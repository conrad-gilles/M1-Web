import { TestBed } from '@angular/core/testing';
import { PlaybackChange } from '../models/playback-change.model';
import { PlaybackState } from '../models/playback-state.model';
import { RoomSnapshot } from '../models/room-snapshot.model';
import { FakeSyncSocket } from '../testing/fake-sync-socket';
import { SYNC_SOCKET_FACTORY, SyncService } from './sync.service';

const ALEX = { id: 'p1', name: 'Alex' };
const SAM = { id: 'p2', name: 'Sam' };

const playback = (overrides: Partial<PlaybackState> = {}): PlaybackState => ({
  mediaId: 'm1',
  paused: true,
  position: 0,
  rate: 1,
  updatedAt: 1_000_000,
  version: 1,
  ...overrides,
});

const snapshot = (overrides: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  version: 0,
  playback: null,
  waitingFor: [],
  participants: [ALEX],
  serverTime: 1_000_000,
  ...overrides,
});

const change = (version: number, overrides: Partial<PlaybackChange> = {}): PlaybackChange => ({
  version,
  playback: playback({ version }),
  waitingFor: [],
  action: 'play',
  by: SAM,
  ...overrides,
});

describe('SyncService', () => {
  let service: SyncService;
  let sockets: FakeSyncSocket[];
  let tokens: string[];

  const socket = () => sockets.at(-1) as FakeSyncSocket;

  /** Ouvre la connexion et reçoit l'état initial du salon. */
  const goOnline = (initial = snapshot()) => {
    service.connect('jeton-de-salon');
    socket().receive('connect');
    socket().receive('room:state', initial);
  };

  beforeEach(() => {
    sockets = [];
    tokens = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SYNC_SOCKET_FACTORY,
          useValue: (token: string) => {
            tokens.push(token);
            sockets.push(new FakeSyncSocket());
            return socket();
          },
        },
      ],
    });
    service = TestBed.inject(SyncService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('se connecte avec le jeton de salon, puis passe en ligne à réception de l’état', () => {
    expect(service.status()).toBe('offline');

    service.connect('jeton-de-salon');
    expect(tokens).toEqual(['jeton-de-salon']);
    expect(service.status()).toBe('connecting');

    socket().receive('room:state', snapshot({ version: 3, playback: playback({ version: 3 }), participants: [ALEX, SAM] }));

    expect(service.online()).toBe(true);
    expect(service.playback()?.version).toBe(3);
    expect(service.participants()).toEqual([ALEX, SAM]);
  });

  it('un arrivant tardif reçoit l’état courant dès sa connexion', () => {
    goOnline(snapshot({ version: 7, playback: playback({ paused: false, position: 600, version: 7 }) }));

    expect(service.playback()).toMatchObject({ paused: false, position: 600 });
  });

  describe('décalage d’horloge', () => {
    it('mesure 5 allers-retours et garde le plus court', () => {
      vi.useFakeTimers({ now: 1000 });
      service.connect('jeton');
      socket().receive('connect'); // premier ping envoyé à 1000

      // [réception, heure du serveur]. Chaque accusé de réception déclenche
      // aussitôt le ping suivant. Le 3e aller-retour ne dure que 10 ms : c'est
      // le plus fiable. Les autres, plus lents, donnent un décalage faussé.
      const rounds = [
        [1200, 6150], // 200 ms d'aller-retour
        [1300, 6290], // 100 ms
        [1310, 6305], // 10 ms -> 6305 + 5 - 1310 = 5000
        [1610, 6500], // 300 ms
        [1710, 6700], // 100 ms
      ];
      for (const [receivedAt, serverTime] of rounds) {
        vi.setSystemTime(receivedAt);
        socket().acknowledge('clock:ping', { serverTime });
      }

      expect(socket().sent('clock:ping').length).toBe(5);
      expect(service.clockOffset()).toBe(5000);

      vi.setSystemTime(10_000);
      expect(service.serverNow()).toBe(15_000);
    });

    it('mesure de nouveau l’horloge après une reconnexion', () => {
      service.connect('jeton');
      socket().receive('connect');
      socket().receive('connect');

      expect(socket().sent('clock:ping').length).toBe(2);
    });
  });

  describe('état partagé', () => {
    it('applique un nouvel état et le signale avec son auteur', () => {
      goOnline();
      const seen: PlaybackChange[] = [];
      service.changes$.subscribe((value) => seen.push(value));

      socket().receive('playback:state', change(1, { action: 'load' }));
      socket().receive('playback:state', change(2, { playback: playback({ paused: false, version: 2 }) }));

      expect(service.playback()).toMatchObject({ paused: false, version: 2 });
      expect(seen.map((value) => [value.action, value.by?.name])).toEqual([
        ['load', 'Sam'],
        ['play', 'Sam'],
      ]);
    });

    it('écarte un message plus ancien que l’état connu', () => {
      goOnline(snapshot({ version: 5, playback: playback({ position: 50, version: 5 }) }));
      const seen: PlaybackChange[] = [];
      service.changes$.subscribe((value) => seen.push(value));

      socket().receive('playback:state', change(4, { playback: playback({ position: 10, version: 4 }) }));

      expect(service.playback()?.position).toBe(50);
      expect(seen).toEqual([]);
    });

    it('à version égale, ne met à jour que la liste d’attente', () => {
      goOnline(snapshot({ version: 5, playback: playback({ version: 5 }) }));
      const before = service.playback();

      socket().receive('playback:state', change(5, { action: 'buffering', waitingFor: [SAM] }));

      expect(service.waitingFor()).toEqual([SAM]);
      expect(service.playback()).toBe(before);
    });

    it('vide le lecteur quand le média en cours est supprimé', () => {
      goOnline(snapshot({ version: 2, playback: playback({ version: 2 }) }));

      socket().receive('playback:state', change(3, { action: 'unload', playback: null, by: null }));

      expect(service.playback()).toBeNull();
    });

    it('accepte l’état d’un serveur redémarré, même avec une version plus basse', () => {
      goOnline(snapshot({ version: 9, playback: playback({ version: 9 }) }));

      socket().receive('room:state', snapshot({ version: 0, playback: null }));
      socket().receive('playback:state', change(1));

      expect(service.playback()?.version).toBe(1);
    });
  });

  describe('commandes', () => {
    it('envoie la commande et attend l’accusé de réception du serveur', async () => {
      goOnline();

      const result = service.send({ type: 'seek', position: 42 });
      expect(socket().sent('playback:command')[0][0]).toEqual({ type: 'seek', position: 42 });
      socket().acknowledge('playback:command', { ok: true });

      await expect(result).resolves.toEqual({ ok: true });
      // La commande ne change rien localement : seul l'état diffusé compte.
      expect(service.playback()).toBeNull();
    });

    it('transmet le refus du serveur', async () => {
      goOnline();

      const result = service.send({ type: 'load', mediaId: 'inconnu' });
      socket().acknowledge('playback:command', { ok: false, message: 'Média inconnu' });

      await expect(result).resolves.toEqual({ ok: false, message: 'Média inconnu' });
    });

    it('n’envoie rien hors ligne', async () => {
      service.connect('jeton'); // connexion en cours, pas encore en ligne

      const result = await service.send({ type: 'play' });

      expect(result.ok).toBe(false);
      expect(socket().sent('playback:command')).toEqual([]);
    });

    it('signale le début et la fin d’un blocage du lecteur', () => {
      goOnline();

      service.bufferStart();
      service.bufferEnd();

      expect(socket().emitted.map((message) => message.event).filter((event) => event.startsWith('buffer:'))).toEqual([
        'buffer:start',
        'buffer:end',
      ]);
    });
  });

  describe('événements du salon', () => {
    it('relaie la présence, les médias, le changement de code et la fermeture', () => {
      goOnline();
      const events: string[] = [];
      service.mediaChanged$.subscribe(() => events.push('media'));
      service.roomUpdated$.subscribe((room) => events.push(`code ${room.code}`));
      service.roomClosed$.subscribe(() => events.push('fermé'));

      socket().receive('room:participants', [ALEX, SAM]);
      socket().receive('media:changed');
      socket().receive('room:updated', { code: 'NEW234', participants: [], expiresAt: '' });
      socket().receive('room:closed');

      expect(service.participants()).toEqual([ALEX, SAM]);
      expect(events).toEqual(['media', 'code NEW234', 'fermé']);
    });

    it('un refus d’authentification signale que le salon n’est plus accessible', () => {
      service.connect('jeton-refusé');
      let closed = 0;
      service.roomClosed$.subscribe(() => (closed += 1));

      socket().receive('connect_error', new Error('websocket error')); // panne réseau : on réessaie
      expect(closed).toBe(0);

      socket().receive('connect_error', new Error('Salon fermé ou jeton invalide'));
      expect(closed).toBe(1);
    });

    it('repasse en « connexion » après une coupure réseau, hors ligne si le serveur ferme', () => {
      goOnline();

      socket().receive('disconnect', 'transport close');
      expect(service.status()).toBe('connecting');

      socket().receive('room:state', snapshot());
      socket().receive('disconnect', 'io server disconnect');
      expect(service.status()).toBe('offline');
    });
  });

  it('disconnect() ferme le socket et oublie l’état', () => {
    goOnline(snapshot({ version: 2, playback: playback({ version: 2 }) }));
    const closed = socket();

    service.disconnect();

    expect(closed.disconnected).toBe(true);
    expect(service.status()).toBe('offline');
    expect(service.playback()).toBeNull();
    expect(service.participants()).toEqual([]);
  });

  it('connect() remplace une connexion précédente', () => {
    service.connect('premier');
    const first = socket();

    service.connect('second');

    expect(first.disconnected).toBe(true);
    expect(tokens).toEqual(['premier', 'second']);
  });
});
