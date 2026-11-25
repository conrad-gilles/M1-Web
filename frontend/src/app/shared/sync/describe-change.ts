import { Translate } from '../i18n/i18n.service';
import { PlaybackChange } from '../models/playback-change.model';
import { expectedPosition, formatTime } from './sync-math';

/**
 * Texte de la notice « qui a fait quoi » affichée à tout le salon, ou null
 * quand le changement ne mérite pas de notice. `t` traduit dans la langue
 * choisie (voir I18nService).
 */
export function describeChange(change: PlaybackChange, selfId: string | null, t: Translate): string | null {
  const isSelf = change.by !== null && change.by.id === selfId;
  const name = change.by?.name ?? '';

  switch (change.action) {
    case 'load':
      return change.by ? (isSelf ? t('notice.loadSelf') : t('notice.load', { name })) : null;
    case 'play':
      return change.by ? (isSelf ? t('notice.playSelf') : t('notice.play', { name })) : null;
    case 'pause':
      return change.by ? (isSelf ? t('notice.pauseSelf') : t('notice.pause', { name })) : null;
    case 'seek': {
      if (!change.by || !change.playback) return null;
      // L'état porte la position visée au moment de la commande.
      const time = formatTime(expectedPosition(change.playback, change.playback.updatedAt));
      return isSelf ? t('notice.seekSelf', { time }) : t('notice.seek', { name, time });
    }
    case 'buffering': {
      if (change.waitingFor.length === 0) return null;
      const names = change.waitingFor
        .map((participant) => (participant.id === selfId ? t('notice.you') : participant.name))
        .join(', ');
      return t('notice.buffering', { names });
    }
    case 'resume':
      return t('notice.resume');
    case 'unload':
      return t('notice.unload');
    case 'ended':
      return null;
  }
}
