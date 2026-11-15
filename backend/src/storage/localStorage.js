import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";

// Une clé de stockage est toujours générée par le serveur : un UUID suivi
// d'une extension simple. Toute autre forme est refusée, ce qui interdit les
// chemins relatifs du type "../../.env".
const KEY_PATTERN = /^[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/;

/**
 * Stockage des médias sur le disque local, pour le développement et les tests.
 * L'implémentation S3 (Backblaze B2, phase 3.4) exposera les mêmes fonctions
 * `save`, `signedUrl` et `remove`.
 */
export function createLocalStorage({ directory, secret }) {
  fs.mkdirSync(directory, { recursive: true });
  console.log(`[storage] Stockage local prêt : ${directory}`);

  function pathFor(key) {
    if (!KEY_PATTERN.test(String(key))) {
      throw new Error("Clé de stockage invalide");
    }
    return path.join(directory, key);
  }

  return {
    /** Range dans le stockage un fichier temporaire déjà écrit par Multer. */
    async save({ tempPath, key }) {
      await fsPromises.rename(tempPath, pathFor(key));
      console.log(`[storage] Fichier enregistré : ${key}`);
    },

    /**
     * Fabrique une URL de lecture temporaire, limitée à un seul média. Le
     * navigateur la place directement dans <audio src> : elle ne peut pas
     * porter d'en-tête Authorization, d'où le jeton signé dans l'URL.
     */
    async signedUrl({ key, mediaId, mimeType, expiresInSeconds }) {
      pathFor(key);
      const token = jwt.sign({ typ: "media-url", mid: mediaId, key, mime: mimeType }, secret, {
        expiresIn: expiresInSeconds,
      });
      return {
        url: `/api/media/${mediaId}/stream?token=${token}`,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      };
    },

    /**
     * Vérifie le jeton d'une URL de lecture (signature, expiration, média
     * visé) et renvoie le fichier à envoyer. Lève une erreur sinon.
     */
    verifyUrlToken(token, mediaId) {
      const payload = jwt.verify(String(token), secret);
      if (payload.typ !== "media-url" || payload.mid !== mediaId) {
        throw new Error("Jeton de lecture émis pour un autre usage");
      }
      return { filePath: pathFor(payload.key), mimeType: payload.mime };
    },

    /** Supprime un fichier. Un fichier déjà absent n'est pas une erreur. */
    async remove(key) {
      try {
        await fsPromises.unlink(pathFor(key));
        console.log(`[storage] Fichier supprimé : ${key}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        console.warn(`[storage] Fichier déjà absent : ${key}`);
      }
    },
  };
}
