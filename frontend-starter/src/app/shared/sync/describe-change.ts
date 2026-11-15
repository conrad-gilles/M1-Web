import { PlaybackChange } from '../models/playback-change.model';
import { expectedPosition, formatTime } from './sync-math';

/**
 * Texte de la notice « qui a fait quoi » affichée à tout le salon, ou null
 * quand le changement ne mérite pas de notice.
 */
export function describeChange(change: PlaybackChange, selfId: string | null): string | null {
  const isSelf = change.by !== null && change.by.id === selfId;
  const who = change.by ? (isSelf ? 'Vous avez' : `${change.by.name} a`) : null;

  switch (change.action) {
    case 'load':
      return who ? `${who} choisi un nouveau média` : null;
    case 'play':
      return who ? `${who} lancé la lecture` : null;
    case 'pause':
      return who ? `${who} mis en pause` : null;
    case 'seek': {
      if (!change.by || !change.playback) return null;
      // L'état porte la position visée au moment de la commande.
      const target = formatTime(expectedPosition(change.playback, change.playback.updatedAt));
      return isSelf ? `Vous êtes allé à ${target}` : `${change.by.name} est allé à ${target}`;
    }
    case 'buffering': {
      if (change.waitingFor.length === 0) return null;
      const names = change.waitingFor
        .map((participant) => (participant.id === selfId ? 'vous' : participant.name))
        .join(', ');
      return `Le salon attend ${names} (mise en mémoire tampon)…`;
    }
    case 'resume':
      return 'Lecture reprise';
    case 'unload':
      return 'Le média en cours a été supprimé';
    case 'ended':
      return null;
  }
}
