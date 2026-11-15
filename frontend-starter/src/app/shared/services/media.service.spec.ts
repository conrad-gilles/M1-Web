import { TestBed } from '@angular/core/testing';
import { HttpEventType } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MediaService } from './media.service';

describe('MediaService', () => {
  let service: MediaService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MediaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() envoie GET /api/media avec page et limit', () => {
    let result: unknown;
    service.list(3, 10).subscribe((page) => (result = page));

    const request = http.expectOne((req) => req.url === '/api/media');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('3');
    expect(request.request.params.get('limit')).toBe('10');

    const body = { items: [], page: 3, limit: 10, total: 0, pages: 1 };
    request.flush(body);
    expect(result).toEqual(body);
  });

  it('list() utilise page=1 et limit=5 par défaut', () => {
    service.list().subscribe();

    const request = http.expectOne((req) => req.url === '/api/media');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('limit')).toBe('5');
    request.flush({ items: [], page: 1, limit: 5, total: 0, pages: 1 });
  });

  it('upload() envoie un multipart avec exactement les champs file et title', () => {
    const file = new File(['abc'], 'song.mp3', { type: 'audio/mpeg' });
    service.upload(file, 'Mon titre').subscribe();

    const request = http.expectOne('/api/media');
    expect(request.request.method).toBe('POST');
    expect(request.request.reportProgress).toBe(true);

    const body = request.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()].sort()).toEqual(['file', 'title']);
    expect(body.get('title')).toBe('Mon titre');
    expect((body.get('file') as File).name).toBe('song.mp3');
    request.flush({});
  });

  it('upload() émet Sent, puis la progression, puis la réponse finale', () => {
    const file = new File(['abc'], 'song.mp3', { type: 'audio/mpeg' });
    const types: HttpEventType[] = [];
    service.upload(file, 'x').subscribe((event) => types.push(event.type));

    const request = http.expectOne('/api/media');
    request.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    request.flush({ id: '1' });

    // Sent est émis par HttpClient dès que la requête part ; le composant l'ignore.
    expect(types).toEqual([HttpEventType.Sent, HttpEventType.UploadProgress, HttpEventType.Response]);
  });

  it('remove() envoie DELETE /api/media/:id', () => {
    let done = false;
    service.remove('abc123').subscribe(() => (done = true));

    const request = http.expectOne('/api/media/abc123');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(true);
  });

  it('streamUrl() demande une URL de lecture sur /api/media/:id/url', () => {
    let result: unknown;
    service.streamUrl('abc123').subscribe((value) => (result = value));

    const request = http.expectOne('/api/media/abc123/url');
    expect(request.request.method).toBe('GET');
    // Seule l'URL est demandée en JSON : le fichier n'est pas téléchargé ici.
    expect(request.request.responseType).toBe('json');
    const body = { url: '/api/media/abc123/stream?token=t', expiresAt: '2026-11-15T20:00:00.000Z' };
    request.flush(body);
    expect(result).toEqual(body);
  });
});
