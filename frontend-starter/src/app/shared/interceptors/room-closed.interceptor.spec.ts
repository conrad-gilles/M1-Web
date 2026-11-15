import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { RoomSessionService } from '../services/room-session.service';
import { roomClosedInterceptor } from './room-closed.interceptor';

describe('roomClosedInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let session: RoomSessionService;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([roomClosedInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate } },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    session = TestBed.inject(RoomSessionService);
    session.open({
      room: { code: 'K7P2QX', participants: [], expiresAt: '2026-11-16T10:00:00.000Z' },
      participant: { id: 'p1', name: 'Alex' },
      token: 'jeton',
    });
  });

  afterEach(() => {
    controller.verify();
    sessionStorage.clear();
  });

  it("401 : oublie la session, revient à l'accueil et laisse passer l'erreur", () => {
    let status = 0;
    http.get('/api/media').subscribe({ error: (error) => (status = error.status) });

    controller
      .expectOne('/api/media')
      .flush({ message: 'Salon fermé ou jeton invalide' }, { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401);
    expect(session.session()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/'], { queryParams: { closed: 1 } });
  });

  it('une autre erreur (404, 403, 500) ne ferme pas la session', () => {
    for (const status of [403, 404, 500]) {
      http.get(`/api/x${status}`).subscribe({ error: () => undefined });
      controller.expectOne(`/api/x${status}`).flush({}, { status, statusText: 'Erreur' });
    }

    expect(session.session()?.code).toBe('K7P2QX');
    expect(navigate).not.toHaveBeenCalled();
  });
});
