import path from "node:path";
import fs from "node:fs";
import { MongoMemoryServer } from "mongodb-memory-server";

/*
 * Démarre l'API avec une base MongoDB locale au lieu de MongoDB Atlas.
 * Utile quand Atlas est inaccessible (IP non autorisée, réseau qui bloque le
 * port 27017, cluster en pause). Réservé au développement.
 *
 * Les données sont gardées dans backend/data/mongo-dev entre deux lancements.
 * Le premier lancement télécharge le binaire MongoDB (une seule fois).
 */
const dbPath = path.resolve(import.meta.dirname, "../data/mongo-dev");
fs.mkdirSync(dbPath, { recursive: true });

console.log("[dev] Démarrage d'une base MongoDB locale (premier lancement : téléchargement)…");
const mongo = await MongoMemoryServer.create({
  instance: { dbPath, storageEngine: "wiredTiger" },
});

// Remplace l'URI Atlas éventuellement présente dans .env.
process.env.MONGODB_URI = mongo.getUri("sharing-platform-dev");
// Un secret de développement suffit si .env n'en fournit pas.
process.env.JWT_SECRET ||= "secret-de-developpement-local";
console.log(`[dev] Base locale prête dans ${dbPath}`);

// Arrête proprement la base avec Ctrl + C.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await mongo.stop({ doCleanup: false });
    process.exit(0);
  });
}

await import("../src/server.js");
