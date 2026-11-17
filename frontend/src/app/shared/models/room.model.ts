import { Participant } from './participant.model';

/** Room data visible to its participants. */
export interface Room {
  code: string;
  participants: Participant[];
  expiresAt: string;
}
