import {
  expectedPosition,
  isValidPosition,
  loadMedia,
  pause,
  play,
  seek,
} from "./playback.js";

// Un participant encore bloqué après ce délai ne retient plus le salon.
export const BUFFER_TIMEOUT_MS = 10_000;

/**
 * Source de vérité de la lecture d'un salon. Les clients n'appliquent que
 * l'état diffusé par cette classe : tout le monde suit la même ligne de temps.
 *
 * Règles (voir Documentation/SYNC_PROTOCOL.md) :
 * - tout le monde peut lancer, mettre en pause, déplacer ou changer le média ;
 *   si deux commandes se croisent, la dernière reçue gagne ;
 * - quand un participant met en mémoire tampon, le salon l'attend, 10 s au
 *   plus, puis reprend sans lui.
 *
 * L'horloge et les minuteurs sont injectés pour pouvoir être simulés en test.
 */
export class RoomSync {
  constructor({
    onChange,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    this.onChange = onChange;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;

    this.version = 0;
    this.playback = null;
    // Participants que le salon attend : identifiant -> { name, timer }.
    this.waiting = new Map();
    // Participants distancés après 10 s : ignorés jusqu'à ce qu'ils soient prêts.
    this.excluded = new Set();
    // Vrai quand la pause vient du buffering et doit se lever toute seule.
    this.resumeWhenReady = false;
  }

  /** État complet, envoyé tel quel à un participant qui arrive. */
  snapshot() {
    return {
      version: this.version,
      playback: this.playback,
      waitingFor: [...this.waiting].map(([id, { name }]) => ({ id, name })),
    };
  }

  /**
   * Applique une commande d'un participant. Renvoie `{ ok: true }`, ou
   * `{ ok: false, message }` si la commande est invalide.
   */
  command(participant, command) {
    const type = command?.type;

    if (type === "load") {
      this.clearWaiting();
      this.excluded.clear();
      this.playback = loadMedia(String(command.mediaId), this.now(), this.nextVersion());
      return this.changed("load", participant);
    }

    if (!this.playback) return { ok: false, message: "Aucun média chargé" };

    if (type === "play") {
      if (this.resumeWhenReady) {
        // Quelqu'un relance pendant l'attente : le salon repart tout de suite,
        // les participants encore bloqués rattraperont seuls.
        for (const id of this.waiting.keys()) this.excluded.add(id);
        this.clearWaiting();
      } else if (!this.playback.paused) {
        return { ok: true };
      }
      this.playback = play(this.playback, this.now(), this.nextVersion());
      return this.changed("play", participant);
    }

    if (type === "pause") {
      if (this.resumeWhenReady) {
        // La pause automatique devient une vraie pause : plus de reprise seule.
        this.clearWaiting();
        this.playback = { ...this.playback, updatedAt: this.now(), version: this.nextVersion() };
        return this.changed("pause", participant);
      }
      if (this.playback.paused) return { ok: true };
      this.playback = pause(this.playback, this.now(), this.nextVersion());
      return this.changed("pause", participant);
    }

    if (type === "seek") {
      if (!isValidPosition(command.position)) {
        return { ok: false, message: "Position invalide" };
      }
      this.playback = seek(this.playback, command.position, this.now(), this.nextVersion());
      return this.changed("seek", participant);
    }

    if (type === "ended") {
      // Chaque lecteur signale la fin du média : seul le premier signalement,
      // émis pour l'état courant, met le salon en pause.
      if (this.playback.paused || command.version !== this.playback.version) return { ok: true };
      const position = isValidPosition(command.position)
        ? command.position
        : expectedPosition(this.playback, this.now());
      this.clearWaiting();
      this.playback = {
        ...this.playback,
        paused: true,
        position,
        updatedAt: this.now(),
        version: this.nextVersion(),
      };
      return this.changed("ended", null);
    }

    return { ok: false, message: "Commande inconnue" };
  }

  /** Un participant signale que son lecteur est bloqué depuis plus de 0,5 s. */
  bufferStart(participant) {
    if (!this.playback || this.waiting.has(participant.id) || this.excluded.has(participant.id)) {
      return;
    }
    // Une pause décidée par un participant n'attend personne.
    if (this.playback.paused && !this.resumeWhenReady) return;

    if (!this.playback.paused) {
      this.playback = pause(this.playback, this.now(), this.nextVersion());
      this.resumeWhenReady = true;
    }

    const timer = this.setTimer(() => this.bufferTimedOut(participant.id), BUFFER_TIMEOUT_MS);
    timer?.unref?.();
    this.waiting.set(participant.id, { name: participant.name, timer });
    this.changed("buffering", participant);
  }

  /** Un participant signale que son lecteur peut de nouveau lire. */
  bufferEnd(participant) {
    this.excluded.delete(participant.id);
    this.stopWaitingFor(participant.id);
  }

  /** Un participant déconnecté ne retient plus le salon. */
  leave(participantId) {
    this.excluded.delete(participantId);
    this.stopWaitingFor(participantId);
  }

  /** Plus personne n'est connecté : inutile de laisser le temps défiler. */
  everyoneLeft() {
    if (!this.playback || (this.playback.paused && !this.resumeWhenReady)) return;
    this.clearWaiting();
    this.excluded.clear();
    if (!this.playback.paused) {
      this.playback = pause(this.playback, this.now(), this.nextVersion());
    }
  }

  /** Le média en cours a été supprimé : le lecteur du salon se vide. */
  mediaRemoved(mediaId) {
    if (this.playback?.mediaId !== String(mediaId)) return;
    this.clearWaiting();
    this.excluded.clear();
    this.playback = null;
    this.nextVersion();
    this.changed("unload", null);
  }

  /** Annule les minuteurs en cours (salon fermé). */
  dispose() {
    this.clearWaiting();
  }

  // --- Détails internes --------------------------------------------------

  bufferTimedOut(participantId) {
    if (!this.waiting.has(participantId)) return;
    // Limite de 10 s : une connexion lente ne peut pas figer le salon.
    this.excluded.add(participantId);
    this.stopWaitingFor(participantId);
  }

  stopWaitingFor(participantId) {
    const entry = this.waiting.get(participantId);
    if (!entry) return;
    this.clearTimer(entry.timer);
    this.waiting.delete(participantId);

    if (this.waiting.size > 0) {
      this.changed("buffering", null);
      return;
    }
    if (this.resumeWhenReady && this.playback) {
      this.resumeWhenReady = false;
      this.playback = play(this.playback, this.now(), this.nextVersion());
      this.changed("resume", null);
    }
  }

  clearWaiting() {
    for (const { timer } of this.waiting.values()) this.clearTimer(timer);
    this.waiting.clear();
    this.resumeWhenReady = false;
  }

  nextVersion() {
    this.version += 1;
    return this.version;
  }

  changed(action, participant) {
    this.onChange({
      ...this.snapshot(),
      action,
      by: participant ? { id: participant.id, name: participant.name } : null,
    });
    return { ok: true };
  }
}
