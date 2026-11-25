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
import { ChosenFile, LocalFilesService } from '../../shared/services/local-files.service';
import { formatDuration, sameDuration } from '../../shared/local-media/local-media';
import { I18nService } from '../../shared/i18n/i18n.service';
import { TranslationKey } from '../../shared/i18n/translations';
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
 * Message à afficher selon le statut HTTP de l'URL du média. 403 : c'est
 * ainsi que Backblaze B2 refuse un téléchargement une fois le quota gratuit
 * du jour épuisé (download_cap_exceeded).
 */
export function mediaErrorMessage(status: number): TranslationKey {
  if (status === 403) return 'player.errorQuota';
  if (status === 401) return 'player.errorExpired';
  if (status === 404) return 'player.errorMissing';
  return 'player.errorDefault';
}

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
  private readonly localFiles = inject(LocalFilesService);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t;
  readonly server = this.i18n.server;

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

  // --- Média local : chaque participant choisit sa propre copie ---------------
  /** Nature du fichier local choisi (une copie vidéo d'un média audio reste une vidéo). */
  readonly localKind = signal<'audio' | 'video' | null>(null);
  readonly localError = signal('');
  readonly checkingLocal = signal(false);
  /** Média local du salon pour lequel ce participant n'a pas encore choisi de fichier. */
  readonly needsLocalFile = computed(() => this.media()?.source === 'local' && !this.url());
  readonly playerKind = computed(() => this.localKind() ?? this.media()?.kind ?? 'audio');

  readonly paused = computed(() => this.state()?.paused ?? true);
  readonly shownPosition = computed(() => this.scrubPosition() ?? this.position());
  readonly waitingNames = computed(() => this.waitingFor().map((participant) => participant.name).join(', '));
  readonly syncLabel = computed(() => {
    const t = this.t;
    if (!this.online()) return t('player.reconnecting');
    if (this.needsGesture()) return t('player.waitingClick');
    if (this.buffering()) return t('player.buffering');
    const drift = this.drift();
    if (this.paused() || drift === null) return t('player.synced');
    return Math.abs(drift) < 0.1
      ? t('player.syncedDrift', { drift: Math.abs(drift).toFixed(2) })
      : t('player.catchingUp');
  });

  private readonly player = viewChild<ElementRef<HTMLMediaElement>>('player');
  private readonly timer = setInterval(() => this.tick(), TICK_MS);

  /** Identifiant du média demandé en dernier, pour ignorer une réponse périmée. */
  private requestedId: string | null = null;
  /** URL `blob:` du fichier local en lecture, à libérer au changement de média. */
  private objectUrl: string | null = null;
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
    this.releaseLocalFile();
  }

  // --- Média local --------------------------------------------------------------

  /**
   * Le participant choisit sa copie du média local. Elle est acceptée si sa
   * durée est celle du média du salon (à 1 s près) ; le nom et le format
   * peuvent différer. Rien n'est envoyé : le lecteur lit le fichier sur place.
   */
  async chooseLocalFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const media = this.media();
    if (!file || media?.source !== 'local') return;

    this.localError.set('');
    this.checkingLocal.set(true);
    try {
      const info = await this.localFiles.probe(file);
      if (this.media()?.id !== media.id) return; // le salon a changé de média entre-temps
      if (!sameDuration(media.duration ?? 0, info.duration)) {
        console.warn('[SyncPlayer] Fichier local refusé : durée différente', info.duration, media.duration);
        this.localError.set(
          this.t('local.mismatch', {
            actual: formatDuration(info.duration),
            expected: formatDuration(media.duration ?? 0),
          }),
        );
        input.value = '';
        return;
      }
      const chosen = { file, info };
      this.localFiles.remember(media.id, chosen);
      this.useLocalFile(chosen);
    } catch (error) {
      console.warn('[SyncPlayer] Fichier local illisible', error);
      this.localError.set(this.t('player.localUnreadable'));
      input.value = '';
    } finally {
      this.checkingLocal.set(false);
    }
  }

  private useLocalFile({ file, info }: ChosenFile): void {
    this.releaseLocalFile();
    this.objectUrl = URL.createObjectURL(file);
    this.localKind.set(info.kind);
    this.url.set(this.objectUrl);
    console.debug('[SyncPlayer] Lecture du fichier local', file.name);
  }

  private releaseLocalFile(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  formatDuration = formatDuration;

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
      if (!result.ok) this.commandError.set(result.message ?? this.t('player.commandRefused'));
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
    // L'élément ne donne qu'une erreur générique. Pour expliquer la cause
    // (quota gratuit du jour atteint, lien expiré, média supprimé), on relit
    // le code HTTP de l'URL en ne demandant qu'un octet.
    console.error('[SyncPlayer] Le lecteur a signalé une erreur');
    const media = this.media();
    if (media?.source === 'local') {
      // Fichier de l'appareil : pas de serveur à interroger. On oublie cette
      // copie pour que « Réessayer » en fasse choisir une autre.
      this.localFiles.forget(media.id);
      this.error.set(this.t('player.localBroken'));
      return;
    }
    this.error.set(this.t('player.errorDefault'));
    const url = this.url();
    if (!url) return;
    void fetch(url, { headers: { Range: 'bytes=0-0' } })
      .then((response) => {
        if (this.url() !== url) return; // le salon a changé de média entre-temps
        console.warn('[SyncPlayer] Cause de l’erreur de lecture : HTTP', response.status);
        this.error.set(this.t(mediaErrorMessage(response.status)));
      })
      .catch(() => undefined); // réseau coupé : le message générique reste
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
        this.media.set(media);
        this.mediaChange.emit(media);
        if (media.source === 'local') {
          // Pas d'URL : chacun lit sa copie. Fichier déjà choisi pendant la session ?
          this.duration.set(media.duration ?? 0);
          const chosen = this.localFiles.get(media.id);
          if (chosen) this.useLocalFile(chosen);
          return;
        }
        console.debug('[SyncPlayer] URL de lecture reçue', mediaId);
        this.url.set(url ?? '');
      },
      error: (error: HttpErrorResponse) => {
        if (this.requestedId !== mediaId) return;
        console.error('[SyncPlayer] Média impossible à charger', error.status);
        const serverMessage: unknown = error.error?.message;
        this.error.set(typeof serverMessage === 'string' ? serverMessage : this.t('player.loadFailed'));
      },
    });
  }

  private resetPlayer(): void {
    if (this.media()) this.mediaChange.emit(null);
    this.media.set(null);
    this.url.set('');
    this.releaseLocalFile();
    this.localKind.set(null);
    this.localError.set('');
    this.checkingLocal.set(false);
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
