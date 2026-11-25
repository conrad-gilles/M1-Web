import { Participant } from './participant.model';

/** A room chat message, stamped by the server (author from the room token). */
export interface ChatMessage {
  id: string;
  from: Participant;
  text: string;
  /** Server time, in ms. */
  at: number;
}
