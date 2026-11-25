import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LocalFolderItem, LocalMediaDeclaration, Media } from '../models/media.model';
import { MediaUrl } from '../models/media-url.model';
import { Page } from '../models/page.model';

/** Encapsulates all HTTP operations for media files. */
@Injectable({ providedIn: 'root' })
export class MediaService {
  private readonly http = inject(HttpClient);

  list(page = 1, limit = 5) {
    return this.http.get<Page<Media>>('/api/media', {
      params: { page, limit },
    });
  }

  upload(file: File, title: string, folder?: string) {
    const body = new FormData();
    body.append('file', file);
    body.append('title', title);
    if (folder) body.append('folder', folder);
    // observe: 'events' + reportProgress exposent la progression de l'envoi
    // (HttpEventType.UploadProgress) en plus de la réponse finale.
    return this.http.post<Media>('/api/media', body, {
      reportProgress: true,
      observe: 'events',
    });
  }

  /** Déclare un média local : seules ses métadonnées sont envoyées, jamais le fichier. */
  declareLocal(declaration: LocalMediaDeclaration) {
    return this.http.post<Media>('/api/media/local', declaration);
  }

  /** Déclare un partage direct (P2P) : le fichier reste sur cet appareil. */
  declareP2p(declaration: LocalMediaDeclaration) {
    return this.http.post<Media>('/api/media/p2p', declaration);
  }

  /** Déclare les fichiers d'un dossier local (métadonnées seulement). */
  declareLocalFolder(folder: string, items: LocalFolderItem[]) {
    return this.http.post<Media[]>('/api/media/local-folder', { folder, items });
  }

  /** Tous les médias d'un dossier du salon. */
  folder(name: string) {
    return this.http.get<Media[]>('/api/media/folder', { params: { name } });
  }

  /** URL temporaire qui télécharge le fichier sous son nom d'origine. */
  downloadUrl(id: string) {
    return this.http.get<{ url: string; expiresAt: string }>(`/api/media/${id}/download`);
  }

  /**
   * Demande une URL de lecture temporaire. Le lecteur la charge directement
   * (streaming par requêtes Range) : le fichier n'est jamais téléchargé en
   * entier par HttpClient.
   */
  streamUrl(id: string) {
    return this.http.get<MediaUrl>(`/api/media/${id}/url`);
  }

  remove(id: string) {
    return this.http.delete<void>(`/api/media/${id}`);
  }
}
