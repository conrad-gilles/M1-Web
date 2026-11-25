import crypto from "node:crypto";

/** Longueur maximale d'un message, après suppression des espaces autour. */
export const MAX_CHAT_LENGTH = 500;
/** Messages gardés par salon, pour les arrivants tardifs. */
export const CHAT_HISTORY = 200;
/** Anti-spam : au plus RATE_COUNT messages par participant en RATE_WINDOW_MS. */
const RATE_COUNT = 5;
const RATE_WINDOW_MS = 5000;

export const CHAT_INVALID = `Message vide ou trop long (${MAX_CHAT_LENGTH} caractères maximum)`;
export const CHAT_TOO_FAST = "Trop de messages, patientez un instant";

/**
 * Discussion d'un salon, en mémoire comme l'état de lecture : elle convient
 * à une seule instance de serveur et se vide au redémarrage. L'auteur vient
 * toujours du jeton vérifié (jamais du message), le texte est gardé tel quel
 * et affiché comme du texte par le client (jamais comme du HTML).
 */
export class RoomChat {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.messages = [];
    this.recent = new Map(); // participantId -> horodatages des derniers messages
  }

  /** Renvoie `{ ok: true, message }` ou `{ ok: false, message: <erreur> }`. */
  post(participant, text) {
    const clean = typeof text === "string" ? text.trim() : "";
    if (!clean || clean.length > MAX_CHAT_LENGTH) return { ok: false, message: CHAT_INVALID };

    const at = this.now();
    const recent = (this.recent.get(participant.id) ?? []).filter((time) => at - time < RATE_WINDOW_MS);
    if (recent.length >= RATE_COUNT) return { ok: false, message: CHAT_TOO_FAST };
    recent.push(at);
    this.recent.set(participant.id, recent);

    const message = { id: crypto.randomUUID(), from: { id: participant.id, name: participant.name }, text: clean, at };
    this.messages.push(message);
    if (this.messages.length > CHAT_HISTORY) this.messages.shift();
    return { ok: true, message };
  }

  history() {
    return [...this.messages];
  }
}
