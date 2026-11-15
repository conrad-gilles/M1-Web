import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RoomSessionService } from '../services/room-session.service';
import { roomTokenInterceptor } from './room-token.interceptor';

describe('roomTokenInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let session: RoomSessionService;

  const open = (token: string) =>
    session.open({
      room: { code: 'K7P2QX', participants: [], expiresAt: '2026-11-16T10:00:00.000Z' },
      participant: { id: 'p1', name: 'Alex' },
      token,
    });

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([roomTokenInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    session = TestBed.inject(RoomSessionService);
  });

  afterEach(() => {
    controller.verify();
    sessionStorage.clear();
  });

  it('ajoute Authorization: Bearer <jeton de salon> quand une session existe', () => {
    open('jeton-de-test');

    http.get('/api/media').subscribe();

    const request = controller.expectOne('/api/media');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jeton-de-test');
    request.flush({});
  });

  it("n'ajoute pas Authorization hors d'un salon", () => {
    http.post('/api/rooms', {}).subscribe();

    const request = controller.expectOne('/api/rooms');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('utilise le jeton courant à chaque requête (après une entrée dans un salon)', () => {
    http.get('/api/a').subscribe();
    expect(controller.expectOne('/api/a').request.headers.has('Authorization')).toBe(false);

    open('nouveau-jeton');
    http.get('/api/b').subscribe();
    expect(controller.expectOne('/api/b').request.headers.get('Authorization')).toBe('Bearer nouveau-jeton');
  });
});
