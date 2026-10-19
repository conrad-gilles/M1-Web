import test, { mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Track } from "../src/models/Track.js";

let server, base;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test("health sans dépendre de MongoDB", async () => {
  const r = await fetch(base + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "ok");
});

test("schémas Mongoose et relation", () => {
  const u = new User({
    name: "Test",
    email: "TEST@example.com",
    password: "12345678",
  });

  assert.equal(u.email, "test@example.com");
  const t = new Track({
    ownerId: new mongoose.Types.ObjectId(),
    title: "Blues",
    originalName: "b.mp3",
    storedName: "x.mp3",
    mimeType: "audio/mpeg",
    size: 42,
  });
  
  assert.equal(t.title, "Blues");
  assert.equal(Track.schema.path("ownerId").options.ref, "User");
});

/* -------------------------------------------------------------------------
 * TP3 — Tests de contrat et de sécurité (extension facultative)
 *
 * Aucun de ces tests n'a besoin de MongoDB : les routes sont appelées par HTTP
 * sur une vraie application Express, et les méthodes Mongoose (`Track.find`,
 * `Track.findOne`, ...) sont remplacées par des simulations qui enregistrent
 * les filtres reçus. On vérifie ainsi le contrat HTTP et le filtrage par
 * propriétaire sans base de données.
 * ---------------------------------------------------------------------- */

const SECRET = process.env.JWT_SECRET || "tp1-development-secret";
const USER_A = "64b000000000000000000001";
const USER_B = "64b000000000000000000002";

/** Fabrique un JWT valide, identique à celui émis par POST /api/auth/login. */
const bearer = (sub, options = {}) =>
  `Bearer ${jwt.sign({ sub, email: `${sub}@example.com` }, SECRET, options)}`;

/** Envoie un multipart avec les champs demandés. */
const upload = (headers, { title, file } = {}) => {
  const form = new FormData();
  if (title) form.append("title", title);
  if (file) form.append("audio", new Blob([file.content], { type: file.type }), file.name);
  return fetch(base + "/api/tracks", { method: "POST", headers, body: form });
};

test.afterEach(() => mock.restoreAll());

test("401 sans JWT sur toutes les routes protégées", async () => {
  const routes = [
    ["GET", "/api/tracks"],
    ["POST", "/api/tracks"],
    ["GET", "/api/tracks/64b000000000000000000099/audio"],
    ["DELETE", "/api/tracks/64b000000000000000000099"],
    ["GET", "/api/users/me"],
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
    const r = await fetch(base + "/api/tracks", { headers: { authorization } });
    assert.equal(r.status, 401, authorization.slice(0, 20));
  }
});

test("upload sans fichier : 400 « Fichier audio requis »", async () => {
  const r = await upload({ authorization: bearer(USER_A) }, { title: "Sans fichier" });

  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Fichier audio requis");
});

test("upload d'un type MIME refusé : 400 « Format audio non accepté »", async () => {
  const r = await upload(
    { authorization: bearer(USER_A) },
    { title: "Texte", file: { content: "bonjour", type: "text/plain", name: "notes.txt" } },
  );

  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Format audio non accepté");
});

test("pagination : transmet page et limit et ne lit que les pistes du propriétaire", async () => {
  const calls = {};
  const query = {
    sort: () => query,
    skip: (n) => ((calls.skip = n), query),
    limit: (n) => ((calls.limit = n), query),
    select: () => query,
    lean: async () => [{ _id: "t1", title: "Blues", ownerId: USER_A }],
  };
  mock.method(Track, "find", (filter) => ((calls.filter = filter), query));
  mock.method(Track, "countDocuments", async (filter) => ((calls.countFilter = filter), 7));

  const r = await fetch(base + "/api/tracks?page=2&limit=3", {
    headers: { authorization: bearer(USER_A) },
  });
  const body = await r.json();

  assert.equal(r.status, 200);
  assert.deepEqual(
    { page: body.page, limit: body.limit, total: body.total, pages: body.pages },
    { page: 2, limit: 3, total: 7, pages: 3 },
  );
  assert.equal(body.items[0].id, "t1");
  assert.equal(body.items[0]._id, undefined);
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
  mock.method(Track, "find", () => query);
  mock.method(Track, "countDocuments", async () => 0);

  const r = await fetch(base + "/api/tracks?page=-4&limit=500", {
    headers: { authorization: bearer(USER_A) },
  });
  const body = await r.json();

  assert.equal(body.page, 1);
  assert.equal(body.limit, 20);
  assert.equal(body.pages, 1);
  assert.equal(calls.skip, 0);
});

test("la piste d'un autre utilisateur n'est ni lisible ni supprimable (404)", async () => {
  const filters = {};
  // Simule MongoDB : la piste appartient à USER_A, donc toute requête
  // filtrée sur un autre propriétaire ne trouve rien.
  const owned = (name) => (filter) => {
    filters[name] = filter;
    const found = filter.ownerId === USER_A ? { id: filter._id, storedName: "x.mp3" } : null;
    return { select: async () => found };
  };
  mock.method(Track, "findOne", owned("audio"));
  mock.method(Track, "findOneAndDelete", owned("delete"));
  const headers = { authorization: bearer(USER_B) };

  const audio = await fetch(base + "/api/tracks/64b0000000000000000000aa/audio", { headers });
  const del = await fetch(base + "/api/tracks/64b0000000000000000000aa", { method: "DELETE", headers });

  assert.equal(audio.status, 404);
  assert.equal(del.status, 404);
  assert.equal((await audio.json()).message, "Piste inconnue");
  // Le filtre contient bien l'identité issue du JWT, pas une valeur envoyée par le client.
  assert.equal(filters.audio.ownerId, USER_B);
  assert.equal(filters.delete.ownerId, USER_B);
});

test("DELETE d'une piste inexistante : 404 « Piste inconnue »", async () => {
  mock.method(Track, "findOneAndDelete", () => ({ select: async () => null }));

  const r = await fetch(base + "/api/tracks/64b0000000000000000000bb", {
    method: "DELETE",
    headers: { authorization: bearer(USER_A) },
  });

  assert.equal(r.status, 404);
  assert.equal((await r.json()).message, "Piste inconnue");
});
