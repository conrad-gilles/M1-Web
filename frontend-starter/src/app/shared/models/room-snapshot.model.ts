import { Participant } from './participant.model';
import { PlaybackState } from './playback-state.model';

/** "room:state" event: everything a participant needs right after connecting. */
export interface RoomSnapshot {
  version: number;
  playback: PlaybackState | null;
  waitingFor: Participant[];
  /** Participants currently connected to the room. */
  participants: Participant[];
  /** Server clock, in ms. */
  serverTime: number;
}
