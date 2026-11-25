import fs from "node:fs";
import fsPromises from "node:fs/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Même règle que le stockage local : une clé est toujours générée par le
// serveur (UUID + extension simple).
const KEY_PATTERN = /^[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/;

// Une URL présignée S3 ne peut pas durer plus de 7 jours.
const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

function checkKey(key) {
  if (!KEY_PATTERN.test(String(key))) throw new Error("Clé de stockage invalide");
}

/**
 * Backblaze B2 refuse un envoi par un 403 dont le message parle de « cap
 * exceeded » quand le quota gratuit de stockage (10 Go) est atteint. On le
 * traduit en STORAGE_FULL, que app.js transforme en erreur 507 claire.
 */
function isStorageCapError(error) {
  return error?.$metadata?.httpStatusCode === 403 && /storage cap|cap exceeded/i.test(error.message ?? "");
}

/** Envoi en plusieurs morceaux (multipart) : un gros fichier ne tient jamais en mémoire. */
async function uploadWithSdk(client, params) {
  await new Upload({ client, params, queueSize: 2, partSize: 8 * 1024 * 1024 }).done();
}

/**
 * Stockage des médias dans un bucket S3 compatible, ici Backblaze B2 (bucket
 * privé). Mêmes fonctions que le stockage local : `save`, `signedUrl`,
 * `remove`. Il n'y a pas de route /stream : le navigateur lit directement une
 * URL présignée de B2, qui répond lui-même aux requêtes Range.
 *
 * `client`, `uploadFile` et `presign` sont remplaçables pour les tests.
 */
export function createS3Storage({
  endpoint,
  region,
  bucket,
  accessKeyId,
  secretAccessKey,
  client,
  uploadFile = uploadWithSdk,
  presign = getSignedUrl,
}) {
  client ??= new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    // Les sommes de contrôle ajoutées par défaut par les versions récentes du
    // SDK ne sont pas toutes acceptées par les services S3 compatibles.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  console.log(`[storage] Stockage S3 prêt : bucket ${bucket} (${endpoint})`);

  return {
    /** Envoie dans le bucket le fichier temporaire écrit par Multer, puis le supprime. */
    async save({ tempPath, key, mimeType }) {
      checkKey(key);
      try {
        await uploadFile(client, {
          Bucket: bucket,
          Key: key,
          Body: fs.createReadStream(tempPath),
          ContentType: mimeType,
        });
      } catch (error) {
        if (isStorageCapError(error)) {
          console.error("[storage] Quota de stockage du bucket atteint", error);
          throw Object.assign(new Error("Quota de stockage atteint"), { code: "STORAGE_FULL", cause: error });
        }
        throw error;
      }
      await fsPromises.unlink(tempPath).catch((error) => {
        if (error.code !== "ENOENT") console.error(`[storage] Fichier temporaire non supprimé : ${tempPath}`, error);
      });
      console.log(`[storage] Fichier envoyé dans le bucket : ${key}`);
    },

    /** URL de lecture présignée, limitée à ce fichier et à une durée (7 jours au plus). */
    async signedUrl({ key, mimeType, expiresInSeconds }) {
      checkKey(key);
      const expiresIn = Math.min(expiresInSeconds, MAX_PRESIGN_SECONDS);
      const url = await presign(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: mimeType }),
        { expiresIn },
      );
      return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
    },

    /**
     * Supprime le fichier et toutes ses versions. Sur B2, un simple
     * DeleteObject ne fait que « cacher » le fichier, qui continue de compter
     * dans les 10 Go gratuits.
     */
    async remove(key) {
      checkKey(key);
      const listed = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }));
      const versions = [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])].filter(
        (version) => version.Key === key,
      );
      if (versions.length === 0) {
        console.warn(`[storage] Fichier déjà absent du bucket : ${key}`);
        return;
      }
      for (const { VersionId } of versions) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId }));
      }
      console.log(`[storage] Fichier supprimé du bucket : ${key} (${versions.length} version(s))`);
    },
  };
}
