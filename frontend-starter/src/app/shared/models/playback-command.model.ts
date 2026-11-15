/** Command sent to the server; it answers by broadcasting the new state. */
export type PlaybackCommand =
  | { type: 'load'; mediaId: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; position: number }
  | { type: 'ended'; version: number; position: number };

/** Acknowledgement of a command. */
export interface CommandResult {
  ok: boolean;
  message?: string;
}
