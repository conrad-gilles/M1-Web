/** Media metadata (audio or video) returned by the API. */
export interface Media {
  id: string;
  kind: 'audio' | 'video';
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}
