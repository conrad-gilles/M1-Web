import { TestBed } from '@angular/core/testing';
import { RoomAccess } from '../models/room-access.model';
import { RoomSessionService } from './room-session.service';

const access = (overrides: Partial<RoomAccess> = {}): RoomAccess => ({
  room: { code: 'K7P2QX', participants: [], expiresAt: '2026-11-16T10:00:00.000Z' },
  participant: { id: 'p1', name: 'Alex' },
  token: 'jeton-de-salon',
  ...overrides,
});

describe('RoomSessionService', () => {
  const create = () => TestBed.inject(RoomSessionService);

  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('démarre sans session', () => {
    const service = create();

    expect(service.session()).toBeNull();
    expect(service.token()).toBeNull();
    expect(service.isHost()).toBe(false);
  });

  it("open() mémorise la session d'un invité, sans jeton d'hôte", () => {
    const service = create();

    service.open(access());

    expect(service.session()).toEqual({
      code: 'K7P2QX',
      token: 'jeton-de-salon',
      participant: { id: 'p1', name: 'Alex' },
    });
    expect(service.token()).toBe('jeton-de-salon');
    expect(service.isHost()).toBe(false);
  });

  it("open() conserve le jeton d'hôte du créateur du salon", () => {
    const service = create();

    service.open(access({ hostToken: 'secret-hote' }));

    expect(service.isHost()).toBe(true);
    expect(service.session()?.hostToken).toBe('secret-hote');
  });

  it('la session survit à un rechargement de la page (sessionStorage)', () => {
    create().open(access({ hostToken: 'secret-hote' }));
    TestBed.resetTestingModule();

    const reloaded = create();

    expect(reloaded.session()?.code).toBe('K7P2QX');
    expect(reloaded.isHost()).toBe(true);
  });

  it('updateCode() suit un changement de code décidé par l’hôte', () => {
    const service = create();
    service.open(access());

    service.updateCode('NEW234');

    expect(service.session()?.code).toBe('NEW234');
    expect(service.token()).toBe('jeton-de-salon');
    expect(JSON.parse(sessionStorage.getItem('gpc_room_session') ?? '{}').code).toBe('NEW234');
  });

  it('close() oublie la session', () => {
    const service = create();
    service.open(access());

    service.close();

    expect(service.session()).toBeNull();
    expect(sessionStorage.getItem('gpc_room_session')).toBeNull();
  });

  it('ignore une session stockée illisible ou incomplète', () => {
    for (const stored of ['pas-du-json', '{"code":"K7P2QX"}', 'null']) {
      sessionStorage.setItem('gpc_room_session', stored);
      TestBed.resetTestingModule();

      expect(create().session()).toBeNull();
    }
  });
});
