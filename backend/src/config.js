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

// Emplacement du build Angular (`npm run build` dans frontend/).
export const FRONTEND_DIST = path.resolve(
  import.meta.dirname,
  "../../frontend/dist/sharing-platform/browser",
);

// Pas de limite de taille par fichier (décision du projet, novembre 2026) :
// la vraie limite est l'espace et le quota gratuits du stockage. Quand ils
// sont épuisés, l'upload échoue avec une erreur 507 explicite (storage/errors.js)
// et le frontend avertit l'utilisateur au-delà de 1 Go.

// Durée de validité d'une URL de lecture. Elle doit couvrir la durée du média
// (un film dure plusieurs heures) : 6 h par défaut.
export const MEDIA_URL_TTL_SECONDS =
  Number(process.env.MEDIA_URL_TTL_SECONDS) || 6 * 60 * 60;

// Types MIME acceptés et famille de média correspondante. La famille décide du
// lecteur affiché côté Angular (<audio> ou <video>). Seuls les conteneurs vidéo
// lisibles nativement par les navigateurs courants sont acceptés (pas de .mov,
// .avi ni .mkv).
export const ALLOWED_MIME_TYPES = new Map([
  ["audio/mpeg", "audio"],
  ["audio/wav", "audio"],
  ["audio/x-wav", "audio"],
  ["audio/ogg", "audio"],
  ["audio/mp4", "audio"],
  ["audio/x-m4a", "audio"],
  ["video/mp4", "video"],
  ["video/webm", "video"],
  ["video/ogg", "video"],
]);

// --- Salons ---------------------------------------------------------------

// Alphabet des codes de salon, sans caractères qui se ressemblent (0/O, 1/I/L).
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

// Un salon inactif depuis cette durée expire ; ses fichiers sont supprimés.
export const ROOM_TTL_MS = (Number(process.env.ROOM_TTL_HOURS) || 24) * 60 * 60 * 1000;

// Le projet vise de petits groupes (2 à 10 personnes par salon).
export const MAX_PARTICIPANTS = 10;

// Quota par salon : le stockage gratuit est partagé entre tous les salons.
export const MAX_MEDIA_PER_ROOM = 20;

export const MAX_NAME_LENGTH = 30;

// Limites par adresse IP. Les codes sont courts : sans limite, ils pourraient
// être devinés par force brute. Réglables pour les tests de bout en bout, qui
// créent de nombreux salons depuis la même adresse.
export const RATE_LIMITS = {
  failedJoinsPer10Min: Number(process.env.FAILED_JOINS_PER_10_MIN) || 10,
  creationsPerHour: Number(process.env.ROOM_CREATIONS_PER_HOUR) || 10,
};
