import path from "node:path";
import { DATA_DIR, SECRET } from "../config.js";
import { createLocalStorage } from "./localStorage.js";

/**
 * Choisit l'implémentation du stockage des médias. Seul le disque local
 * existe pour l'instant ; l'implémentation S3 (phase 3.4) sera sélectionnée
 * ici à partir des variables d'environnement S3_*.
 */
export function createStorage() {
  return createLocalStorage({
    directory: path.join(DATA_DIR, "uploads"),
    secret: SECRET,
  });
}
