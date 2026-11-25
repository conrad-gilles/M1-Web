import { Media } from '../models/media.model';
import { isMediaFile, matchFolder, readFolder } from './local-folder';

/** Fichier tel que le donne `<input webkitdirectory>`. */
const inFolder = (relativePath: string, type = '') => {
  const file = new File(['x'], relativePath.split('/').pop()!, { type });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
};

const local = (originalName: string, duration: number): Media => ({
  id: originalName,
  source: 'local',
  duration,
  folder: 'Ma série',
  owner: null,
  kind: 'video',
  title: originalName,
  originalName,
  mimeType: '',
  size: 0,
  createdAt: '2026-11-25T10:00:00.000Z',
});

describe('local-folder', () => {
  it('reconnaît les fichiers audio et vidéo, par type ou par extension', () => {
    expect(isMediaFile(new File([], 'a.bin', { type: 'video/mp4' }))).toBe(true);
    expect(isMediaFile(new File([], 'EP01.MKV'))).toBe(true);
    expect(isMediaFile(new File([], 'notes.txt', { type: 'text/plain' }))).toBe(false);
    expect(isMediaFile(new File([], 'cover.jpg', { type: 'image/jpeg' }))).toBe(false);
  });

  it('lit le nom du dossier et le chemin de chaque média, sous-dossiers compris', () => {
    const folder = readFolder([
      inFolder('Ma série/Saison 1/ep02.mkv'),
      inFolder('Ma série/notes.txt', 'text/plain'),
      inFolder('Ma série/Saison 1/ep01.mkv'),
      inFolder('Ma série/générique.mp3', 'audio/mpeg'),
    ]);

    expect(folder?.folder).toBe('Ma série');
    expect(folder?.files.map((entry) => entry.path)).toEqual([
      'générique.mp3',
      'Saison 1/ep01.mkv',
      'Saison 1/ep02.mkv',
    ]);
  });

  it('pas de dossier (fichiers sans chemin) : null', () => {
    expect(readFolder([new File([], 'seul.mp4')])).toBeNull();
    expect(readFolder([])).toBeNull();
  });

  it('associe les fichiers de même chemin et de même durée, signale les autres', () => {
    const room = [local('Saison 1/ep01.mkv', 1490.7), local('Saison 1/ep02.mkv', 1500.2), local('ep03.mkv', 1400)];
    const probed = (path: string, duration: number) => ({
      path,
      file: new File([], path),
      info: { duration, kind: 'video' as const },
    });

    const match = matchFolder(room, [
      probed('Saison 1/ep01.mkv', 1491.3), // même durée à 1 s près
      probed('Saison 1/ep02.mkv', 1200), // autre durée : pas le même fichier
      probed('bonus.mkv', 300), // inconnu du salon
      probed('ep01.mkv', 1490.7), // même nom, autre chemin : inconnu aussi
    ]);

    expect(match.linked.map((entry) => entry.media.originalName)).toEqual(['Saison 1/ep01.mkv']);
    expect(match.mismatched.map((entry) => entry.file.path)).toEqual(['Saison 1/ep02.mkv']);
    expect(match.added.map((entry) => entry.path)).toEqual(['bonus.mkv', 'ep01.mkv']);
  });

  it('ignore les médias envoyés (upload) du même dossier', () => {
    const uploaded = { ...local('ep01.mkv', 10), source: 'upload' as const };

    const match = matchFolder([uploaded], [{ path: 'ep01.mkv', file: new File([], 'ep01.mkv'), info: { duration: 10, kind: 'video' } }]);

    expect(match.linked).toEqual([]);
    expect(match.added.length).toBe(1);
  });
});
