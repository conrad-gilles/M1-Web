import { Media } from './media.model';

/**
 * Temporary playback URL for one media, loaded directly by the media element.
 * `url` and `expiresAt` are null for a local media (`media.source === 'local'`):
 * each participant then plays their own copy of the file.
 */
export interface MediaUrl {
  url: string | null;
  expiresAt: string | null;
  media: Media;
}
