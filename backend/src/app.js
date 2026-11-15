import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { FRONTEND_DIST } from "./config.js";
import { httpLogger } from "./middleware/httpLogger.js";
import { UNSUPPORTED_FORMAT } from "./middleware/upload.js";
import { mediaRoutes } from "./routes/mediaRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";
import { createStorage } from "./storage/index.js";

/**
 * Construit l'application Express sans ouvrir de port.
 * Cette séparation permet au serveur réel et aux tests de créer la même
 * application. Le port est ouvert uniquement dans server.js. Les tests
 * peuvent injecter un autre stockage ou un autre dossier de build.
 */
export function createApp({ frontendDir = FRONTEND_DIST, storage = createStorage() } = {}) {
  const app = express();

  app.use(httpLogger);

  // CORS est nécessaire pour que le frontend Angular puisse appeler l'API
  // depuis une autre origine. Dans un vrai projet, il est recommandé de
  // limiter les origines autorisées.
  app.use(cors());

  // Transforme un corps JSON en objet JavaScript accessible via req.body.
  app.use(express.json());

  /** Endpoint public utilisé pour vérifier que l'API répond. */
  app.get("/api/health", (_req, res) => {
    console.log("[health] Vérification de l'API");
    res.json({ status: "ok" });
  });

  app.use("/api", userRoutes());
  app.use("/api/media", mediaRoutes({ storage }));

  // Une route /api inconnue répond en JSON : elle ne doit jamais recevoir la
  // page Angular servie ci-dessous.
  app.use("/api", (req, res) => {
    console.warn(`[http] Route API inconnue : ${req.method} ${req.path}`);
    res.status(404).json({ message: "Ressource inconnue" });
  });

  // En production (Render), Express sert aussi le build Angular : le frontend
  // et l'API partagent alors la même origine, sans configuration CORS. En
  // développement, le build est absent et `ng serve` joue ce rôle.
  const indexFile = path.join(frontendDir, "index.html");
  if (fs.existsSync(indexFile)) {
    console.log(`[startup] Build Angular servi depuis ${frontendDir}`);
    app.use(express.static(frontendDir));
    // Toute autre requête GET reçoit index.html : c'est le routeur Angular qui
    // interprète ensuite l'URL.
    app.get(/.*/, (_req, res, next) => {
      res.sendFile(indexFile, (error) => {
        if (error) {
          console.error("[http] Erreur d'envoi de index.html", error);
          if (!res.headersSent) next(error);
        }
      });
    });
  } else {
    console.log("[startup] Aucun build Angular à servir (mode développement)");
  }

  /** Gestionnaire central des erreurs connues de l'application. */
  app.use((error, _req, res, next) => {
    console.error("[error] Erreur reçue par le gestionnaire central", error);

    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "Fichier trop volumineux (25 Mo maximum)"
          : error.message;
      return res.status(400).json({ message });
    }
    if (error?.message === UNSUPPORTED_FORMAT) {
      return res.status(400).json({ message: error.message });
    }
    if (error?.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    if (error?.name === "CastError") {
      return res.status(404).json({ message: "Ressource inconnue" });
    }

    next(error);
  });

  return app;
}
