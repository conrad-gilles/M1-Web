import { Router } from "express";
import fsPromises from "node:fs/promises";
import mongoose from "mongoose";
import { roomEvents } from "../events.js";
import { ALLOWED_MIME_TYPES, MAX_FOLDER_FILES_PER_REQUEST, MEDIA_URL_TTL_SECONDS } from "../config.js";
import { roomAuth } from "../middleware/roomAuth.js";
import { upload } from "../middleware/upload.js";
import { Media } from "../models/Media.js";
import { attachmentHeader } from "../storage/s3Storage.js";

const UNKNOWN_MEDIA = "Média inconnu";

/** Nom de dossier nettoyé (1 à 200 caractères), ou null. */
function folderName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name.length <= 200 ? name : null;
}

/**
 * Vérifie un média local (déclaré seul ou dans un dossier) et renvoie
 * `{ value }` prêt pour Media.create, ou `{ error }`.
 */
function localMedia(body) {
  const { title, duration, kind, originalName, mimeType, size } = body ?? {};
  if (typeof title !== "string" || !title.trim() || title.trim().length > 200) {
    return { error: "Titre requis (200 caractères maximum)" };
  }
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return { error: "Durée du média requise (nombre de secondes positif)" };
  }
  if (kind !== "audio" && kind !== "video") {
    return { error: "Type de média requis : audio ou video" };
  }
  return {
    value: {
      source: "local",
      kind,
      title: title.trim(),
      duration,
      originalName: typeof originalName === "string" ? originalName.slice(0, 500) : "",
      mimeType: typeof mimeType === "string" ? mimeType.slice(0, 100) : "",
      size: Number.isFinite(size) && size >= 0 ? size : 0,
    },
  };
}

/** Refuse tôt un identifiant qui n'est pas un ObjectId MongoDB. */
function validId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    console.warn(`[media] Identifiant invalide : ${req.params.id}`);
    return res.status(404).json({ message: UNKNOWN_MEDIA });
  }
  next();
}

/** Supprime le fichier temporaire de Multer s'il existe encore. */
async function discardTempFile(file) {
  if (!file) return;
  try {
    await fsPromises.unlink(file.path);
    console.log(`[media] Fichier temporaire supprimé : ${file.filename}`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`[media] Fichier temporaire non supprimé : ${file.filename}`, error);
    }
  }
}

/**
 * Routes des médias d'un salon. Chaque requête est filtrée sur le salon du
 * jeton (`req.room.id`) : un jeton d'un autre salon ne trouve rien (404).
 * Flux d'un upload : multipart/form-data -> Multer
 * (dossier temporaire, taille et type contrôlés) -> module de stockage ->
 * métadonnées dans MongoDB.
 */
export function mediaRoutes({ storage }) {
  const router = Router();

  /** Retourne une page des médias du salon. */
  router.get("/", roomAuth, async (req, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
      const filter = { roomId: req.room.id };

      console.log(`[media] Lecture page=${page}, limit=${limit}, salon=${req.room.id}`);

      // La page demandée et le total sont lus en parallèle.
      const [items, total] = await Promise.all([
        Media.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .select("-storageKey -roomId")
          .lean(),
        Media.countDocuments(filter),
      ]);

      // L'identifiant MongoDB (_id) devient `id`, plus simple côté frontend.
      const publicItems = items.map(({ _id, __v, updatedAt, storageKey, roomId, ownerId, ownerName, ...media }) => ({
        id: String(_id),
        ...media,
        // Médias créés avant l'option « fichier local » : ce sont des uploads.
        source: media.source ?? "upload",
        duration: media.duration ?? null,
        folder: media.folder ?? null,
        owner: media.source === "p2p" ? { id: ownerId, name: ownerName } : null,
      }));

      console.log(`[media] ${publicItems.length} média(s) envoyé(s) sur ${total}`);
      res.json({
        items: publicItems,
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (error) {
      console.error("[media] Erreur de pagination", error);
      next(error);
    }
  });

  /**
   * Reçoit le champ multipart `file`, et les champs texte `title` et `folder`
   * (dossier d'origine, pour l'envoi d'un dossier entier, un fichier par requête).
   * Pas de nombre maximal de médias : un stockage plein donne une erreur 507.
   */
  router.post("/", roomAuth, upload.single("file"), async (req, res, next) => {
    let stored = false;
    try {
      if (!req.file) {
        console.warn(`[media] Upload sans fichier dans le salon ${req.room.id}`);
        return res.status(400).json({ message: "Fichier requis" });
      }

      const key = req.file.filename;
      await storage.save({ tempPath: req.file.path, key, mimeType: req.file.mimetype });
      stored = true;

      const media = await Media.create({
        roomId: req.room.id,
        kind: ALLOWED_MIME_TYPES.get(req.file.mimetype),
        title: req.body.title || req.file.originalname,
        originalName: req.file.originalname,
        folder: folderName(req.body.folder),
        storageKey: key,
        mimeType: req.file.mimetype,
        size: req.file.size,
      });

      console.log(`[media] Upload enregistré : ${media.id}`);
      roomEvents.emit("media:changed", req.room.id);
      res.status(201).json(media.toPublic());
    } catch (error) {
      console.error("[media] Erreur pendant l'enregistrement du média", error);

      // Aucun fichier orphelin ne doit rester si une étape échoue.
      await discardTempFile(req.file);
      if (stored) {
        try {
          await storage.remove(req.file.filename);
        } catch (cleanupError) {
          console.error(`[media] Fichier orphelin non supprimé : ${req.file.filename}`, cleanupError);
        }
      }
      next(error);
    }
  });

  /**
   * Déclare un média local : rien n'est envoyé, seules ses métadonnées sont
   * enregistrées. Pendant la lecture, chaque participant choisit sa propre
   * copie du fichier ; le navigateur l'accepte si sa durée est la même (à
   * 1 s près). Le nom, la taille ou le format peuvent différer.
   * Corps JSON : { title, duration, kind, originalName?, mimeType?, size? }.
   */
  router.post("/local", roomAuth, async (req, res, next) => {
    try {
      const checked = localMedia(req.body);
      if (checked.error) {
        console.warn(`[media] Média local refusé dans le salon ${req.room.id} : ${checked.error}`);
        return res.status(400).json({ message: checked.error });
      }

      const media = await Media.create({ roomId: req.room.id, ...checked.value });

      console.log(`[media] Média local déclaré : ${media.id} (${media.duration.toFixed(1)} s)`);
      roomEvents.emit("media:changed", req.room.id);
      res.status(201).json(media.toPublic());
    } catch (error) {
      console.error("[media] Erreur pendant la déclaration du média local", error);
      next(error);
    }
  });

  /**
   * Partage en direct (P2P) : le fichier reste sur l'appareil du participant
   * qui le partage et part directement vers les autres navigateurs (WebRTC,
   * signalisation par Socket.IO, voir SYNC_PROTOCOL.md). Le serveur ne garde
   * que les métadonnées et qui partage. Corps JSON : comme /local.
   */
  router.post("/p2p", roomAuth, async (req, res, next) => {
    try {
      const checked = localMedia(req.body);
      if (checked.error) {
        console.warn(`[media] Partage direct refusé dans le salon ${req.room.id} : ${checked.error}`);
        return res.status(400).json({ message: checked.error });
      }
      const media = await Media.create({
        roomId: req.room.id,
        ...checked.value,
        source: "p2p",
        ownerId: req.participant.id,
        ownerName: req.participant.name,
      });
      console.log(`[media] Partage direct déclaré : ${media.id} par ${req.participant.id}`);
      roomEvents.emit("media:changed", req.room.id);
      res.status(201).json(media.toPublic());
    } catch (error) {
      console.error("[media] Erreur pendant la déclaration du partage direct", error);
      next(error);
    }
  });

  /**
   * Déclare les fichiers d'un dossier local (rien n'est envoyé). Corps JSON :
   * { folder, items: [{ title?, originalName, duration, kind, mimeType?, size? }] }
   * où `originalName` est le chemin du fichier dans le dossier. Un autre
   * participant y accède en choisissant un dossier de même nom : chaque
   * fichier de même chemin et de même durée devient lisible pour lui.
   */
  router.post("/local-folder", roomAuth, async (req, res, next) => {
    try {
      const folder = folderName(req.body?.folder);
      const items = req.body?.items;
      const invalid = (message) => {
        console.warn(`[media] Dossier local refusé dans le salon ${req.room.id} : ${message}`);
        return res.status(400).json({ message });
      };
      if (!folder) return invalid("Nom du dossier requis (200 caractères maximum)");
      if (!Array.isArray(items) || items.length === 0 || items.length > MAX_FOLDER_FILES_PER_REQUEST) {
        return invalid(`Liste de fichiers requise (${MAX_FOLDER_FILES_PER_REQUEST} au plus par envoi)`);
      }

      const documents = [];
      for (const item of items) {
        // Titre par défaut : le nom du fichier (sans le chemin dans le dossier).
        const title = item?.title || String(item?.originalName ?? "").split("/").pop();
        const checked = localMedia({ ...item, title });
        if (checked.error) return invalid(`${item?.originalName ?? "?"} : ${checked.error}`);
        if (!checked.value.originalName) return invalid("Chemin du fichier requis dans le dossier");
        documents.push({ roomId: req.room.id, ...checked.value, folder });
      }

      const created = await Media.insertMany(documents);
      console.log(`[media] Dossier local « ${folder} » déclaré : ${created.length} fichier(s)`);
      roomEvents.emit("media:changed", req.room.id);
      res.status(201).json(created.map((media) => media.toPublic()));
    } catch (error) {
      console.error("[media] Erreur pendant la déclaration du dossier local", error);
      next(error);
    }
  });

  /** Tous les médias d'un dossier du salon (pour qu'un participant y relie le sien). */
  router.get("/folder", roomAuth, async (req, res, next) => {
    try {
      const folder = folderName(req.query.name);
      if (!folder) return res.status(400).json({ message: "Nom du dossier requis (200 caractères maximum)" });
      const items = await Media.find({ roomId: req.room.id, folder }).sort({ originalName: 1 });
      res.json(items.map((media) => media.toPublic()));
    } catch (error) {
      console.error("[media] Erreur de lecture du dossier", error);
      next(error);
    }
  });

  /**
   * URL de téléchargement d'un média envoyé : même URL temporaire que la
   * lecture, mais le navigateur enregistre le fichier sous son nom d'origine.
   * Avec Backblaze B2, chaque téléchargement compte dans le quota gratuit du
   * jour (1 Go). Un média local n'a pas de fichier sur le serveur (409).
   */
  router.get("/:id/download", roomAuth, validId, async (req, res, next) => {
    try {
      const media = await Media.findOne({ _id: req.params.id, roomId: req.room.id }).select("+storageKey");
      if (!media) return res.status(404).json({ message: UNKNOWN_MEDIA });
      if (media.source === "local") {
        return res.status(409).json({ message: "Média local : aucun fichier à télécharger sur le serveur" });
      }
      if (media.source === "p2p") {
        return res.status(409).json({ message: "Média partagé en direct : aucun fichier à télécharger sur le serveur" });
      }

      const signed = await storage.signedUrl({
        key: media.storageKey,
        mediaId: media.id,
        mimeType: media.mimeType,
        expiresInSeconds: MEDIA_URL_TTL_SECONDS,
        downloadName: media.originalName.split("/").pop() || "media",
      });
      console.log(`[media] URL de téléchargement émise pour ${media.id}`);
      res.json(signed);
    } catch (error) {
      console.error("[media] Erreur de préparation du téléchargement", error);
      next(error);
    }
  });

  /**
   * Fournit une URL de lecture temporaire à un participant du salon. <audio src> ne peut pas envoyer
   * d'en-tête Authorization : le navigateur charge donc cette URL signée, et
   * le lecteur diffuse le fichier par morceaux (requêtes Range).
   */
  router.get("/:id/url", roomAuth, validId, async (req, res, next) => {
    try {
      const media = await Media.findOne({
        _id: req.params.id,
        roomId: req.room.id,
      }).select("+storageKey");

      if (!media) {
        console.warn(`[media] Média introuvable ou interdit : ${req.params.id}`);
        return res.status(404).json({ message: UNKNOWN_MEDIA });
      }

      // Média local ou partagé en direct : pas de fichier sur le serveur. Le
      // lecteur demande sa copie à chacun (local) ou la reçoit du participant
      // qui la partage (p2p, WebRTC).
      if (media.source === "local" || media.source === "p2p") {
        return res.json({ url: null, expiresAt: null, media: media.toPublic() });
      }

      const signed = await storage.signedUrl({
        key: media.storageKey,
        mediaId: media.id,
        mimeType: media.mimeType,
        expiresInSeconds: MEDIA_URL_TTL_SECONDS,
      });
      console.log(`[media] URL de lecture émise pour ${media.id}`);
      res.json({ ...signed, media: media.toPublic() });
    } catch (error) {
      console.error("[media] Erreur de préparation de l'URL de lecture", error);
      next(error);
    }
  });

  /**
   * Envoie le contenu du fichier (stockage local uniquement). L'accès repose
   * sur le jeton signé de l'URL. res.sendFile répond aux requêtes Range par
   * `206 Partial Content`, ce qui permet la lecture progressive et le seek.
   */
  router.get("/:id/stream", validId, (req, res, next) => {
    if (!storage.verifyUrlToken) {
      return res.status(404).json({ message: UNKNOWN_MEDIA });
    }

    let file;
    try {
      file = storage.verifyUrlToken(req.query.token, req.params.id);
    } catch (error) {
      console.warn(`[media] Lien de lecture refusé pour ${req.params.id} : ${error.message}`);
      return res.status(401).json({ message: "Lien de lecture invalide ou expiré" });
    }

    // URL de téléchargement : le navigateur enregistre le fichier sous son nom d'origine.
    if (file.downloadName) res.set("Content-Disposition", attachmentHeader(file.downloadName));
    res.type(file.mimeType);
    res.sendFile(file.filePath, { cacheControl: false }, (error) => {
      if (!error) return;
      // Un lecteur qui change de position interrompt la requête en cours :
      // ce n'est pas une erreur du serveur.
      if (error.code === "ECONNABORTED" || res.headersSent) {
        console.debug(`[media] Envoi interrompu par le client : ${req.params.id}`);
        return;
      }
      if (error.code === "ENOENT") {
        console.warn(`[media] Fichier absent du stockage : ${req.params.id}`);
        return res.status(404).json({ message: UNKNOWN_MEDIA });
      }
      console.error(`[media] Erreur d'envoi du média ${req.params.id}`, error);
      next(error);
    });
  });

  /** Supprime la métadonnée et le fichier correspondant. */
  router.delete("/:id", roomAuth, validId, async (req, res, next) => {
    try {
      const media = await Media.findOneAndDelete({
        _id: req.params.id,
        roomId: req.room.id,
      }).select("+storageKey");

      if (!media) {
        console.warn(`[media] Suppression impossible : ${req.params.id}`);
        return res.status(404).json({ message: UNKNOWN_MEDIA });
      }

      try {
        if (media.storageKey) await storage.remove(media.storageKey); // rien à supprimer pour un média local
      } catch (error) {
        // L'exception n'est volontairement pas ignorée : l'administrateur doit
        // voir ce fichier orphelin si sa suppression échoue.
        console.error(`[media] Fichier non supprimé : ${media.storageKey}`, error);
        roomEvents.emit("media:removed", req.room.id, media.id);
        roomEvents.emit("media:changed", req.room.id);
        return res.status(500).json({
          message: "Métadonnée supprimée, mais fichier non supprimé",
        });
      }

      console.log(`[media] Média supprimé : ${media.id}`);
      // Le lecteur du salon se vide si ce média était en cours de lecture.
      roomEvents.emit("media:removed", req.room.id, media.id);
      roomEvents.emit("media:changed", req.room.id);
      res.status(204).end();
    } catch (error) {
      console.error("[media] Erreur de suppression", error);
      next(error);
    }
  });

  return router;
}
