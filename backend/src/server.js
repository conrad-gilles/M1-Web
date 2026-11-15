import mongoose from "mongoose";
import { createApp } from "./app.js";
import { purgeExpiredRooms } from "./services/roomService.js";
import { createStorage } from "./storage/index.js";

// Le port et l'URI viennent de l'environnement du backend, jamais d'Angular.
const port = process.env.PORT || 3000;
const uri = process.env.MONGODB_URI;

if (!uri) {
  const error = new Error("MONGODB_URI manque dans backend/.env");
  console.error("[startup] Configuration MongoDB absente", error);
  throw error;
}

// Sans JWT_SECRET, app.js utiliserait un secret de secours visible dans le
// dépôt public : n'importe qui pourrait alors fabriquer des jetons valides.
if (!process.env.JWT_SECRET) {
  const error = new Error("JWT_SECRET manque dans backend/.env");
  console.error("[startup] Secret JWT absent", error);
  throw error;
}

try {
  // `await` suspend le démarrage jusqu'à la connexion effective à MongoDB.
  // Le `then` rend le succès visible dans les logs.
  await mongoose.connect(uri).then(() => {
    console.log("[startup] Connecté à MongoDB Atlas");
    console.log(
      "[startup] La base guitar-practice-cloud est prête à recevoir des données",
    );
    console.log(`[startup] Vérification : http://localhost:${port}/api/health`);
  });
} catch (error) {
  // Ne pas démarrer une API qui ne peut pas accéder à sa base de données.
  console.error("[startup] Échec de connexion à MongoDB", error);
  throw error;
}

const storage = createStorage();

/** Supprime les salons expirés ; une erreur ne doit pas arrêter le serveur. */
async function purge() {
  try {
    await purgeExpiredRooms(storage);
  } catch (error) {
    console.error("[rooms] Échec du nettoyage des salons expirés", error);
  }
}

await purge();
// unref() : ce minuteur ne doit pas empêcher l'arrêt du processus.
setInterval(purge, 60 * 60 * 1000).unref();

const server = createApp({ storage }).listen(port, () => {
  console.log(`Guitar Practice Cloud API: http://localhost:${port}/api/health`);
});

// Le callback `error` couvre notamment un port déjà utilisé.
server.on("error", (error) => {
  console.error(`[startup] Impossible d'écouter sur le port ${port}`, error);
});
