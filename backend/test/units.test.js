import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import { ROOM_TTL_MS, SECRET } from "../src/config.js";
import { httpLogger } from "../src/middleware/httpLogger.js";
import { createRateLimiter } from "../src/middleware/rateLimit.js";
import {
  hashHostToken,
  isExpired,
  isHostToken,
  signRoomToken,
} from "../src/services/roomService.js";
import { createStorage } from "../src/storage/index.js";
import { createLocalStorage } from "../src/storage/localStorage.js";
import { presence } from "../src/sync/presence.js";

/* -------------------------------------------------------------------------
 * Tests unitaires des petits modules, sans serveur HTTP.
 * ---------------------------------------------------------------------- */

const KEY = "11111111-2222-4333-8444-555555555555.mp3";

test("limite de fréquence : bloque au-delà de la limite, puis libère après la fenêtre", () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => now });

  for (let i = 0; i < 3; i += 1) {
    assert.equal(limiter.isBlocked("ip-a"), false);
    limiter.hit("ip-a");
  }
  assert.equal(limiter.isBlocked("ip-a"), true);
  assert.equal(limiter.isBlocked("ip-b"), false); // chaque adresse a son compteur

  now = 999;
  assert.equal(limiter.isBlocked("ip-a"), true);
  now = 1000;
  assert.equal(limiter.isBlocked("ip-a"), false);
});

test("présence : plusieurs connexions d'un même participant comptent pour une personne", () => {
  const room = "salon-presence";
  const alex = { id: "p1", name: "Alex" };

  assert.equal(presence.add(room, alex), true); // arrivée
  assert.equal(presence.add(room, alex), false); // deuxième onglet
  presence.add(room, { id: "p2", name: "Sam" });
  assert.deepEqual(presence.list(room), [alex, { id: "p2", name: "Sam" }]);
  assert.equal(presence.count(room), 2);

  assert.equal(presence.remove(room, "p1"), false); // un onglet reste ouvert
  assert.equal(presence.isOnline(room, "p1"), true);
  assert.equal(presence.remove(room, "p1"), true); // dernier onglet fermé
  assert.equal(presence.isOnline(room, "p1"), false);
  assert.equal(presence.remove(room, "inconnu"), false);

  presence.clear(room);
  assert.equal(presence.count(room), 0);
  assert.deepEqual(presence.list(room), []);
});

test("jeton d'hôte : seule l'empreinte est comparée, en temps constant", () => {
  const hash = hashHostToken("secret-hote");

  assert.notEqual(hash, "secret-hote");
  assert.equal(isHostToken("secret-hote", hash), true);
  assert.equal(isHostToken("autre", hash), false);
  assert.equal(isHostToken("secret-hote", "trop-court"), false);
});

test("jeton de salon : limité au salon et au participant, valable le temps d'un salon", () => {
  const token = signRoomToken({ id: "salon-1" }, { id: "p1", name: "Alex" });
  const payload = jwt.verify(token, SECRET);

  assert.deepEqual(
    { typ: payload.typ, rid: payload.rid, pid: payload.pid, name: payload.name },
    { typ: "room", rid: "salon-1", pid: "p1", name: "Alex" },
  );
  assert.equal((payload.exp - payload.iat) * 1000, ROOM_TTL_MS);
});

test("expiration d'un salon : au-delà de la durée de vie sans activité", () => {
  const now = Date.now();
  const room = (inactiveFor) => ({ lastActivityAt: new Date(now - inactiveFor) });

  assert.equal(isExpired(room(ROOM_TTL_MS - 1), now), false);
  assert.equal(isExpired(room(ROOM_TTL_MS + 1), now), true);
});

test("stockage local : enregistrement, suppression et clés refusées", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sharing-platform-storage-"));
  const storage = createLocalStorage({ directory: path.join(dir, "uploads"), secret: SECRET });
  const temp = path.join(dir, "temp.mp3");
  fs.writeFileSync(temp, "octets");

  try {
    await storage.save({ tempPath: temp, key: KEY });
    assert.equal(fs.readFileSync(path.join(dir, "uploads", KEY), "utf8"), "octets");

    await storage.remove(KEY);
    await storage.remove(KEY); // déjà absent : pas une erreur
    assert.equal(fs.existsSync(path.join(dir, "uploads", KEY)), false);

    // Une clé qui n'a pas la forme générée par le serveur est toujours refusée.
    for (const key of ["../../.env", "/etc/passwd", "nom-libre.mp3", ""]) {
      await assert.rejects(storage.remove(key), /Clé de stockage invalide/, key);
    }
    await assert.rejects(
      storage.signedUrl({ key: "../x", mediaId: "m", mimeType: "audio/mpeg", expiresInSeconds: 60 }),
      /Clé de stockage invalide/,
    );

    // Une autre erreur que « fichier absent » est remontée, pas ignorée.
    fs.mkdirSync(path.join(dir, "uploads", KEY));
    await assert.rejects(storage.remove(KEY));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stockage : l'application utilise le stockage local par défaut", () => {
  const storage = createStorage();

  for (const name of ["save", "signedUrl", "verifyUrlToken", "remove"]) {
    assert.equal(typeof storage[name], "function", name);
  }
});

/** Simule une requête terminée et renvoie les lignes journalisées. */
function logLine(originalUrl, statusCode) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    const res = Object.assign(new EventEmitter(), { statusCode });
    httpLogger({ method: "GET", originalUrl }, res, () => {});
    res.emit("finish");
  } finally {
    console.log = original;
  }
  return lines;
}

test("logs HTTP : vérification de santé silencieuse, sauf en cas d'échec", () => {
  assert.deepEqual(logLine("/api/health", 200), []);
  assert.match(logLine("/api/health", 503)[0], /^\[http\] GET \/api\/health -> 503/);
  assert.match(logLine("/api/rooms/current", 200)[0], /^\[http\] GET \/api\/rooms\/current -> 200/);
});

test("logs HTTP : la chaîne de requête est toujours masquée", () => {
  const [line] = logLine("/api/media/m1/stream?token=secret", 206);

  assert.match(line, /\/api\/media\/m1\/stream\?\[masqué\] -> 206/);
  assert.ok(!line.includes("secret"));
});
