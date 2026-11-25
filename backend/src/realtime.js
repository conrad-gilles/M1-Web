import mongoose from "mongoose";
import { Server } from "socket.io";
import { roomEvents } from "./events.js";
import { Media } from "./models/Media.js";
import { Room } from "./models/Room.js";
import { openRoomSession } from "./services/roomService.js";
import { presence } from "./sync/presence.js";
import { RoomSync } from "./sync/roomSync.js";

// Une commande de lecture repousse l'expiration du salon, au plus à ce rythme.
const ACTIVITY_REFRESH_MS = 5 * 60 * 1000;

/**
 * Branche Socket.IO sur le serveur HTTP d'Express. Le serveur est la seule
 * source de vérité : chaque commande reçue est horodatée, versionnée, puis
 * l'état obtenu est diffusé à tout le salon, émetteur compris.
 *
 * L'état des salons est en mémoire : il convient à une seule instance de
 * serveur et se perd à chaque redémarrage (les lecteurs repartent en pause).
 */
export function attachRealtime(httpServer, { now = Date.now } = {}) {
  const origins = process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim());
  const io = new Server(httpServer, {
    serveClient: false,
    ...(origins ? { cors: { origin: origins } } : {}),
  });

  const hubs = new Map(); // roomId -> { sync, touchedAt }

  function hubFor(roomId) {
    if (!hubs.has(roomId)) {
      const sync = new RoomSync({
        now,
        onChange: (payload) => {
          console.log(
            `[sync] Salon ${roomId} : ${payload.action} (version ${payload.version})`,
          );
          io.to(roomId).emit("playback:state", payload);
        },
      });
      hubs.set(roomId, { sync, touchedAt: now() });
    }
    return hubs.get(roomId);
  }

  /** Empêche un salon actif d'expirer, sans écrire en base à chaque commande. */
  async function touch(roomId, hub) {
    if (now() - hub.touchedAt < ACTIVITY_REFRESH_MS) return;
    hub.touchedAt = now();
    try {
      await Room.updateOne({ _id: roomId }, { $set: { lastActivityAt: new Date() } });
    } catch (error) {
      console.error(`[sync] Activité du salon ${roomId} non enregistrée`, error);
    }
  }

  // Le jeton de salon est vérifié pendant la poignée de main : une connexion
  // sans jeton valide n'atteint jamais les gestionnaires d'événements.
  io.use(async (socket, next) => {
    try {
      const session = await openRoomSession(socket.handshake.auth?.token);
      if (!session) return next(new Error("Salon fermé ou jeton invalide"));
      // Le salon vient du jeton vérifié : un client ne peut pas en viser un autre.
      socket.data.roomId = session.room.id;
      socket.data.participant = session.participant;
      socket.data.expiresAt = session.expiresAt;
      next();
    } catch (error) {
      console.error("[sync] Erreur pendant la vérification du jeton", error);
      next(new Error("Erreur interne du serveur"));
    }
  });

  io.on("connection", (socket) => {
    const { roomId, participant } = socket.data;
    const hub = hubFor(roomId);

    socket.join(roomId);
    presence.add(roomId, participant);
    console.log(`[sync] ${participant.id} connecté au salon ${roomId}`);

    // Un arrivant tardif reçoit l'état courant dès sa connexion.
    socket.emit("room:state", {
      ...hub.sync.snapshot(),
      participants: presence.list(roomId),
      serverTime: now(),
    });
    io.to(roomId).emit("room:participants", presence.list(roomId));

    /** Vrai tant que le jeton de la connexion n'a pas expiré. */
    function stillAllowed() {
      if (now() < socket.data.expiresAt) return true;
      console.warn(`[sync] Jeton expiré pour ${participant.id}, déconnexion`);
      socket.emit("room:closed", { reason: "expired" });
      socket.disconnect(true);
      return false;
    }

    // Mesure du décalage d'horloge : le client compare cette heure à la sienne.
    socket.on("clock:ping", (ack) => {
      if (typeof ack === "function") ack({ serverTime: now() });
    });

    socket.on("playback:command", async (command, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        if (!stillAllowed()) return reply({ ok: false, message: "Salon fermé ou jeton invalide" });

        if (command?.type === "load") {
          // Le média doit exister et appartenir à ce salon.
          const known =
            mongoose.isValidObjectId(command.mediaId) &&
            (await Media.findOne({ _id: command.mediaId, roomId }).select("_id").lean());
          if (!known) {
            console.warn(`[sync] Média refusé dans le salon ${roomId}`);
            return reply({ ok: false, message: "Média inconnu" });
          }
        }

        const result = hub.sync.command(participant, command);
        if (!result.ok) console.warn(`[sync] Commande refusée : ${result.message}`);
        reply(result);
        void touch(roomId, hub);
      } catch (error) {
        console.error("[sync] Erreur pendant le traitement d'une commande", error);
        reply({ ok: false, message: "Erreur interne du serveur" });
      }
    });

    /*
     * Signalisation WebRTC du partage direct (P2P) : le serveur ne fait que
     * relayer offre, réponse et candidats ICE vers un autre participant du
     * même salon. Le fichier, lui, ne passe jamais par le serveur.
     */
    socket.on("p2p:signal", async (message) => {
      try {
        if (!stillAllowed()) return;
        const to = message?.to;
        const data = message?.data;
        if (typeof to !== "string" || to === participant.id || data === undefined) return;
        if (JSON.stringify(data).length > 64 * 1024) {
          console.warn(`[p2p] Signal trop volumineux de ${participant.id}, ignoré`);
          return;
        }
        const targets = (await io.in(roomId).fetchSockets()).filter((s) => s.data.participant?.id === to);
        for (const target of targets) target.emit("p2p:signal", { from: participant.id, data });
      } catch (error) {
        console.error("[p2p] Erreur de relais de la signalisation", error);
      }
    });

    socket.on("buffer:start", () => {
      if (stillAllowed()) hub.sync.bufferStart(participant);
    });

    socket.on("buffer:end", () => {
      if (stillAllowed()) hub.sync.bufferEnd(participant);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[sync] ${participant.id} déconnecté du salon ${roomId} (${reason})`);
      if (!presence.remove(roomId, participant.id)) return;

      // Un participant déconnecté ne retient plus le salon.
      hub.sync.leave(participant.id);
      if (presence.count(roomId) === 0) hub.sync.everyoneLeft();
      io.to(roomId).emit("room:participants", presence.list(roomId));
    });
  });

  // --- Changements venus des routes HTTP -----------------------------------

  const listeners = {
    "media:changed": (roomId) => io.to(roomId).emit("media:changed"),
    "media:removed": (roomId, mediaId) => hubs.get(roomId)?.sync.mediaRemoved(mediaId),
    "room:updated": (roomId, room) => io.to(roomId).emit("room:updated", room),
    "room:closed": (roomId) => {
      io.to(roomId).emit("room:closed", { reason: "closed" });
      io.in(roomId).disconnectSockets(true);
      hubs.get(roomId)?.sync.dispose();
      hubs.delete(roomId);
      presence.clear(roomId);
    },
    "participant:left": async (roomId, participantId) => {
      // Son jeton ne vaut plus rien : ses connexions sont fermées.
      for (const socket of await io.in(roomId).fetchSockets()) {
        if (socket.data.participant.id === participantId) {
          socket.emit("room:closed", { reason: "left" });
          socket.disconnect(true);
        }
      }
    },
  };
  for (const [event, listener] of Object.entries(listeners)) roomEvents.on(event, listener);

  return {
    io,
    /** Ferme le temps réel et détache ses écouteurs (utilisé par les tests). */
    async close() {
      for (const [event, listener] of Object.entries(listeners)) roomEvents.off(event, listener);
      for (const hub of hubs.values()) hub.sync.dispose();
      hubs.clear();
      await io.close();
    },
  };
}
