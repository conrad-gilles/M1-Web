import { Injectable } from '@angular/core';
import { LocalFileInfo } from '../local-media/local-media';

/** Fichier local choisi pour un média, avec ce que le navigateur en a lu. */
export interface ChosenFile {
  file: File;
  info: LocalFileInfo;
}

/** Au-delà, le navigateur ne lit visiblement pas ce fichier. */
const PROBE_TIMEOUT_MS = 15_000;

/**
 * Fichiers locaux des participants : lecture de leur durée dans le
 * navigateur, et mémoire des fichiers déjà choisis pendant la session.
 *
 * Rien n'est jamais envoyé : le fichier reste sur l'appareil, le lecteur le
 * lit avec une URL `blob:` locale. Après un rechargement de la page, le
 * navigateur ne peut pas rouvrir un fichier : il faut le choisir de nouveau.
 */
@Injectable({ providedIn: 'root' })
export class LocalFilesService {
  private readonly chosen = new Map<string, ChosenFile>();

  /**
   * Lit les métadonnées du fichier avec un élément <video> hors de la page
   * (il lit aussi les fichiers audio). Échoue si le navigateur ne sait pas
   * lire ce format.
   */
  probe(file: File): Promise<LocalFileInfo> {
    return new Promise((resolve, reject) => {
      const element = document.createElement('video');
      const url = URL.createObjectURL(file);
      const done = () => {
        clearTimeout(timer);
        element.removeAttribute('src');
        element.load();
        URL.revokeObjectURL(url);
      };
      const fail = () => {
        done();
        reject(new Error('Fichier illisible par ce navigateur'));
      };
      const timer = setTimeout(fail, PROBE_TIMEOUT_MS);

      element.preload = 'metadata';
      element.muted = true;
      element.onloadedmetadata = () => {
        const { duration, videoWidth } = element;
        done();
        if (!Number.isFinite(duration) || duration <= 0) {
          reject(new Error('Durée du fichier inconnue'));
          return;
        }
        resolve({ duration, kind: videoWidth > 0 ? 'video' : 'audio' });
      };
      element.onerror = fail;
      element.src = url;
    });
  }

  /** Retient le fichier choisi pour ce média, jusqu'au rechargement de la page. */
  remember(mediaId: string, chosen: ChosenFile): void {
    this.chosen.set(mediaId, chosen);
  }

  get(mediaId: string): ChosenFile | undefined {
    return this.chosen.get(mediaId);
  }

  forget(mediaId: string): void {
    this.chosen.delete(mediaId);
  }
}
