/*
 * Qui est connecté au WebSocket de chaque salon. Un participant peut avoir
 * plusieurs connexions (rechargement de page en cours) : on les compte.
 * État en mémoire, valable pour une seule instance de serveur.
 */
const rooms = new Map(); // roomId -> Map(participantId -> { name, connections })

export const presence = {
  /** Enregistre une connexion. Renvoie vrai si le participant vient d'arriver. */
  add(roomId, participant) {
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const online = rooms.get(roomId);
    const entry = online.get(participant.id) || { name: participant.name, connections: 0 };
    entry.connections += 1;
    online.set(participant.id, entry);
    return entry.connections === 1;
  },

  /** Retire une connexion. Renvoie vrai si le participant n'en a plus aucune. */
  remove(roomId, participantId) {
    const online = rooms.get(roomId);
    const entry = online?.get(participantId);
    if (!entry) return false;
    entry.connections -= 1;
    if (entry.connections > 0) return false;
    online.delete(participantId);
    if (online.size === 0) rooms.delete(roomId);
    return true;
  },

  isOnline(roomId, participantId) {
    return Boolean(rooms.get(String(roomId))?.has(participantId));
  },

  /** Participants connectés d'un salon : `[{ id, name }]`. */
  list(roomId) {
    return [...(rooms.get(roomId) || [])].map(([id, { name }]) => ({ id, name }));
  },

  count(roomId) {
    return rooms.get(roomId)?.size ?? 0;
  },

  clear(roomId) {
    rooms.delete(roomId);
  },
};
