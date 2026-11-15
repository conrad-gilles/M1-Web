import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RoomAccess } from '../models/room-access.model';
import { RoomService } from './room.service';
import { RoomSessionService } from './room-session.service';

const room = (code = 'K7P2QX') => ({ code, participants: [], expiresAt: '2026-11-16T10:00:00.000Z' });
const access = (overrides: Partial<RoomAccess> = {}): RoomAccess => ({
  room: room(),
  participant: { id: 'p1', name: 'Alex' },
  token: 'jeton-de-salon',
  ...overrides,
});

describe('RoomService', () => {
  let service: RoomService;
  let session: RoomSessionService;
  let http: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RoomService);
    session = TestBed.inject(RoomSessionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('create() envoie POST /api/rooms avec le nom, puis ouvre la session hôte', () => {
    service.create('Alex').subscribe();

    const request = http.expectOne('/api/rooms');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Alex' });
    request.flush(access({ hostToken: 'secret-hote' }));

    expect(session.session()?.code).toBe('K7P2QX');
    expect(session.isHost()).toBe(true);
  });

  it('join() normalise le code saisi et ouvre la session invité', () => {
    service.join(' k7p2qx ', 'Sam').subscribe();

    const request = http.expectOne('/api/rooms/K7P2QX/join');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Sam' });
    request.flush(access({ participant: { id: 'p2', name: 'Sam' } }));

    expect(session.session()?.participant.name).toBe('Sam');
    expect(session.isHost()).toBe(false);
  });

  it("join() n'ouvre aucune session quand le code est refusé", () => {
    let status = 0;
    service.join('ZZZZZZ', 'Sam').subscribe({ error: (error) => (status = error.status) });

    http.expectOne('/api/rooms/ZZZZZZ/join').flush({ message: 'Salon inconnu' }, { status: 404, statusText: 'Not Found' });

    expect(status).toBe(404);
    expect(session.session()).toBeNull();
  });

  it('current() lit le salon et suit un changement de code', () => {
    session.open(access());

    service.current().subscribe();
    const request = http.expectOne('/api/rooms/current');
    expect(request.request.method).toBe('GET');
    request.flush(room('NEW234'));

    expect(session.session()?.code).toBe('NEW234');
  });

  it('leave() envoie POST /api/rooms/current/leave puis ferme la session', () => {
    session.open(access());

    service.leave().subscribe();
    const request = http.expectOne('/api/rooms/current/leave');
    expect(request.request.method).toBe('POST');
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(session.session()).toBeNull();
  });

  it("changeCode() et close() envoient le jeton d'hôte dans X-Host-Token", () => {
    session.open(access({ hostToken: 'secret-hote' }));

    service.changeCode().subscribe();
    const change = http.expectOne('/api/rooms/current/code');
    expect(change.request.method).toBe('POST');
    expect(change.request.headers.get('X-Host-Token')).toBe('secret-hote');
    change.flush(room('NEW234'));
    expect(session.session()?.code).toBe('NEW234');

    service.close().subscribe();
    const close = http.expectOne('/api/rooms/current');
    expect(close.request.method).toBe('DELETE');
    expect(close.request.headers.get('X-Host-Token')).toBe('secret-hote');
    close.flush(null, { status: 204, statusText: 'No Content' });
    expect(session.session()).toBeNull();
  });

  it("un invité n'envoie pas d'en-tête X-Host-Token", () => {
    session.open(access());

    service.close().subscribe({ error: () => undefined });
    const request = http.expectOne('/api/rooms/current');
    expect(request.request.headers.has('X-Host-Token')).toBe(false);
    request.flush({ message: "Action réservée à l'hôte du salon" }, { status: 403, statusText: 'Forbidden' });

    // Un refus ne ferme pas la session : l'invité reste dans le salon.
    expect(session.session()?.code).toBe('K7P2QX');
  });
});
