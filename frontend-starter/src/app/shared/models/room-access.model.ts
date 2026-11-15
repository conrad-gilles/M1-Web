import { Participant } from './participant.model';
import { Room } from './room.model';

/** Response returned when a room is created or joined. */
export interface RoomAccess {
  room: Room;
  participant: Participant;
  /** Room token: sent with every API call for this room. */
  token: string;
  /** Only returned to the creator of the room. */
  hostToken?: string;
}
