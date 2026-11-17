import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Media } from '../../shared/models/media.model';
import { PlaybackState } from '../../shared/models/playback-state.model';
import { MediaService } from '../../shared/services/media.service';
import { SyncService } from '../../shared/services/sync.service';
import { driftCorrection, expectedPosition, formatTime } from '../../shared/sync/sync-math';

/** Période de la boucle de surveillance du lecteur. */
const TICK_MS = 250;
/** La dérive est corrigée environ une fois par seconde. */
const CORRECTION_INTERVAL_MS = 1000;
/** Un blocage plus court que cela n'est pas signalé au salon. */
const BUFFERING_REPORT_DELAY_MS = 500;
/** En pause, on recale le lecteur au-delà de cet écart (secondes). */
const PAUSED_TOLERANCE = 0.05;
/** HTMLMediaElement.HAVE_METADATA : durée connue, déplacement possible. */
const HAVE_METADATA = 1;
/** HTMLMediaElement.HAVE_FUTURE_DATA : assez de données pour continuer à lire. */
const HAVE_FUTURE_DATA = 3;
const SKIP_SECONDS = 10;

/**
 * Synchronized player of a room.
 *
 * Ce composant n'a pas les contrôles natifs du navigateur : ses boutons
 * envoient des commandes au serveur, et le lecteur n'applique que l'état
 * partagé reçu en retour. Ainsi tout le monde suit la même ligne de temps, et
 * les événements play/pause/seeked déclenchés par l'application d'un état ne
 * peuvent pas repartir comme de nouvelles commandes (pas de boucle d'écho).
 */
@Component({
  selector: 'app-sync-player',
  templateUrl: './sync-player.html',
  styleUrl: './sync-player.css',
})
export class SyncPlayerComponent implements OnDestroy {
  private readonly sync = inject(SyncService);
  private readonly mediaService = inject(MediaService);

  /** Émis quand le média chargé dans le lecteur change (null : lecteur vide). */
  readonly mediaChange = output<Media | null>();

  readonly state = this.sync.playback;
  readonly waitingFor = this.sync.waitingFor;
  readonly online = this.sync.online;

  readonly media = signal<Media | null>(null);
  readonly url = signal('');
  readonly error = signal('');
  readonly commandError = signal('');
  /** Le navigateur exige un clic avant de lire du son (règle d'autoplay). */
  readonly needsGesture = signal(false);
  readonly position = signal(0);
  readonly duration = signal(0);
  /** Écart mesuré avec la position attendue, en secondes (positif : en retard). */
  readonly drift = signal<number | null>(null);
  readonly buffering = signal(false);
  /** Position visée pendant que l'utilisateur déplace le curseur. */
  readonly scrubPosition = signal<number | null>(null);
  readonly volume = signal(1);
  readonly muted = signal(false);

  readonly paused = computed(() => this.state()?.paused ?? true);
  readonly shownPosition = computed(() => this.scrubPosition() ?? this.position());
  readonly waitingNames = computed(() => this.waitingFor().map((participant) => participant.name).join(', '));
  readonly syncLabel = computed(() => {
    if (!this.online()) return 'Reconnexion au salon…';
    if (this.needsGesture()) return 'En attente de votre clic';
    if (this.buffering()) return 'Mise en mémoire tampon…';
    const drift = this.drift();
    if (this.paused() || drift === null) return 'Synchronisé';
    return Math.abs(drift) < 0.1 ? `Synchronisé (écart ${Math.abs(drift).toFixed(2)} s)` : 'Rattrapage…';
  });

  private readonly player = viewChild<ElementRef<HTMLMediaElement>>('player');
  private readonly timer = setInterval(() => this.tick(), TICK_MS);

  /** Identifiant du média demandé en dernier, pour ignorer une réponse périmée. */
  private requestedId: string | null = null;
  /** Vrai pendant un rattrapage par la vitesse (voir driftCorrection). */
  private correcting = false;
  private lastCorrectionAt = 0;
  private stalledSince: number | null = null;
  private bufferingReported = false;

  constructor() {
    // Le média du salon change : on demande une URL de lecture pour le nouveau.
    effect(() => {
      const mediaId = this.state()?.mediaId ?? null;
      untracked(() => this.loadMedia(mediaId));
    });

    // Un nouvel état arrive, ou le lecteur vient d'être créé : on l'applique.
    effect(() => {
      this.state();
      this.player();
      untracked(() => this.apply());
    });

    // Après une reconnexion, le serveur a oublié nos signalements de buffering.
    effect(() => {
      if (this.online()) untracked(() => this.resetBuffering());
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  // --- Commandes : les boutons parlent au serveur, pas au lecteur -----------

  togglePlay(): void {
    this.command(this.paused() ? { type: 'play' } : { type: 'pause' });
  }

  skip(seconds: number): void {
    const state = this.state();
    if (!state) return;
    this.seekTo(expectedPosition(state, this.sync.serverNow()) + seconds);
  }

  onScrub(event: Event): void {
    this.scrubPosition.set(Number((event.target as HTMLInputElement).value));
  }

  /** Le curseur est relâché : c'est seulement là qu'on déplace tout le salon. */
  onScrubEnd(event: Event): void {
    this.scrubPosition.set(null);
    this.seekTo(Number((event.target as HTMLInputElement).value));
  }

  private seekTo(position: number): void {
    this.command({ type: 'seek', position: this.clamp(position) });
  }

  private command(command: Parameters<SyncService['send']>[0]): void {
    this.commandError.set('');
    void this.sync.send(command).then((result) => {
      if (!result.ok) this.commandError.set(result.message ?? 'Commande refusée.');
    });
  }

  // --- Réglages locaux, propres à chaque participant ------------------------

  setVolume(event: Event): void {
    this.volume.set(Number((event.target as HTMLInputElement).value));
    this.applyVolume();
  }

  toggleMute(): void {
    this.muted.update((muted) => !muted);
    this.applyVolume();
  }

  fullscreen(): void {
    void this.player()?.nativeElement.requestFullscreen?.();
  }

  /** Clic demandé par la règle d'autoplay : la lecture peut alors démarrer. */
  enableSound(): void {
    this.needsGesture.set(false);
    this.apply();
  }

  retry(): void {
    const mediaId = this.requestedId;
    this.requestedId = null;
    this.loadMedia(mediaId);
  }

  // --- Événements du lecteur : aucun ne renvoie de commande play/pause/seek --

  onLoadedMetadata(): void {
    const element = this.player()?.nativeElement;
    if (!element) return;
    this.duration.set(Number.isFinite(element.duration) ? element.duration : 0);
    this.applyVolume();
    this.apply();
  }

  onTimeUpdate(): void {
    const element = this.player()?.nativeElement;
    if (element) this.position.set(element.currentTime);
  }

  /** Fin du média : le salon passe en pause (le serveur ignore les doublons). */
  onEnded(): void {
    const state = this.state();
    const element = this.player()?.nativeElement;
    if (!state || state.paused || !element) return;
    this.command({ type: 'ended', version: state.version, position: element.duration });
  }

  onMediaError(): void {
    // L'élément ne donne qu'une erreur générique : fichier illisible, lien
    // expiré ou quota de téléchargement du stockage atteint.
    console.error('[SyncPlayer] Le lecteur a signalé une erreur');
    this.error.set('Média temporairement indisponible. Réessayez dans un instant.');
  }

  formatTime = formatTime;

  // --- Chargement du média ---------------------------------------------------

  /**
   * Flux : état du salon -> MediaService.streamUrl -> GET /api/media/:id/url
   * (jeton de salon) -> URL signée temporaire -> src du lecteur. Le navigateur
   * charge ensuite le fichier par requêtes Range (206 Partial Content).
   */
  private loadMedia(mediaId: string | null): void {
    if (mediaId === this.requestedId) return;
    this.requestedId = mediaId;
    this.resetPlayer();
    if (!mediaId) return;

    this.mediaService.streamUrl(mediaId).subscribe({
      next: ({ url, media }) => {
        if (this.requestedId !== mediaId) return; // le salon a déjà changé de média
        console.debug('[SyncPlayer] URL de lecture reçue', mediaId);
        this.media.set(media);
        this.url.set(url);
        this.mediaChange.emit(media);
      },
      error: (error: HttpErrorResponse) => {
        if (this.requestedId !== mediaId) return;
        console.error('[SyncPlayer] Média impossible à charger', error.status);
        const serverMessage: unknown = error.error?.message;
        this.error.set(typeof serverMessage === 'string' ? serverMessage : 'Impossible de charger ce média.');
      },
    });
  }

  private resetPlayer(): void {
    if (this.media()) this.mediaChange.emit(null);
    this.media.set(null);
    this.url.set('');
    this.error.set('');
    this.commandError.set('');
    this.position.set(0);
    this.duration.set(0);
    this.drift.set(null);
    this.needsGesture.set(false);
    this.correcting = false;
    this.resetBuffering();
  }

  // --- Application de l'état partagé ------------------------------------------

  /** Lecteur et état, seulement quand le lecteur a chargé le média du salon. */
  private ready(): { element: HTMLMediaElement; state: PlaybackState } | null {
    const element = this.player()?.nativeElement;
    const state = this.state();
    if (!element || !state || this.media()?.id !== state.mediaId) return null;
    // Avant les métadonnées, on ne peut pas se déplacer : onLoadedMetadata rappellera apply().
    return element.readyState >= HAVE_METADATA ? { element, state } : null;
  }

  /** Aligne le lecteur sur l'état partagé (appelé à chaque nouvel état). */
  private apply(): void {
    const current = this.ready();
    if (!current) return;
    const { element, state } = current;

    if (state.paused) {
      if (!element.paused) element.pause();
      element.playbackRate = state.rate;
      this.correcting = false;
      this.drift.set(null);
      const expected = this.clamp(expectedPosition(state, this.sync.serverNow()));
      if (Math.abs(element.currentTime - expected) > PAUSED_TOLERANCE) element.currentTime = expected;
    } else {
      this.correct(element, state);
      this.resume(element);
    }
    this.position.set(element.currentTime);
  }

  /** Corrige la dérive : rien, léger changement de vitesse, ou saut. */
  private correct(element: HTMLMediaElement, state: PlaybackState): void {
    this.lastCorrectionAt = Date.now();
    // Le salon a dépassé la fin du média et le lecteur y est déjà : rien à rattraper.
    const duration = this.duration();
    if (duration > 0 && this.atEnd(element) && expectedPosition(state, this.sync.serverNow()) >= duration) {
      this.drift.set(null);
      return;
    }

    const correction = driftCorrection(state, element.currentTime, this.sync.serverNow(), this.correcting);
    this.drift.set(correction.drift);

    if (correction.type === 'seek') {
      element.currentTime = this.clamp(correction.position);
      element.playbackRate = state.rate;
      this.correcting = false;
    } else if (correction.type === 'rate') {
      element.playbackRate = correction.rate;
      this.correcting = true;
    } else {
      element.playbackRate = state.rate;
      this.correcting = false;
    }
  }

  /** Lance la lecture locale si le salon lit et que le lecteur est arrêté. */
  private resume(element: HTMLMediaElement): void {
    if (!element.paused || this.atEnd(element) || this.needsGesture()) return;
    // play() est refusé tant que l'utilisateur n'a pas interagi avec la page.
    element.play()?.catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        console.warn('[SyncPlayer] Lecture automatique bloquée par le navigateur');
        this.needsGesture.set(true);
      } else if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('[SyncPlayer] Lecture impossible', error);
      }
    });
  }

  /** Boucle de surveillance : position affichée, buffering, dérive. */
  private tick(): void {
    const current = this.ready();
    if (!current) return;
    const { element, state } = current;

    if (this.scrubPosition() === null) this.position.set(element.currentTime);
    const stalled = this.watchBuffering(element, state);

    if (state.paused) {
      if (!element.paused) element.pause();
      return;
    }
    if (this.needsGesture() || Date.now() - this.lastCorrectionAt < CORRECTION_INTERVAL_MS) return;

    // Le salon lit : on suit, même si le lecteur a été arrêté par ailleurs
    // (touche multimédia du clavier, par exemple).
    this.resume(element);
    // Pendant un blocage, un saut ne ferait que relancer le chargement.
    if (stalled) this.lastCorrectionAt = Date.now();
    else this.correct(element, state);
  }

  /**
   * Signale au salon un blocage de plus de 0,5 s, puis la fin du blocage. Les
   * blocages plus courts (après chaque lecture ou saut) sont ignorés, sinon le
   * salon se mettrait sans cesse en pause.
   */
  private watchBuffering(element: HTMLMediaElement, state: PlaybackState): boolean {
    const stalled = element.readyState < HAVE_FUTURE_DATA && !this.atEnd(element);
    // Le salon veut lire : soit il lit, soit il est en pause pour attendre quelqu'un.
    const roomWantsPlayback = !state.paused || this.waitingFor().length > 0;
    this.buffering.set(stalled && roomWantsPlayback);

    if (this.bufferingReported) {
      if (!stalled) {
        this.sync.bufferEnd();
        this.resetBuffering();
      }
      return stalled;
    }
    if (!stalled || !roomWantsPlayback || this.needsGesture()) {
      this.stalledSince = null;
      return stalled;
    }

    this.stalledSince ??= Date.now();
    if (Date.now() - this.stalledSince > BUFFERING_REPORT_DELAY_MS) {
      console.debug('[SyncPlayer] Blocage signalé au salon');
      this.sync.bufferStart();
      this.bufferingReported = true;
    }
    return stalled;
  }

  private resetBuffering(): void {
    this.stalledSince = null;
    this.bufferingReported = false;
    this.buffering.set(false);
  }

  private applyVolume(): void {
    const element = this.player()?.nativeElement;
    if (!element) return;
    element.volume = this.volume();
    element.muted = this.muted();
  }

  private atEnd(element: HTMLMediaElement): boolean {
    return element.ended || (Number.isFinite(element.duration) && element.currentTime >= element.duration - 0.05);
  }

  /** Garde une position entre 0 et la durée du média. */
  private clamp(position: number): number {
    const duration = this.duration();
    return Math.max(0, duration > 0 ? Math.min(position, duration) : position);
  }
}
