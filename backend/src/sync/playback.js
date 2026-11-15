/*
 * État de lecture d'un salon et transitions, sous forme de fonctions pures :
 * l'heure est toujours passée en paramètre, ce qui permet de tester la
 * synchronisation sans navigateur ni minuteur.
 *
 * PlaybackState :
 *   mediaId   média chargé dans le salon
 *   paused    lecture en pause ?
 *   position  position en secondes, valable à `updatedAt`
 *   rate      vitesse de lecture, normalement 1
 *   updatedAt horloge du serveur, en ms
 *   version   augmente à chaque changement, pour écarter les messages périmés
 */

/** Position, en secondes, où tout le monde doit se trouver à l'instant `now`. */
export function expectedPosition(state, now) {
  if (state.paused) return state.position;
  return state.position + ((now - state.updatedAt) / 1000) * state.rate;
}

/** Une position reçue du réseau n'est acceptée que si c'est un nombre fini positif. */
export function isValidPosition(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** État initial d'un média qui vient d'être choisi : en pause au début. */
export function loadMedia(mediaId, now, version) {
  return { mediaId, paused: true, position: 0, rate: 1, updatedAt: now, version };
}

export function play(state, now, version) {
  return { ...state, paused: false, updatedAt: now, version };
}

/** La pause fige la position attendue à l'instant du serveur. */
export function pause(state, now, version) {
  return { ...state, paused: true, position: expectedPosition(state, now), updatedAt: now, version };
}

/** Un saut garde l'état lecture/pause et repart de la nouvelle position. */
export function seek(state, position, now, version) {
  return { ...state, position, updatedAt: now, version };
}
