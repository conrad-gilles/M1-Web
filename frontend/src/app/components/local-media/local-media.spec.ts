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

  it('erreur du serveur (salon plein) : message du serveur affiché', async () => {
    probe.mockResolvedValue({ duration: 83, kind: 'audio' });
    await choose(new File(['abc'], 'morceau.mp3'));

    component.declare();
    http
      .expectOne('/api/media/local')
      .flush({ message: 'Salon plein : 20 médias maximum' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(root().querySelector('[role="alert"]')?.textContent).toContain('Salon plein : 20 médias maximum');
    expect(submit().disabled).toBe(false);
  });
});
