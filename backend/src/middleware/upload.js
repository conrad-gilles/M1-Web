import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { ALLOWED_MIME_TYPES, DATA_DIR } from "../config.js";

// Multer écrit d'abord dans un dossier temporaire ; le module de stockage
// déplace ensuite le fichier à son emplacement définitif.
const TEMP_DIR = path.join(DATA_DIR, "tmp");
fs.mkdirSync(TEMP_DIR, { recursive: true });

export const UNSUPPORTED_FORMAT = "Format de média non accepté";

/*
 * Le nom aléatoire évite les collisions et n'utilise jamais `originalname`
 * comme chemin. Aucune limite de taille : un disque plein est signalé par une
 * erreur 507 (voir storage/errors.js). fileFilter refuse les types absents de
 * la liste blanche avant toute écriture.
 */
export const upload = multer({
  // Noms de fichiers en UTF-8 : sans cela, « été.mp3 » arrive en « Ã©tÃ©.mp3 ».
  defParamCharset: "utf8",
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, TEMP_DIR),
    filename: (_request, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
      callback(null, crypto.randomUUID() + safeExtension);
    },
  }),
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
