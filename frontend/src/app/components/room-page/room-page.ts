import { Component, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { I18nService } from '../../shared/i18n/i18n.service';
import { Media } from '../../shared/models/media.model';
import { Room } from '../../shared/models/room.model';
import { RoomService } from '../../shared/services/room.service';
import { RoomSessionService } from '../../shared/services/room-session.service';
import { SyncService } from '../../shared/services/sync.service';
import { describeChange } from '../../shared/sync/describe-change';
import { MediaLibraryComponent } from '../media-library/media-library';
import { SyncPlayerComponent } from '../sync-player/sync-player';
import { ChatComponent } from '../chat/chat';

const SNACKBAR_DURATION = 5000;
/** Les notices « qui a fait quoi » sont brèves : elles se succèdent vite. */
const NOTICE_DURATION = 3000;

/** A room: its code, its participants, its media files and the synced player. */
@Component({
  imports: [MediaLibraryComponent, SyncPlayerComponent, ChatComponent],
  templateUrl: './room-page.html',
  styleUrl: './room-page.css',
})
export class RoomPageComponent implements OnDestroy {
  private readonly rooms = inject(RoomService);
  private readonly sync = inject(SyncService);
  private readonly sessionService = inject(RoomSessionService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t;
  readonly server = this.i18n.server;
  private readonly library = viewChild(MediaLibraryComponent);

  readonly session = this.sessionService.session;
  readonly isHost = this.sessionService.isHost;

  readonly room = signal<Room | null>(null);
  /** Code présent dans l'URL de la page (le garde l'a comparé à la session). */
  private urlCode = this.session()?.code ?? '';
  readonly loadError = signal('');
  readonly busy = signal(false);

  /** Média chargé dans le lecteur du salon, signalé par le lecteur. */
  readonly current = signal<Media | null>(null);

  readonly online = this.sync.online;
  /** Connecté : les participants réellement présents. Sinon : ceux du salon. */
  readonly participants = computed(() =>
    this.online() ? this.sync.participants() : (this.room()?.participants ?? []),
  );

  readonly code = computed(() => this.room()?.code ?? this.session()?.code ?? '');
  readonly shareUrl = computed(() => `${location.origin}/rooms/${this.code()}`);

  constructor() {
    this.refresh();

    // Le jeton de salon authentifie aussi le WebSocket.
    const token = this.session()?.token;
    if (token) this.sync.connect(token);

    // Notice « qui a fait quoi » pour chaque changement de lecture.
    this.sync.changes$.pipe(takeUntilDestroyed()).subscribe((change) => {
      const notice = describeChange(change, this.session()?.participant.id ?? null, this.t);
      if (notice) this.snackBar.open(notice, undefined, { duration: NOTICE_DURATION });
    });

    // Un autre participant a ajouté ou supprimé un média : la liste se recharge.
    this.sync.mediaChanged$.pipe(takeUntilDestroyed()).subscribe(() => this.library()?.load());

    // À chaque (re)connexion du WebSocket, le salon est relu : un changement
    // de code survenu pendant la connexion ou une coupure (événement
    // « room:updated » manqué) est ainsi rattrapé.
    let wasOnline = false;
    effect(() => {
      const online = this.online();
      untracked(() => {
        if (online && !wasOnline) this.refresh();
        wasOnline = online;
      });
    });

    // L'hôte a changé le code du salon.
    this.sync.roomUpdated$.pipe(takeUntilDestroyed()).subscribe((room) => {
      this.sessionService.updateCode(room.code);
      this.applyRoom(room);
    });

    // Un autre onglet a quitté ce salon ou en a rejoint un autre : ce jeton
    // n'est plus celui du navigateur, cette page n'a plus lieu d'être.
    const joinedWith = token;
    this.sessionService.changedElsewhere$.pipe(takeUntilDestroyed()).subscribe((session) => {
      if (session?.token === joinedWith) return; // simple changement de code
      console.debug('[RoomPage] Session changée dans un autre onglet');
      void this.router.navigate(['/']);
    });

    // Salon fermé par l'hôte, expiré, ou jeton refusé.
    this.sync.roomClosed$.pipe(takeUntilDestroyed()).subscribe((reason) => {
      // Quitté (ici ou dans un autre onglet), ou session remplacée dans un autre
      // onglet : pas de message « salon fermé ».
      if (reason === 'left' || this.sessionService.refresh()?.token !== joinedWith) {
        this.sessionService.close();
        void this.router.navigate(['/']);
        return;
      }
      console.warn('[RoomPage] Le salon n’est plus accessible');
      this.sessionService.close();
      void this.router.navigate(['/'], { queryParams: { closed: 1 } });
    });
  }

  ngOnDestroy(): void {
    this.sync.disconnect();
  }

  /** Flux : RoomService.current -> GET /api/rooms/current (jeton de salon). */
  refresh(): void {
    this.loadError.set('');
    this.rooms.current().subscribe({
      next: (room) => this.applyRoom(room),
      error: (error: HttpErrorResponse) => {
        // Un 401 est déjà traité par roomClosedInterceptor (retour à l'accueil).
        console.error('[RoomPage] Chargement du salon impossible', error.status);
        this.loadError.set(this.messageOf(error, this.t('room.loadFailed')));
      },
    });
  }

  async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.shareUrl());
      this.notify(this.t('room.linkCopied'));
    } catch (error) {
      // Le presse-papiers est refusé hors HTTPS ou sans permission.
      console.warn('[RoomPage] Copie impossible', error);
      this.notify(this.t('room.copyFailed', { code: this.code() }));
    }
  }

  leave(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.rooms.leave().subscribe({
      next: () => {
        console.debug('[RoomPage] Salon quitté');
        void this.router.navigate(['/']);
      },
      error: (error: HttpErrorResponse) => {
        console.error('[RoomPage] Sortie impossible', error.status);
        this.busy.set(false);
        this.notify(this.messageOf(error, this.t('room.leaveFailed')));
      },
    });
  }

  /** Réservé à l'hôte : l'ancien code cesse de fonctionner. */
  changeCode(): void {
    if (this.busy()) return;
    if (!confirm(this.t('room.confirmChangeCode'))) return;

    this.busy.set(true);
    this.rooms.changeCode().subscribe({
      next: (room) => {
        this.busy.set(false);
        this.applyRoom(room);
        this.notify(this.t('room.newCode', { code: room.code }));
      },
      error: (error: HttpErrorResponse) => {
        console.error('[RoomPage] Changement de code impossible', error.status);
        this.busy.set(false);
        this.notify(this.messageOf(error, this.t('room.changeCodeFailed')));
      },
    });
  }

  /** Réservé à l'hôte : supprime le salon et ses médias pour tout le monde. */
  closeRoom(): void {
    if (this.busy()) return;
    if (!confirm(this.t('room.confirmClose'))) return;

    this.busy.set(true);
    this.rooms.close().subscribe({
      next: () => {
        console.debug('[RoomPage] Salon fermé');
        void this.router.navigate(['/']);
      },
      error: (error: HttpErrorResponse) => {
        console.error('[RoomPage] Fermeture impossible', error.status);
        this.busy.set(false);
        this.notify(this.messageOf(error, this.t('room.closeFailed')));
      },
    });
  }

  // --- Lecteur ------------------------------------------------------------

  /**
   * Un média est choisi dans la liste : on demande au serveur de le charger
   * pour tout le salon. Le lecteur ne change que lorsque l'état revient.
   */
  play(media: Media): void {
    void this.sync.send({ type: 'load', mediaId: media.id }).then((result) => {
      if (!result.ok) this.notify(result.message ? this.server(result.message) : this.t('room.playFailed'));
    });
  }

  /** Le code a pu être changé par l'hôte : l'URL de la page suit. */
  private applyRoom(room: Room): void {
    this.room.set(room);
    if (this.urlCode !== room.code) {
      // La session suit d'abord : le garde de la route compare son code à l'URL.
      if (this.session()?.code !== room.code) this.sessionService.updateCode(room.code);
      this.urlCode = room.code;
      void this.router.navigate(['/rooms', room.code], { replaceUrl: true });
    }
  }

  private notify(message: string): void {
    // Un message du serveur (en français) est traduit ; les autres le sont déjà.
    this.snackBar.open(this.server(message), 'OK', { duration: SNACKBAR_DURATION });
  }

  private messageOf(error: HttpErrorResponse, fallback: string): string {
    const serverMessage: unknown = error.error?.message;
    return typeof serverMessage === 'string' && serverMessage.length > 0 ? serverMessage : fallback;
  }
}
