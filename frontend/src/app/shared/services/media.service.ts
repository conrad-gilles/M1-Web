import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LocalMediaDeclaration, Media } from '../models/media.model';
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

  upload(file: File, title: string) {
    const body = new FormData();
    body.append('file', file);
    body.append('title', title);
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
