import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

/* -------------------------------------------------------------------------
 * Démarrage du serveur : il refuse de démarrer sans configuration complète.
 * ---------------------------------------------------------------------- */

const SERVER = path.resolve(import.meta.dirname, "../src/server.js");

/** Lance server.js avec l'environnement donné et attend sa fin. */
function start(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill(), 10_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

test("sans MONGODB_URI : le serveur refuse de démarrer", async () => {
  const { code, output } = await start({ JWT_SECRET: "secret-de-test" });

  assert.notEqual(code, 0);
  assert.match(output, /MONGODB_URI manque/);
});

test("sans JWT_SECRET : le serveur refuse de démarrer (le secret de secours est public)", async () => {
  const { code, output } = await start({ MONGODB_URI: "mongodb://127.0.0.1:1/aucune" });

  assert.notEqual(code, 0);
  assert.match(output, /JWT_SECRET manque/);
});
