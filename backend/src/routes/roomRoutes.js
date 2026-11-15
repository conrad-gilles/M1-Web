import { Router } from "express";
import crypto from "node:crypto";
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS } from "../config.js";
import { roomEvents } from "../events.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { roomAuth } from "../middleware/roomAuth.js";
import { Room } from "../models/Room.js";
import {
  deleteRoom,
  generateRoomCode,
  hashHostToken,
  isExpired,
  isHostToken,
  normalizeRoomCode,
  signRoomToken,
} from "../services/roomService.js";
import { presence } from "../sync/presence.js";

const UNKNOWN_ROOM = "Salon inconnu";

// Délai laissé à un participant qui vient d'entrer pour ouvrir son WebSocket.
const GHOST_GRACE_MS = 2 * 60 * 1000;
const INVALID_NAME = `Nom d'affichage requis (${MAX_NAME_LENGTH} caractères maximum)`;

/** Valide le nom d'affichage envoyé par le navigateur. */
function cleanName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= MAX_NAME_LENGTH ? name : null;
}

function newParticipant(name) {
  return { id: crypto.randomUUID(), name, joinedAt: new Date() };
}

const publicParticipant = ({ id, name }) => ({ id, name });

/** Une erreur E11000 de MongoDB signale un code de salon déjà pris. */
const isDuplicateKey = (error) => error?.code === 11000;

/**
 * Routes des salons. Il n'y a pas de comptes : l'hôte crée un salon et partage
 * son code ; les autres le rejoignent avec ce code et un nom d'affichage.
 */
export function roomRoutes({ storage, limits = {} }) {
  const router = Router();
  const { failedJoinsPer10Min = 10, creationsPerHour = 10 } = limits;

  // Un code est court : sans limite, il pourrait être deviné par force brute.
  const failedJoins = createRateLimiter({ limit: failedJoinsPer10Min, windowMs: 10 * 60 * 1000 });
  // Chaque salon peut recevoir des fichiers : en limiter la création protège
  // le stockage gratuit partagé.
  const creations = createRateLimiter({ limit: creationsPerHour, windowMs: 60 * 60 * 1000 });

  /** Vérifie l'en-tête X-Host-Token pour les actions réservées à l'hôte. */
  async function hostOnly(req, res, next) {
    try {
      const room = await Room.findOne({ _id: req.room.id }).select("+hostTokenHash");
      const hostToken = req.headers["x-host-token"];
      if (!room || !hostToken || !isHostToken(hostToken, room.hostTokenHash)) {
        console.warn(`[rooms] Action d'hôte refusée dans le salon ${req.room.id}`);
        return res.status(403).json({ message: "Action réservée à l'hôte du salon" });
      }
      next();
    } catch (error) {
      console.error("[rooms] Erreur pendant la vérification du jeton d'hôte", error);
      next(error);
    }
  }

  /** Crée un salon ; son créateur en devient l'hôte et le premier participant. */
  router.post("/", async (req, res, next) => {
    try {
      if (creations.isBlocked(req.ip)) {
        console.warn(`[rooms] Trop de salons créés depuis ${req.ip}`);
        return res.status(429).json({ message: "Trop de salons créés, réessayez plus tard" });
      }

      const name = cleanName(req.body?.name);
      if (!name) {
        console.warn("[rooms] Création refusée : nom d'affichage invalide");
        return res.status(400).json({ message: INVALID_NAME });
      }

      const hostToken = crypto.randomBytes(32).toString("hex");
      const participant = newParticipant(name);

      // Deux salons ne peuvent pas partager un code (index unique) : en cas de
      // collision, on tire simplement un autre code.
      let room;
      for (let attempt = 1; !room; attempt += 1) {
        try {
          room = await Room.create({
            code: generateRoomCode(),
            hostTokenHash: hashHostToken(hostToken),
            participants: [participant],
          });
        } catch (error) {
          if (!isDuplicateKey(error) || attempt >= 5) throw error;
          console.warn("[rooms] Code de salon déjà pris, nouveau tirage");
        }
      }

      creations.hit(req.ip);
      console.log(`[rooms] Salon créé : ${room.id}`);
      res.status(201).json({
        room: room.toPublic(),
        participant: publicParticipant(participant),
        token: signRoomToken(room, participant),
        hostToken,
      });
    } catch (error) {
      console.error("[rooms] Erreur pendant la création du salon", error);
      next(error);
    }
  });

  /** Rejoint un salon avec son code et un nom d'affichage. */
  router.post("/:code/join", async (req, res, next) => {
    try {
      if (failedJoins.isBlocked(req.ip)) {
        console.warn(`[rooms] Trop de codes erronés depuis ${req.ip}`);
        return res.status(429).json({ message: "Trop de tentatives, réessayez plus tard" });
      }

      const name = cleanName(req.body?.name);
      if (!name) {
        console.warn("[rooms] Entrée refusée : nom d'affichage invalide");
        return res.status(400).json({ message: INVALID_NAME });
      }

      const code = normalizeRoomCode(req.params.code);
      const existing = code ? await Room.findOne({ code }) : null;
      if (!existing || isExpired(existing)) {
        failedJoins.hit(req.ip);
        console.warn("[rooms] Entrée refusée : code inconnu ou salon expiré");
        return res.status(404).json({ message: UNKNOWN_ROOM });
      }
      if (existing.participants.length >= MAX_PARTICIPANTS) {
        // Un onglet fermé ne « quitte » pas le salon : avant de refuser, on
        // retire les participants qui ne sont plus connectés.
        const ghosts = existing.participants.filter(
          ({ id, joinedAt }) =>
            !presence.isOnline(existing.id, id) && Date.now() - joinedAt.getTime() > GHOST_GRACE_MS,
        );
        if (ghosts.length === 0) {
          console.warn(`[rooms] Salon complet : ${existing.id}`);
          return res.status(409).json({ message: "Salon complet" });
        }
        for (const ghost of ghosts) {
          await Room.updateOne({ _id: existing.id }, { $pull: { participants: { id: ghost.id } } });
        }
        console.log(`[rooms] ${ghosts.length} participant(s) absent(s) retiré(s) de ${existing.id}`);
      }

      // $push est atomique : deux entrées simultanées ne s'écrasent pas.
      const participant = newParticipant(name);
      const room = await Room.findOneAndUpdate(
        { _id: existing.id },
        { $push: { participants: participant }, $set: { lastActivityAt: new Date() } },
        { returnDocument: "after" },
      );
      if (!room) {
        console.warn("[rooms] Salon fermé pendant l'entrée");
        return res.status(404).json({ message: UNKNOWN_ROOM });
      }

      console.log(`[rooms] Participant ${participant.id} entré dans ${room.id}`);
      res.json({
        room: room.toPublic(),
        participant: publicParticipant(participant),
        token: signRoomToken(room, participant),
      });
    } catch (error) {
      console.error("[rooms] Erreur pendant l'entrée dans le salon", error);
      next(error);
    }
  });

  /** Retourne le salon désigné par le jeton. */
  router.get("/current", roomAuth, (req, res) => {
    console.log(`[rooms] Salon envoyé : ${req.room.id}`);
    res.json(req.room.toPublic());
  });

  /** Quitte le salon : le jeton du participant cesse aussitôt de fonctionner. */
  router.post("/current/leave", roomAuth, async (req, res, next) => {
    try {
      await Room.updateOne(
        { _id: req.room.id },
        { $pull: { participants: { id: req.participant.id } } },
      );
      console.log(`[rooms] Participant ${req.participant.id} sorti de ${req.room.id}`);
      roomEvents.emit("participant:left", req.room.id, req.participant.id);
      res.status(204).end();
    } catch (error) {
      console.error("[rooms] Erreur pendant la sortie du salon", error);
      next(error);
    }
  });

  /** Change le code du salon, par exemple s'il a fuité. Réservé à l'hôte. */
  router.post("/current/code", roomAuth, hostOnly, async (req, res, next) => {
    try {
      let room;
      for (let attempt = 1; !room; attempt += 1) {
        try {
          room = await Room.findOneAndUpdate(
            { _id: req.room.id },
            { $set: { code: generateRoomCode() } },
            { returnDocument: "after" },
          );
          if (!room) return res.status(404).json({ message: UNKNOWN_ROOM });
        } catch (error) {
          if (!isDuplicateKey(error) || attempt >= 5) throw error;
          console.warn("[rooms] Code de salon déjà pris, nouveau tirage");
        }
      }
      console.log(`[rooms] Code changé pour le salon ${room.id}`);
      roomEvents.emit("room:updated", room.id, room.toPublic());
      res.json(room.toPublic());
    } catch (error) {
      console.error("[rooms] Erreur pendant le changement de code", error);
      next(error);
    }
  });

  /** Ferme le salon et supprime ses médias. Réservé à l'hôte. */
  router.delete("/current", roomAuth, hostOnly, async (req, res, next) => {
    try {
      await deleteRoom(req.room.id, storage);
      res.status(204).end();
    } catch (error) {
      console.error("[rooms] Erreur pendant la fermeture du salon", error);
      next(error);
    }
  });

  return router;
}
