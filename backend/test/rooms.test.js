import test, { mock } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { MAX_PARTICIPANTS, ROOM_TTL_MS, SECRET } from "../src/config.js";
import { Media } from "../src/models/Media.js";
import { Room } from "../src/models/Room.js";
import {
  generateRoomCode,
  normalizeRoomCode,
  purgeExpiredRooms,
} from "../src/services/roomService.js";
import { mp3, startTestApp } from "./helpers/testApp.js";

/* -------------------------------------------------------------------------
 * Salons : création, entrée par code, jetons de salon, hôte, expiration.
 * Aucun de ces tests n'a besoin de MongoDB (voir helpers/fakeDb.js).
 * ---------------------------------------------------------------------- */

let t;

test.before(async () => {
  t = await startTestApp();
});
test.after(() => t.stop());
test.afterEach(() => {
  mock.restoreAll();
  t.db.reset();
});

test("codes de salon : 6 caractères sans 0/O/1/I/L, saisie normalisée", () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(generateRoomCode(), /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
  }
  assert.equal(normalizeRoomCode(" k7p2qx "), "K7P2QX");
  assert.equal(normalizeRoomCode("K7P2Q"), null); // trop court
  assert.equal(normalizeRoomCode("K7P2QO"), null); // O interdit
  assert.equal(normalizeRoomCode({ $ne: "" }), null); // jamais d'objet dans un filtre
});

test("création : salon, participant, jeton de salon et jeton d'hôte", async () => {
  const r = await t.json("POST", "/api/rooms", { body: { name: "  Alex  " } });
  const body = await r.json();

  assert.equal(r.status, 201);
  assert.match(body.room.code, /^[A-Z2-9]{6}$/);
  assert.deepEqual(body.room.participants, [{ id: body.participant.id, name: "Alex" }]);
  assert.ok(new Date(body.room.expiresAt) > new Date());
  assert.match(body.hostToken, /^[0-9a-f]{64}$/);

  const payload = jwt.verify(body.token, SECRET);
  assert.equal(payload.typ, "room");
  assert.equal(payload.pid, body.participant.id);

  // Le jeton d'hôte n'est jamais stocké ni renvoyé tel quel.
  const [stored] = t.db.all(Room);
  assert.notEqual(stored.hostTokenHash, body.hostToken);
  assert.equal(JSON.stringify(body.room).includes("hostToken"), false);
});

test("création : un code déjà pris provoque un nouveau tirage", async () => {
  const first = await t.createRoom();
  const create = Room.create;
  let calls = 0;
  mock.method(Room, "create", (doc) => create({ ...doc, code: (calls += 1) === 1 ? first.room.code : doc.code }));

  const second = await t.createRoom();

  assert.equal(calls, 2);
  assert.notEqual(second.room.code, first.room.code);
});

test("nom d'affichage invalide : 400 à la création et à l'entrée", async () => {
  const { room } = await t.createRoom();

  for (const name of [undefined, "", "   ", "x".repeat(31), { $gt: "" }, 42]) {
    const created = await t.json("POST", "/api/rooms", { body: { name } });
    const joined = await t.json("POST", `/api/rooms/${room.code}/join`, { body: { name } });
    assert.equal(created.status, 400, `création avec ${JSON.stringify(name)}`);
    assert.equal(joined.status, 400, `entrée avec ${JSON.stringify(name)}`);
  }
});

test("entrée sans compte avec le code (insensible à la casse)", async () => {
  const host = await t.createRoom("Hôte");

  const r = await t.json("POST", `/api/rooms/${host.room.code.toLowerCase()}/join`, {
    body: { name: "Sam" },
  });
  const body = await r.json();

  assert.equal(r.status, 200);
  assert.equal(body.hostToken, undefined);
  assert.deepEqual(
    body.room.participants.map((p) => p.name),
    ["Hôte", "Sam"],
  );

  const current = await t.json("GET", "/api/rooms/current", { token: body.token });
  assert.equal(current.status, 200);
  assert.equal((await current.json()).code, host.room.code);
});

test("mauvais code : 404 « Salon inconnu »", async () => {
  await t.createRoom();

  for (const code of ["ZZZZZZ", "abc", "K7P2QO"]) {
    const r = await t.json("POST", `/api/rooms/${code}/join`, { body: { name: "Sam" } });
    assert.equal(r.status, 404, code);
    assert.equal((await r.json()).message, "Salon inconnu");
  }
});

test("trop de codes erronés depuis la même adresse : 429", async () => {
  // Application dédiée : son compteur de tentatives part de zéro.
  const server = createApp({ storage: t.storage, frontendDir: "/aucun-build" }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const join = (code) =>
    fetch(`${url}/api/rooms/${code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sam" }),
    });

  try {
    const { room } = await t.createRoom();
    for (let i = 0; i < 10; i += 1) assert.equal((await join("ZZZZZZ")).status, 404);

    // Même le bon code est refusé tant que l'adresse est bloquée.
    const blocked = await join(room.code);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).message, "Trop de tentatives, réessayez plus tard");
  } finally {
    server.close();
  }
});

test("trop de salons créés depuis la même adresse : 429", async () => {
  const server = createApp({
    storage: t.storage,
    frontendDir: "/aucun-build",
    limits: { creationsPerHour: 2 },
  }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const create = () =>
    fetch(`http://127.0.0.1:${server.address().port}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alex" }),
    });

  try {
    assert.equal((await create()).status, 201);
    assert.equal((await create()).status, 201);
    const blocked = await create();
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).message, "Trop de salons créés, réessayez plus tard");
  } finally {
    server.close();
  }
});

test("salon complet : 409", async () => {
  const { room } = await t.createRoom();
  for (let i = 1; i < MAX_PARTICIPANTS; i += 1) {
    assert.equal((await t.json("POST", `/api/rooms/${room.code}/join`, { body: { name: `P${i}` } })).status, 200);
  }

  const r = await t.json("POST", `/api/rooms/${room.code}/join`, { body: { name: "De trop" } });

  assert.equal(r.status, 409);
  assert.equal((await r.json()).message, "Salon complet");
});

test("401 sans jeton de salon, ou avec un jeton invalide", async () => {
  const { room, participant } = await t.createRoom();
  const [stored] = t.db.all(Room);
  const sign = (payload, secret = SECRET, options = {}) => jwt.sign(payload, secret, options);
  const valid = { typ: "room", rid: stored.id, pid: participant.id, name: "Hôte" };

  const routes = [
    ["GET", "/api/rooms/current"],
    ["POST", "/api/rooms/current/leave"],
    ["POST", "/api/rooms/current/code"],
    ["DELETE", "/api/rooms/current"],
    ["GET", "/api/media"],
    ["POST", "/api/media"],
    ["GET", "/api/media/64b0000000000000000000aa/url"],
    ["DELETE", "/api/media/64b0000000000000000000aa"],
  ];
  for (const [method, url] of routes) {
    const r = await t.json(method, url);
    assert.equal(r.status, 401, `${method} ${url}`);
    assert.equal((await r.json()).message, "Jeton de salon requis");
  }

  const invalid = {
    "n'importe quoi": "n-importe-quoi",
    "mauvaise signature": sign(valid, "un-autre-secret"),
    expiré: sign(valid, SECRET, { expiresIn: -10 }),
    "URL de lecture détournée": sign({ ...valid, typ: "media-url" }),
    "participant inconnu": sign({ ...valid, pid: "quelqu-un-d-autre" }),
    "salon inexistant": sign({ ...valid, rid: "64b000000000000000000099" }),
  };
  for (const [label, token] of Object.entries(invalid)) {
    const r = await t.json("GET", "/api/rooms/current", { token });
    assert.equal(r.status, 401, label);
    assert.equal((await r.json()).message, "Salon fermé ou jeton invalide");
  }
  assert.equal(room.code, stored.code);
});

test("quitter le salon invalide aussitôt le jeton", async () => {
  const host = await t.createRoom();
  const guest = await t.joinRoom(host.room.code, "Sam");

  const left = await t.json("POST", "/api/rooms/current/leave", { token: guest.token });
  assert.equal(left.status, 204);

  assert.equal((await t.json("GET", "/api/rooms/current", { token: guest.token })).status, 401);
  const current = await (await t.json("GET", "/api/rooms/current", { token: host.token })).json();
  assert.deepEqual(current.participants.map((p) => p.name), ["Hôte"]);
});

test("actions d'hôte : 403 sans le jeton d'hôte", async () => {
  const host = await t.createRoom();
  const guest = await t.joinRoom(host.room.code);
  const other = await t.createRoom();

  const attempts = [
    { token: guest.token }, // invité sans jeton d'hôte
    { token: guest.token, headers: { "x-host-token": "f".repeat(64) } }, // jeton deviné
    { token: guest.token, headers: { "x-host-token": other.hostToken } }, // hôte d'un autre salon
  ];
  for (const options of attempts) {
    for (const [method, url] of [["DELETE", "/api/rooms/current"], ["POST", "/api/rooms/current/code"]]) {
      const r = await t.json(method, url, options);
      assert.equal(r.status, 403);
      assert.equal((await r.json()).message, "Action réservée à l'hôte du salon");
    }
  }
  assert.equal(t.db.all(Room).length, 2);
});

test("l'hôte change le code : l'ancien ne fonctionne plus, les jetons restent valides", async () => {
  const host = await t.createRoom();
  const guest = await t.joinRoom(host.room.code);

  const r = await t.json("POST", "/api/rooms/current/code", {
    token: host.token,
    headers: { "x-host-token": host.hostToken },
  });
  const updated = await r.json();

  assert.equal(r.status, 200);
  assert.notEqual(updated.code, host.room.code);
  assert.equal((await t.json("POST", `/api/rooms/${host.room.code}/join`, { body: { name: "X" } })).status, 404);
  assert.equal((await t.json("POST", `/api/rooms/${updated.code}/join`, { body: { name: "X" } })).status, 200);
  assert.equal((await t.json("GET", "/api/rooms/current", { token: guest.token })).status, 200);
});

test("l'hôte ferme le salon : médias, fichiers et jetons disparaissent", async () => {
  const host = await t.createRoom();
  const guest = await t.joinRoom(host.room.code);
  assert.equal((await t.upload(host.token, { file: mp3() })).status, 201);
  assert.equal(t.storedFiles().length, 1);

  const r = await t.json("DELETE", "/api/rooms/current", {
    token: host.token,
    headers: { "x-host-token": host.hostToken },
  });

  assert.equal(r.status, 204);
  assert.equal(t.db.all(Room).length, 0);
  assert.equal(t.db.all(Media).length, 0);
  assert.deepEqual(t.storedFiles(), []);
  assert.equal((await t.json("GET", "/api/media", { token: guest.token })).status, 401);
});

test("expiration : un salon inactif est refusé puis supprimé avec ses fichiers", async () => {
  const old = await t.createRoom("Ancien");
  const recent = await t.createRoom("Récent");
  await t.upload(old.token, { file: mp3() });
  await t.upload(recent.token, { file: mp3() });

  const stored = t.db.all(Room).find((room) => room.code === old.room.code);
  stored.lastActivityAt = new Date(Date.now() - ROOM_TTL_MS - 1000);

  // Avant même le nettoyage, le salon expiré n'est plus accessible.
  assert.equal((await t.json("GET", "/api/rooms/current", { token: old.token })).status, 401);
  assert.equal((await t.json("POST", `/api/rooms/${old.room.code}/join`, { body: { name: "X" } })).status, 404);

  const purged = await purgeExpiredRooms(t.storage);

  assert.deepEqual(purged, [stored.id]);
  assert.deepEqual(t.db.all(Room).map((room) => room.code), [recent.room.code]);
  assert.equal(t.db.all(Media).length, 1);
  assert.equal(t.storedFiles().length, 1);
});

test("une requête authentifiée repousse l'expiration du salon", async () => {
  const host = await t.createRoom();
  const [stored] = t.db.all(Room);
  const before = new Date(Date.now() - 10 * 60 * 1000);
  stored.lastActivityAt = before;

  await t.json("GET", "/api/rooms/current", { token: host.token });

  assert.ok(stored.lastActivityAt > before);
});
