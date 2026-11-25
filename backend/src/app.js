import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { FRONTEND_DIST } from "./config.js";
import { httpLogger } from "./middleware/httpLogger.js";
import { UNSUPPORTED_FORMAT } from "./middleware/upload.js";
import { mediaRoutes } from "./routes/mediaRoutes.js";
import { roomRoutes } from "./routes/roomRoutes.js";
import { createStorage } from "./storage/index.js";
import { STORAGE_FULL, isStorageFull } from "./storage/errors.js";

/**
 * Construit l'application Express sans ouvrir de port.
 * Cette séparation permet au serveur réel et aux tests de créer la même
 * application. Le port est ouvert uniquement dans server.js. Les tests
 * peuvent injecter un autre stockage, un autre dossier de build ou d'autres
 * limites de fréquence.
 */
export function createApp({
  frontendDir = FRONTEND_DIST,
  storage = createStorage(),
  limits,
} = {}) {
  const app = express();

  app.use(httpLogger);

  // Derrière le proxy de Render, l'adresse du client est dans X-Forwarded-For.
  // Elle sert à limiter les tentatives par adresse IP.
  if (process.env.TRUST_PROXY) {
    app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
  }

  // Le frontend et l'API partagent la même origine (proxy `ng serve` en
  // développement, build servi par Express en production) : CORS est donc
  // fermé par défaut. CORS_ORIGIN n'ouvre l'API qu'à un frontend hébergé
  // ailleurs (par exemple GitHub Pages).
  if (process.env.CORS_ORIGIN) {
    const origins = process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim());
    console.log(`[startup] CORS autorisé pour : ${origins.join(", ")}`);
    app.use(cors({ origin: origins }));
  }

  // Transforme un corps JSON en objet JavaScript accessible via req.body.
  app.use(express.json());

  /** Endpoint public utilisé pour vérifier que l'API répond. */
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/rooms", roomRoutes({ storage, limits }));
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
    // Certains navigateurs demandent /favicon.ico même quand la page déclare
    // une icône SVG : on les renvoie vers celle-ci.
    app.get("/favicon.ico", (_req, res) => res.redirect(301, "/favicon.svg"));
    // Toute autre requête GET reçoit index.html : c'est le routeur Angular qui
    // interprète ensuite l'URL.
    app.get(/.*/, (req, res, next) => {
      // Un fichier absent du build (script, image...) reste une erreur 404 :
      // lui répondre par la page HTML masquerait le problème.
      if (path.extname(req.path)) return next();
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
      return res.status(400).json({ message: error.message });
    }
    // Disque ou quota de stockage épuisé : 507 Insufficient Storage.
    if (isStorageFull(error)) {
      return res.status(507).json({ message: STORAGE_FULL });
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
    // Corps JSON illisible envoyé par le client.
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ message: "Corps JSON invalide" });
    }

    // Erreur inattendue (base indisponible, bug...) : détail dans les logs
    // uniquement. Le gestionnaire par défaut d'Express renverrait une page
    // HTML contenant la pile d'appels.
    if (res.headersSent) return next(error);
    res.status(500).json({ message: "Erreur interne du serveur" });
  });

  return app;
}
