import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Media } from '../../shared/models/media.model';
import { Room } from '../../shared/models/room.model';
import { MediaService } from '../../shared/services/media.service';
import { RoomService } from '../../shared/services/room.service';
import { RoomSessionService } from '../../shared/services/room-session.service';
import { MediaLibraryComponent } from '../media-library/media-library';

const SNACKBAR_DURATION = 5000;

/** A room: its code, its participants, its media files and the player. */
@Component({
  imports: [MediaLibraryComponent],
  templateUrl: './room-page.html',
  styleUrl: './room-page.css',
})
export class RoomPageComponent {
  private readonly rooms = inject(RoomService);
  private readonly mediaService = inject(MediaService);
  private readonly sessionService = inject(RoomSessionService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  readonly session = this.sessionService.session;
  readonly isHost = this.sessionService.isHost;

  readonly room = signal<Room | null>(null);
  readonly loadError = signal('');
  readonly busy = signal(false);

  // --- Lecteur ------------------------------------------------------------
  readonly current = signal<Media | null>(null);
  readonly mediaUrl = signal('');
  readonly playerError = signal('');

  readonly code = computed(() => this.room()?.code ?? this.session()?.code ?? '');
  readonly shareUrl = computed(() => `${location.origin}/rooms/${this.code()}`);

  constructor() {
    this.refresh();
  }

  /** Flux : RoomService.current -> GET /api/rooms/current (jeton de salon). */
  refresh(): void {
    this.loadError.set('');
    this.rooms.current().subscribe({
      next: (room) => this.applyRoom(room),
      error: (error: HttpErrorResponse) => {
        // Un 401 est déjà traité par roomClosedInterceptor (retour à l'accueil).
        console.error('[RoomPage] Chargement du salon impossible', error.status);
        this.loadError.set(this.messageOf(error, 'Impossible de charger le salon.'));
      },
    });
  }

  async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.shareUrl());
      this.notify('Lien du salon copié.');
    } catch (error) {
      // Le presse-papiers est refusé hors HTTPS ou sans permission.
      console.warn('[RoomPage] Copie impossible', error);
      this.notify(`Copie impossible. Partagez le code ${this.code()}.`);
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
        this.notify(this.messageOf(error, 'Impossible de quitter le salon.'));
      },
    });
  }

  /** Réservé à l'hôte : l'ancien code cesse de fonctionner. */
  changeCode(): void {
    if (this.busy()) return;
    if (!confirm('Changer le code ? L’ancien code et l’ancien lien ne fonctionneront plus.')) return;

    this.busy.set(true);
    this.rooms.changeCode().subscribe({
      next: (room) => {
        this.busy.set(false);
        this.applyRoom(room);
        this.notify(`Nouveau code du salon : ${room.code}`);
      },
      error: (error: HttpErrorResponse) => {
        console.error('[RoomPage] Changement de code impossible', error.status);
        this.busy.set(false);
        this.notify(this.messageOf(error, 'Impossible de changer le code.'));
      },
    });
  }

  /** Réservé à l'hôte : supprime le salon et ses médias pour tout le monde. */
  closeRoom(): void {
    if (this.busy()) return;
    if (!confirm('Fermer le salon pour tout le monde ? Ses médias seront supprimés.')) return;

    this.busy.set(true);
    this.rooms.close().subscribe({
      next: () => {
        console.debug('[RoomPage] Salon fermé');
        void this.router.navigate(['/']);
      },
      error: (error: HttpErrorResponse) => {
        console.error('[RoomPage] Fermeture impossible', error.status);
        this.busy.set(false);
        this.notify(this.messageOf(error, 'Impossible de fermer le salon.'));
      },
    });
  }

  // --- Lecteur ------------------------------------------------------------

  /**
   * Flux : média choisi -> MediaService.streamUrl -> GET /api/media/:id/url
   * (jeton de salon) -> URL signée temporaire -> src du lecteur. Le navigateur
   * charge ensuite le fichier par requêtes Range (206 Partial Content).
   */
  play(media: Media): void {
    this.playerError.set('');
    this.mediaService.streamUrl(media.id).subscribe({
      next: ({ url }) => {
        console.debug('[RoomPage] URL de lecture reçue', media.id);
        this.current.set(media);
        this.mediaUrl.set(url);
      },
      error: (error: HttpErrorResponse) => {
        console.error('[RoomPage] Lecture impossible', error.status);
        this.stop();
        this.playerError.set(this.messageOf(error, 'Impossible de lire ce média.'));
      },
    });
  }

  onMediaRemoved(media: Media): void {
    if (this.current()?.id === media.id) this.stop();
  }

  /** Déclenché par l'événement (error) du lecteur HTML natif. */
  onPlaybackError(): void {
    console.error('[RoomPage] Le lecteur a signalé une erreur');
    this.stop();
    this.playerError.set('Lecture impossible : fichier illisible ou lien de lecture expiré.');
  }

  private stop(): void {
    this.current.set(null);
    this.mediaUrl.set('');
  }

  /** Le code a pu être changé par l'hôte : l'URL de la page suit. */
  private applyRoom(room: Room): void {
    const previous = this.room()?.code ?? this.session()?.code;
    this.room.set(room);
    if (previous && previous !== room.code) {
      void this.router.navigate(['/rooms', room.code], { replaceUrl: true });
    }
  }

  private notify(message: string): void {
    this.snackBar.open(message, 'OK', { duration: SNACKBAR_DURATION });
  }

  private messageOf(error: HttpErrorResponse, fallback: string): string {
    const serverMessage: unknown = error.error?.message;
    return typeof serverMessage === 'string' && serverMessage.length > 0 ? serverMessage : fallback;
  }
}
