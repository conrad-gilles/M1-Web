import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { SECRET } from "../src/config.js";
import { User } from "../src/models/User.js";
import { Media } from "../src/models/Media.js";
import { createLocalStorage } from "../src/storage/localStorage.js";

/* -------------------------------------------------------------------------
 * Aucun de ces tests n'a besoin de MongoDB : les routes sont appelées par HTTP
 * sur une vraie application Express, et les méthodes Mongoose (`Media.find`,
 * `Media.findOne`, ...) sont remplacées par des simulations qui enregistrent
 * les filtres reçus. Les fichiers vont dans un dossier temporaire.
 * ---------------------------------------------------------------------- */

const USER_A = "64b000000000000000000001";
const USER_B = "64b000000000000000000002";
const MEDIA_ID = "64b0000000000000000000aa";
const KEY = "11111111-2222-4333-8444-555555555555.mp3";

let server, base, uploadsDir, storage;

test.before(async () => {
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "gpc-uploads-"));
  storage = createLocalStorage({ directory: uploadsDir, secret: SECRET });
  server = createApp({ storage, frontendDir: path.join(uploadsDir, "aucun-build") }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

test.afterEach(() => mock.restoreAll());

/** Fabrique un JWT valide, identique à celui émis par POST /api/auth/login. */
const bearer = (sub, options = {}) =>
  `Bearer ${jwt.sign({ sub, email: `${sub}@example.com` }, SECRET, options)}`;

/** Envoie un multipart avec les champs demandés. */
const upload = (headers, { title, file } = {}) => {
  const form = new FormData();
  if (title) form.append("title", title);
  if (file) form.append("file", new Blob([file.content], { type: file.type }), file.name);
  return fetch(base + "/api/media", { method: "POST", headers, body: form });
};

/** Simule un document Mongoose renvoyé par une requête. */
const fakeMedia = (fields = {}) => ({
  id: MEDIA_ID,
  storageKey: KEY,
  mimeType: "audio/mpeg",
  ...fields,
});

/** Simule MongoDB : seul `owner` retrouve le média. */
const ownedBy = (owner, filters, name) => (filter) => {
  filters[name] = filter;
  return { select: async () => (filter.ownerId === owner ? fakeMedia() : null) };
};

test("health sans dépendre de MongoDB", async () => {
  const r = await fetch(base + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "ok");
});

test("schémas Mongoose et relation", () => {
  const u = new User({ name: "Test", email: "TEST@example.com", password: "12345678" });
  assert.equal(u.email, "test@example.com");

  const m = new Media({
    ownerId: new mongoose.Types.ObjectId(),
    kind: "audio",
    title: "Blues",
    originalName: "b.mp3",
    storageKey: KEY,
    mimeType: "audio/mpeg",
    size: 42,
  });
  assert.equal(m.validateSync(), undefined);
  assert.equal(m.toPublic().kind, "audio");
  assert.equal(m.toPublic().storageKey, undefined); // jamais exposé
  assert.equal(Media.schema.path("ownerId").options.ref, "User");

  const invalid = new Media({ ...m.toObject(), _id: undefined, kind: "pdf" });
  assert.ok(invalid.validateSync().errors.kind);
});

test("401 sans JWT sur toutes les routes protégées", async () => {
  const routes = [
    ["GET", "/api/media"],
    ["POST", "/api/media"],
    ["GET", `/api/media/${MEDIA_ID}/url`],
    ["DELETE", `/api/media/${MEDIA_ID}`],
    ["GET", "/api/users/me"],
    ["PUT", "/api/users/me"],
  ];

  for (const [method, url] of routes) {
    const r = await fetch(base + url, { method });
    assert.equal(r.status, 401, `${method} ${url}`);
    assert.equal((await r.json()).message, "Authentification requise");
  }
});

test("401 avec un JWT invalide, falsifié ou expiré", async () => {
  const invalid = [
    "Bearer n-importe-quoi",
    `Bearer ${jwt.sign({ sub: USER_A }, "un-autre-secret")}`, // mauvaise signature
    bearer(USER_A, { expiresIn: -10 }), // déjà expiré
    `Basic ${Buffer.from("a:b").toString("base64")}`, // mauvais schéma
  ];

  for (const authorization of invalid) {
    const r = await fetch(base + "/api/media", { headers: { authorization } });
    assert.equal(r.status, 401, authorization.slice(0, 20));
  }
});

test("upload sans fichier : 400 « Fichier requis »", async () => {
  const r = await upload({ authorization: bearer(USER_A) }, { title: "Sans fichier" });

  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Fichier requis");
});

test("upload d'un type MIME refusé : 400 « Format de média non accepté »", async () => {
  const r = await upload(
    { authorization: bearer(USER_A) },
    { title: "Texte", file: { content: "bonjour", type: "text/plain", name: "notes.txt" } },
  );

  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Format de média non accepté");
  assert.deepEqual(fs.readdirSync(uploadsDir), []);
});

test("upload accepté : fichier rangé dans le stockage et métadonnées créées", async () => {
  let created;
  mock.method(Media, "create", async (doc) => {
    created = doc;
    return { id: MEDIA_ID, toPublic: () => ({ id: MEDIA_ID, kind: doc.kind, title: doc.title }) };
  });

  const r = await upload(
    { authorization: bearer(USER_A) },
    { title: "Blues", file: { content: "ID3-données", type: "audio/mpeg", name: "Mon Blues.MP3" } },
  );

  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { id: MEDIA_ID, kind: "audio", title: "Blues" });
  assert.equal(created.ownerId, USER_A);
  assert.equal(created.originalName, "Mon Blues.MP3");
  // Le nom de stockage est généré par le serveur, pas repris du client.
  assert.match(created.storageKey, /^[0-9a-f-]{36}\.mp3$/);
  assert.equal(fs.readFileSync(path.join(uploadsDir, created.storageKey), "utf8"), "ID3-données");

  fs.unlinkSync(path.join(uploadsDir, created.storageKey));
});

test("upload : aucun fichier orphelin si MongoDB échoue", async () => {
  mock.method(Media, "create", async () => {
    throw Object.assign(new Error("titre invalide"), { name: "ValidationError" });
  });

  const r = await upload(
    { authorization: bearer(USER_A) },
    { file: { content: "abc", type: "audio/mpeg", name: "a.mp3" } },
  );

  assert.equal(r.status, 400);
  assert.deepEqual(fs.readdirSync(uploadsDir), []);
});

test("pagination : transmet page et limit et ne lit que les médias du propriétaire", async () => {
  const calls = {};
  const query = {
    sort: () => query,
    skip: (n) => ((calls.skip = n), query),
    limit: (n) => ((calls.limit = n), query),
    select: () => query,
    lean: async () => [{ _id: "m1", title: "Blues", kind: "audio" }],
  };
  mock.method(Media, "find", (filter) => ((calls.filter = filter), query));
  mock.method(Media, "countDocuments", async (filter) => ((calls.countFilter = filter), 7));

  const r = await fetch(base + "/api/media?page=2&limit=3", {
    headers: { authorization: bearer(USER_A) },
  });
  const body = await r.json();

  assert.equal(r.status, 200);
  assert.deepEqual(
    { page: body.page, limit: body.limit, total: body.total, pages: body.pages },
    { page: 2, limit: 3, total: 7, pages: 3 },
  );
  assert.deepEqual(body.items[0], { id: "m1", title: "Blues", kind: "audio" });
  assert.deepEqual([calls.skip, calls.limit], [3, 3]); // (page - 1) * limit
  assert.deepEqual(calls.filter, { ownerId: USER_A });
  assert.deepEqual(calls.countFilter, { ownerId: USER_A });
});

test("pagination : limit est plafonné à 20 et page à 1 minimum", async () => {
  const calls = {};
  const query = {
    sort: () => query,
    skip: (n) => ((calls.skip = n), query),
    limit: (n) => ((calls.limit = n), query),
    select: () => query,
    lean: async () => [],
  };
  mock.method(Media, "find", () => query);
  mock.method(Media, "countDocuments", async () => 0);

  const r = await fetch(base + "/api/media?page=-4&limit=500", {
    headers: { authorization: bearer(USER_A) },
  });
  const body = await r.json();

  assert.equal(body.page, 1);
  assert.equal(body.limit, 20);
  assert.equal(body.pages, 1);
  assert.equal(calls.skip, 0);
});

test("le média d'un autre utilisateur n'est ni lisible ni supprimable (404)", async () => {
  const filters = {};
  mock.method(Media, "findOne", ownedBy(USER_A, filters, "url"));
  mock.method(Media, "findOneAndDelete", ownedBy(USER_A, filters, "delete"));
  const headers = { authorization: bearer(USER_B) };

  const url = await fetch(`${base}/api/media/${MEDIA_ID}/url`, { headers });
  const del = await fetch(`${base}/api/media/${MEDIA_ID}`, { method: "DELETE", headers });

  assert.equal(url.status, 404);
  assert.equal(del.status, 404);
  assert.equal((await url.json()).message, "Média inconnu");
  // Le filtre contient bien l'identité issue du JWT, pas une valeur envoyée par le client.
  assert.equal(filters.url.ownerId, USER_B);
  assert.equal(filters.delete.ownerId, USER_B);
});

test("un identifiant qui n'est pas un ObjectId : 404 sans requête MongoDB", async () => {
  const findOne = mock.method(Media, "findOne", () => ({ select: async () => null }));

  const r = await fetch(base + "/api/media/pas-un-id/url", {
    headers: { authorization: bearer(USER_A) },
  });

  assert.equal(r.status, 404);
  assert.equal(findOne.mock.callCount(), 0);
});

test("URL de lecture : streaming partiel (206) sans en-tête Authorization", async () => {
  fs.writeFileSync(path.join(uploadsDir, KEY), "0123456789");
  mock.method(Media, "findOne", ownedBy(USER_A, {}, "url"));

  const r = await fetch(`${base}/api/media/${MEDIA_ID}/url`, {
    headers: { authorization: bearer(USER_A) },
  });
  const { url, expiresAt } = await r.json();

  assert.equal(r.status, 200);
  assert.ok(url.startsWith(`/api/media/${MEDIA_ID}/stream?token=`));
  assert.ok(new Date(expiresAt) > new Date());

  // Comme <audio src>, la requête ne porte aucun en-tête Authorization.
  const full = await fetch(base + url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/mpeg");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(await full.text(), "0123456789");

  const partial = await fetch(base + url, { headers: { range: "bytes=2-5" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await partial.text(), "2345");

  fs.unlinkSync(path.join(uploadsDir, KEY));
});

test("URL de lecture : jeton absent, expiré, falsifié ou émis pour un autre média (401)", async () => {
  fs.writeFileSync(path.join(uploadsDir, KEY), "secret");
  const OTHER_ID = "64b0000000000000000000bb";
  const sign = (payload, secret = SECRET, options = { expiresIn: 60 }) =>
    jwt.sign({ typ: "media-url", mid: MEDIA_ID, key: KEY, mime: "audio/mpeg", ...payload }, secret, options);

  const attempts = {
    "sans jeton": `/api/media/${MEDIA_ID}/stream`,
    "jeton expiré": `/api/media/${MEDIA_ID}/stream?token=${sign({}, SECRET, { expiresIn: -10 })}`,
    "mauvaise signature": `/api/media/${MEDIA_ID}/stream?token=${sign({}, "autre-secret")}`,
    "autre média": `/api/media/${OTHER_ID}/stream?token=${sign({})}`,
    // Un JWT de session ne doit pas servir d'URL de lecture.
    "jeton de session": `/api/media/${MEDIA_ID}/stream?token=${bearer(USER_A).slice(7)}`,
    "chemin relatif": `/api/media/${MEDIA_ID}/stream?token=${sign({ key: "../../.env" })}`,
  };

  for (const [label, url] of Object.entries(attempts)) {
    const r = await fetch(base + url);
    assert.equal(r.status, 401, label);
    assert.equal((await r.json()).message, "Lien de lecture invalide ou expiré");
  }

  fs.unlinkSync(path.join(uploadsDir, KEY));
});

test("les logs HTTP masquent la chaîne de requête (jeton de lecture)", async () => {
  const lines = [];
  mock.method(console, "log", (...args) => lines.push(args.join(" ")));

  await fetch(`${base}/api/media/${MEDIA_ID}/stream?token=jeton-tres-secret`);
  await new Promise((r) => setTimeout(r, 20));

  const line = lines.find((l) => l.startsWith("[http]") && l.includes("/stream"));
  assert.ok(line, "ligne [http] attendue");
  assert.ok(line.includes("?[masqué]"));
  assert.ok(!lines.some((l) => l.includes("jeton-tres-secret")));
});

test("DELETE : supprime la métadonnée et le fichier", async () => {
  fs.writeFileSync(path.join(uploadsDir, KEY), "à supprimer");
  mock.method(Media, "findOneAndDelete", ownedBy(USER_A, {}, "delete"));

  const r = await fetch(`${base}/api/media/${MEDIA_ID}`, {
    method: "DELETE",
    headers: { authorization: bearer(USER_A) },
  });

  assert.equal(r.status, 204);
  assert.equal(fs.existsSync(path.join(uploadsDir, KEY)), false);
});

test("DELETE d'un média inexistant : 404 « Média inconnu »", async () => {
  mock.method(Media, "findOneAndDelete", () => ({ select: async () => null }));

  const r = await fetch(`${base}/api/media/${MEDIA_ID}`, {
    method: "DELETE",
    headers: { authorization: bearer(USER_A) },
  });

  assert.equal(r.status, 404);
  assert.equal((await r.json()).message, "Média inconnu");
});

/* -------------------------------------------------------------------------
 * Déploiement : Express sert le build Angular quand il existe.
 * ---------------------------------------------------------------------- */

test("le build Angular est servi, sans masquer les routes /api", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpc-front-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html>angular</html>");
  fs.writeFileSync(path.join(dir, "main.js"), "console.log('main')");

  const front = createApp({ frontendDir: dir, storage }).listen(0);
  await new Promise((r) => front.once("listening", r));
  const url = `http://127.0.0.1:${front.address().port}`;

  try {
    // Un fichier du build est servi tel quel.
    assert.equal(await (await fetch(url + "/main.js")).text(), "console.log('main')");
    // Une route du routeur Angular reçoit index.html.
    const deep = await fetch(url + "/rooms/K7P2QX");
    assert.equal(deep.status, 200);
    assert.equal(await deep.text(), "<html>angular</html>");
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
