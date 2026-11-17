import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { io as connectSocket } from "socket.io-client";
import jwt from "jsonwebtoken";
import { MAX_PARTICIPANTS, SECRET } from "../src/config.js";
import { Room } from "../src/models/Room.js";
import { expectedPosition } from "../src/sync/playback.js";
import { mp3, startTestApp } from "./helpers/testApp.js";

/* -------------------------------------------------------------------------
 * Temps réel : de vrais clients Socket.IO connectés à la vraie application.
 * La base reste simulée en mémoire (voir helpers/fakeDb.js).
 * ---------------------------------------------------------------------- */

let t;

test.before(async () => {
  t = await startTestApp();
});
test.after(() => t.stop());
test.afterEach(() => mock.restoreAll());

/** Salon avec un média, un hôte et un invité connectés au WebSocket. */
async function roomWithTwoPeople() {
  const host = await t.createRoom("Alex");
  const guest = await t.joinRoom(host.room.code, "Sam");
  const media = await (await t.upload(host.token, { title: "Blues", file: mp3() })).json();
  const alex = await t.connect(host.token);
  const sam = await t.connect(guest.token);
  return { host, guest, media, alex, sam };
}

const refused = (token) =>
  new Promise((resolve) => {
    const socket = connectSocket(t.base, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      reconnection: false,
    });
    socket.once("connect", () => (socket.disconnect(), resolve(null)));
    socket.once("connect_error", (error) => resolve(error.message));
  });

test("connexion refusée sans jeton de salon valide", async () => {
  const { token, participant } = await t.createRoom();
  const [room] = t.db.all(Room).slice(-1);
  const valid = { typ: "room", rid: room.id, pid: participant.id, name: "Hôte" };

  const attempts = {
    "sans jeton": undefined,
    "n'importe quoi": "n-importe-quoi",
    "mauvaise signature": jwt.sign(valid, "un-autre-secret"),
    expiré: jwt.sign(valid, SECRET, { expiresIn: -10 }),
    "URL de lecture détournée": jwt.sign({ ...valid, typ: "media-url" }, SECRET),
    "participant inconnu": jwt.sign({ ...valid, pid: "quelqu-un-d-autre" }, SECRET),
  };
  for (const [label, attempt] of Object.entries(attempts)) {
    assert.equal(await refused(attempt), "Salon fermé ou jeton invalide", label);
  }
  assert.equal(await refused(token), null); // le vrai jeton est accepté
});

test("à la connexion : état courant, participants connectés et heure du serveur", async () => {
  const host = await t.createRoom("Alex");
  const before = Date.now();

  const alex = await t.connect(host.token);

  assert.equal(alex.initial.playback, null);
  assert.equal(alex.initial.version, 0);
  assert.deepEqual(alex.initial.waitingFor, []);
  assert.deepEqual(alex.initial.participants, [host.participant]);
  assert.ok(alex.initial.serverTime >= before && alex.initial.serverTime <= Date.now());
});

test("présence : tout le salon voit qui arrive et qui part", async () => {
  const host = await t.createRoom("Alex");
  const guest = await t.joinRoom(host.room.code, "Sam");
  const alex = await t.connect(host.token);

  const arrival = alex.until("room:participants", (list) => list.length === 2);
  const sam = await t.connect(guest.token);
  assert.deepEqual((await arrival).map((p) => p.name), ["Alex", "Sam"]);

  const departure = alex.until("room:participants", (list) => list.length === 1);
  sam.disconnect();
  assert.deepEqual((await departure).map((p) => p.name), ["Alex"]);
});

test("mesure d'horloge : clock:ping renvoie l'heure du serveur", async () => {
  const { token } = await t.createRoom();
  const socket = await t.connect(token);

  const before = Date.now();
  const { serverTime } = await new Promise((resolve) => socket.emit("clock:ping", resolve));

  assert.ok(serverTime >= before && serverTime <= Date.now());
});

test("une commande est diffusée à tout le salon, émetteur compris", async () => {
  const { media, alex, sam } = await roomWithTwoPeople();

  const seenByAlex = alex.next("playback:state");
  const seenBySam = sam.next("playback:state");
  assert.deepEqual(await alex.command({ type: "load", mediaId: media.id }), { ok: true });

  const state = await seenByAlex;
  assert.deepEqual(await seenBySam, state);
  assert.equal(state.action, "load");
  assert.equal(state.by.name, "Alex");
  assert.equal(state.playback.mediaId, media.id);
  assert.equal(state.playback.paused, true);
});

test("lecture, saut et pause par l'un ou l'autre : tout le monde suit", async () => {
  const { media, alex, sam } = await roomWithTwoPeople();
  await alex.command({ type: "load", mediaId: media.id });

  let seen = alex.next("playback:state");
  await sam.command({ type: "play" });
  let state = await seen;
  assert.deepEqual([state.action, state.by.name, state.playback.paused], ["play", "Sam", false]);

  seen = sam.next("playback:state");
  await alex.command({ type: "seek", position: 754 });
  state = await seen;
  assert.deepEqual([state.action, state.by.name, state.playback.position], ["seek", "Alex", 754]);
  assert.equal(state.playback.paused, false);

  seen = alex.next("playback:state");
  await sam.command({ type: "pause" });
  state = await seen;
  assert.equal(state.action, "pause");
  assert.ok(state.playback.position >= 754);
  assert.equal(state.version, 4);
});

test("un arrivant tardif démarre à la bonne position", async () => {
  const { host, media, alex } = await roomWithTwoPeople();
  await alex.command({ type: "load", mediaId: media.id });
  await alex.command({ type: "seek", position: 100 });
  await alex.command({ type: "play" });
  await new Promise((resolve) => setTimeout(resolve, 120));

  const late = await t.joinRoom(host.room.code, "Lou");
  const lou = await t.connect(late.token);

  const { playback, serverTime } = lou.initial;
  assert.equal(playback.paused, false);
  const position = expectedPosition(playback, serverTime);
  assert.ok(position >= 100.1 && position < 101, `position ${position}`);
});

test("charger un média d'un autre salon, inexistant ou invalide : refusé", async () => {
  const { alex, sam } = await roomWithTwoPeople();
  const other = await t.createRoom("Ailleurs");
  const foreign = await (await t.upload(other.token, { file: mp3() })).json();
  let broadcasts = 0;
  sam.on("playback:state", () => (broadcasts += 1));

  for (const mediaId of [foreign.id, "64b000000000000000000099", "pas-un-id", { $ne: null }, undefined]) {
    assert.deepEqual(await alex.command({ type: "load", mediaId }), {
      ok: false,
      message: "Média inconnu",
    });
  }
  assert.equal(broadcasts, 0);
});

test("les commandes d'un salon ne touchent jamais un autre salon", async () => {
  const { media, alex } = await roomWithTwoPeople();
  const other = await t.createRoom("Ailleurs");
  const outsider = await t.connect(other.token);
  let leaked = 0;
  outsider.on("playback:state", () => (leaked += 1));

  await alex.command({ type: "load", mediaId: media.id });
  await alex.command({ type: "play" });
  // L'autre salon n'a aucun média chargé : la commande échoue chez lui.
  assert.deepEqual(await outsider.command({ type: "pause" }), {
    ok: false,
    message: "Aucun média chargé",
  });

  assert.equal(leaked, 0);
});

test("buffering : le salon attend le participant bloqué puis reprend", async () => {
  const { media, alex, sam } = await roomWithTwoPeople();
  await alex.command({ type: "load", mediaId: media.id });
  await alex.command({ type: "play" });

  let seen = alex.next("playback:state");
  sam.emit("buffer:start");
  let state = await seen;
  assert.deepEqual([state.action, state.by.name, state.playback.paused], ["buffering", "Sam", true]);
  assert.deepEqual(state.waitingFor.map((p) => p.name), ["Sam"]);

  seen = alex.next("playback:state");
  sam.emit("buffer:end");
  state = await seen;
  assert.deepEqual([state.action, state.playback.paused, state.waitingFor], ["resume", false, []]);
});

test("un participant bloqué qui se déconnecte ne fige pas le salon", async () => {
  const { media, alex, sam } = await roomWithTwoPeople();
  await alex.command({ type: "load", mediaId: media.id });
  await alex.command({ type: "play" });
  const paused = alex.next("playback:state");
  sam.emit("buffer:start");
  await paused;

  const resumed = alex.next("playback:state");
  sam.disconnect();

  assert.equal((await resumed).action, "resume");
});

test("médias : un ajout ou une suppression prévient le salon et vide le lecteur", async () => {
  const { host, media, alex, sam } = await roomWithTwoPeople();
  await alex.command({ type: "load", mediaId: media.id });

  const added = sam.next("media:changed");
  await t.upload(host.token, { file: mp3() });
  await added;

  const unloaded = sam.next("playback:state");
  const changed = sam.next("media:changed");
  assert.equal((await t.json("DELETE", `/api/media/${media.id}`, { token: host.token })).status, 204);

  const state = await unloaded;
  await changed;
  assert.deepEqual([state.action, state.playback], ["unload", null]);
});

test("changement de code par l'hôte : le salon reçoit le nouveau code", async () => {
  const { host, sam } = await roomWithTwoPeople();

  const updated = sam.next("room:updated");
  const r = await t.json("POST", "/api/rooms/current/code", {
    token: host.token,
    headers: { "x-host-token": host.hostToken },
  });

  assert.equal((await updated).code, (await r.json()).code);
});

test("fermeture du salon : tout le monde est prévenu puis déconnecté", async () => {
  const { host, alex, sam } = await roomWithTwoPeople();

  const closed = [alex.next("room:closed"), sam.next("room:closed")];
  const disconnected = [alex.next("disconnect"), sam.next("disconnect")];
  await t.json("DELETE", "/api/rooms/current", {
    token: host.token,
    headers: { "x-host-token": host.hostToken },
  });

  const reasons = await Promise.all(closed);
  await Promise.all(disconnected);
  assert.deepEqual(reasons, [{ reason: "closed" }, { reason: "closed" }]);
  assert.equal(alex.connected, false);
  assert.equal(sam.connected, false);
});

test("quitter le salon ferme le WebSocket du participant, pas celui des autres", async () => {
  const { guest, alex, sam } = await roomWithTwoPeople();

  const disconnected = sam.next("disconnect");
  const notified = sam.next("room:closed");
  // L'annonce de l'arrivée de Sam peut encore être en route : on attend la
  // liste où il ne figure plus.
  const alone = alex.until("room:participants", (list) => list.length === 1);
  await t.json("POST", "/api/rooms/current/leave", { token: guest.token });

  assert.deepEqual(await notified, { reason: "left" });
  await disconnected;
  assert.deepEqual((await alone).map((p) => p.name), ["Alex"]);
  assert.equal(alex.connected, true);
});

test("salon complet : les participants absents depuis longtemps laissent leur place", async () => {
  const host = await t.createRoom("Alex");
  await t.connect(host.token);
  for (let i = 1; i < MAX_PARTICIPANTS; i += 1) await t.joinRoom(host.room.code, `Absent ${i}`);

  // Personne d'autre n'est connecté, mais les entrées sont récentes : complet.
  const full = await t.json("POST", `/api/rooms/${host.room.code}/join`, { body: { name: "Lou" } });
  assert.equal(full.status, 409);

  // Plus tard, ces participants jamais connectés ne bloquent plus le salon.
  const room = t.db.all(Room).find((candidate) => candidate.code === host.room.code);
  for (const participant of room.participants) participant.joinedAt = new Date(Date.now() - 10 * 60 * 1000);

  const joined = await t.json("POST", `/api/rooms/${host.room.code}/join`, { body: { name: "Lou" } });
  assert.equal(joined.status, 200);
  // L'hôte, connecté, garde sa place ; les absents sont retirés.
  assert.deepEqual((await joined.json()).room.participants.map((p) => p.name), ["Alex", "Lou"]);
});
