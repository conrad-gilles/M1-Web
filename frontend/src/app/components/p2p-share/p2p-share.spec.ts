import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Media } from '../../shared/models/media.model';
import { P2pService } from '../../shared/p2p/p2p.service';
import { LocalFilesService } from '../../shared/services/local-files.service';
import { P2pShareComponent } from './p2p-share';

const shared = (): Media => ({
  id: 'p1',
  source: 'p2p',
  duration: 7322.5,
  folder: null,
  owner: { id: 'alex', name: 'Alex' },
  kind: 'video',
  title: 'Film en 4K',
  originalName: 'film.mkv',
  mimeType: 'video/x-matroska',
  size: 3,
  createdAt: '2026-11-25T10:00:00.000Z',
});

describe('P2pShareComponent', () => {
  let fixture: ComponentFixture<P2pShareComponent>;
  let component: P2pShareComponent;
  let http: HttpTestingController;
  let probe: ReturnType<typeof vi.spyOn>;
  let p2p: P2pService;

  const root = () => fixture.nativeElement as HTMLElement;
  const choose = async (file: File) => {
    await component.choose({ target: { files: [file] } } as unknown as Event);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    probe = vi.spyOn(TestBed.inject(LocalFilesService), 'probe');
    p2p = TestBed.inject(P2pService);
    fixture = TestBed.createComponent(P2pShareComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('carte distincte, qui explique le partage direct et ses limites', () => {
    expect(root().querySelector('h2')?.textContent).toBe('Partager en direct (P2P)');
    expect(root().textContent).toContain('Gardez cette page ouverte');
    expect(root().textContent).toContain('débit d’envoi pour chaque spectateur');
    expect(root().textContent).toContain('la connexion directe est impossible');
  });

  it('déclare le partage (métadonnées seulement) et garde le fichier sur cet appareil', async () => {
    probe.mockResolvedValue({ duration: 7322.5, kind: 'video' });
    const file = new File(['abc'], 'film.mkv', { type: 'video/x-matroska' });
    const emitted: Media[] = [];
    component.shared.subscribe((media) => emitted.push(media));
    await choose(file);
    component.title.setValue('Film en 4K');

    component.share();
    const request = http.expectOne('/api/media/p2p');
    expect(request.request.body).toEqual({
      title: 'Film en 4K',
      duration: 7322.5,
      kind: 'video',
      originalName: 'film.mkv',
      mimeType: 'video/x-matroska',
      size: 3,
    });
    request.flush(shared());
    fixture.detectChanges();

    expect(p2p.sharedFile('p1')).toBe(file);
    expect(root().textContent).toContain('« Film en 4K » est partagé en direct depuis votre appareil.');
    expect(emitted.map((media) => media.id)).toEqual(['p1']);
  });

  it('fichier illisible : rien n’est partagé', async () => {
    probe.mockRejectedValue(new Error('illisible'));

    await choose(new File(['x'], 'film.wmv'));

    expect(root().querySelector('[role="alert"]')?.textContent).toContain('ne sait pas lire ce fichier');
    http.expectNone('/api/media/p2p');
  });
});
