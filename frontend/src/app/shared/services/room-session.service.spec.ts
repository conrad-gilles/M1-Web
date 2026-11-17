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

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

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

  it('la session survit à un rechargement et à la fermeture de l’onglet (localStorage)', () => {
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
    expect(JSON.parse(localStorage.getItem('sharing_platform_session') ?? '{}').code).toBe('NEW234');
  });

  it('close() oublie la session', () => {
    const service = create();
    service.open(access());

    service.close();

    expect(service.session()).toBeNull();
    expect(localStorage.getItem('sharing_platform_session')).toBeNull();
  });

  it('ignore une session stockée illisible ou incomplète', () => {
    for (const stored of ['pas-du-json', '{"code":"K7P2QX"}', 'null']) {
      localStorage.setItem('sharing_platform_session', stored);
      TestBed.resetTestingModule();

      expect(create().session()).toBeNull();
    }
  });

  describe('plusieurs onglets du même navigateur', () => {
    /** Simule un autre onglet qui écrit la session, puis l'événement "storage" reçu ici. */
    const otherTab = (value: string | null) => {
      if (value === null) localStorage.removeItem('sharing_platform_session');
      else localStorage.setItem('sharing_platform_session', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'sharing_platform_session', newValue: value }));
    };

    it('un nouvel onglet reprend la session du navigateur : même participant, droits d’hôte compris', () => {
      create().open(access({ hostToken: 'secret-hote' }));
      TestBed.resetTestingModule();

      const secondTab = create();

      expect(secondTab.session()?.participant.id).toBe('p1');
      expect(secondTab.isHost()).toBe(true);
    });

    it('suit la session quand un autre onglet quitte le salon ou en rejoint un autre', () => {
      const service = create();
      service.open(access());
      const seen: (string | null)[] = [];
      service.changedElsewhere$.subscribe((session) => seen.push(session?.code ?? null));

      otherTab(JSON.stringify({ code: 'NEW234', token: 'autre-jeton', participant: { id: 'p9', name: 'Alex' } }));
      expect(service.session()?.code).toBe('NEW234');

      otherTab(null);
      expect(service.session()).toBeNull();

      expect(seen).toEqual(['NEW234', null]);
    });

    it('ignore les autres clés de localStorage', () => {
      const service = create();
      service.open(access());
      let changes = 0;
      service.changedElsewhere$.subscribe(() => (changes += 1));

      window.dispatchEvent(new StorageEvent('storage', { key: 'sharing_platform_name', newValue: 'Sam' }));

      expect(changes).toBe(0);
      expect(service.session()?.code).toBe('K7P2QX');
    });

    it('les changements faits dans cet onglet ne sont pas signalés comme venant d’ailleurs', () => {
      const service = create();
      let changes = 0;
      service.changedElsewhere$.subscribe(() => (changes += 1));

      service.open(access());
      service.updateCode('NEW234');
      service.close();

      expect(changes).toBe(0);
    });
  });
});
