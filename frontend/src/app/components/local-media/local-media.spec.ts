import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Media } from '../../shared/models/media.model';
import { LocalFilesService } from '../../shared/services/local-files.service';
import { LocalMediaComponent } from './local-media';

const declared = (overrides: Partial<Media> = {}): Media => ({
  id: 'loc1',
  source: 'local',
  duration: 5423.48,
  folder: null,
  owner: null,
  kind: 'video',
  title: 'Film du soir',
  originalName: 'film.mkv',
  mimeType: 'video/x-matroska',
  size: 3,
  createdAt: '2026-11-25T10:00:00.000Z',
  ...overrides,
});

describe('LocalMediaComponent', () => {
  let fixture: ComponentFixture<LocalMediaComponent>;
  let component: LocalMediaComponent;
  let http: HttpTestingController;
  let localFiles: LocalFilesService;
  let probe: ReturnType<typeof vi.spyOn>;

  const root = () => fixture.nativeElement as HTMLElement;
  const submit = () => root().querySelector<HTMLButtonElement>('button')!;
  const choose = async (file: File) => {
    await component.choose({ target: { files: [file] } } as unknown as Event);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    localFiles = TestBed.inject(LocalFilesService);
    // jsdom ne lit aucun média : la durée lue par le navigateur est simulée.
    probe = vi.spyOn(localFiles, 'probe');
    fixture = TestBed.createComponent(LocalMediaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('est une carte distincte de l’upload, qui explique que rien n’est envoyé', () => {
    expect(root().querySelector('h2')?.textContent).toBe('Synchroniser un fichier local');
    expect(root().textContent).toContain('Rien n\'est envoyé');
    expect(submit().disabled).toBe(true);
  });

  it('lit la durée du fichier dans le navigateur, sans requête', async () => {
    probe.mockResolvedValue({ duration: 5423.48, kind: 'video' });

    await choose(new File(['abc'], 'film.mkv', { type: 'video/x-matroska' }));

    expect(root().textContent).toContain('Durée : 1:30:23 (vidéo)');
    expect(submit().disabled).toBe(false);
    http.expectNone('/api/media/local');
  });

  it('déclare le média (métadonnées seulement), retient le fichier et prévient la bibliothèque', async () => {
    probe.mockResolvedValue({ duration: 5423.48, kind: 'video' });
    const emitted: Media[] = [];
    component.declared.subscribe((media) => emitted.push(media));
    const file = new File(['abc'], 'film.mkv', { type: 'video/x-matroska' });
    await choose(file);
    component.title.setValue('Film du soir');

    submit().click();
    const request = http.expectOne('/api/media/local');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      title: 'Film du soir',
      duration: 5423.48,
      kind: 'video',
      originalName: 'film.mkv',
      mimeType: 'video/x-matroska',
      size: 3,
    });
    expect(request.request.body instanceof FormData).toBe(false); // jamais le fichier
    request.flush(declared());
    fixture.detectChanges();

    expect(emitted.map((media) => media.id)).toEqual(['loc1']);
    // Celui qui l'ajoute n'aura pas à rechoisir son fichier pour le lire.
    expect(localFiles.get('loc1')?.file).toBe(file);
    expect(root().textContent).toContain('chacun lira sa propre copie');
    expect(component.title.value).toBe('');
    expect(submit().disabled).toBe(true);
  });

  it('titre par défaut : le nom du fichier', async () => {
    probe.mockResolvedValue({ duration: 83, kind: 'audio' });
    await choose(new File(['abc'], 'morceau.flac', { type: 'audio/flac' }));

    component.declare();

    const request = http.expectOne('/api/media/local');
    expect(request.request.body.title).toBe('morceau.flac');
    request.flush(declared({ title: 'morceau.flac' }));
  });

  it('fichier illisible par le navigateur : message, rien n’est déclaré', async () => {
    probe.mockRejectedValue(new Error('Fichier illisible par ce navigateur'));

    await choose(new File(['abc'], 'film.wmv'));

    expect(root().querySelector('[role="alert"]')?.textContent).toContain('ne sait pas lire ce fichier');
    expect(submit().disabled).toBe(true);
  });

  it('erreur du serveur : message du serveur affiché', async () => {
    probe.mockResolvedValue({ duration: 83, kind: 'audio' });
    await choose(new File(['abc'], 'morceau.mp3'));

    component.declare();
    http
      .expectOne('/api/media/local')
      .flush({ message: 'Erreur interne du serveur' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(root().querySelector('[role="alert"]')?.textContent).toContain('Erreur interne du serveur');
    expect(submit().disabled).toBe(false);
  });

  describe('dossier local', () => {
    /** Fichier tel que le donne `<input webkitdirectory>`. */
    const inFolder = (relativePath: string, type = 'video/mp4') => {
      const file = new File(['x'], relativePath.split('/').pop()!, { type });
      Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
      return file;
    };
    const roomEntry = (originalName: string, duration: number): Media => ({
      ...declared({ id: `room-${originalName}`, originalName, duration }),
      folder: 'Ma série',
    });
    /** Le navigateur lit la durée : selon le nom du fichier, dans ces tests. */
    const durations: Record<string, number> = { 'ep01.mp4': 1490.7, 'ep02.mp4': 1200, 'bonus.mp4': 300 };

    beforeEach(() => {
      probe.mockImplementation(async (file: File) => {
        if (!(file.name in durations)) throw new Error('illisible');
        return { duration: durations[file.name], kind: 'video' };
      });
    });

    it('relie les fichiers identiques, ajoute les nouveaux, signale les différents — sans rien envoyer', async () => {
      const files = [
        inFolder('Ma série/ep01.mp4'),
        inFolder('Ma série/ep02.mp4'),
        inFolder('Ma série/bonus.mp4'),
        inFolder('Ma série/cassé.mp4'),
        inFolder('Ma série/notes.txt', 'text/plain'),
      ];
      const emitted: Media[] = [];
      component.declared.subscribe((media) => emitted.push(media));

      const pending = component.chooseFolder({ target: { files, value: 'x' } } as unknown as Event);
      const list = await vi.waitFor(() => http.expectOne((req) => req.url === '/api/media/folder'));
      expect(list.request.params.get('name')).toBe('Ma série');
      list.flush([roomEntry('ep01.mp4', 1491), roomEntry('ep02.mp4', 1500)]);

      const declare = await vi.waitFor(() => http.expectOne('/api/media/local-folder'));
      // Seul le fichier inconnu du salon est déclaré, avec son chemin et sa durée.
      expect(declare.request.body).toEqual({
        folder: 'Ma série',
        items: [{ originalName: 'bonus.mp4', duration: 300, kind: 'video', mimeType: 'video/mp4', size: 1 }],
      });
      declare.flush([{ ...roomEntry('bonus.mp4', 300), id: 'new-bonus' }]);
      await pending;
      fixture.detectChanges();

      expect(localFiles.get('room-ep01.mp4')?.file.name).toBe('ep01.mp4');
      expect(localFiles.get('new-bonus')?.file.name).toBe('bonus.mp4');
      expect(localFiles.get('room-ep02.mp4')).toBeUndefined();
      expect(localFiles.hasFolder('Ma série')).toBe(true);
      const text = root().textContent ?? '';
      expect(text).toContain('Dossier « Ma série » : 1 fichier(s) relié(s) au salon, 1 ajouté(s).');
      expect(text).toContain('Durée différente de celle du salon, non synchronisés : ep02.mp4');
      expect(text).toContain('Illisibles par ce navigateur : cassé.mp4');
      expect(emitted.map((media) => media.id)).toEqual(['new-bonus']);
    });

    it('tout est déjà dans le salon : rien n’est déclaré', async () => {
      const pending = component.chooseFolder({
        target: { files: [inFolder('Ma série/ep01.mp4')], value: 'x' },
      } as unknown as Event);
      (await vi.waitFor(() => http.expectOne((req) => req.url === '/api/media/folder'))).flush([
        roomEntry('ep01.mp4', 1490.7),
      ]);
      await pending;
      fixture.detectChanges();

      http.expectNone('/api/media/local-folder');
      expect(root().textContent).toContain('1 fichier(s) relié(s) au salon, 0 ajouté(s)');
    });

    it('dossier sans fichier audio ou vidéo : message, aucune requête', async () => {
      await component.chooseFolder({
        target: { files: [inFolder('Vide/notes.txt', 'text/plain')], value: 'x' },
      } as unknown as Event);
      fixture.detectChanges();

      expect(root().querySelector('[role="alert"]')?.textContent).toContain('aucun fichier audio ou vidéo');
      http.expectNone((req) => req.url === '/api/media/folder');
    });
  });
});
