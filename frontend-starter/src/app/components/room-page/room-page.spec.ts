import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Media } from '../../shared/models/media.model';
import { Room } from '../../shared/models/room.model';
import { RoomSessionService } from '../../shared/services/room-session.service';
import { SYNC_SOCKET_FACTORY } from '../../shared/services/sync.service';
import { FakeSyncSocket } from '../../shared/testing/fake-sync-socket';
import { MediaLibraryComponent } from '../media-library/media-library';
import { SyncPlayerComponent } from '../sync-player/sync-player';
import { RoomPageComponent } from './room-page';

/** Remplace la bibliothèque : ses requêtes HTTP sont testées dans son propre spec. */
@Component({ selector: 'app-media-library', template: '' })
class MediaLibraryStubComponent {
  readonly activeMediaId = input<string | null>(null);
  readonly selected = output<Media>();
  readonly removed = output<Media>();
}

/** Remplace le lecteur synchronisé, testé dans son propre spec. */
@Component({ selector: 'app-sync-player', template: '' })
class SyncPlayerStubComponent {
  readonly mediaChange = output<Media | null>();
}

const room = (code = 'K7P2QX'): Room => ({
  code,
  participants: [
    { id: 'p1', name: 'Alex' },
    { id: 'p2', name: 'Sam' },
  ],
  expiresAt: '2026-11-16T10:00:00.000Z',
});

const media = (id: string, kind: Media['kind'] = 'audio'): Media => ({
  id,
  kind,
  title: `Média ${id}`,
  originalName: `${id}.mp3`,
  mimeType: 'audio/mpeg',
  size: 2048,
  createdAt: '2026-11-15T10:00:00.000Z',
});

describe('RoomPageComponent', () => {
  let fixture: ComponentFixture<RoomPageComponent>;
  let component: RoomPageComponent;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let socket: FakeSyncSocket;
  let socketTokens: string[];

  const element = () => fixture.nativeElement as HTMLElement;

  /** Crée la page pour un participant (hôte ou non) et répond au chargement du salon. */
  const create = ({ host = false } = {}) => {
    TestBed.inject(RoomSessionService).open({
      room: room(),
      participant: { id: 'p1', name: 'Alex' },
      token: 'jeton',
      ...(host ? { hostToken: 'secret-hote' } : {}),
    });
    fixture = TestBed.createComponent(RoomPageComponent);
    component = fixture.componentInstance;
    http.expectOne('/api/rooms/current').flush(room());
    fixture.detectChanges();
  };

  /** Le WebSocket reçoit l'état initial : la page passe « en ligne ». */
  const goOnline = (participants = room().participants) => {
    socket.receive('room:state', { version: 0, playback: null, waitingFor: [], participants, serverTime: Date.now() });
    fixture.detectChanges();
  };

  beforeEach(() => {
    localStorage.clear();
    navigate = vi.fn().mockResolvedValue(true);
    snackBar = { open: vi.fn() };
    confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    socket = new FakeSyncSocket();
    socketTokens = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: SYNC_SOCKET_FACTORY, useValue: (token: string) => (socketTokens.push(token), socket) },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate } },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    }).overrideComponent(RoomPageComponent, {
      remove: { imports: [MediaLibraryComponent, SyncPlayerComponent] },
      add: { imports: [MediaLibraryStubComponent, SyncPlayerStubComponent] },
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    confirmSpy.mockRestore();
    localStorage.clear();
  });

  it('affiche le code du salon et ses participants', () => {
    create();

    expect(element().querySelector('.code')?.textContent).toContain('K7P2QX');
    const names = Array.from(element().querySelectorAll('.participants li')).map((li) => li.textContent?.trim());
    expect(names[0]).toContain('Alex');
    expect(names[0]).toContain('vous');
    expect(names[1]).toBe('Sam');
    expect(component.shareUrl()).toBe(`${location.origin}/rooms/K7P2QX`);
  });

  it("affiche le message du serveur quand le salon ne peut pas être chargé", () => {
    TestBed.inject(RoomSessionService).open({ room: room(), participant: { id: 'p1', name: 'Alex' }, token: 'jeton' });
    fixture = TestBed.createComponent(RoomPageComponent);
    http.expectOne('/api/rooms/current').flush({ message: 'Erreur serveur' }, { status: 500, statusText: 'Erreur' });
    fixture.detectChanges();

    expect(element().querySelector('[role="alert"]')?.textContent).toContain('Erreur serveur');
  });

  it("un invité ne voit pas les actions réservées à l'hôte", () => {
    create();

    const labels = Array.from(element().querySelectorAll('.actions button')).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Copier le lien', 'Quitter']);
  });

  it("l'hôte peut changer le code : l'URL de la page suit", () => {
    create({ host: true });

    component.changeCode();
    const request = http.expectOne('/api/rooms/current/code');
    expect(request.request.headers.get('X-Host-Token')).toBe('secret-hote');
    request.flush(room('NEW234'));
    fixture.detectChanges();

    expect(element().querySelector('.code')?.textContent).toContain('NEW234');
    expect(navigate).toHaveBeenCalledWith(['/rooms', 'NEW234'], { replaceUrl: true });
    expect(snackBar.open).toHaveBeenCalledWith('Nouveau code du salon : NEW234', 'OK', expect.anything());
  });

  it("l'hôte ferme le salon après confirmation, puis revient à l'accueil", () => {
    create({ host: true });

    component.closeRoom();
    http.expectOne({ method: 'DELETE', url: '/api/rooms/current' }).flush(null, { status: 204, statusText: 'No Content' });

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/']);
    expect(TestBed.inject(RoomSessionService).session()).toBeNull();
  });

  it("n'envoie rien quand la confirmation est refusée", () => {
    create({ host: true });
    confirmSpy.mockReturnValue(false);

    component.closeRoom();
    component.changeCode();
    // http.verify() (afterEach) échoue si une requête a été envoyée
    expect(navigate).not.toHaveBeenCalled();
  });

  it("quitter le salon ferme la session et revient à l'accueil", () => {
    create();

    component.leave();
    http.expectOne('/api/rooms/current/leave').flush(null, { status: 204, statusText: 'No Content' });

    expect(navigate).toHaveBeenCalledWith(['/']);
    expect(TestBed.inject(RoomSessionService).session()).toBeNull();
  });

  describe('temps réel', () => {
    it('ouvre le WebSocket avec le jeton de salon et le ferme en quittant la page', () => {
      create();
      expect(socketTokens).toEqual(['jeton']);

      fixture.destroy();

      expect(socket.disconnected).toBe(true);
    });

    it('affiche les participants réellement connectés', () => {
      create();

      goOnline([{ id: 'p1', name: 'Alex' }]);
      expect(element().querySelector('.participants h2')?.textContent).toContain('Participants connectés (1)');

      socket.receive('room:participants', [
        { id: 'p1', name: 'Alex' },
        { id: 'p3', name: 'Lou' },
      ]);
      fixture.detectChanges();

      const names = Array.from(element().querySelectorAll('.participants li')).map((li) => li.textContent?.trim());
      expect(names[1]).toBe('Lou');
    });

    it('choisir un média le charge pour tout le salon, sans toucher au lecteur local', () => {
      create();
      goOnline();

      component.play(media('a'));

      expect(socket.sent('playback:command')[0][0]).toEqual({ type: 'load', mediaId: 'a' });
      // http.verify() (afterEach) garantit qu'aucune URL de lecture n'est demandée ici
    });

    it('affiche le refus du serveur quand le média ne peut pas être chargé', async () => {
      create();
      goOnline();

      component.play(media('a'));
      socket.acknowledge('playback:command', { ok: false, message: 'Média inconnu' });
      await Promise.resolve();

      expect(snackBar.open).toHaveBeenCalledWith('Média inconnu', 'OK', expect.anything());
    });

    it('affiche une notice « qui a fait quoi » pour chaque changement de lecture', () => {
      create();
      goOnline();
      const playback = { mediaId: 'a', paused: true, position: 754, rate: 1, updatedAt: 1_000_000, version: 1 };

      socket.receive('playback:state', {
        version: 1,
        playback,
        waitingFor: [],
        action: 'seek',
        by: { id: 'p2', name: 'Sam' },
      });
      socket.receive('playback:state', {
        version: 2,
        playback: { ...playback, version: 2 },
        waitingFor: [],
        action: 'pause',
        by: { id: 'p1', name: 'Alex' },
      });

      expect(snackBar.open.mock.calls.map((call) => call[0])).toEqual([
        'Sam est allé à 12:34',
        'Vous avez mis en pause',
      ]);
    });

    it('met en évidence dans la liste le média chargé dans le lecteur', () => {
      create();

      component.current.set(media('a'));
      fixture.detectChanges();

      expect(component.current()?.id).toBe('a');
    });

    it('suit un changement de code décidé par l’hôte', () => {
      create();
      goOnline();

      socket.receive('room:updated', room('NEW234'));
      fixture.detectChanges();

      expect(element().querySelector('.code')?.textContent).toContain('NEW234');
      expect(TestBed.inject(RoomSessionService).session()?.code).toBe('NEW234');
      expect(navigate).toHaveBeenCalledWith(['/rooms', 'NEW234'], { replaceUrl: true });
    });

    describe('autre onglet du même navigateur', () => {
      const otherTab = (session: object | null) => {
        if (session) localStorage.setItem('gpc_room_session', JSON.stringify(session));
        else localStorage.removeItem('gpc_room_session');
        window.dispatchEvent(new StorageEvent('storage', { key: 'gpc_room_session' }));
      };

      it("revient à l'accueil quand le salon est quitté dans un autre onglet", () => {
        create();

        otherTab(null);

        expect(navigate).toHaveBeenCalledWith(['/']);
      });

      it("revient à l'accueil quand un autre onglet rejoint un autre salon", () => {
        create();

        otherTab({ code: 'AUTRE2', token: 'autre-jeton', participant: { id: 'p9', name: 'Alex' } });

        expect(navigate).toHaveBeenCalledWith(['/']);
      });

      it('sans message « salon fermé » quand le salon a été quitté dans un autre onglet', () => {
        create();
        goOnline();

        // Le serveur prévient avant que l'autre onglet ait vidé la session.
        socket.receive('room:closed', { reason: 'left' });

        expect(navigate).toHaveBeenCalledWith(['/']);
        expect(navigate).not.toHaveBeenCalledWith(['/'], { queryParams: { closed: 1 } });
        expect(TestBed.inject(RoomSessionService).session()).toBeNull();
      });

      it('reste dans le salon quand un autre onglet ne change que le code', () => {
        create();

        otherTab({ code: 'NEW234', token: 'jeton', participant: { id: 'p1', name: 'Alex' } });

        expect(navigate).not.toHaveBeenCalledWith(['/']);
      });
    });

    it("revient à l'accueil quand le salon est fermé pour tout le monde", () => {
      create();
      goOnline();

      socket.receive('room:closed', { reason: 'closed' });

      expect(TestBed.inject(RoomSessionService).session()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/'], { queryParams: { closed: 1 } });
    });
  });
});
