import path from "node:path";

/*
 * Configuration lue une seule fois au démarrage. Les secrets viennent de
 * l'environnement (backend/.env en local, tableau de bord Render en
 * production) et ne sont jamais copiés dans Angular ni dans les logs.
 */

// Ce secret de secours ne sert qu'aux tests : server.js refuse de démarrer
// sans JWT_SECRET.
export const SECRET = process.env.JWT_SECRET || "tp1-development-secret";

// Dossier de données du backend, indépendant du dossier courant du processus.
export const DATA_DIR = path.resolve(import.meta.dirname, "../data");

// Emplacement du build Angular (`npm run build` dans frontend-starter/).
export const FRONTEND_DIST = path.resolve(
  import.meta.dirname,
  "../../frontend-starter/dist/gpc/browser",
);

// Les fichiers plus gros sont refusés par Multer avant la fin de l'écriture.
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

// Durée de validité d'une URL de lecture. Elle doit couvrir la durée du média
// (un film dure plusieurs heures) : 6 h par défaut.
export const MEDIA_URL_TTL_SECONDS =
  Number(process.env.MEDIA_URL_TTL_SECONDS) || 6 * 60 * 60;

// Types MIME acceptés et famille de média correspondante. La vidéo (phase
// 3.5) s'ajoutera ici.
export const ALLOWED_MIME_TYPES = new Map([
  ["audio/mpeg", "audio"],
  ["audio/wav", "audio"],
  ["audio/x-wav", "audio"],
  ["audio/ogg", "audio"],
  ["audio/mp4", "audio"],
  ["audio/x-m4a", "audio"],
]);
