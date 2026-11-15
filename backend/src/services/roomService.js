import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_TTL_MS,
  SECRET,
} from "../config.js";
import { roomEvents } from "../events.js";
import { Media } from "../models/Media.js";
import { Room } from "../models/Room.js";

/** Tire un code de salon au hasard, par exemple "K7P2QX". */
export function generateRoomCode() {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Met un code saisi sous forme canonique, ou renvoie null s'il est impossible. */
export function normalizeRoomCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  const valid =
    code.length === ROOM_CODE_LENGTH &&
    [...code].every((character) => ROOM_CODE_ALPHABET.includes(character));
  return valid ? code : null;
}

/** Empreinte du jeton d'hôte : le jeton lui-même n'est jamais stocké. */
export function hashHostToken(hostToken) {
  return crypto.createHash("sha256").update(String(hostToken)).digest("hex");
}

/** Compare un jeton d'hôte reçu à l'empreinte stockée, en temps constant. */
export function isHostToken(hostToken, expectedHash) {
  const received = Buffer.from(hashHostToken(hostToken), "hex");
  const expected = Buffer.from(String(expectedHash), "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

/**
 * Crée le jeton de salon d'un participant. Il est limité à ce salon (`rid`)
 * et sert à l'API, au WebSocket et aux demandes d'URL de lecture.
 */
export function signRoomToken(room, participant) {
  return jwt.sign(
    { typ: "room", rid: room.id, pid: participant.id, name: participant.name },
    SECRET,
    { expiresIn: Math.floor(ROOM_TTL_MS / 1000) },
  );
}

/**
 * Vérifie un jeton de salon (signature, expiration, usage) puis que le salon
 * existe encore et que le participant ne l'a pas quitté. Renvoie
 * `{ room, participant, expiresAt }`, ou null si l'accès doit être refusé.
 */
export async function openRoomSession(token) {
  let payload;
  try {
    payload = jwt.verify(String(token), SECRET);
  } catch (error) {
    console.warn(`[rooms] Jeton de salon refusé : ${error.message}`);
    return null;
  }
  if (payload.typ !== "room" || !payload.rid || !payload.pid) {
    console.warn("[rooms] Jeton refusé : ce n'est pas un jeton de salon");
    return null;
  }

  const room = await Room.findOne({ _id: payload.rid, "participants.id": payload.pid });
  if (!room || isExpired(room)) {
    console.warn(`[rooms] Salon fermé, expiré ou quitté : ${payload.rid}`);
    return null;
  }

  const participant = room.participants.find(({ id }) => id === payload.pid);
  return {
    room,
    participant: { id: participant.id, name: participant.name },
    expiresAt: payload.exp * 1000,
  };
}

export function isExpired(room, now = Date.now()) {
  return room.lastActivityAt.getTime() + ROOM_TTL_MS < now;
}

/** Supprime un salon, ses métadonnées et ses fichiers. */
export async function deleteRoom(roomId, storage) {
  const medias = await Media.find({ roomId }).select("+storageKey");
  for (const media of medias) {
    try {
      await storage.remove(media.storageKey);
    } catch (error) {
      // Un fichier orphelin doit rester visible dans les logs.
      console.error(`[rooms] Fichier non supprimé : ${media.storageKey}`, error);
    }
  }
  await Media.deleteMany({ roomId });
  await Room.deleteOne({ _id: roomId });
  // Les participants encore connectés sont prévenus (voir realtime.js).
  roomEvents.emit("room:closed", String(roomId));
  console.log(`[rooms] Salon supprimé : ${roomId} (${medias.length} média(s))`);
}

/**
 * Supprime les salons inactifs depuis plus de ROOM_TTL_MS. Appelée au
 * démarrage puis régulièrement par server.js : sans cela, les fichiers des
 * salons abandonnés rempliraient le stockage gratuit.
 */
export async function purgeExpiredRooms(storage, now = Date.now()) {
  const expired = await Room.find({ lastActivityAt: { $lt: new Date(now - ROOM_TTL_MS) } });
  for (const room of expired) {
    await deleteRoom(room.id, storage);
  }
  if (expired.length > 0) console.log(`[rooms] ${expired.length} salon(s) expiré(s) supprimé(s)`);
  return expired.map((room) => room.id);
}
