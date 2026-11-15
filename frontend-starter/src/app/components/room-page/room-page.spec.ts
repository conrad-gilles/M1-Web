import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Media } from '../../shared/models/media.model';
import { Room } from '../../shared/models/room.model';
import { RoomSessionService } from '../../shared/services/room-session.service';
import { MediaLibraryComponent } from '../media-library/media-library';
import { RoomPageComponent } from './room-page';

/** Remplace la bibliothèque : ses requêtes HTTP sont testées dans son propre spec. */
@Component({ selector: 'app-media-library', template: '' })
class MediaLibraryStubComponent {
  readonly activeMediaId = input<string | null>(null);
  readonly selected = output<Media>();
  readonly removed = output<Media>();
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

  beforeEach(() => {
    sessionStorage.clear();
    navigate = vi.fn().mockResolvedValue(true);
    snackBar = { open: vi.fn() };
    confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate } },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    }).overrideComponent(RoomPageComponent, {
      remove: { imports: [MediaLibraryComponent] },
      add: { imports: [MediaLibraryStubComponent] },
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    confirmSpy.mockRestore();
    sessionStorage.clear();
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

  describe('lecteur', () => {
    it("place l'URL signée dans <audio src> sans télécharger le fichier", () => {
      create();

      component.play(media('a'));
      const request = http.expectOne('/api/media/a/url');
      expect(request.request.method).toBe('GET');
      request.flush({ url: '/api/media/a/stream?token=t', expiresAt: '2026-11-15T20:00:00.000Z' });
      fixture.detectChanges();

      expect(element().querySelector('audio')?.getAttribute('src')).toBe('/api/media/a/stream?token=t');
      expect(element().querySelector('video')).toBeNull();
      expect(element().querySelector('.now-playing')?.textContent).toContain('Média a');
    });

    it('utilise <video> pour un média vidéo', () => {
      create();

      component.play(media('v', 'video'));
      http.expectOne('/api/media/v/url').flush({ url: '/api/media/v/stream?token=t', expiresAt: '' });
      fixture.detectChanges();

      expect(element().querySelector('video')?.getAttribute('src')).toBe('/api/media/v/stream?token=t');
    });

    it("affiche le message du serveur quand l'URL est refusée", () => {
      create();

      component.play(media('a'));
      http.expectOne('/api/media/a/url').flush({ message: 'Média inconnu' }, { status: 404, statusText: 'Not Found' });
      fixture.detectChanges();

      expect(component.current()).toBeNull();
      expect(component.playerError()).toBe('Média inconnu');
    });

    it('arrête la lecture quand le média en cours est supprimé', () => {
      create();
      component.play(media('a'));
      http.expectOne('/api/media/a/url').flush({ url: '/u', expiresAt: '' });

      component.onMediaRemoved(media('b'));
      expect(component.current()?.id).toBe('a');

      component.onMediaRemoved(media('a'));
      expect(component.current()).toBeNull();
      expect(component.mediaUrl()).toBe('');
    });
  });
});
