import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { ALLOWED_MIME_TYPES, DATA_DIR, MAX_FILE_SIZE } from "../config.js";

// Multer écrit d'abord dans un dossier temporaire ; le module de stockage
// déplace ensuite le fichier à son emplacement définitif.
const TEMP_DIR = path.join(DATA_DIR, "tmp");
fs.mkdirSync(TEMP_DIR, { recursive: true });

export const UNSUPPORTED_FORMAT = "Format de média non accepté";

/*
 * Le nom aléatoire évite les collisions et n'utilise jamais `originalname`
 * comme chemin. limits.fileSize protège le serveur contre les fichiers trop
 * volumineux ; fileFilter refuse les types absents de la liste blanche avant
 * toute écriture.
 */
export const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, TEMP_DIR),
    filename: (_request, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
      callback(null, crypto.randomUUID() + safeExtension);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_request, file, callback) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      console.log(`[multer] Type accepté : ${file.mimetype}`);
      return callback(null, true);
    }
    const error = new Error(UNSUPPORTED_FORMAT);
    console.error(`[multer] Type refusé : ${file.mimetype}`, error);
    return callback(error);
  },
});
