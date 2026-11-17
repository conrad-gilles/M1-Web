import { Media } from './media.model';

/** Temporary playback URL for one media, loaded directly by the media element. */
export interface MediaUrl {
  url: string;
  expiresAt: string;
  media: Media;
}
