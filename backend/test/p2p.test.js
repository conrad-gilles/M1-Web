import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { Media } from "../src/models/Media.js";
import { startTestApp } from "./helpers/testApp.js";

/* -------------------------------------------------------------------------
 * Partage en direct (P2P) : le serveur garde les métadonnées et qui partage,
 * et relaie la signalisation WebRTC. Le fichier ne passe jamais par lui.
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

const SHARED = { title: "Film en 4K", duration: 7322.5, kind: "video", originalName: "film.mkv", size: 8e9 };

test("partage direct : 201, celui qui partage vient du jeton, aucun fichier sur le serveur", async () => {
  const host = await t.createRoom("Alex");

  const r = await t.json("POST", "/api/media/p2p", {
    token: host.token,
    body: { ...SHARED, ownerId: "quelqu-un-d-autre" }, // ignoré : le jeton fait foi
  });
  const media = await r.json();

  assert.equal(r.status, 201);
  assert.deepEqual(
    { source: media.source, owner: media.owner, duration: media.duration },
    { source: "p2p", owner: { id: host.participant.id, name: "Alex" }, duration: 7322.5 },
  );
  assert.deepEqual(t.storedFiles(), []);

  const list = await (await t.json("GET", "/api/media", { token: host.token })).json();
  assert.deepEqual(list.items[0].owner, { id: host.participant.id, name: "Alex" });
  assert.equal(list.items[0].ownerId, undefined);
});

test("partage direct : mêmes vérifications que les médias locaux (400), jeton requis (401)", async () => {
  const { token } = await t.createRoom();

  const bad = await t.json("POST", "/api/media/p2p", { token, body: { ...SHARED, duration: -1 } });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).message, "Durée du média requise (nombre de secondes positif)");
  assert.equal((await t.json("POST", "/api/media/p2p", { body: SHARED })).status, 401);
  assert.equal(t.db.all(Media).length, 0);
});

test("partage direct : pas d'URL de lecture ni de téléchargement côté serveur", async () => {
  const { token } = await t.createRoom();
  const media = await (await t.json("POST", "/api/media/p2p", { token, body: SHARED })).json();

  const url = await (await t.json("GET", `/api/media/${media.id}/url`, { token })).json();
  assert.equal(url.url, null);
  assert.equal(url.media.owner.name, "Hôte");

  const download = await t.json("GET", `/api/media/${media.id}/download`, { token });
  assert.equal(download.status, 409);
  assert.equal(
    (await download.json()).message,
    "Média partagé en direct : aucun fichier à télécharger sur le serveur",
  );
});

test("signalisation WebRTC : relayée au seul participant visé, avec l'expéditeur", async () => {
  const alex = await t.createRoom("Alex");
  const sam = await t.joinRoom(alex.room.code, "Sam");
  const lou = await t.joinRoom(alex.room.code, "Lou");
  const alexSocket = await t.connect(alex.token);
  const samSocket = await t.connect(sam.token);
  const louSocket = await t.connect(lou.token);
  const louReceived = [];
  louSocket.on("p2p:signal", (message) => louReceived.push(message));

  const received = samSocket.next("p2p:signal");
  alexSocket.emit("p2p:signal", { to: sam.participant.id, data: { sdp: { type: "offer", sdp: "v=0" } } });

  assert.deepEqual(await received, {
    from: alex.participant.id,
    data: { sdp: { type: "offer", sdp: "v=0" } },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(louReceived, []);
});

test("signalisation : jamais vers un autre salon, ni vers soi-même, ni trop volumineuse", async () => {
  const a = await t.createRoom("Alex");
  const b = await t.createRoom("Bea");
  const alexSocket = await t.connect(a.token);
  const beaSocket = await t.connect(b.token);
  const seen = [];
  beaSocket.on("p2p:signal", (message) => seen.push(message));
  alexSocket.on("p2p:signal", (message) => seen.push(message));

  alexSocket.emit("p2p:signal", { to: b.participant.id, data: { sdp: "x" } }); // autre salon
  alexSocket.emit("p2p:signal", { to: a.participant.id, data: { sdp: "x" } }); // soi-même
  alexSocket.emit("p2p:signal", { to: b.participant.id, data: "x".repeat(70 * 1024) });
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.deepEqual(seen, []);
});
