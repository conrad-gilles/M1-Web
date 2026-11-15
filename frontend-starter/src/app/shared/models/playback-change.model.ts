import { Participant } from './participant.model';
import { PlaybackState } from './playback-state.model';

export type PlaybackAction =
  | 'load'
  | 'play'
  | 'pause'
  | 'seek'
  | 'ended'
  | 'buffering'
  | 'resume'
  | 'unload';

/** "playback:state" event: the new room state and what caused it. */
export interface PlaybackChange {
  version: number;
  /** null when no media is loaded in the room. */
  playback: PlaybackState | null;
  /** Participants the room is waiting for while they buffer. */
  waitingFor: Participant[];
  action: PlaybackAction;
  /** Who did it; null when the server did (resume, end of media, ...). */
  by: Participant | null;
}
