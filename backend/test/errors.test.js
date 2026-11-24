import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/app.js";
import { Media } from "../src/models/Media.js";
import { Room } from "../src/models/Room.js";
import { mp3, startTestApp } from "./helpers/testApp.js";

/* -------------------------------------------------------------------------
 * Chemins d'erreur : base indisponible, stockage en échec, requêtes mal
 * formées. Le client reçoit toujours un JSON `{ message }`, jamais une page
 * HTML ni une pile d'appels.
 * ---------------------------------------------------------------------- */

let t;

test.before(async () => {
  t = await startTestApp();
});
test.after(() => t.stop());
test.afterEach(() => {
  mock.restoreAll();
  t.db.reset();
  for (const file of t.storedFiles()) fs.unlinkSync(path.join(t.uploadsDir, file));
});

const fail = () => {
  throw new Error("base indisponible");
};

/** Vérifie une erreur 500 propre : JSON, message générique, pas de détail interne. */
async function assertInternalError(response, label) {
  assert.equal(response.status, 500, label);
  assert.match(response.headers.get("content-type"), /application\/json/, label);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { message: "Erreur interne du serveur" }, label);
  assert.ok(!body.includes("base indisponible"), `${label} : détail interne exposé`);
}

test("base indisponible : 500 JSON sur les routes des salons", async () => {
  const host = await t.createRoom();
  const auth = { token: host.token, headers: { "x-host-token": host.hostToken } };

  mock.method(Room, "create", fail);
  await assertInternalError(await t.json("POST", "/api/rooms", { body: { name: "A" } }), "création");

  mock.method(Room, "updateOne", fail);
  await assertInternalError(await t.json("POST", "/api/rooms/current/leave", auth), "sortie");

  mock.method(Room, "findOneAndUpdate", fail);
  await assertInternalError(await t.json("POST", "/api/rooms/current/code", auth), "changement de code");

  mock.method(Media, "find", fail);
  await assertInternalError(await t.json("DELETE", "/api/rooms/current", auth), "fermeture");

  // En dernier : sans Room.findOne, même le jeton ne peut plus être vérifié.
  mock.method(Room, "findOne", fail);
  await assertInternalError(await t.json("GET", "/api/rooms/current", { token: host.token }), "jeton");
  await assertInternalError(
    await t.json("POST", `/api/rooms/${host.room.code}/join`, { body: { name: "B" } }),
    "entrée",
  );
});

test("code de salon toujours déjà pris après 5 tirages : 500", async () => {
  mock.method(Room, "create", async () => {
    throw Object.assign(new Error("E11000"), { code: 11000 });
  });

  await assertInternalError(await t.json("POST", "/api/rooms", { body: { name: "A" } }), "collision");
  assert.equal(Room.create.mock.callCount(), 5);
});

test("base indisponible : 500 JSON sur les routes des médias", async () => {
  const { token } = await t.createRoom();
  const media = await (await t.upload(token, { file: mp3() })).json();

  mock.method(Media, "find", fail);
  await assertInternalError(await t.json("GET", "/api/media", { token }), "liste");

  mock.method(Media, "findOne", fail);
  await assertInternalError(await t.json("GET", `/api/media/${media.id}/url`, { token }), "URL");

  mock.method(Media, "findOneAndDelete", fail);
  await assertInternalError(await t.json("DELETE", `/api/media/${media.id}`, { token }), "suppression");
});

test("upload : échec du stockage → 500 et aucun fichier temporaire laissé", async () => {
  const { token } = await t.createRoom();
  let tempPath;
  mock.method(t.storage, "save", async (file) => {
    tempPath = file.tempPath;
    throw new Error("disque plein");
  });

  await assertInternalError(await t.upload(token, { file: mp3() }), "stockage");

  // On vérifie le fichier temporaire de CET upload, pas tout le dossier
  // data/tmp : les autres fichiers de test, lancés en parallèle par
  // `node --test`, y écrivent aussi leurs uploads en cours.
  assert.ok(tempPath, "le stockage a bien été appelé");
  assert.equal(fs.existsSync(tempPath), false);
  assert.equal(t.db.all(Media).length, 0);
});

test("URL de lecture : échec de la signature → 500", async () => {
  const { token } = await t.createRoom();
  const media = await (await t.upload(token, { file: mp3() })).json();
  mock.method(t.storage, "signedUrl", async () => {
    throw new Error("signature impossible");
  });

  await assertInternalError(await t.json("GET", `/api/media/${media.id}/url`, { token }), "signature");
});

test("suppression : fichier impossible à supprimer → 500 explicite, métadonnée supprimée", async () => {
  const { token } = await t.createRoom();
  const media = await (await t.upload(token, { file: mp3() })).json();
  mock.method(t.storage, "remove", async () => {
    throw new Error("permission refusée");
  });

  const r = await t.json("DELETE", `/api/media/${media.id}`, { token });

  assert.equal(r.status, 500);
  assert.equal((await r.json()).message, "Métadonnée supprimée, mais fichier non supprimé");
  assert.equal(t.db.all(Media).length, 0);
});

test("fermeture du salon : un fichier impossible à supprimer n'empêche pas la fermeture", async () => {
  const host = await t.createRoom();
  await t.upload(host.token, { file: mp3() });
  mock.method(t.storage, "remove", async () => {
    throw new Error("permission refusée");
  });

  const r = await t.json("DELETE", "/api/rooms/current", {
    token: host.token,
    headers: { "x-host-token": host.hostToken },
  });

  assert.equal(r.status, 204);
  assert.equal(t.db.all(Room).length, 0);
});

test("fichier disparu du stockage : le flux répond 404", async () => {
  const { token } = await t.createRoom();
  const media = await (await t.upload(token, { file: mp3() })).json();
  const { url } = await (await t.json("GET", `/api/media/${media.id}/url`, { token })).json();
  for (const file of t.storedFiles()) fs.unlinkSync(path.join(t.uploadsDir, file));

  const r = await fetch(t.base + url);

  assert.equal(r.status, 404);
  assert.equal((await r.json()).message, "Média inconnu");
});

test("fichier de plus de 25 Mo : 400 explicite, rien n'est gardé", async () => {
  const { token } = await t.createRoom();

  const r = await t.upload(token, {
    file: { content: new Uint8Array(25 * 1024 * 1024 + 1), type: "audio/mpeg", name: "gros.mp3" },
  });

  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Fichier trop volumineux (25 Mo maximum)");
  assert.deepEqual(t.storedFiles(), []);
});

test("corps JSON illisible : 400 « Corps JSON invalide »", async () => {
  const r = await fetch(t.base + "/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ pas du json",
  });

  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Corps JSON invalide");
});

test("TRUST_PROXY : la limite de tentatives s'applique à l'adresse du visiteur, pas au proxy", async () => {
  process.env.TRUST_PROXY = "1";
  const server = createApp({ storage: t.storage, frontendDir: "/aucun-build" }).listen(0);
  delete process.env.TRUST_PROXY;
  await new Promise((r) => server.once("listening", r));
  const join = (ip) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/rooms/ZZZZZZ/join`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ name: "Sam" }),
    });

  try {
    for (let i = 0; i < 10; i += 1) assert.equal((await join("203.0.113.1")).status, 404);
    assert.equal((await join("203.0.113.1")).status, 429);
    // Un autre visiteur derrière le même proxy n'est pas bloqué.
    assert.equal((await join("203.0.113.2")).status, 404);
  } finally {
    server.close();
  }
});
