/*
 * Dossiers locaux : règles pures (testées unitairement).
 *
 * Deux participants partagent un dossier s'ils choisissent chacun un dossier
 * de même nom. Un fichier est alors lisible pour les deux s'il a le même
 * chemin dans le dossier (« Saison 1/ep01.mkv ») et la même durée, à 1 s près.
 */
import { Media } from '../models/media.model';
import { LocalFileInfo, sameDuration } from './local-media';

/** Extensions de médias reconnues quand le navigateur ne donne pas de type MIME. */
const MEDIA_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus',
  '.mp4', '.m4v', '.webm', '.ogv', '.mov', '.avi', '.mkv',
]);

export function isMediaFile(file: File): boolean {
  if (file.type.startsWith('audio/') || file.type.startsWith('video/')) return true;
  const dot = file.name.lastIndexOf('.');
  return dot !== -1 && MEDIA_EXTENSIONS.has(file.name.slice(dot).toLowerCase());
}

/** Un fichier d'un dossier choisi, avec son chemin dans ce dossier. */
export interface FolderFile {
  path: string;
  file: File;
}

/**
 * Lit le résultat d'un champ `<input webkitdirectory>` : nom du dossier
 * choisi (premier élément de `webkitRelativePath`) et ses fichiers audio ou
 * vidéo, sous-dossiers compris. Null si aucun fichier n'a de chemin.
 */
export function readFolder(files: File[]): { folder: string; files: FolderFile[] } | null {
  // Fichier choisi seul (ou navigateur sans webkitRelativePath) : pas de chemin.
  const pathOf = (file: File) => file.webkitRelativePath ?? '';
  const withPath = files.filter((file) => pathOf(file).includes('/'));
  if (withPath.length === 0) return null;
  const folder = pathOf(withPath[0]).split('/')[0];
  const media = withPath
    .filter((file) => pathOf(file).split('/')[0] === folder && isMediaFile(file))
    .map((file) => ({ path: pathOf(file).split('/').slice(1).join('/'), file }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { folder, files: media };
}

/** Fichier du dossier dont le navigateur a lu la durée. */
export interface ProbedFile extends FolderFile {
  info: LocalFileInfo;
}

export interface FolderMatch {
  /** Médias du salon dont ce participant a une copie identique (même chemin, même durée). */
  linked: { media: Media; file: ProbedFile }[];
  /** Même chemin mais durée différente : ce n'est pas le même fichier. */
  mismatched: { media: Media; file: ProbedFile }[];
  /** Fichiers que le salon n'a pas encore : ils peuvent lui être ajoutés. */
  added: ProbedFile[];
}

/** Compare les fichiers d'un dossier choisi aux médias locaux du même dossier dans le salon. */
export function matchFolder(roomItems: Media[], files: ProbedFile[]): FolderMatch {
  const byPath = new Map(
    roomItems.filter((media) => media.source === 'local').map((media) => [media.originalName, media]),
  );
  const result: FolderMatch = { linked: [], mismatched: [], added: [] };
  for (const file of files) {
    const media = byPath.get(file.path);
    if (!media) result.added.push(file);
    else if (sameDuration(media.duration ?? 0, file.info.duration)) result.linked.push({ media, file });
    else result.mismatched.push({ media, file });
  }
  return result;
}
