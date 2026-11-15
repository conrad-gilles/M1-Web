import { PlaybackState } from '../models/playback-state.model';

/*
 * Calculs de synchronisation, sous forme de fonctions pures : l'heure est
 * toujours passée en paramètre, ce qui permet de les tester sans navigateur.
 * Les règles sont décrites dans Documentation/SYNC_PROTOCOL.md.
 */

/** En dessous de cet écart (secondes), on ne corrige rien. */
export const DRIFT_IGNORED = 0.1;
/** Au-delà de cet écart (secondes), on saute directement à la bonne position. */
export const DRIFT_SEEK = 1;
/** Une correction en cours continue jusqu'à cet écart, pour ne pas osciller autour de 0,1 s. */
export const DRIFT_SETTLED = 0.03;
/** Variation de vitesse utilisée pour rattraper un petit écart (5 %). */
export const RATE_NUDGE = 0.05;

/** Position, en secondes, où tout le monde doit se trouver à l'instant `serverNow`. */
export function expectedPosition(state: PlaybackState, serverNow: number): number {
  if (state.paused) return state.position;
  return state.position + ((serverNow - state.updatedAt) / 1000) * state.rate;
}

export type DriftCorrection =
  | { type: 'none'; drift: number }
  | { type: 'rate'; drift: number; rate: number }
  | { type: 'seek'; drift: number; position: number };

/**
 * Décide comment rattraper l'écart entre la position attendue et la position
 * réelle du lecteur. `drift` est positif quand le lecteur est en retard.
 *
 * - moins de 0,1 s : rien ;
 * - entre 0,1 s et 1 s : on accélère ou ralentit légèrement ;
 * - plus de 1 s : on saute.
 */
export function driftCorrection(
  state: PlaybackState,
  actualPosition: number,
  serverNow: number,
  correcting = false,
): DriftCorrection {
  const expected = expectedPosition(state, serverNow);
  const drift = expected - actualPosition;
  const size = Math.abs(drift);

  if (size > DRIFT_SEEK) return { type: 'seek', drift, position: expected };
  if (size < (correcting ? DRIFT_SETTLED : DRIFT_IGNORED)) return { type: 'none', drift };
  return { type: 'rate', drift, rate: state.rate * (drift > 0 ? 1 + RATE_NUDGE : 1 - RATE_NUDGE) };
}

/** Un aller-retour vers le serveur, pour mesurer le décalage d'horloge. */
export interface ClockSample {
  /** Horloge locale à l'envoi, en ms. */
  sentAt: number;
  /** Horloge locale à la réception, en ms. */
  receivedAt: number;
  /** Horloge du serveur au moment de sa réponse, en ms. */
  serverTime: number;
}

/**
 * Décalage entre l'horloge du serveur et l'horloge locale (méthode de type
 * NTP) : `serverNow = Date.now() + offset`. On garde la mesure dont
 * l'aller-retour est le plus court, car c'est la moins faussée par le réseau.
 */
export function bestClockOffset(samples: ClockSample[]): number {
  if (samples.length === 0) return 0;
  const best = samples.reduce((shortest, sample) =>
    sample.receivedAt - sample.sentAt < shortest.receivedAt - shortest.sentAt ? sample : shortest,
  );
  const roundTrip = best.receivedAt - best.sentAt;
  return best.serverTime + roundTrip / 2 - best.receivedAt;
}

/** Formate une durée en secondes : "3:07", ou "1:02:09" au-delà d'une heure. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
