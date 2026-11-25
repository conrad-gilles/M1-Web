import { Injectable, signal } from '@angular/core';
import { Media } from '../models/media.model';
import { FolderFile } from '../local-media/local-folder';
import { LocalFileInfo, sameDuration } from '../local-media/local-media';

/** Résultat de la recherche d'un média de dossier dans le dossier choisi. */
export type FolderLookup =
  | { status: 'found'; chosen: ChosenFile }
  | { status: 'missing' }
  | { status: 'mismatch'; duration: number };

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
  /** Augmente à chaque fichier ou dossier retenu : le lecteur en attente réessaie. */
  readonly changes = signal(0);

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
    this.changes.update((n) => n + 1);
  }

  get(mediaId: string): ChosenFile | undefined {
    return this.chosen.get(mediaId);
  }

  forget(mediaId: string): void {
    this.chosen.delete(mediaId);
  }

  // --- Dossiers locaux ------------------------------------------------------

  /** Dossiers choisis pendant la session : nom du dossier -> chemin -> fichier. */
  private readonly folders = new Map<string, Map<string, File>>();

  rememberFolder(folder: string, files: FolderFile[]): void {
    this.folders.set(folder, new Map(files.map((entry) => [entry.path, entry.file])));
    this.changes.update((n) => n + 1);
  }

  hasFolder(folder: string): boolean {
    return this.folders.has(folder);
  }

  /**
   * Cherche la copie d'un média de dossier dans le dossier de même nom choisi
   * par ce participant : même chemin, même durée (à 1 s près).
   */
  async fromFolder(media: Media): Promise<FolderLookup> {
    const file = media.folder ? this.folders.get(media.folder)?.get(media.originalName) : undefined;
    if (!file) return { status: 'missing' };
    const info = await this.probe(file);
    if (!sameDuration(media.duration ?? 0, info.duration)) return { status: 'mismatch', duration: info.duration };
    const chosen = { file, info };
    this.chosen.set(media.id, chosen); // sans `changes` : c'est le lecteur qui cherche
    return { status: 'found', chosen };
  }
}
