import { Router } from "express";
import fsPromises from "node:fs/promises";
import mongoose from "mongoose";
import { roomEvents } from "../events.js";
import { ALLOWED_MIME_TYPES, MAX_MEDIA_PER_ROOM, MEDIA_URL_TTL_SECONDS } from "../config.js";
import { roomAuth } from "../middleware/roomAuth.js";
import { upload } from "../middleware/upload.js";
import { Media } from "../models/Media.js";

const UNKNOWN_MEDIA = "Média inconnu";

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
      const publicItems = items.map(({ _id, __v, updatedAt, storageKey, roomId, ...media }) => ({
        id: String(_id),
        ...media,
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

  /** Reçoit le champ multipart `file` et le champ texte `title`. */
  router.post("/", roomAuth, upload.single("file"), async (req, res, next) => {
    let stored = false;
    try {
      if (!req.file) {
        console.warn(`[media] Upload sans fichier dans le salon ${req.room.id}`);
        return res.status(400).json({ message: "Fichier requis" });
      }

      if ((await Media.countDocuments({ roomId: req.room.id })) >= MAX_MEDIA_PER_ROOM) {
        console.warn(`[media] Quota atteint dans le salon ${req.room.id}`);
        await discardTempFile(req.file);
        return res.status(409).json({
          message: `Salon plein : ${MAX_MEDIA_PER_ROOM} médias maximum`,
        });
      }

      const key = req.file.filename;
      await storage.save({ tempPath: req.file.path, key });
      stored = true;

      const media = await Media.create({
        roomId: req.room.id,
        kind: ALLOWED_MIME_TYPES.get(req.file.mimetype),
        title: req.body.title || req.file.originalname,
        originalName: req.file.originalname,
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
        await storage.remove(media.storageKey);
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
