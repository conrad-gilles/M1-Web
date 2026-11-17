/** Shared playback state of a room. The server is its single source of truth. */
export interface PlaybackState {
  mediaId: string;
  paused: boolean;
  /** Seconds, valid at `updatedAt`. */
  position: number;
  /** Playback rate, normally 1. */
  rate: number;
  /** Server clock, in ms. */
  updatedAt: number;
  /** Incremented on every change, used to drop stale messages. */
  version: number;
}
