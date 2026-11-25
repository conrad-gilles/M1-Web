import { TestBed } from '@angular/core/testing';
import { Media } from '../models/media.model';
import { LocalFilesService } from './local-files.service';

const inFolder = (path: string): Media => ({
  id: path,
  source: 'local',
  duration: 1490.7,
  folder: 'Ma série',
  owner: null,
  kind: 'video',
  title: path,
  originalName: path,
  mimeType: '',
  size: 0,
  createdAt: '2026-11-25T10:00:00.000Z',
});

describe('LocalFilesService : dossiers', () => {
  let service: LocalFilesService;
  let probe: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = TestBed.inject(LocalFilesService);
    probe = vi.spyOn(service, 'probe');
  });

  it('trouve la copie de même chemin et de même durée dans le dossier de même nom', async () => {
    const file = new File(['x'], 'ep01.mkv');
    service.rememberFolder('Ma série', [{ path: 'Saison 1/ep01.mkv', file }]);
    probe.mockResolvedValue({ duration: 1491.2, kind: 'video' });

    const found = await service.fromFolder(inFolder('Saison 1/ep01.mkv'));

    expect(found).toEqual({ status: 'found', chosen: { file, info: { duration: 1491.2, kind: 'video' } } });
    expect(service.get('Saison 1/ep01.mkv')?.file).toBe(file);
  });

  it('fichier absent du dossier, ou dossier jamais choisi : missing', async () => {
    service.rememberFolder('Ma série', [{ path: 'autre.mkv', file: new File([], 'autre.mkv') }]);

    expect(await service.fromFolder(inFolder('Saison 1/ep01.mkv'))).toEqual({ status: 'missing' });
    expect(await service.fromFolder({ ...inFolder('x.mkv'), folder: 'Inconnu' })).toEqual({ status: 'missing' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('même chemin mais autre durée : mismatch, rien n’est retenu', async () => {
    service.rememberFolder('Ma série', [{ path: 'ep01.mkv', file: new File([], 'ep01.mkv') }]);
    probe.mockResolvedValue({ duration: 60, kind: 'video' });

    expect(await service.fromFolder(inFolder('ep01.mkv'))).toEqual({ status: 'mismatch', duration: 60 });
    expect(service.get('ep01.mkv')).toBeUndefined();
  });

  it('signale chaque fichier ou dossier retenu (le lecteur en attente réessaie)', () => {
    const before = service.changes();

    service.rememberFolder('Ma série', []);
    service.remember('m1', { file: new File([], 'a.mp4'), info: { duration: 1, kind: 'video' } });

    expect(service.changes()).toBe(before + 2);
    expect(service.hasFolder('Ma série')).toBe(true);
    expect(service.hasFolder('Autre')).toBe(false);
  });
});
