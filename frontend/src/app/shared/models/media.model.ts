/** Media metadata (audio or video) returned by the API. */
export interface Media {
  id: string;
  /**
   * upload: the file is stored by the server.
   * local: nothing is uploaded; every participant plays their own copy,
   * recognised by its duration.
   */
  source: 'upload' | 'local';
  /** Duration in seconds, known for a local media; null for an upload. */
  duration: number | null;
  kind: 'audio' | 'video';
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

/** Body of POST /api/media/local. */
export interface LocalMediaDeclaration {
  title: string;
  duration: number;
  kind: Media['kind'];
  originalName: string;
  mimeType: string;
  size: number;
}
