/** Media metadata (audio or video) returned by the API. */
export interface Media {
  id: string;
  /**
   * upload: the file is stored by the server.
   * local: nothing is uploaded; every participant plays their own copy,
   * recognised by its duration.
   */
  source: 'upload' | 'local' | 'p2p';
  /** Participant who streams a `p2p` media from their device (null otherwise). */
  owner: { id: string; name: string } | null;
  /** Duration in seconds, known for a local media; null for an upload. */
  duration: number | null;
  /**
   * Folder the file came from (uploaded or synced folder), or null. For a
   * local folder, `originalName` is the file's path inside that folder.
   */
  folder: string | null;
  kind: 'audio' | 'video';
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

/** One file of POST /api/media/local-folder (`originalName`: path inside the folder). */
export type LocalFolderItem = Omit<LocalMediaDeclaration, 'title'>;

/** Body of POST /api/media/local. */
export interface LocalMediaDeclaration {
  title: string;
  duration: number;
  kind: Media['kind'];
  originalName: string;
  mimeType: string;
  size: number;
}
