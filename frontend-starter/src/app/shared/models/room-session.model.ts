import { Participant } from './participant.model';

/** What this browser tab remembers about the room it is in. */
export interface RoomSession {
  code: string;
  token: string;
  participant: Participant;
  /** Present only in the host's browser. */
  hostToken?: string;
}
