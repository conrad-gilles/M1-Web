import test from "node:test";
import assert from "node:assert/strict";
import { expectedPosition, isValidPosition } from "../src/sync/playback.js";
import { BUFFER_TIMEOUT_MS, RoomSync } from "../src/sync/roomSync.js";

/* -------------------------------------------------------------------------
 * Logique de synchronisation, sans réseau ni navigateur : l'horloge et les
 * minuteurs sont simulés, donc chaque test contrôle le temps.
 * ---------------------------------------------------------------------- */

const ALEX = { id: "p-alex", name: "Alex" };
const SAM = { id: "p-sam", name: "Sam" };
const LOU = { id: "p-lou", name: "Lou" };
const MEDIA = "64b0000000000000000000aa";

/** Crée un salon avec une horloge et des minuteurs contrôlés par le test. */
function createRoom() {
  let time = 1_000_000;
  const timers = new Set();
  const events = [];
  const sync = new RoomSync({
    now: () => time,
    setTimer: (callback, delay) => {
      const timer = { callback, at: time + delay };
      timers.add(timer);
      return timer;
    },
    clearTimer: (timer) => timers.delete(timer),
    onChange: (payload) => events.push(payload),
  });

  return {
    sync,
    events,
    last: () => events.at(-1),
    /** Avance l'horloge et déclenche les minuteurs arrivés à échéance. */
    advance(ms) {
      time += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at <= time && timers.delete(timer)) timer.callback();
      }
    },
    /** Position attendue par tous les clients à l'instant présent. */
    position: () => expectedPosition(sync.playback, time),
    pendingTimers: () => timers.size,
  };
}

/** Salon où un média est chargé et en cours de lecture depuis 0 s. */
function playingRoom() {
  const room = createRoom();
  room.sync.command(ALEX, { type: "load", mediaId: MEDIA });
  room.sync.command(ALEX, { type: "play" });
  return room;
}

test("position attendue : figée en pause, elle avance en lecture selon la vitesse", () => {
  const state = { mediaId: MEDIA, paused: true, position: 12, rate: 1, updatedAt: 1000, version: 1 };

  assert.equal(expectedPosition(state, 9000), 12);
  assert.equal(expectedPosition({ ...state, paused: false }, 3500), 14.5);
  assert.equal(expectedPosition({ ...state, paused: false, rate: 2 }, 3500), 17);
});

test("positions reçues du réseau : seuls les nombres finis positifs sont acceptés", () => {
  for (const valid of [0, 12.5, 7200]) assert.equal(isValidPosition(valid), true);
  for (const invalid of [-1, NaN, Infinity, "12", null, undefined, {}]) {
    assert.equal(isValidPosition(invalid), false);
  }
});

test("charger un média : en pause au début, pour tout le monde", () => {
  const room = createRoom();

  const result = room.sync.command(ALEX, { type: "load", mediaId: MEDIA });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(room.last(), {
    version: 1,
    playback: { mediaId: MEDIA, paused: true, position: 0, rate: 1, updatedAt: 1_000_000, version: 1 },
    waitingFor: [],
    action: "load",
    by: ALEX,
  });
});

test("sans média chargé, les commandes de lecture sont refusées", () => {
  const room = createRoom();

  for (const type of ["play", "pause", "seek", "ended"]) {
    assert.deepEqual(room.sync.command(ALEX, { type, position: 3 }), {
      ok: false,
      message: "Aucun média chargé",
    });
  }
  assert.equal(room.events.length, 0);
});

test("lecture, pause, saut : chaque commande incrémente la version et indique son auteur", () => {
  const room = playingRoom();
  room.advance(4000);

  room.sync.command(SAM, { type: "pause" });
  assert.equal(room.last().action, "pause");
  assert.deepEqual(room.last().by, SAM);
  assert.equal(room.sync.playback.paused, true);
  assert.equal(room.sync.playback.position, 4); // figée à l'heure du serveur

  room.advance(60_000);
  assert.equal(room.position(), 4);

  room.sync.command(ALEX, { type: "seek", position: 120 });
  assert.equal(room.sync.playback.paused, true); // un saut garde l'état pause
  assert.equal(room.position(), 120);

  room.sync.command(ALEX, { type: "play" });
  room.advance(2500);
  assert.equal(room.position(), 122.5);

  assert.deepEqual(
    room.events.map((event) => [event.action, event.version]),
    [["load", 1], ["play", 2], ["pause", 3], ["seek", 4], ["play", 5]],
  );
});

test("un saut pendant la lecture déplace tout le monde sans mettre en pause", () => {
  const room = playingRoom();
  room.advance(3000);

  room.sync.command(SAM, { type: "seek", position: 754 });
  room.advance(1000);

  assert.equal(room.sync.playback.paused, false);
  assert.equal(room.position(), 755);
  assert.deepEqual(room.last().by, SAM);
});

test("deux sauts au même instant : la dernière commande reçue gagne", () => {
  const room = playingRoom();

  room.sync.command(ALEX, { type: "seek", position: 30 });
  room.sync.command(SAM, { type: "seek", position: 90 });

  assert.equal(room.position(), 90);
  assert.equal(room.sync.playback.version, 4);
});

test("commandes sans effet ou invalides : aucun état diffusé", () => {
  const room = playingRoom();
  const before = room.events.length;

  assert.deepEqual(room.sync.command(ALEX, { type: "play" }), { ok: true }); // déjà en lecture
  for (const position of [-5, NaN, Infinity, "12", undefined]) {
    assert.deepEqual(room.sync.command(ALEX, { type: "seek", position }), {
      ok: false,
      message: "Position invalide",
    });
  }
  assert.deepEqual(room.sync.command(ALEX, { type: "explode" }), { ok: false, message: "Commande inconnue" });
  assert.deepEqual(room.sync.command(ALEX, null), { ok: false, message: "Commande inconnue" });

  assert.equal(room.events.length, before);
});

test("fin du média : seul le premier signalement met le salon en pause", () => {
  const room = playingRoom();
  room.advance(180_000);
  const version = room.sync.playback.version;

  room.sync.command(ALEX, { type: "ended", version, position: 180 });
  room.sync.command(SAM, { type: "ended", version, position: 180 }); // doublon ignoré

  assert.equal(room.sync.playback.paused, true);
  assert.equal(room.sync.playback.position, 180);
  assert.equal(room.last().action, "ended");
  assert.equal(room.last().by, null);
  assert.equal(room.sync.playback.version, version + 1);
});

test("fin du média signalée pour un état périmé : ignorée", () => {
  const room = playingRoom();
  const stale = room.sync.playback.version;
  room.sync.command(SAM, { type: "seek", position: 10 }); // quelqu'un revient en arrière

  room.sync.command(ALEX, { type: "ended", version: stale, position: 180 });

  assert.equal(room.sync.playback.paused, false);
});

/* --- Buffering : le salon attend le participant le plus lent ------------- */

test("buffering : le salon se met en pause puis reprend quand le participant est prêt", () => {
  const room = playingRoom();
  room.advance(5000);

  room.sync.bufferStart(SAM);
  assert.equal(room.last().action, "buffering");
  assert.deepEqual(room.last().by, SAM);
  assert.deepEqual(room.last().waitingFor, [SAM]);
  assert.equal(room.sync.playback.paused, true);
  assert.equal(room.position(), 5);

  room.advance(3000); // personne n'avance pendant l'attente
  assert.equal(room.position(), 5);

  room.sync.bufferEnd(SAM);
  assert.equal(room.last().action, "resume");
  assert.deepEqual(room.last().waitingFor, []);
  assert.equal(room.sync.playback.paused, false);

  room.advance(2000);
  assert.equal(room.position(), 7);
  assert.equal(room.pendingTimers(), 0);
});

test("buffering de plusieurs participants : reprise quand tous sont prêts", () => {
  const room = playingRoom();

  room.sync.bufferStart(SAM);
  room.sync.bufferStart(LOU);
  assert.deepEqual(room.last().waitingFor, [SAM, LOU]);

  room.sync.bufferEnd(SAM);
  assert.equal(room.sync.playback.paused, true); // Lou n'est pas prêt
  assert.deepEqual(room.last().waitingFor, [LOU]);

  room.sync.bufferEnd(LOU);
  assert.equal(room.sync.playback.paused, false);
});

test("limite de 10 s : le salon reprend sans le participant bloqué", () => {
  const room = playingRoom();
  room.sync.bufferStart(SAM);

  room.advance(BUFFER_TIMEOUT_MS - 1);
  assert.equal(room.sync.playback.paused, true);

  room.advance(1);
  assert.equal(room.sync.playback.paused, false);
  assert.equal(room.last().action, "resume");
});

test("un participant distancé ne remet pas le salon en pause avant d'être prêt", () => {
  const room = playingRoom();
  room.sync.bufferStart(SAM);
  room.advance(BUFFER_TIMEOUT_MS);
  const events = room.events.length;

  room.sync.bufferStart(SAM); // toujours bloqué : ignoré
  assert.equal(room.sync.playback.paused, false);
  assert.equal(room.events.length, events);

  room.sync.bufferEnd(SAM); // il a rattrapé
  room.sync.bufferStart(SAM); // un nouveau blocage compte de nouveau
  assert.equal(room.sync.playback.paused, true);
});

test("un participant qui se déconnecte pendant l'attente ne retient plus le salon", () => {
  const room = playingRoom();
  room.sync.bufferStart(SAM);

  room.sync.leave(SAM.id);

  assert.equal(room.sync.playback.paused, false);
  assert.equal(room.pendingTimers(), 0);
});

test("pause décidée par un participant : le buffering est ignoré", () => {
  const room = playingRoom();
  room.sync.command(ALEX, { type: "pause" });
  const events = room.events.length;

  room.sync.bufferStart(SAM);
  room.sync.bufferEnd(SAM);

  assert.equal(room.events.length, events);
  assert.equal(room.sync.playback.paused, true);
});

test("pause pendant l'attente : la reprise automatique est annulée", () => {
  const room = playingRoom();
  room.sync.bufferStart(SAM);

  room.sync.command(ALEX, { type: "pause" });
  room.sync.bufferEnd(SAM);
  room.advance(BUFFER_TIMEOUT_MS);

  assert.equal(room.sync.playback.paused, true);
  assert.equal(room.last().action, "pause");
  assert.equal(room.pendingTimers(), 0);
});

test("lecture relancée pendant l'attente : le salon repart, le participant bloqué rattrapera", () => {
  const room = playingRoom();
  room.sync.bufferStart(SAM);

  room.sync.command(ALEX, { type: "play" });
  assert.equal(room.sync.playback.paused, false);
  assert.deepEqual(room.last().waitingFor, []);

  room.sync.bufferStart(SAM); // ignoré tant qu'il n'a pas rattrapé
  assert.equal(room.sync.playback.paused, false);
});

test("saut pendant l'attente : le salon attend toujours, à la nouvelle position", () => {
  const room = playingRoom();
  room.sync.bufferStart(SAM);

  room.sync.command(ALEX, { type: "seek", position: 300 });
  assert.equal(room.sync.playback.paused, true);

  room.sync.bufferEnd(SAM);
  room.advance(1000);
  assert.equal(room.position(), 301);
});

test("changer de média annule l'attente en cours", () => {
  const room = playingRoom();
  room.sync.bufferStart(SAM);

  room.sync.command(ALEX, { type: "load", mediaId: "64b0000000000000000000bb" });
  room.advance(BUFFER_TIMEOUT_MS);

  assert.equal(room.sync.playback.mediaId, "64b0000000000000000000bb");
  assert.equal(room.sync.playback.paused, true); // chargé en pause, pas de reprise seule
  assert.equal(room.pendingTimers(), 0);
});

test("média supprimé : le lecteur du salon se vide, les autres médias ne sont pas touchés", () => {
  const room = playingRoom();

  room.sync.mediaRemoved("64b0000000000000000000bb"); // un autre média
  assert.equal(room.sync.playback.mediaId, MEDIA);

  room.sync.mediaRemoved(MEDIA);
  assert.equal(room.last().action, "unload");
  assert.equal(room.last().playback, null);
  assert.equal(room.last().version, 3);
});

test("plus personne de connecté : la lecture se met en pause à la position courante", () => {
  const room = playingRoom();
  room.advance(42_000);

  room.sync.everyoneLeft();
  room.advance(600_000);

  assert.equal(room.sync.playback.paused, true);
  assert.equal(room.position(), 42);
});

test("un arrivant tardif reçoit l'état courant et calcule la bonne position", () => {
  const room = playingRoom();
  room.sync.command(ALEX, { type: "seek", position: 600 });
  room.advance(15_000);

  const { playback, version, waitingFor } = room.sync.snapshot();

  assert.equal(version, 3);
  assert.deepEqual(waitingFor, []);
  assert.equal(expectedPosition(playback, playback.updatedAt + 15_000), 615);
});
