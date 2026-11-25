import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStorage } from "../src/storage/index.js";

/*
 * Test d'intégration du stockage réellement configuré (Backblaze B2 avec
 * backend/.env) : envoi d'un petit fichier, URL de lecture, requête Range,
 * suppression. Lancer avec `npm run check:storage`. Il consomme quelques
 * transactions du quota gratuit, d'où son absence de `npm test` et de la CI.
 */
const storage = createStorage();
if (!storage.signedUrl || storage.verifyUrlToken) {
  console.error("[check] Aucune configuration S3 : renseigner les variables S3_* dans backend/.env.");
  process.exit(1);
}

const key = `${crypto.randomUUID()}.txt`;
const content = "sharing-platform : vérification du stockage";
const tempPath = path.join(os.tmpdir(), key);
fs.writeFileSync(tempPath, content);

let ok = true;
const check = (label, condition, detail = "") => {
  console.log(`${condition ? "OK   " : "ÉCHEC"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) ok = false;
};

try {
  await storage.save({ tempPath, key, mimeType: "text/plain" });
  check("envoi dans le bucket", true);
  check("fichier temporaire supprimé", !fs.existsSync(tempPath));

  const { url, expiresAt } = await storage.signedUrl({ key, mimeType: "text/plain", expiresInSeconds: 300 });
  check("URL présignée", url.startsWith("https://"), `expire ${expiresAt}`);

  const full = await fetch(url);
  check("lecture complète", full.status === 200 && (await full.text()) === content, `HTTP ${full.status}`);

  const range = await fetch(url, { headers: { Range: "bytes=0-12" } });
  const partial = await range.text();
  check("requête Range (streaming)", range.status === 206 && partial === content.slice(0, 13), `HTTP ${range.status}`);

  const cors = await fetch(url, { headers: { Range: "bytes=0-0", Origin: "http://localhost:3000" } });
  check(
    "CORS (message d'erreur précis du lecteur)",
    Boolean(cors.headers.get("access-control-allow-origin")),
    cors.headers.get("access-control-allow-origin") ?? "règle CORS absente sur le bucket",
  );

  await storage.remove(key);
  const gone = await fetch(url);
  check("suppression", gone.status === 404 || gone.status === 403, `HTTP ${gone.status} après suppression`);
} catch (error) {
  check("aller-retour avec le bucket", false, `${error.name}: ${error.message}`);
  await storage.remove(key).catch(() => undefined);
} finally {
  fs.rmSync(tempPath, { force: true });
}

process.exit(ok ? 0 : 1);
