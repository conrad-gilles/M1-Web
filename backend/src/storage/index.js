import path from "node:path";
import { DATA_DIR, SECRET } from "../config.js";
import { createLocalStorage } from "./localStorage.js";
import { createS3Storage } from "./s3Storage.js";

const S3_VARIABLES = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];

/**
 * Choisit l'implémentation du stockage des médias :
 * - les cinq variables S3_* renseignées : Backblaze B2 (production, et
 *   développement avec backend/.env) ;
 * - aucune : disque local (tests, développement hors ligne) ;
 * - certaines seulement : erreur au démarrage plutôt qu'un stockage inattendu.
 */
export function createStorage(env = process.env) {
  const missing = S3_VARIABLES.filter((name) => !env[name]);

  if (missing.length === 0) {
    return createS3Storage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  if (missing.length < S3_VARIABLES.length) {
    throw new Error(`Configuration S3 incomplète, variables manquantes : ${missing.join(", ")}`);
  }
  return createLocalStorage({
    directory: path.join(DATA_DIR, "uploads"),
    secret: SECRET,
  });
}
