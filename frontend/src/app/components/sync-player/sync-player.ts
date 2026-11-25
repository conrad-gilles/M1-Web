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
import { readFolder } from '../../shared/local-media/local-folder';
import { P2pService } from '../../shared/p2p/p2p.service';
import { P2pError } from '../../shared/p2p/p2p-transfer';
import { RoomSessionService } from '../../shared/services/room-session.service';
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
/** Explication affichée selon la raison de l'échec d'un partage direct. */
const P2P_ERRORS: Record<P2pError['code'], TranslationKey> = {
  offline: 'player.p2pOffline',
  failed: 'player.p2pFailed',
  'bad-range': 'player.p2pFailed',
  'not-shared': 'player.p2pNotShared',
  closed: 'player.p2pInterrupted',
};

/** Un saut natif à moins de cet écart de la position du salon n'est pas une demande de saut. */
const NATIVE_SEEK_THRESHOLD = 0.5;
/**
 * Les contrôles natifs envoient parfois plusieurs événements pour un seul
 * geste (Firefox met en pause puis relance pendant qu'on fait glisser la
 * barre). On attend la fin du geste et on n'envoie au salon que le résultat.
 */
const NATIVE_SETTLE_MS = 250;
/** Un saut fait par le lecteur lui-même est reconnu à sa cible, pendant ce délai. */
const SELF_SEEK_MEMORY_MS = 3000;

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
 * Les boutons du composant et les contrôles natifs du navigateur (visibles
 * aussi en plein écran) envoient des commandes au serveur ; le lecteur
 * n'applique que l'état partagé reçu en retour. Ainsi tout le monde suit la
 * même ligne de temps. Les événements play/pause/seeked déclenchés par
 * l'application d'un état ne repartent pas comme de nouvelles commandes (pas
 * de boucle d'écho) : le lecteur marque ses propres actions sur l'élément,
 * et seules les autres comptent comme actions de l'utilisateur (voir
 * « Contrôles natifs du navigateur » plus bas).
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
  private readonly p2p = inject(P2pService);
  private readonly session = inject(RoomSessionService).session;
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
  /**
   * Partage direct (P2P) : connexion au participant qui partage en cours, ou
   * fichier à choisir de nouveau par celui qui le partage (page rechargée).
   */
  readonly p2pStatus = signal<'idle' | 'connecting' | 'reshare'>('idle');
  /** Média local (ou partage à rechoisir) pour lequel ce participant n'a pas encore choisi de fichier. */
  readonly needsLocalFile = computed(
    () =>
      !this.url() &&
      (this.media()?.source === 'local' || (this.media()?.source === 'p2p' && this.p2pStatus() === 'reshare')),
  );
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
  // Actions du lecteur lui-même sur l'élément : leurs événements ne sont pas
  // des actions de l'utilisateur (voir « Contrôles natifs du navigateur »).
  private selfPlay = false;
  private selfPause = false;
  private selfSeek: { target: number; at: number } | null = null;
  private nativeTimer?: ReturnType<typeof setTimeout>;
  /**
   * Après une commande venue des contrôles natifs, la boucle de surveillance
   * laisse le lecteur tel que l'utilisateur l'a mis jusqu'à la réponse du
   * salon (1 s au plus), au lieu de le remettre brièvement dans l'ancien état.
   */
  private nativeCommandUntil = 0;
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

    this.installDebugHook();

    // Un fichier ou un dossier vient d'être retenu (carte « Synchroniser ») :
    // si le lecteur attendait la copie de ce participant, il la cherche.
    effect(() => {
      this.localFiles.changes();
      untracked(() => {
        const media = this.media();
        if (media && this.needsLocalFile() && !this.checkingLocal()) this.findLocalCopy(media);
      });
    });

    // Un nouvel état arrive, ou le lecteur vient d'être créé : on l'applique.
    effect(() => {
      this.state();
      this.player();
      untracked(() => {
        // La réponse du salon est là : la boucle de surveillance reprend la main.
        this.nativeCommandUntil = 0;
        this.apply();
      });
    });

    // Après une reconnexion, le serveur a oublié nos signalements de buffering.
    effect(() => {
      if (this.online()) untracked(() => this.resetBuffering());
    });
  }

  /**
   * Aide aux tests de bout en bout, active seulement si localStorage contient
   * `sharing_platform_debug=1` : décale le lecteur comme le ferait une vraie
   * dérive (réseau lent, appareil chargé), sans que ce soit pris pour un saut
   * demandé par l'utilisateur.
   */
  private installDebugHook(): void {
    try {
      if (localStorage.getItem('sharing_platform_debug') !== '1') return;
    } catch {
      return;
    }
    (window as unknown as { __syncPlayer?: unknown }).__syncPlayer = {
      drift: (seconds: number) => {
        const element = this.player()?.nativeElement;
        if (element) this.selfSeekElement(element, Math.max(0, element.currentTime + seconds));
      },
    };
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    clearTimeout(this.nativeTimer);
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
    if (!file || !media || !this.needsLocalFile()) return;

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
      // Celui qui partage en direct rechoisit son fichier : il le diffuse de nouveau.
      if (media.source === 'p2p') {
        this.p2p.share(media.id, file);
        this.p2pStatus.set('idle');
      }
      this.useLocalFile(chosen);
    } catch (error) {
      console.warn('[SyncPlayer] Fichier local illisible', error);
      this.localError.set(this.t('player.localUnreadable'));
      input.value = '';
    } finally {
      this.checkingLocal.set(false);
    }
  }

  /**
   * Partage direct : celui qui partage lit son propre fichier ; les autres
   * ouvrent une connexion directe et lisent le flux servi par le service worker.
   */
  private startP2p(media: Media): void {
    const name = media.owner?.name ?? '';
    if (media.owner?.id === this.session()?.participant.id) {
      const file = this.p2p.sharedFile(media.id);
      if (file) this.useLocalFile({ file, info: { duration: media.duration ?? 0, kind: media.kind } });
      else this.p2pStatus.set('reshare');
      return;
    }

    this.p2pStatus.set('connecting');
    this.p2p
      .prepare(media)
      .then((url) => {
        if (this.media()?.id !== media.id) return; // le salon a changé de média entre-temps
        this.p2pStatus.set('idle');
        this.url.set(url);
      })
      .catch((error: unknown) => {
        if (this.media()?.id !== media.id) return;
        this.p2pStatus.set('idle');
        const code = error instanceof P2pError ? error.code : 'failed';
        console.warn('[SyncPlayer] Partage direct indisponible', code);
        // Une connexion ratée est oubliée : « Réessayer » en ouvre une nouvelle.
        if (code !== 'offline' && media.owner) this.p2p.forget(media.owner.id);
        this.error.set(this.t(P2P_ERRORS[code], { name }));
      });
  }

  /** Copie déjà connue de ce participant : fichier choisi, ou dossier de même nom. */
  private findLocalCopy(media: Media): void {
    const chosen = this.localFiles.get(media.id);
    if (chosen) this.useLocalFile(chosen);
    else if (media.folder && this.localFiles.hasFolder(media.folder)) void this.lookInFolder(media);
  }

  /** Dossier choisi (ici ou dans la carte « Synchroniser ») : le participant choisit son dossier de même nom. */
  async chooseLocalFolder(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const media = this.media();
    const chosen = readFolder(Array.from(input.files ?? []));
    input.value = '';
    if (!chosen || !media?.folder) return;
    this.localError.set('');
    if (chosen.folder !== media.folder) {
      this.localError.set(this.t('player.folderWrongName', { actual: chosen.folder, expected: media.folder }));
      return;
    }
    this.localFiles.rememberFolder(chosen.folder, chosen.files);
    await this.lookInFolder(media);
  }

  /** Même chemin, même durée : la copie du dossier est lue, sinon on explique pourquoi. */
  private async lookInFolder(media: Media): Promise<void> {
    this.checkingLocal.set(true);
    try {
      const found = await this.localFiles.fromFolder(media);
      if (this.media()?.id !== media.id) return; // le salon a changé de média entre-temps
      if (found.status === 'found') {
        this.localError.set('');
        this.useLocalFile(found.chosen);
      } else if (found.status === 'missing') {
        this.localError.set(this.t('player.folderMissing', { folder: media.folder ?? '', path: media.originalName }));
      } else {
        this.localError.set(
          this.t('local.mismatch', {
            actual: formatDuration(found.duration),
            expected: formatDuration(media.duration ?? 0),
          }),
        );
      }
    } catch (error) {
      console.warn('[SyncPlayer] Copie du dossier illisible', error);
      this.localError.set(this.t('player.localUnreadable'));
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

  // --- Contrôles natifs du navigateur -------------------------------------------
  //
  // Le lecteur affiche les contrôles de Firefox/Chrome (y compris en plein
  // écran). Les navigateurs ne signalent pas les clics sur ces contrôles à la
  // page : on ne voit que les événements play, pause et seeked. Règle :
  // - le lecteur marque chaque play(), pause() ou saut qu'il fait lui-même
  //   (appliquer l'état du salon, corriger la dérive) ; leurs événements sont
  //   ignorés, ce qui empêche toute boucle d'écho ;
  // - tout autre play, pause ou saut vient de l'utilisateur (contrôles
  //   natifs, clavier, touche multimédia, casque) : à la fin du geste, on
  //   envoie au salon l'état auquel il a mené le lecteur.

  onNativePlay(): void {
    if (this.selfPlay) {
      this.selfPlay = false;
      return;
    }
    // Lancer la lecture soi-même vaut le clic demandé par la règle d'autoplay.
    if (this.needsGesture()) {
      this.needsGesture.set(false);
      if (this.state() && !this.state()!.paused) this.apply();
    }
    this.userChangedPlayer();
  }

  onNativePause(): void {
    if (this.selfPause) {
      this.selfPause = false;
      return;
    }
    this.userChangedPlayer();
  }

  onNativeSeeked(): void {
    const element = this.player()?.nativeElement;
    const self = this.selfSeek;
    if (element && self && Date.now() - self.at < SELF_SEEK_MEMORY_MS && Math.abs(element.currentTime - self.target) < 0.25) {
      this.selfSeek = null;
      return;
    }
    this.userChangedPlayer();
  }

  /**
   * L'utilisateur vient de changer le lecteur. La surveillance le laisse tel
   * quel le temps du geste, puis on envoie au salon ce qui diffère de son état.
   */
  private userChangedPlayer(): void {
    if (!this.ready()) return;
    this.nativeCommandUntil = Date.now() + NATIVE_SETTLE_MS + CORRECTION_INTERVAL_MS;
    clearTimeout(this.nativeTimer);
    this.nativeTimer = setTimeout(() => this.sendUserChange(), NATIVE_SETTLE_MS);
  }

  private sendUserChange(): void {
    const current = this.ready();
    if (!current) return;
    const { element, state } = current;
    this.nativeCommandUntil = Date.now() + CORRECTION_INTERVAL_MS;

    const expected = this.clamp(expectedPosition(state, this.sync.serverNow()));
    if (Math.abs(element.currentTime - expected) > NATIVE_SEEK_THRESHOLD && !this.atEnd(element)) {
      console.debug('[SyncPlayer] Saut depuis les contrôles natifs', element.currentTime);
      this.command({ type: 'seek', position: this.clamp(element.currentTime) });
    }
    // La pause automatique en fin de média est traitée par onEnded.
    if (element.paused && !state.paused && !this.atEnd(element)) {
      console.debug('[SyncPlayer] Pause depuis les contrôles natifs');
      this.command({ type: 'pause' });
    } else if (!element.paused && state.paused) {
      console.debug('[SyncPlayer] Lecture depuis les contrôles natifs');
      this.command({ type: 'play' });
    }
  }

  /** Les actions du lecteur lui-même sur l'élément passent par ces trois fonctions. */
  private selfPlayElement(element: HTMLMediaElement): Promise<void> | undefined {
    this.selfPlay = true;
    const result = element.play();
    return result?.catch((error: unknown) => {
      this.selfPlay = false; // refusé : aucun événement play ne viendra
      throw error;
    });
  }

  private selfPauseElement(element: HTMLMediaElement): void {
    if (element.paused) return;
    this.selfPause = true;
    element.pause();
  }

  private selfSeekElement(element: HTMLMediaElement, position: number): void {
    this.selfSeek = { target: position, at: Date.now() };
    element.currentTime = position;
  }

  /** Volume ou sourdine changés avec les contrôles natifs : réglage local, reflété dans nos curseurs. */
  onVolumeChange(): void {
    const element = this.player()?.nativeElement;
    if (!element) return;
    this.volume.set(element.volume);
    this.muted.set(element.muted);
  }

  // --- Événements du lecteur ------------------------------------------------------

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
    if (media?.source === 'p2p' && media.owner?.id !== this.session()?.participant.id) {
      // Flux interrompu (pair parti, connexion coupée) : « Réessayer » se reconnecte.
      if (media.owner) this.p2p.forget(media.owner.id);
      this.error.set(this.t('player.p2pInterrupted', { name: media.owner?.name ?? '' }));
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
          // Pas d'URL : chacun lit sa copie (fichier ou dossier déjà choisi pendant la session ?).
          this.duration.set(media.duration ?? 0);
          this.findLocalCopy(media);
          return;
        }
        if (media.source === 'p2p') {
          this.duration.set(media.duration ?? 0);
          this.startP2p(media);
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
    clearTimeout(this.nativeTimer);
    this.selfPlay = false;
    this.selfPause = false;
    this.selfSeek = null;
    this.nativeCommandUntil = 0;
    this.localKind.set(null);
    this.p2pStatus.set('idle');
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
      this.selfPauseElement(element);
      element.playbackRate = state.rate;
      this.correcting = false;
      this.drift.set(null);
      const expected = this.clamp(expectedPosition(state, this.sync.serverNow()));
      if (Math.abs(element.currentTime - expected) > PAUSED_TOLERANCE) this.selfSeekElement(element, expected);
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
      this.selfSeekElement(element, this.clamp(correction.position));
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
    this.selfPlayElement(element)?.catch((error: unknown) => {
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

    // Commande native en route : on laisse le lecteur tel que l'utilisateur l'a mis.
    if (Date.now() < this.nativeCommandUntil) return;

    if (state.paused) {
      this.selfPauseElement(element);
      return;
    }
    if (this.needsGesture() || Date.now() - this.lastCorrectionAt < CORRECTION_INTERVAL_MS) return;

    // Le salon lit : on suit, même si le lecteur s'est arrêté sans événement
    // de pause (blocage du navigateur, par exemple).
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
