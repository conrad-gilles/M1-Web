import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_HISTORY, CHAT_INVALID, CHAT_TOO_FAST, MAX_CHAT_LENGTH, RoomChat } from "../src/sync/chat.js";
import { startTestApp } from "./helpers/testApp.js";

/* -------------------------------------------------------------------------
 * Discussion du salon : règles (unitaires), puis vrais clients Socket.IO.
 * ---------------------------------------------------------------------- */

const ALEX = { id: "p1", name: "Alex" };

test("discussion : message nettoyé, horodaté, auteur venu du participant", () => {
  const chat = new RoomChat({ now: () => 1000 });

  const result = chat.post(ALEX, "  Salut tout le monde !  ");

  assert.equal(result.ok, true);
  assert.deepEqual(
    { from: result.message.from, text: result.message.text, at: result.message.at },
    { from: ALEX, text: "Salut tout le monde !", at: 1000 },
  );
  assert.match(result.message.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(chat.history(), [result.message]);
});

test("discussion : message vide, trop long ou qui n'est pas du texte → refusé", () => {
  const chat = new RoomChat();

  for (const text of ["", "   ", "x".repeat(MAX_CHAT_LENGTH + 1), 42, null, { text: "x" }]) {
    assert.deepEqual(chat.post(ALEX, text), { ok: false, message: CHAT_INVALID }, JSON.stringify(text));
  }
  assert.equal(chat.post(ALEX, "x".repeat(MAX_CHAT_LENGTH)).ok, true);
  assert.equal(chat.history().length, 1);
});

test("discussion : anti-spam, 5 messages en 5 s au plus par participant", () => {
  let time = 0;
  const chat = new RoomChat({ now: () => time });

  for (let i = 0; i < 5; i += 1) assert.equal(chat.post(ALEX, `m${i}`).ok, true);
  assert.deepEqual(chat.post(ALEX, "trop"), { ok: false, message: CHAT_TOO_FAST });
  // Les autres participants ne sont pas freinés.
  assert.equal(chat.post({ id: "p2", name: "Sam" }, "moi ça va").ok, true);

  time = 5001;
  assert.equal(chat.post(ALEX, "de nouveau").ok, true);
});

test("discussion : seuls les 200 derniers messages sont gardés", () => {
  let time = 0;
  const chat = new RoomChat({ now: () => (time += 10_000) });

  for (let i = 0; i < CHAT_HISTORY + 5; i += 1) chat.post(ALEX, `m${i}`);

  const history = chat.history();
  assert.equal(history.length, CHAT_HISTORY);
  assert.equal(history[0].text, "m5");
});

/* --- Avec de vrais clients Socket.IO ------------------------------------- */

let t;
test.before(async () => {
  t = await startTestApp();
});
test.after(() => t.stop());

const send = (socket, text) => new Promise((resolve) => socket.emit("chat:send", text, resolve));

test("discussion en temps réel : diffusée à tout le salon, auteur tiré du jeton", async () => {
  const alex = await t.createRoom("Alex");
  const sam = await t.joinRoom(alex.room.code, "Sam");
  const alexSocket = await t.connect(alex.token);
  const samSocket = await t.connect(sam.token);

  const toSam = samSocket.next("chat:message");
  const toAlex = alexSocket.next("chat:message");
  assert.deepEqual(await send(alexSocket, "On lance le film ?"), { ok: true });

  const message = await toSam;
  assert.deepEqual({ from: message.from, text: message.text }, { from: { id: alex.participant.id, name: "Alex" }, text: "On lance le film ?" });
  assert.deepEqual(await toAlex, message); // l'auteur reçoit aussi son message
});

test("discussion : refus expliqué, et jamais vers un autre salon", async () => {
  const a = await t.createRoom("Alex");
  const b = await t.createRoom("Bea");
  const alexSocket = await t.connect(a.token);
  const beaSocket = await t.connect(b.token);
  const seenByBea = [];
  beaSocket.on("chat:message", (message) => seenByBea.push(message));

  assert.deepEqual(await send(alexSocket, "   "), { ok: false, message: CHAT_INVALID });
  assert.deepEqual(await send(alexSocket, "bonjour"), { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.deepEqual(seenByBea, []);
});

test("discussion : un arrivant tardif reçoit les messages précédents", async () => {
  const alex = await t.createRoom("Alex");
  const alexSocket = await t.connect(alex.token);
  await send(alexSocket, "premier");
  await send(alexSocket, "second");

  const sam = await t.joinRoom(alex.room.code, "Sam");
  const samSocket = await t.connect(sam.token);

  const history = await samSocket.chatHistory;
  assert.deepEqual(
    history.map((message) => ({ name: message.from.name, text: message.text })),
    [
      { name: "Alex", text: "premier" },
      { name: "Alex", text: "second" },
    ],
  );
});
