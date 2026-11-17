import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { MAX_MEDIA_PER_ROOM, SECRET } from "../src/config.js";
import { Media } from "../src/models/Media.js";
import { mp3, startTestApp } from "./helpers/testApp.js";

/* -------------------------------------------------------------------------
 * Médias d'un salon : upload, liste paginée, streaming, suppression.
 * Aucun de ces tests n'a besoin de MongoDB (voir helpers/fakeDb.js) : les
 * routes sont appelées par HTTP sur une vraie application Express.
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

/** Crée un salon contenant un média et renvoie de quoi y accéder. */
async function roomWithMedia(content = "0123456789") {
  const host = await t.createRoom();
  const media = await (await t.upload(host.token, { title: "Blues", file: mp3(content) })).json();
  return { ...host, media };
}

test("health sans dépendre de MongoDB", async () => {
  const r = await fetch(t.base + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "ok");
});

test("schéma Media : relation avec le salon, clé de stockage jamais exposée", () => {
  const m = new Media({
    roomId: new mongoose.Types.ObjectId(),
    kind: "audio",
    title: "Blues",
    originalName: "b.mp3",
    storageKey: "11111111-2222-4333-8444-555555555555.mp3",
    mimeType: "audio/mpeg",
    size: 42,
  });
  assert.equal(m.validateSync(), undefined);
  assert.equal(m.toPublic().kind, "audio");
  assert.equal(m.toPublic().storageKey, undefined);
  assert.equal(m.toPublic().roomId, undefined);
  assert.equal(Media.schema.path("roomId").options.ref, "Room");

  const invalid = new Media({ ...m.toObject(), _id: undefined, kind: "pdf" });
  assert.ok(invalid.validateSync().errors.kind);
});

test("upload sans fichier : 400 « Fichier requis »", async () => {
  const { token } = await t.createRoom();

  const r = await t.upload(token, { title: "Sans fichier" });

  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Fichier requis");
});

test("upload d'un type MIME refusé : 400 « Format de média non accepté »", async () => {
  const { token } = await t.createRoom();

  const r = await t.upload(token, {
    title: "Texte",
    file: { content: "bonjour", type: "text/plain", name: "notes.txt" },
  });

  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Format de média non accepté");
  assert.deepEqual(t.storedFiles(), []);
});

test("upload accepté : fichier rangé dans le stockage, média rattaché au salon", async () => {
  const { token } = await t.createRoom();

  const r = await t.upload(token, { title: "Blues", file: mp3("ID3-données", "Mon Blues.MP3") });
  const body = await r.json();

  assert.equal(r.status, 201);
  assert.deepEqual(
    { kind: body.kind, title: body.title, originalName: body.originalName, size: body.size },
    { kind: "audio", title: "Blues", originalName: "Mon Blues.MP3", size: 12 },
  );
  assert.equal(body.storageKey, undefined);

  // Le nom de stockage est généré par le serveur, pas repris du client.
  const [stored] = t.db.all(Media);
  assert.match(stored.storageKey, /^[0-9a-f-]{36}\.mp3$/);
  assert.equal(fs.readFileSync(path.join(t.uploadsDir, stored.storageKey), "utf8"), "ID3-données");
});

test("upload : aucun fichier orphelin si MongoDB échoue", async () => {
  const { token } = await t.createRoom();
  mock.method(Media, "create", async () => {
    throw Object.assign(new Error("titre invalide"), { name: "ValidationError" });
  });

  const r = await t.upload(token, { file: mp3() });

  assert.equal(r.status, 400);
  assert.deepEqual(t.storedFiles(), []);
});

test("quota : un salon plein refuse l'upload (409) sans garder le fichier", async () => {
  const { token } = await t.createRoom();
  mock.method(Media, "countDocuments", async () => MAX_MEDIA_PER_ROOM);

  const r = await t.upload(token, { file: mp3() });

  assert.equal(r.status, 409);
  assert.equal((await r.json()).message, `Salon plein : ${MAX_MEDIA_PER_ROOM} médias maximum`);
  assert.deepEqual(t.storedFiles(), []);
});

test("pagination : page et limit, médias du salon uniquement, du plus récent au plus ancien", async () => {
  const host = await t.createRoom();
  const other = await t.createRoom();
  for (const title of ["A", "B", "C", "D", "E"]) {
    await t.upload(host.token, { title, file: mp3() });
  }
  await t.upload(other.token, { title: "Autre salon", file: mp3() });

  const r = await t.json("GET", "/api/media?page=2&limit=2", { token: host.token });
  const body = await r.json();

  assert.equal(r.status, 200);
  assert.deepEqual(
    { page: body.page, limit: body.limit, total: body.total, pages: body.pages },
    { page: 2, limit: 2, total: 5, pages: 3 },
  );
  assert.deepEqual(body.items.map((item) => item.title), ["C", "B"]);
  assert.deepEqual(Object.keys(body.items[0]).sort(), [
    "createdAt", "id", "kind", "mimeType", "originalName", "size", "title",
  ]);
});

test("pagination : limit est plafonné à 20 et page à 1 minimum", async () => {
  const { token } = await t.createRoom();

  const body = await (await t.json("GET", "/api/media?page=-4&limit=500", { token })).json();

  assert.deepEqual(
    { page: body.page, limit: body.limit, pages: body.pages, items: body.items },
    { page: 1, limit: 20, pages: 1, items: [] },
  );
});

test("un invité entré avec le code voit et lit les médias du salon", async () => {
  const host = await roomWithMedia();
  const guest = await t.joinRoom(host.room.code, "Sam");

  const list = await (await t.json("GET", "/api/media", { token: guest.token })).json();
  const url = await t.json("GET", `/api/media/${host.media.id}/url`, { token: guest.token });

  assert.deepEqual(list.items.map((item) => item.id), [host.media.id]);
  assert.equal(url.status, 200);
});

test("le jeton d'un autre salon ne peut ni lister, ni lire, ni supprimer (404)", async () => {
  const host = await roomWithMedia();
  const intruder = await t.createRoom("Intrus");

  const list = await (await t.json("GET", "/api/media", { token: intruder.token })).json();
  const url = await t.json("GET", `/api/media/${host.media.id}/url`, { token: intruder.token });
  const del = await t.json("DELETE", `/api/media/${host.media.id}`, { token: intruder.token });

  assert.deepEqual(list.items, []);
  assert.equal(url.status, 404);
  assert.equal(del.status, 404);
  assert.equal((await url.json()).message, "Média inconnu");
  assert.equal(t.db.all(Media).length, 1);
  assert.equal(t.storedFiles().length, 1);
});

test("un identifiant qui n'est pas un ObjectId : 404 sans requête MongoDB", async () => {
  const { token } = await t.createRoom();
  const findOne = mock.method(Media, "findOne", Media.findOne);

  const r = await t.json("GET", "/api/media/pas-un-id/url", { token });

  assert.equal(r.status, 404);
  assert.equal(findOne.mock.callCount(), 0);
});

test("URL de lecture : streaming partiel (206) sans en-tête Authorization", async () => {
  const { token, media } = await roomWithMedia("0123456789");

  const r = await t.json("GET", `/api/media/${media.id}/url`, { token });
  const { url, expiresAt } = await r.json();

  assert.equal(r.status, 200);
  assert.ok(url.startsWith(`/api/media/${media.id}/stream?token=`));
  assert.ok(new Date(expiresAt) > new Date());

  // Comme <audio src>, la requête ne porte aucun en-tête Authorization.
  const full = await fetch(t.base + url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/mpeg");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(await full.text(), "0123456789");

  const partial = await fetch(t.base + url, { headers: { range: "bytes=2-5" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await partial.text(), "2345");
});

test("URL de lecture : jeton absent, expiré, falsifié ou émis pour un autre média (401)", async () => {
  const { token, media } = await roomWithMedia("secret");
  const [stored] = t.db.all(Media);
  const OTHER_ID = "64b0000000000000000000bb";
  const sign = (payload, secret = SECRET, options = { expiresIn: 60 }) =>
    jwt.sign(
      { typ: "media-url", mid: media.id, key: stored.storageKey, mime: "audio/mpeg", ...payload },
      secret,
      options,
    );

  const attempts = {
    "sans jeton": `/api/media/${media.id}/stream`,
    "jeton expiré": `/api/media/${media.id}/stream?token=${sign({}, SECRET, { expiresIn: -10 })}`,
    "mauvaise signature": `/api/media/${media.id}/stream?token=${sign({}, "autre-secret")}`,
    "autre média": `/api/media/${OTHER_ID}/stream?token=${sign({})}`,
    // Un jeton de salon ne doit pas servir d'URL de lecture.
    "jeton de salon": `/api/media/${media.id}/stream?token=${token}`,
    "chemin relatif": `/api/media/${media.id}/stream?token=${sign({ key: "../../.env" })}`,
  };

  for (const [label, url] of Object.entries(attempts)) {
    const r = await fetch(t.base + url);
    assert.equal(r.status, 401, label);
    assert.equal((await r.json()).message, "Lien de lecture invalide ou expiré");
  }
});

test("les logs HTTP masquent la chaîne de requête (jeton de lecture)", async () => {
  const lines = [];
  mock.method(console, "log", (...args) => lines.push(args.join(" ")));

  await fetch(`${t.base}/api/media/64b0000000000000000000aa/stream?token=jeton-tres-secret`);
  await new Promise((r) => setTimeout(r, 20));

  const line = lines.find((l) => l.startsWith("[http]") && l.includes("/stream"));
  assert.ok(line, "ligne [http] attendue");
  assert.ok(line.includes("?[masqué]"));
  assert.ok(!lines.some((l) => l.includes("jeton-tres-secret")));
});

test("DELETE : supprime la métadonnée et le fichier, puis 404", async () => {
  const { token, media } = await roomWithMedia();

  const r = await t.json("DELETE", `/api/media/${media.id}`, { token });

  assert.equal(r.status, 204);
  assert.deepEqual(t.storedFiles(), []);
  assert.equal(t.db.all(Media).length, 0);

  const again = await t.json("DELETE", `/api/media/${media.id}`, { token });
  assert.equal(again.status, 404);
  assert.equal((await again.json()).message, "Média inconnu");
});

test("CORS : fermé par défaut, ouvert seulement aux origines de CORS_ORIGIN", async () => {
  const origin = "https://exemple.github.io";
  const closed = await fetch(t.base + "/api/health", { headers: { origin } });
  assert.equal(closed.headers.get("access-control-allow-origin"), null);

  process.env.CORS_ORIGIN = origin;
  const server = createApp({ storage: t.storage, frontendDir: "/aucun-build" }).listen(0);
  delete process.env.CORS_ORIGIN;
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/api/health`;

  try {
    const allowed = await fetch(url, { headers: { origin } });
    const refused = await fetch(url, { headers: { origin: "https://ailleurs.example" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), origin);
    assert.equal(refused.headers.get("access-control-allow-origin"), null);
  } finally {
    server.close();
  }
});

/* -------------------------------------------------------------------------
 * Déploiement : Express sert le build Angular quand il existe.
 * ---------------------------------------------------------------------- */

test("le build Angular est servi, sans masquer les routes /api", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sharing-platform-front-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html>angular</html>");
  fs.writeFileSync(path.join(dir, "main.js"), "console.log('main')");

  const front = createApp({ frontendDir: dir, storage: t.storage }).listen(0);
  await new Promise((r) => front.once("listening", r));
  const url = `http://127.0.0.1:${front.address().port}`;

  try {
    // Un fichier du build est servi tel quel.
    assert.equal(await (await fetch(url + "/main.js")).text(), "console.log('main')");
    // Une route du routeur Angular reçoit index.html.
    const deep = await fetch(url + "/rooms/K7P2QX");
    assert.equal(deep.status, 200);
    assert.equal(await deep.text(), "<html>angular</html>");
    // Un fichier absent n'est pas remplacé par la page HTML.
    assert.equal((await fetch(url + "/rooms/main-absent.js")).status, 404);
    // L'API garde la priorité, y compris pour une route inconnue.
    assert.equal((await (await fetch(url + "/api/health")).json()).status, "ok");
    const unknown = await fetch(url + "/api/inconnue");
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).message, "Ressource inconnue");
  } finally {
    front.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
