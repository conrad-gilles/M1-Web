import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/*
 * Tests de bout en bout : de vrais navigateurs sur l'application complète
 * (backend, base MongoDB locale éphémère, build Angular servi par Express).
 * Le build Angular doit exister : `npm run test:full` le construit d'abord.
 */
const PORT = 3100;
const BUILD = path.resolve(import.meta.dirname, "../frontend/dist/sharing-platform/browser/index.html");
if (!fs.existsSync(BUILD)) {
  throw new Error("Build Angular absent : lancer `npm run test:full`, ou `npm run build` dans frontend/.");
}

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Un seul serveur pour toute la suite ; chaque test crée ses propres salons.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    // Les tests lisent des médias : aucun son ne doit sortir de la machine.
    launchOptions: { args: ["--mute-audio"] },
    // L'interface suit la langue du navigateur : les tests vérifient le
    // français ; l'anglais est testé à part (langue.spec.js).
    locale: "fr-FR",
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ../backend/scripts/start-memory.js",
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      PORT: String(PORT),
      MEMORY_DB_EPHEMERAL: "1",
      JWT_SECRET: "secret-des-tests-de-bout-en-bout",
      // Les tests créent beaucoup de salons depuis la même adresse.
      ROOM_CREATIONS_PER_HOUR: "1000",
      FAILED_JOINS_PER_10_MIN: "1000",
    },
  },
});
