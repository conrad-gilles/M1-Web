import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { MAX_MEDIA_PER_ROOM } from "../src/config.js";
import { Media } from "../src/models/Media.js";
import { startTestApp } from "./helpers/testApp.js";

/* -------------------------------------------------------------------------
 * Médias locaux : rien n'est envoyé, chaque participant lit sa propre copie.
 * Le serveur ne garde que les métadonnées (dont la durée) et synchronise la
 * lecture exactement comme pour un fichier envoyé.
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

const LOCAL = { title: "Film du soir", duration: 5423.48, kind: "video", originalName: "film.mkv", size: 1.4e9 };

const declare = (token, body = LOCAL) => t.json("POST", "/api/media/local", { token, body });

test("média local : 201, métadonnées seulement, aucun fichier stocké", async () => {
  const { token } = await t.createRoom();

  const r = await declare(token);
  const body = await r.json();

  assert.equal(r.status, 201);
  assert.deepEqual(
    { source: body.source, title: body.title, duration: body.duration, kind: body.kind, size: body.size },
    { source: "local", title: "Film du soir", duration: 5423.48, kind: "video", size: 1.4e9 },
  );
  assert.deepEqual(t.storedFiles(), []);

  // Il apparaît dans la liste du salon comme un média ordinaire.
  const list = await (await t.json("GET", "/api/media", { token })).json();
  assert.deepEqual(
    list.items.map(({ title, source, duration }) => ({ title, source, duration })),
    [{ title: "Film du soir", source: "local", duration: 5423.48 }],
  );
});

test("média local : sans jeton, 401", async () => {
  const r = await t.json("POST", "/api/media/local", { body: LOCAL });
  assert.equal(r.status, 401);
});

test("média local : titre, durée et type sont vérifiés (400)", async () => {
  const { token } = await t.createRoom();
  const cases = [
    [{ ...LOCAL, title: "  " }, "Titre requis (200 caractères maximum)"],
    [{ ...LOCAL, title: "x".repeat(201) }, "Titre requis (200 caractères maximum)"],
    [{ ...LOCAL, duration: 0 }, "Durée du média requise (nombre de secondes positif)"],
    [{ ...LOCAL, duration: "90" }, "Durée du média requise (nombre de secondes positif)"],
    [{ ...LOCAL, duration: undefined }, "Durée du média requise (nombre de secondes positif)"],
    [{ ...LOCAL, kind: "pdf" }, "Type de média requis : audio ou video"],
  ];

  for (const [body, message] of cases) {
    const r = await declare(token, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal((await r.json()).message, message);
  }
  assert.equal(t.db.all(Media).length, 0);
});

test("média local : compte dans le quota de médias du salon (409)", async () => {
  const { token } = await t.createRoom();
  mock.method(Media, "countDocuments", async () => MAX_MEDIA_PER_ROOM);

  const r = await declare(token);

  assert.equal(r.status, 409);
});

test("média local : GET /url ne donne pas d'URL, seulement les métadonnées", async () => {
  const { token } = await t.createRoom();
  const media = await (await declare(token)).json();

  const r = await t.json("GET", `/api/media/${media.id}/url`, { token });
  const body = await r.json();

  assert.equal(r.status, 200);
  assert.equal(body.url, null);
  assert.equal(body.expiresAt, null);
  assert.equal(body.media.duration, 5423.48);
  assert.equal(body.media.source, "local");
});

test("média local : la suppression ne touche pas au stockage", async () => {
  const { token } = await t.createRoom();
  const media = await (await declare(token)).json();
  const remove = mock.method(t.storage, "remove");

  const r = await t.json("DELETE", `/api/media/${media.id}`, { token });

  assert.equal(r.status, 204);
  assert.equal(remove.mock.callCount(), 0);
  assert.equal(t.db.all(Media).length, 0);
});

test("fermer un salon avec un média local : rien à supprimer côté stockage", async () => {
  const { token, hostToken } = await t.createRoom();
  await declare(token);
  const remove = mock.method(t.storage, "remove");

  const r = await t.json("DELETE", "/api/rooms/current", { token, headers: { "x-host-token": hostToken } });

  assert.equal(r.status, 204);
  assert.equal(remove.mock.callCount(), 0);
  assert.equal(t.db.all(Media).length, 0);
});

test("média local : la lecture se synchronise comme pour un fichier envoyé", async () => {
  const host = await t.createRoom("Alex");
  const guest = await t.joinRoom(host.room.code, "Sam");
  const media = await (await declare(host.token)).json();
  const alex = await t.connect(host.token);
  const sam = await t.connect(guest.token);

  const loaded = sam.until("playback:state", (s) => s.playback?.mediaId === media.id);
  assert.deepEqual(await alex.command({ type: "load", mediaId: media.id }), { ok: true });
  assert.equal((await loaded).playback.paused, true);

  const playing = alex.until("playback:state", (s) => s.playback && !s.playback.paused);
  assert.deepEqual(await sam.command({ type: "play" }), { ok: true });
  assert.equal((await playing).by.name, "Sam");
});
