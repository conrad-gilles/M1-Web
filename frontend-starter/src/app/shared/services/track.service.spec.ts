import { TestBed } from '@angular/core/testing';
import { HttpEventType } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TrackService } from './track.service';

describe('TrackService', () => {
  let service: TrackService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TrackService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() envoie GET /api/tracks avec page et limit', () => {
    let result: unknown;
    service.list(3, 10).subscribe((page) => (result = page));

    const request = http.expectOne((req) => req.url === '/api/tracks');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('3');
    expect(request.request.params.get('limit')).toBe('10');

    const body = { items: [], page: 3, limit: 10, total: 0, pages: 1 };
    request.flush(body);
    expect(result).toEqual(body);
  });

  it('list() utilise page=1 et limit=5 par défaut', () => {
    service.list().subscribe();

    const request = http.expectOne((req) => req.url === '/api/tracks');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('limit')).toBe('5');
    request.flush({ items: [], page: 1, limit: 5, total: 0, pages: 1 });
  });

  it('upload() envoie un multipart avec exactement les champs audio et title', () => {
    const file = new File(['abc'], 'song.mp3', { type: 'audio/mpeg' });
    service.upload(file, 'Mon titre').subscribe();

    const request = http.expectOne('/api/tracks');
    expect(request.request.method).toBe('POST');
    expect(request.request.reportProgress).toBe(true);

    const body = request.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()].sort()).toEqual(['audio', 'title']);
    expect(body.get('title')).toBe('Mon titre');
    expect((body.get('audio') as File).name).toBe('song.mp3');
    request.flush({});
  });

  it('upload() émet Sent, puis la progression, puis la réponse finale', () => {
    const file = new File(['abc'], 'song.mp3', { type: 'audio/mpeg' });
    const types: HttpEventType[] = [];
    service.upload(file, 'x').subscribe((event) => types.push(event.type));

    const request = http.expectOne('/api/tracks');
    request.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    request.flush({ id: '1' });

    // Sent est émis par HttpClient dès que la requête part ; le composant l'ignore.
    expect(types).toEqual([HttpEventType.Sent, HttpEventType.UploadProgress, HttpEventType.Response]);
  });

  it('remove() envoie DELETE /api/tracks/:id', () => {
    let done = false;
    service.remove('abc123').subscribe(() => (done = true));

    const request = http.expectOne('/api/tracks/abc123');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(true);
  });

  it('audio() demande un Blob sur /api/tracks/:id/audio', () => {
    service.audio('abc123').subscribe();

    const request = http.expectOne('/api/tracks/abc123/audio');
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['x']));
  });
});
