import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Media } from '../../shared/models/media.model';
import { PlaybackState } from '../../shared/models/playback-state.model';
import { SYNC_SOCKET_FACTORY, SyncService } from '../../shared/services/sync.service';
import { FakeSyncSocket } from '../../shared/testing/fake-sync-socket';
import { LocalFilesService } from '../../shared/services/local-files.service';
import { RoomSessionService } from '../../shared/services/room-session.service';
import { P2pService } from '../../shared/p2p/p2p.service';
import { P2pError } from '../../shared/p2p/p2p-transfer';
import { SyncPlayerComponent } from './sync-player';

const NOW = 1_000_000;
const SAM = { id: 'p2', name: 'Sam' };

const media = (id = 'm1', kind: Media['kind'] = 'audio'): Media => ({
  id,
  source: 'upload',
  duration: null,
  folder: null,
  owner: null,
  kind,
  title: `Média ${id}`,
  originalName: `${id}.mp3`,
  mimeType: 'audio/mpeg',
  size: 2048,
  createdAt: '2026-11-15T10:00:00.000Z',
});

const playback = (overrides: Partial<PlaybackState> = {}): PlaybackState => ({
  mediaId: 'm1',
  paused: true,
  position: 0,
  rate: 1,
  updatedAt: NOW,
  version: 1,
  ...overrides,
});

/** État simulé d'un élément <audio>/<video> (jsdom ne lit aucun média). */
interface FakeMediaState {
  readyState: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  currentTime: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
}

describe('SyncPlayerComponent', () => {
  let fixture: ComponentFixture<SyncPlayerComponent>;
  let component: SyncPlayerComponent;
  let http: HttpTestingController;
  let socket: FakeSyncSocket;
  let element: HTMLMediaElement;
  let fake: FakeMediaState;
  let play: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;
  let version: number;

  const host = () => fixture.nativeElement as HTMLElement;
  const commands = () => socket.sent('playback:command').map((args) => args[0]);
  const bufferEvents = () =>
    socket.emitted.map((message) => message.event).filter((event) => event.startsWith('buffer:'));

  /** Le serveur diffuse un nouvel état du salon. */
  const receive = (state: PlaybackState | null, waitingFor: { id: string; name: string }[] = []) => {
    version += 1;
    socket.receive('playback:state', {
      version,
      playback: state ? { ...state, version } : null,
      waitingFor,
      action: 'play',
      by: SAM,
    });
    fixture.detectChanges();
  };

  /** Remplace les propriétés du lecteur que jsdom n'implémente pas. */
  const stubElement = (overrides: Partial<FakeMediaState> = {}) => {
    element = host().querySelector('audio, video') as HTMLMediaElement;
    fake = {
      readyState: 4,
      duration: 200,
      paused: true,
      ended: false,
      currentTime: 0,
      playbackRate: 1,
      volume: 1,
      muted: false,
      ...overrides,
    };
    for (const key of Object.keys(fake) as (keyof FakeMediaState)[]) {
      Object.defineProperty(element, key, {
        configurable: true,
        get: () => fake[key],
        set: (value: never) => (fake[key] = value),
      });
    }
    // Comme un vrai navigateur : play() et pause() déclenchent les événements
    // play / pause quand l'état change.
    play = vi.fn(() => {
      const wasPaused = fake.paused;
      fake.paused = false;
      if (wasPaused) element.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    pause = vi.fn(() => {
      const wasPlaying = !fake.paused;
      fake.paused = true;
      if (wasPlaying) element.dispatchEvent(new Event('pause'));
    });
    element.play = play as unknown as HTMLMediaElement['play'];
    element.pause = pause as unknown as HTMLMediaElement['pause'];
  };

  /**
   * Met le composant en ligne, charge le média `m1` dans le salon, répond à la
   * demande d'URL, puis simule un lecteur prêt (métadonnées chargées).
   */
  const loadMedia = (state = playback(), overrides: Partial<FakeMediaState> = {}, item = media()) => {
    receive(state);
    http.expectOne(`/api/media/${item.id}/url`).flush({
      url: `/api/media/${item.id}/stream?token=t`,
      expiresAt: '2026-11-15T20:00:00.000Z',
      media: item,
    });
    fixture.detectChanges();
    stubElement(overrides);
    element.dispatchEvent(new Event('loadedmetadata'));
    fixture.detectChanges();
  };

  /** Avance l'horloge : les ticks du lecteur (250 ms) se déclenchent. */
  const advance = (ms: number) => {
    vi.advanceTimersByTime(ms);
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    version = 0;
    socket = new FakeSyncSocket();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SYNC_SOCKET_FACTORY, useValue: () => socket },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SyncService).connect('jeton');
    socket.receive('room:state', { version: 0, playback: null, waitingFor: [], participants: [], serverTime: NOW });

    fixture = TestBed.createComponent(SyncPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.useRealTimers();
  });

  describe('contrôles natifs du navigateur (aussi en plein écran)', () => {
    /**
     * Action de l'utilisateur sur les contrôles natifs : le navigateur change
     * l'élément et ne signale que l'événement (pas le clic).
     */
    const user = (event: 'play' | 'pause' | 'seeked', position?: number) => {
      if (event === 'play') fake.paused = false;
      if (event === 'pause') fake.paused = true;
      if (position !== undefined) fake.currentTime = position;
      element.dispatchEvent(new Event(event));
      fixture.detectChanges();
    };
    const typed = () => commands() as { type: string; position?: number }[];
    const sent = (type: string) => typed().filter((command) => command.type === type);

    it('le lecteur affiche les contrôles natifs, pour la vidéo comme pour l’audio', () => {
      loadMedia(playback(), {}, media('m1', 'video'));
      expect(host().querySelector('video')?.hasAttribute('controls')).toBe(true);

      receive(playback({ mediaId: 'm2' }));
      http.expectOne('/api/media/m2/url').flush({ url: '/u2', expiresAt: '', media: media('m2', 'audio') });
      fixture.detectChanges();
      expect(host().querySelector('audio')?.hasAttribute('controls')).toBe(true);
    });

    it('lecture native, salon en pause : tout le salon lit, sans que le lecteur soit remis en pause', () => {
      loadMedia(playback({ paused: true, position: 30 }), { currentTime: 30 });

      user('play');
      advance(300);

      expect(typed()).toEqual([{ type: 'play' }]);
      advance(600);
      expect(pause).not.toHaveBeenCalled();
    });

    it('pause native, salon en lecture : tout le salon s’arrête, sans relance entre-temps', () => {
      loadMedia(playback({ paused: false, position: 30 }), { currentTime: 30 });
      play.mockClear();

      user('pause');
      advance(300);

      expect(typed()).toEqual([{ type: 'pause' }]);
      advance(600);
      expect(play).not.toHaveBeenCalled();
    });

    it('le salon répond : la surveillance reprend aussitôt la main', () => {
      loadMedia(playback({ paused: false, position: 30 }), { currentTime: 30 });
      user('pause');
      advance(300);

      receive(playback({ paused: true, position: 30.3, updatedAt: NOW + 300 }));

      expect(fake.paused).toBe(true);
      expect(typed()).toEqual([{ type: 'pause' }]);
    });

    it('saut natif : tout le salon se déplace, une seule fois pendant le glissement', () => {
      loadMedia(playback({ paused: false, position: 10 }), { currentTime: 10 });

      user('seeked', 60);
      advance(100);
      user('seeked', 95);
      advance(300);

      expect(typed()).toEqual([{ type: 'seek', position: 95 }]);
      // Aucune correction de dérive ne l'a ramené en arrière entre-temps.
      expect(fake.currentTime).toBe(95);
    });

    it('Firefox pendant le glissement (pause, saut, relance) : seulement le saut part au salon', () => {
      loadMedia(playback({ paused: false, position: 10 }), { currentTime: 10 });

      user('pause');
      user('seeked', 70);
      user('play');
      advance(300);

      expect(typed()).toEqual([{ type: 'seek', position: 70 }]);
    });

    it('les changements faits par le lecteur lui-même ne repartent jamais comme commandes', () => {
      // Le salon lit : le lecteur se lance lui-même (événement play compris).
      loadMedia(playback({ paused: false, position: 10 }), { currentTime: 10 });
      // Dérive de 3 s : le lecteur saute lui-même à la bonne position.
      fake.currentTime = 7;
      advance(1000);
      expect(fake.currentTime).toBeCloseTo(11, 0);
      element.dispatchEvent(new Event('seeked'));
      // Le salon passe en pause : le lecteur s'arrête lui-même (événement pause compris).
      receive(playback({ paused: true, position: 11, updatedAt: NOW + 1000 }));
      advance(1000);

      expect(commands()).toEqual([]);
    });

    it('touche multimédia ou casque (pause sans clic sur la page) : c’est aussi l’utilisateur', () => {
      loadMedia(playback({ paused: false, position: 10 }), { currentTime: 10 });

      user('pause');
      advance(300);

      expect(sent('pause')).toEqual([{ type: 'pause' }]);
    });

    it('la pause automatique en fin de média n’est pas une pause du salon', () => {
      loadMedia(playback({ paused: false, position: 199 }), { currentTime: 200, duration: 200 });

      fake.ended = true;
      user('pause');
      advance(300);

      expect(sent('pause')).toEqual([]);
      expect(sent('seek')).toEqual([]);
    });

    it('lecture native quand le navigateur bloquait la lecture automatique : vaut le clic demandé', async () => {
      loadMedia(playback({ paused: true }));
      play.mockImplementation(() => Promise.reject(new DOMException('bloqué', 'NotAllowedError')));
      receive(playback({ paused: false, position: 0, updatedAt: NOW }));
      await vi.advanceTimersByTimeAsync(0);
      expect(component.needsGesture()).toBe(true);

      play.mockImplementation(() => {
        fake.paused = false;
        return Promise.resolve();
      });
      user('play');
      advance(300);

      expect(component.needsGesture()).toBe(false);
      expect(sent('play')).toEqual([]); // le salon lisait déjà
    });

    it('volume et sourdine changés avec les contrôles natifs : reflétés dans nos réglages', () => {
      loadMedia();

      fake.volume = 0.3;
      fake.muted = true;
      element.dispatchEvent(new Event('volumechange'));
      fixture.detectChanges();

      expect(component.volume()).toBe(0.3);
      expect(host().textContent).toContain('Son coupé');
      expect(commands()).toEqual([]);
    });
  });

  describe('partage direct (P2P)', () => {
    const p2pMedia = (ownerId = 'alex'): Media => ({
      ...media('p1', 'video'),
      source: 'p2p',
      duration: 8,
      owner: { id: ownerId, name: 'Alex' },
      title: 'Film en direct',
    });
    let p2p: P2pService;
    let prepare: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      p2p = TestBed.inject(P2pService);
      prepare = vi.spyOn(p2p, 'prepare');
      vi.spyOn(p2p, 'forget');
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mon-fichier');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      TestBed.inject(RoomSessionService).open({
        room: { code: 'K7P2QX', participants: [], expiresAt: '2026-11-25T20:00:00.000Z' },
        participant: { id: 'sam', name: 'Sam' },
        token: 'jeton',
      });
    });
    afterEach(() => vi.restoreAllMocks());

    const loadP2p = async (item = p2pMedia()) => {
      receive(playback({ mediaId: 'p1' }));
      http.expectOne('/api/media/p1/url').flush({ url: null, expiresAt: null, media: item });
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
    };

    it('spectateur : se connecte à celui qui partage, puis lit le flux servi par le service worker', async () => {
      let resolve!: (url: string) => void;
      prepare.mockReturnValue(new Promise((r) => (resolve = r)));

      await loadP2p();
      expect(host().textContent).toContain('Connexion directe à Alex…');
      expect(host().querySelector('video')).toBeNull();

      resolve('/p2p-stream/p1?page=abc');
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();

      expect(host().querySelector('video')?.getAttribute('src')).toBe('/p2p-stream/p1?page=abc');
      expect(host().textContent).not.toContain('Connexion directe à Alex…');
    });

    it.each([
      ['offline', 'Alex n’est pas connecté', false],
      ['failed', 'Connexion directe impossible avec Alex', true],
      ['not-shared', 'Alex ne partage plus ce fichier', true],
      ['closed', 'Le transfert depuis Alex s’est interrompu', true],
    ] as const)('échec « %s » : explication claire et bouton Réessayer', async (code, message, forgets) => {
      prepare.mockRejectedValue(new P2pError(code));

      await loadP2p();

      const alert = host().querySelector('[role="alert"]');
      expect(alert?.textContent).toContain(message);
      expect(alert?.querySelector('button')?.textContent).toContain('Réessayer');
      expect(vi.mocked(p2p.forget).mock.calls.length > 0).toBe(forgets);
    });

    it('celui qui partage lit son propre fichier, sans connexion', async () => {
      const file = new File(['x'], 'film.mp4');
      p2p.share('p1', file);

      await loadP2p(p2pMedia('sam'));

      expect(prepare).not.toHaveBeenCalled();
      expect(host().querySelector('video')?.getAttribute('src')).toBe('blob:mon-fichier');
    });

    it('celui qui partage a rechargé la page : il rechoisit son fichier (même durée) et le partage de nouveau', async () => {
      const probe = vi.spyOn(TestBed.inject(LocalFilesService), 'probe').mockResolvedValue({ duration: 8.3, kind: 'video' });

      await loadP2p(p2pMedia('sam'));
      expect(host().querySelector('.local-pick')?.textContent).toContain('choisissez de nouveau ce fichier');

      const file = new File(['x'], 'film.mp4');
      await component.chooseLocalFile({ target: { files: [file], value: 'x' } } as unknown as Event);
      fixture.detectChanges();

      expect(probe).toHaveBeenCalled();
      expect(p2p.sharedFile('p1')).toBe(file);
      expect(host().querySelector('video')?.getAttribute('src')).toBe('blob:mon-fichier');
    });

    it('flux interrompu pendant la lecture : explication, la connexion est oubliée', async () => {
      prepare.mockResolvedValue('/p2p-stream/p1?page=abc');
      await loadP2p();

      host().querySelector('video')!.dispatchEvent(new Event('error'));
      fixture.detectChanges();

      expect(host().querySelector('[role="alert"]')?.textContent).toContain('Le transfert depuis Alex s’est interrompu');
      expect(p2p.forget).toHaveBeenCalledWith('alex');
    });
  });

  describe('média local : chacun lit sa propre copie, reconnue à sa durée', () => {
    const local = (): Media => ({
      ...media('loc', 'video'),
      source: 'local',
      duration: 5423.48,
      title: 'Film du soir',
    });
    let probe: ReturnType<typeof vi.spyOn>;
    let localFiles: LocalFilesService;

    beforeEach(() => {
      localFiles = TestBed.inject(LocalFilesService);
      probe = vi.spyOn(localFiles, 'probe');
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:copie-locale');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    });
    afterEach(() => vi.restoreAllMocks());

    /** Le salon charge le média local : l'API ne renvoie pas d'URL. */
    const loadLocal = (state = playback({ mediaId: 'loc' })) => {
      receive(state);
      http.expectOne('/api/media/loc/url').flush({ url: null, expiresAt: null, media: local() });
      fixture.detectChanges();
    };
    const pick = async (name: string) => {
      const input = { files: [new File(['x'], name)], value: name };
      await component.chooseLocalFile({ target: input } as unknown as Event);
      fixture.detectChanges();
      return input;
    };

    it('demande la copie locale au lieu de télécharger, contrôles du salon toujours là', () => {
      loadLocal();

      expect(host().querySelector('audio, video')).toBeNull();
      expect(host().querySelector('.local-pick')?.textContent).toContain('Choisissez votre copie de « Film du soir »');
      expect(host().querySelector('.local-pick')?.textContent).toContain('durée 1:30:23');
      expect(host().querySelector('.controls .main')).not.toBeNull();
      expect(component.duration()).toBe(5423.48);
    });

    it('refuse une copie dont la durée diffère de plus de 1 s', async () => {
      loadLocal();
      probe.mockResolvedValue({ duration: 180, kind: 'audio' });

      const input = await pick('autre.mp3');

      expect(host().querySelector('[role="alert"]')?.textContent).toContain(
        'Ce fichier dure 3:00, celui du salon 1:30:23',
      );
      expect(host().querySelector('audio, video')).toBeNull();
      expect(localFiles.get('loc')).toBeUndefined();
      expect(input.value).toBe('');
    });

    it('refuse un fichier que le navigateur ne sait pas lire', async () => {
      loadLocal();
      probe.mockRejectedValue(new Error('Fichier illisible par ce navigateur'));

      await pick('film.avi');

      expect(host().querySelector('[role="alert"]')?.textContent).toContain('ne sait pas lire ce fichier');
      expect(host().querySelector('audio, video')).toBeNull();
    });

    it('accepte une copie au nom différent et de même durée, puis suit l’état du salon', async () => {
      loadLocal(playback({ mediaId: 'loc', paused: true, position: 42 }));
      probe.mockResolvedValue({ duration: 5424.1, kind: 'video' });

      await pick('Mon film - copie (1080p).mp4');

      const video = host().querySelector('video');
      expect(video?.getAttribute('src')).toBe('blob:copie-locale');
      expect(host().querySelector('.local-pick')).toBeNull();
      expect(localFiles.get('loc')?.file.name).toBe('Mon film - copie (1080p).mp4');

      // Même lecteur et même synchronisation que pour un fichier envoyé.
      stubElement({ duration: 5424.1 });
      element.dispatchEvent(new Event('loadedmetadata'));
      fixture.detectChanges();
      expect(fake.currentTime).toBe(42);
      expect(Array.from(host().querySelectorAll('button')).some((b) => b.textContent?.includes('Plein écran'))).toBe(true);
    });

    it('une copie déjà choisie pendant la session est reprise sans redemander', () => {
      localFiles.remember('loc', { file: new File(['x'], 'film.mp4'), info: { duration: 5423.48, kind: 'video' } });

      loadLocal();

      expect(host().querySelector('video')?.getAttribute('src')).toBe('blob:copie-locale');
      expect(host().querySelector('.local-pick')).toBeNull();
      expect(probe).not.toHaveBeenCalled();
    });

    it('une copie audio d’un média vidéo est lue dans un lecteur audio', async () => {
      loadLocal();
      probe.mockResolvedValue({ duration: 5423.48, kind: 'audio' });

      await pick('bande-son.mp3');

      expect(host().querySelector('audio')?.getAttribute('src')).toBe('blob:copie-locale');
      expect(host().querySelector('video')).toBeNull();
    });

    it('si la copie se révèle illisible : message, et elle est oubliée', async () => {
      loadLocal();
      probe.mockResolvedValue({ duration: 5423.48, kind: 'video' });
      await pick('film.mp4');

      host().querySelector('video')!.dispatchEvent(new Event('error'));
      fixture.detectChanges();

      expect(host().querySelector('[role="alert"]')?.textContent).toContain('ne parvient pas à lire ce fichier local');
      expect(localFiles.get('loc')).toBeUndefined();
    });

    describe('fichier d’un dossier local', () => {
      const inFolderMedia = (): Media => ({
        ...local(),
        folder: 'Ma série',
        originalName: 'Saison 1/ep01.mkv',
        title: 'ep01.mkv',
      });
      const loadFolderMedia = () => {
        receive(playback({ mediaId: 'loc' }));
        http.expectOne('/api/media/loc/url').flush({ url: null, expiresAt: null, media: inFolderMedia() });
        fixture.detectChanges();
      };
      const folderFile = (relativePath: string) => {
        const file = new File(['x'], relativePath.split('/').pop()!, { type: 'video/x-matroska' });
        Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
        return file;
      };
      const pickFolder = async (files: File[]) => {
        await component.chooseLocalFolder({ target: { files, value: 'x' } } as unknown as Event);
        fixture.detectChanges();
      };

      it('demande le dossier de même nom, pas un fichier seul', () => {
        loadFolderMedia();

        const pickBox = host().querySelector('.local-pick')!;
        expect(pickBox.textContent).toContain('Fichier « Saison 1/ep01.mkv » du dossier « Ma série »');
        expect(pickBox.querySelector('input')?.hasAttribute('webkitdirectory')).toBe(true);
      });

      it('refuse un dossier d’un autre nom', async () => {
        loadFolderMedia();

        await pickFolder([folderFile('Autre/Saison 1/ep01.mkv')]);

        expect(host().querySelector('[role="alert"]')?.textContent).toContain(
          'Ce dossier s’appelle « Autre », celui du salon « Ma série »',
        );
        expect(probe).not.toHaveBeenCalled();
      });

      it('dossier de même nom sans ce fichier : le dit', async () => {
        loadFolderMedia();

        await pickFolder([folderFile('Ma série/Saison 1/ep02.mkv')]);

        expect(host().querySelector('[role="alert"]')?.textContent).toContain(
          'Votre dossier « Ma série » ne contient pas « Saison 1/ep01.mkv »',
        );
      });

      it('même chemin mais autre durée : refusé', async () => {
        loadFolderMedia();
        probe.mockResolvedValue({ duration: 60, kind: 'video' });

        await pickFolder([folderFile('Ma série/Saison 1/ep01.mkv')]);

        expect(host().querySelector('[role="alert"]')?.textContent).toContain('Ce fichier dure 1:00');
        expect(host().querySelector('video')).toBeNull();
      });

      it('même nom de dossier, même chemin, même durée : le fichier est lu et synchronisé', async () => {
        loadFolderMedia();
        probe.mockResolvedValue({ duration: 5423.9, kind: 'video' });

        await pickFolder([folderFile('Ma série/Saison 1/ep01.mkv'), folderFile('Ma série/Saison 1/ep02.mkv')]);

        expect(host().querySelector('video')?.getAttribute('src')).toBe('blob:copie-locale');
        expect(host().querySelector('.local-pick')).toBeNull();
      });

      it('dossier déjà relié pendant la session (ou ailleurs dans la page) : lu sans rien redemander', async () => {
        loadFolderMedia();
        probe.mockResolvedValue({ duration: 5423.48, kind: 'video' });

        // La carte « Synchroniser un fichier local » relie le dossier pendant que le lecteur attend.
        localFiles.rememberFolder('Ma série', [{ path: 'Saison 1/ep01.mkv', file: folderFile('Ma série/Saison 1/ep01.mkv') }]);
        fixture.detectChanges();
        await vi.advanceTimersByTimeAsync(0);
        fixture.detectChanges();

        expect(host().querySelector('video')?.getAttribute('src')).toBe('blob:copie-locale');
      });
    });

    it('changer de média libère l’URL du fichier local', async () => {
      loadLocal();
      probe.mockResolvedValue({ duration: 5423.48, kind: 'video' });
      await pick('film.mp4');

      receive(playback({ mediaId: 'm2' }));
      http.expectOne('/api/media/m2/url').flush({ url: '/u2', expiresAt: '', media: media('m2') });

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:copie-locale');
    });
  });

  describe('chargement du média', () => {
    it('invite à choisir un média tant que le salon n’en a pas', () => {
      expect(host().textContent).toContain('Choisissez un média ci-dessous');
      expect(host().querySelector('audio, video')).toBeNull();
    });

    it('charge l’URL signée du média du salon dans un lecteur avec les contrôles natifs', () => {
      const changes: (Media | null)[] = [];
      component.mediaChange.subscribe((value) => changes.push(value));

      loadMedia();

      expect(element.tagName).toBe('AUDIO');
      expect(element.getAttribute('src')).toBe('/api/media/m1/stream?token=t');
      // Les contrôles natifs pilotent tout le salon (voir « contrôles natifs du navigateur »).
      expect(element.hasAttribute('controls')).toBe(true);
      expect(host().querySelector('.now-playing')?.textContent).toContain('Média m1');
      expect(changes.map((value) => value?.id)).toEqual(['m1']);
    });

    it('utilise <video> pour un média vidéo', () => {
      loadMedia(playback(), {}, media('m1', 'video'));

      expect(element.tagName).toBe('VIDEO');
    });

    it('change de média quand le salon en charge un autre', () => {
      loadMedia();

      receive(playback({ mediaId: 'm2' }));
      http.expectOne('/api/media/m2/url').flush({ url: '/u2', expiresAt: '', media: media('m2') });
      fixture.detectChanges();

      expect(host().querySelector('audio')?.getAttribute('src')).toBe('/u2');
    });

    it('ignore la réponse d’un média que le salon a déjà remplacé', () => {
      receive(playback({ mediaId: 'm1' }));
      const first = http.expectOne('/api/media/m1/url');
      receive(playback({ mediaId: 'm2' }));
      const second = http.expectOne('/api/media/m2/url');

      second.flush({ url: '/u2', expiresAt: '', media: media('m2') });
      first.flush({ url: '/u1', expiresAt: '', media: media('m1') });
      fixture.detectChanges();

      expect(component.media()?.id).toBe('m2');
      expect(component.url()).toBe('/u2');
    });

    it('vide le lecteur quand le média en cours est supprimé', () => {
      loadMedia();
      const changes: (Media | null)[] = [];
      component.mediaChange.subscribe((value) => changes.push(value));

      receive(null);

      expect(host().querySelector('audio')).toBeNull();
      expect(changes).toEqual([null]);
    });

    it('affiche le message du serveur quand l’URL est refusée, et permet de réessayer', () => {
      receive(playback());
      http.expectOne('/api/media/m1/url').flush({ message: 'Média inconnu' }, { status: 404, statusText: 'Not Found' });
      fixture.detectChanges();
      expect(host().querySelector('[role="alert"]')?.textContent).toContain('Média inconnu');

      component.retry();
      http.expectOne('/api/media/m1/url').flush({ url: '/u', expiresAt: '', media: media() });
      fixture.detectChanges();

      expect(component.error()).toBe('');
      expect(host().querySelector('audio')).not.toBeNull();
    });

    describe('erreur du lecteur : la cause est lue dans le code HTTP de l’URL', () => {
      const failWith = async (response: Promise<Response>) => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(response);
        loadMedia();
        element.dispatchEvent(new Event('error'));
        await vi.advanceTimersByTimeAsync(0); // laisse la réponse de fetch arriver
        fixture.detectChanges();
        const calls = [...fetchSpy.mock.calls]; // mockRestore efface les appels enregistrés
        fetchSpy.mockRestore();
        return { calls, alert: host().querySelector('[role="alert"]')?.textContent ?? '' };
      };

      it('quota gratuit du jour atteint (403)', async () => {
        const { calls, alert } = await failWith(Promise.resolve(new Response(null, { status: 403 })));

        expect(calls).toEqual([['/api/media/m1/stream?token=t', { headers: { Range: 'bytes=0-0' } }]]);
        expect(alert).toContain('Quota gratuit de lecture du jour atteint');
      });

      it('lien expiré (401)', async () => {
        const { alert } = await failWith(Promise.resolve(new Response(null, { status: 401 })));
        expect(alert).toContain('Le lien de lecture a expiré');
      });

      it('média supprimé (404)', async () => {
        const { alert } = await failWith(Promise.resolve(new Response(null, { status: 404 })));
        expect(alert).toContain("Ce média n'existe plus");
      });

      it('autre cause ou réseau coupé : message générique', async () => {
        const { alert } = await failWith(Promise.reject(new TypeError('Failed to fetch')));
        expect(alert).toContain('Média temporairement indisponible');
      });
    });
  });

  describe('application de l’état partagé', () => {
    it('en pause : se place à la position du salon sans lire', () => {
      loadMedia(playback({ paused: true, position: 42 }));

      expect(fake.currentTime).toBe(42);
      expect(play).not.toHaveBeenCalled();
    });

    it('en lecture : lance le lecteur', () => {
      loadMedia(playback({ paused: false }));

      expect(play).toHaveBeenCalledOnce();
    });

    it('un arrivant tardif démarre à la position courante, pas au début', () => {
      // La lecture a commencé il y a 20 s à la position 100.
      loadMedia(playback({ paused: false, position: 100, updatedAt: NOW - 20_000 }));

      expect(fake.currentTime).toBe(120);
      expect(play).toHaveBeenCalledOnce();
    });

    it('tient compte du décalage d’horloge avec le serveur', () => {
      // L'horloge du serveur avance de 5 s sur l'horloge locale.
      TestBed.inject(SyncService).clockOffset.set(5000);

      loadMedia(playback({ paused: false, position: 100, updatedAt: NOW }));

      expect(fake.currentTime).toBe(105);
    });

    it('une pause du salon arrête le lecteur à la position diffusée', () => {
      loadMedia(playback({ paused: false }));
      fake.currentTime = 30.4;

      receive(playback({ paused: true, position: 30 }));

      expect(pause).toHaveBeenCalled();
      expect(fake.paused).toBe(true);
      expect(fake.currentTime).toBe(30);
    });

    it('un saut décidé par un autre participant déplace ce lecteur', () => {
      loadMedia(playback({ paused: false }));

      receive(playback({ paused: false, position: 150, updatedAt: NOW }));

      expect(fake.currentTime).toBe(150);
      expect(fake.paused).toBe(false);
    });

    it('ne dépasse jamais la durée du média', () => {
      loadMedia(playback({ paused: true, position: 999 }), { duration: 200 });

      expect(fake.currentTime).toBe(200);
    });

    it('attend les métadonnées avant d’appliquer l’état', () => {
      receive(playback({ paused: true, position: 42 }));
      http.expectOne('/api/media/m1/url').flush({ url: '/u', expiresAt: '', media: media() });
      fixture.detectChanges();
      stubElement({ readyState: 0 });
      advance(1000);
      expect(fake.currentTime).toBe(0);

      fake.readyState = 4;
      element.dispatchEvent(new Event('loadedmetadata'));

      expect(fake.currentTime).toBe(42);
    });
  });

  describe('commandes : pas de boucle d’écho', () => {
    it('le bouton Lecture envoie une commande et ne touche pas au lecteur', () => {
      loadMedia(playback({ paused: true }));

      host().querySelector<HTMLButtonElement>('.controls .main')?.click();

      expect(commands()).toEqual([{ type: 'play' }]);
      expect(play).not.toHaveBeenCalled();
      expect(fake.paused).toBe(true); // le lecteur attend l'état diffusé par le serveur
    });

    it('le bouton Pause envoie une commande pendant la lecture', () => {
      loadMedia(playback({ paused: false }));

      host().querySelector<HTMLButtonElement>('.controls .main')?.click();

      expect(commands()).toEqual([{ type: 'pause' }]);
    });

    it('appliquer un état reçu ne renvoie aucune commande', () => {
      loadMedia(playback({ paused: false }));

      receive(playback({ paused: true, position: 30 }));
      receive(playback({ paused: false, position: 90, updatedAt: NOW }));
      for (const type of ['play', 'pause', 'seeking', 'seeked', 'timeupdate', 'waiting', 'playing']) {
        element.dispatchEvent(new Event(type));
      }
      advance(3000);

      expect(commands()).toEqual([]);
    });

    it('déplacer le curseur n’envoie le saut qu’au relâchement', () => {
      loadMedia(playback({ paused: false }));
      const slider = host().querySelector<HTMLInputElement>('.timeline input') as HTMLInputElement;

      slider.value = '80';
      slider.dispatchEvent(new Event('input'));
      slider.value = '120';
      slider.dispatchEvent(new Event('input'));
      expect(commands()).toEqual([]);
      expect(component.shownPosition()).toBe(120);

      slider.dispatchEvent(new Event('change'));

      expect(commands()).toEqual([{ type: 'seek', position: 120 }]);
      expect(fake.currentTime).toBe(0); // le lecteur bougera avec l'état du serveur
    });

    it('±10 s part de la position attendue et reste dans le média', () => {
      loadMedia(playback({ paused: true, position: 5 }));

      component.skip(10);
      component.skip(-10);
      receive(playback({ paused: true, position: 195 }));
      component.skip(10);

      expect(commands()).toEqual([
        { type: 'seek', position: 15 },
        { type: 'seek', position: 0 },
        { type: 'seek', position: 200 },
      ]);
    });

    it('la fin du média est signalée une fois, avec la version de l’état', () => {
      loadMedia(playback({ paused: false }));

      element.dispatchEvent(new Event('ended'));

      expect(commands()).toEqual([{ type: 'ended', version: 1, position: 200 }]);
    });

    it('affiche le refus d’une commande par le serveur', async () => {
      loadMedia(playback({ paused: true }));

      component.togglePlay();
      socket.acknowledge('playback:command', { ok: false, message: 'Aucun média chargé' });
      await Promise.resolve();
      fixture.detectChanges();

      expect(host().textContent).toContain('Aucun média chargé');
    });

    it('le volume et le son coupé restent locaux', () => {
      loadMedia(playback({ paused: false }));

      component.toggleMute();
      const volume = host().querySelector<HTMLInputElement>('.local input') as HTMLInputElement;
      volume.value = '0.4';
      volume.dispatchEvent(new Event('input'));

      expect(fake.muted).toBe(true);
      expect(fake.volume).toBe(0.4);
      expect(socket.emitted.filter((message) => message.event !== 'clock:ping')).toEqual([]);
    });
  });

  describe('correction de la dérive (environ une fois par seconde)', () => {
    /** Lecture commencée à NOW depuis 0 : la position attendue suit l'horloge. */
    const playing = () => loadMedia(playback({ paused: false, position: 0, updatedAt: NOW }));

    it('ne touche à rien sous 0,1 s d’écart', () => {
      playing();
      fake.currentTime = 0.95; // attendu : 1,0 après 1 s

      advance(1000);

      expect(fake.currentTime).toBe(0.95);
      expect(fake.playbackRate).toBe(1);
    });

    it('accélère de 5 % quand le lecteur a entre 0,1 s et 1 s de retard, puis revient à la normale', () => {
      playing();
      fake.currentTime = 0.5; // attendu : 1,0 après 1 s

      advance(1000);
      expect(fake.playbackRate).toBe(1.05);
      expect(fake.currentTime).toBe(0.5); // pas de saut

      fake.currentTime = 1.99; // rattrapé : attendu 2,0 après 2 s
      advance(1000);
      expect(fake.playbackRate).toBe(1);
    });

    it('ralentit de 5 % quand le lecteur est en avance', () => {
      playing();
      fake.currentTime = 1.6;

      advance(1000);

      expect(fake.playbackRate).toBe(0.95);
    });

    it('saute à la bonne position au-delà de 1 s d’écart', () => {
      playing();
      fake.currentTime = 30;

      advance(1000);

      expect(fake.currentTime).toBe(1);
      expect(fake.playbackRate).toBe(1);
    });

    it('relance le lecteur s’il a été arrêté en dehors du salon', () => {
      playing();
      fake.paused = true; // touche multimédia du clavier, par exemple
      play.mockClear();

      advance(1000);

      expect(play).toHaveBeenCalledOnce();
      expect(commands()).toEqual([]);
    });

    it('ne corrige rien quand le salon est en pause', () => {
      loadMedia(playback({ paused: true, position: 10 }));

      advance(5000);

      expect(fake.currentTime).toBe(10);
      expect(play).not.toHaveBeenCalled();
    });
  });

  describe('buffering', () => {
    const playing = () => loadMedia(playback({ paused: false, position: 0, updatedAt: NOW }));

    it('ignore un blocage de moins de 0,5 s', () => {
      playing();

      fake.readyState = 2;
      advance(500);
      fake.readyState = 4;
      advance(2000);

      expect(bufferEvents()).toEqual([]);
    });

    it('signale un blocage de plus de 0,5 s, une seule fois, puis sa fin', () => {
      playing();

      fake.readyState = 2;
      advance(1000);
      advance(3000);
      expect(bufferEvents()).toEqual(['buffer:start']);
      expect(host().querySelector('.status')?.textContent).toContain('Mise en mémoire tampon');

      // Le serveur met le salon en pause pour nous attendre.
      receive(playback({ paused: true, position: 0.8 }), [{ id: 'p1', name: 'Alex' }]);
      expect(host().textContent).toContain('Le salon attend Alex');

      fake.readyState = 4;
      advance(250);
      expect(bufferEvents()).toEqual(['buffer:start', 'buffer:end']);
    });

    it('ne saute pas pendant un blocage (cela relancerait le chargement)', () => {
      playing();
      fake.readyState = 2;

      advance(5000);

      expect(fake.currentTime).toBe(0);
    });

    it('ne signale rien quand la pause a été décidée par un participant', () => {
      loadMedia(playback({ paused: true, position: 10 }), { readyState: 2 });

      advance(3000);

      expect(bufferEvents()).toEqual([]);
    });

    it('ne signale pas la fin du média comme un blocage, et n’y saute pas en boucle', () => {
      // La lecture atteint la fin du média (200 s) une seconde plus tard.
      loadMedia(playback({ paused: false, position: 199, updatedAt: NOW }));
      fake.currentTime = 200;
      fake.readyState = 2;
      const seeks = vi.fn();
      Object.defineProperty(element, 'currentTime', { configurable: true, get: () => 200, set: seeks });

      advance(5000);

      expect(bufferEvents()).toEqual([]);
      expect(seeks).not.toHaveBeenCalled();
    });
  });

  describe('lecture automatique bloquée par le navigateur', () => {
    /** Le navigateur refuse play() tant que l'utilisateur n'a pas cliqué. */
    const blocked = async () => {
      receive(playback({ paused: false, position: 0, updatedAt: NOW }));
      http.expectOne('/api/media/m1/url').flush({ url: '/u', expiresAt: '', media: media() });
      fixture.detectChanges();
      stubElement();
      play.mockImplementation(() => Promise.reject(new DOMException('bloqué', 'NotAllowedError')));
      element.dispatchEvent(new Event('loadedmetadata'));
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
    };

    it('demande un clic, sans mettre le salon en pause pour buffering', async () => {
      await blocked();

      expect(component.needsGesture()).toBe(true);
      expect(host().querySelector('.gesture')?.textContent).toContain('Cliquer pour rejoindre la lecture');

      fake.readyState = 2;
      advance(3000);
      expect(bufferEvents()).toEqual([]);
    });

    it('après le clic, rejoint la lecture à la position courante du salon', async () => {
      await blocked();
      advance(4000);
      play.mockImplementation(() => {
        fake.paused = false;
        return Promise.resolve();
      });
      play.mockClear();

      host().querySelector<HTMLButtonElement>('.gesture')?.click();
      fixture.detectChanges();

      expect(play).toHaveBeenCalledOnce();
      expect(fake.currentTime).toBe(4);
      expect(host().querySelector('.gesture')).toBeNull();
      expect(commands()).toEqual([]); // rejoindre n'est pas une commande pour le salon
    });
  });

  it('désactive les commandes et l’indique quand la connexion au salon est perdue', () => {
    loadMedia(playback({ paused: false }));

    socket.receive('disconnect', 'transport close');
    fixture.detectChanges();

    expect(host().querySelector('.status')?.textContent).toContain('Reconnexion au salon');
    expect(host().querySelector<HTMLButtonElement>('.controls .main')?.disabled).toBe(true);
  });
});
