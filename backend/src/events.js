import { EventEmitter } from "node:events";

/*
 * Relie les routes HTTP au temps réel sans que l'une dépende de l'autre : les
 * routes signalent ce qui a changé, realtime.js le diffuse aux participants.
 *
 * Événements (le premier argument est toujours l'identifiant du salon) :
 *   "media:changed"    (roomId)            un média a été ajouté ou supprimé
 *   "media:removed"    (roomId, mediaId)   ce média n'existe plus
 *   "room:updated"     (roomId, room)      le salon a changé (code)
 *   "room:closed"      (roomId)            le salon a été fermé ou a expiré
 *   "participant:left" (roomId, id)        ce participant a quitté le salon
 */
export const roomEvents = new EventEmitter();
