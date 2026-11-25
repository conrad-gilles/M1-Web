import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Media } from '../../shared/models/media.model';
import { UploadState } from '../../shared/models/upload-state.model';
import { MediaService } from '../../shared/services/media.service';
import { VideoConverterService } from '../../shared/services/video-converter.service';
import { formatDuration } from '../../shared/local-media/local-media';
import { I18nService } from '../../shared/i18n/i18n.service';
import { LocalMediaComponent } from '../local-media/local-media';
import { P2pShareComponent } from '../p2p-share/p2p-share';
import { readFolder } from '../../shared/local-media/local-folder';
import { filter, firstValueFrom, tap } from 'rxjs';
import {
  RECOMMENDED_CONVERSION_INPUT_SIZE,
  fileExtension,
  needsConversion,
} from '../../shared/video/video-conversion';

/**
 * Formats audio et vidéo acceptés par le backend (voir backend/src/config.js, la variable
 * `ALLOWED_MIME_TYPES`). Dupliquer cette liste côté frontend permet d'afficher une erreur
 * immédiate, mais ne remplace jamais la vérification faite par le serveur :
 * un client malveillant peut toujours envoyer une requête directement à l'API
 * sans passer par ce formulaire.
 */
const ACCEPTED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'video/mp4',
  'video/webm',
  'video/ogg',
]);

/** Certains navigateurs ne renseignent pas `file.type` pour le m4a/wav : on
 * retombe alors sur l'extension du nom de fichier. */
const ACCEPTED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm', '.ogv']);

/**
 * Pas de limite de taille, seulement un avertissement : le stockage gratuit
 * (Backblaze B2) permet 1 Go de téléchargement par jour pour tout le monde, et
 * chaque participant télécharge le fichier entier.
 */
const LARGE_FILE_WARNING_SIZE = 1024 * 1024 * 1024;

/** Durée d'affichage des notifications SnackBar, en millisecondes. */
const SNACKBAR_DURATION = 5000;

/** Upload, paginated list and deletion of the media files of a room. */
@Component({
  selector: 'app-media-library',
  imports: [ReactiveFormsModule, LocalMediaComponent, P2pShareComponent],
  templateUrl: './media-library.html',
  styleUrl: './media-library.css',
})
export class MediaLibraryComponent {
  private readonly service = inject(MediaService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly converter = inject(VideoConverterService);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t;
  readonly server = this.i18n.server;

  /** Média actuellement chargé dans le lecteur du salon, pour le mettre en évidence. */
  readonly activeMediaId = input<string | null>(null);
  /** Émis quand un participant choisit un média à lire. */
  readonly selected = output<Media>();
  /** Émis quand un média a été supprimé (ou n'existe plus). */
  readonly removed = output<Media>();

  // --- Bibliothèque paginée -------------------------------------------------
  readonly medias = signal<Media[]>([]);
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly loading = signal(false);
  readonly listError = signal('');

  readonly isFirstPage = computed(() => this.page() <= 1);
  readonly isLastPage = computed(() => this.page() >= this.pages());

  // --- Filtre par titre (amélioration facultative) ------------------------
  // Le backend n'expose aucun paramètre de recherche : le filtre ne porte donc
  // que sur la page de pistes déjà chargée.
  readonly filterText = signal('');
  readonly visibleMedias = computed(() => {
    const query = this.filterText().trim().toLowerCase();
    if (!query) return this.medias();
    return this.medias().filter((track) => track.title.toLowerCase().includes(query));
  });

  // --- Formulaire d'upload ---------------------------------------------------
  readonly title = new FormControl('', { nonNullable: true });
  readonly fileError = signal('');
  /** Avertissement non bloquant sur le fichier choisi (l'envoi reste possible). */
  readonly fileWarning = signal('');
  readonly uploadState = signal<UploadState>({ status: 'idle' });
  file?: File;
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  // Valeurs dérivées de `uploadState` pour garder le template simple.
  readonly converting = computed(() => this.uploadState().status === 'converting');
  readonly uploading = computed(() => this.uploadState().status === 'uploading');
  /** Conversion ou envoi en cours : le formulaire est verrouillé. */
  readonly busy = computed(() => this.converting() || this.uploading());
  readonly uploadPercent = computed(() => {
    const state = this.uploadState();
    return state.status === 'uploading' || state.status === 'converting' ? state.percent : null;
  });
  readonly uploadError = computed(() => {
    const state = this.uploadState();
    return state.status === 'error' ? state.message : '';
  });
  readonly uploadSuccess = computed(() => {
    const state = this.uploadState();
    return state.status === 'success' ? this.t('upload.success', { title: state.title }) : '';
  });

  // --- Suppression -----------------------------------------------------------
  readonly deletingId = signal<string | null>(null);

  constructor() {
    this.load();
  }

  choose(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selected = input.files?.[0];
    this.uploadState.set({ status: 'idle' });
    this.fileWarning.set('');

    if (!selected) {
      this.file = undefined;
      this.fileError.set('');
      return;
    }

    const validationError = this.validateFile(selected);
    if (validationError) {
      console.warn('[MediaLibrary] Fichier rejeté côté frontend', validationError);
      this.file = undefined;
      this.fileError.set(validationError);
      input.value = '';
      return;
    }

    this.file = selected;
    this.fileError.set('');
    this.fileWarning.set(this.warnAbout(selected));
    console.debug('[MediaLibrary] Fichier sélectionné', this.file.name);
  }

  /**
   * Vérification frontend "meilleur effort" : elle améliore l'expérience en
   * évitant un aller-retour réseau inutile, mais le backend refait toujours
   * les mêmes contrôles (voir `fileFilter` et `limits.fileSize` dans
   * backend/src/middleware/upload.js) car le frontend peut être contourné.
   */
  private validateFile(file: File): string | null {
    // MOV/AVI/MKV : converti en MP4 avant l'envoi. Aucune taille n'est
    // interdite : les gros fichiers donnent seulement un avertissement (warnAbout).
    if (needsConversion(file)) return null;

    const typeKnown = ACCEPTED_MIME_TYPES.has(file.type);
    const extensionKnown = ACCEPTED_EXTENSIONS.has(fileExtension(file.name));

    if (!typeKnown && !extensionKnown) {
      return this.t('upload.unsupported');
    }
    return null;
  }

  /** Recommandations, pas des interdictions : l'utilisateur décide d'essayer. */
  private warnAbout(file: File): string {
    const warnings: string[] = [];
    const size = this.formatSize(file.size);
    if (needsConversion(file) && file.size > RECOMMENDED_CONVERSION_INPUT_SIZE) {
      warnings.push(this.t('upload.warnConversion', { size }));
    }
    if (file.size >= LARGE_FILE_WARNING_SIZE) {
      warnings.push(this.t('upload.warnLarge', { size }));
    }
    return warnings.join(' ');
  }

  // --- Bibliothèque paginée ------------------------------------------------

  /**
   * Flux : composant -> MediaService.list -> HttpClient.get -> GET
   * /api/tracks?page=...&limit=... . À chaque appel, une nouvelle requête
   * HTTP est envoyée avec la page demandée ; l'application ne récupère
   * jamais toutes les pistes pour les découper localement.
   */
  load(): void {
    this.loading.set(true);
    this.listError.set('');

    this.service.list(this.page()).subscribe({
      next: (response) => {
        // Après une suppression, la dernière page peut avoir disparu : on
        // recule sur la dernière page qui existe encore (jamais en dessous de 1).
        if (response.items.length === 0 && this.page() > 1) {
          this.page.set(Math.max(1, response.pages));
          this.load();
          return;
        }
        console.debug('[MediaLibrary] Pistes chargées', response.items.length, 'page', response.page);
        this.medias.set(response.items);
        this.pages.set(response.pages);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        console.error('[MediaLibrary] Chargement impossible', error.status);
        this.listError.set(this.extractErrorMessage(error, this.t('library.loadFailed')));
        this.loading.set(false);
      },
    });
  }

  go(page: number): void {
    if (page < 1 || page > this.pages() || page === this.page()) return;
    this.page.set(page);
    this.load();
  }

  // --- Upload ----------------------------------------------------------

  /**
   * Flux : formulaire -> MediaService.upload -> HttpClient.post (observe:
   * 'events', reportProgress: true). Le flux émet plusieurs événements : des
   * `UploadProgress` pendant l'envoi (loaded / total), puis un unique
   * `Response` avec la piste créée. Les autres types (Sent, ResponseHeader…)
   * sont ignorés.
   */
  upload(): void {
    // Empêche les doubles soumissions si l'utilisateur reclique pendant l'envoi.
    if (!this.file || this.busy()) return;

    const file = this.file;
    const title = this.title.value || file.name;
    this.title.disable();

    if (needsConversion(file)) {
      void this.convertThenSend(file, title);
    } else {
      this.send(file, title);
    }
  }

  /**
   * MOV/AVI/MKV : conversion en MP4 dans le navigateur (FFmpeg WebAssembly,
   * chargé seulement maintenant), puis envoi normal du fichier converti.
   */
  private async convertThenSend(file: File, title: string): Promise<void> {
    this.uploadState.set({ status: 'converting', percent: null });
    let converted: File;
    try {
      converted = await this.converter.toMp4(file, (percent) =>
        this.uploadState.set({ status: 'converting', percent }),
      );
    } catch (error) {
      console.error('[MediaLibrary] Conversion impossible', error);
      this.title.enable();
      this.uploadState.set({
        status: 'error',
        message: this.t('upload.conversionFailed'),
      });
      return;
    }

    console.debug('[MediaLibrary] Vidéo convertie', file.size, '->', converted.size);
    this.send(converted, title);
  }

  private send(file: File, title: string): void {
    this.uploadState.set({ status: 'uploading', percent: 0 });

    this.service.upload(file, title).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const percent = event.total ? Math.round((100 * event.loaded) / event.total) : null;
          this.uploadState.set({ status: 'uploading', percent });
          return;
        }
        if (event.type !== HttpEventType.Response || !event.body) return;

        const track = event.body;
        console.debug('[MediaLibrary] Piste envoyée', track.id);
        this.title.enable();
        this.title.setValue('');
        this.file = undefined;
        this.fileWarning.set('');
        // `file = undefined` ne vide pas le champ natif : on le réinitialise aussi.
        const input = this.fileInput()?.nativeElement;
        if (input) input.value = '';
        this.uploadState.set({ status: 'success', title: track.title });
        // Recharge la première page pour voir immédiatement le nouveau morceau.
        this.page.set(1);
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        console.error('[MediaLibrary] Envoi impossible', error.status);
        this.title.enable();
        this.uploadState.set({
          status: 'error',
          message: this.extractErrorMessage(error, this.t('upload.failed')),
        });
      },
    });
  }

  // --- Envoi d'un dossier entier ------------------------------------------------

  /** Dossier choisi pour l'envoi : fichiers acceptés, taille totale, fichiers ignorés. */
  readonly folderPlan = signal<{ folder: string; files: File[]; size: number; skipped: string[] } | null>(null);
  readonly folderProgress = signal<{ done: number; total: number; name: string } | null>(null);
  readonly folderMessage = signal('');
  readonly folderError = signal('');
  private readonly folderInput = viewChild<ElementRef<HTMLInputElement>>('folderInput');

  chooseUploadFolder(event: Event): void {
    const chosen = readFolder(Array.from((event.target as HTMLInputElement).files ?? []));
    this.folderMessage.set('');
    this.folderError.set('');
    if (!chosen) {
      this.folderPlan.set(null);
      return;
    }
    const files = chosen.files.filter((entry) => this.validateFile(entry.file) === null).map((entry) => entry.file);
    const skipped = chosen.files.filter((entry) => this.validateFile(entry.file) !== null).map((entry) => entry.path);
    this.folderPlan.set({
      folder: chosen.folder,
      files,
      size: files.reduce((total, file) => total + file.size, 0),
      skipped,
    });
  }

  /**
   * Envoie les fichiers du dossier un par un, comme des envois ordinaires
   * (conversion MOV/AVI/MKV comprise), avec le nom du dossier. Pas de limite
   * de nombre : si le stockage gratuit est plein (507), l'envoi s'arrête et
   * le message du serveur explique pourquoi.
   */
  async uploadFolder(): Promise<void> {
    const plan = this.folderPlan();
    if (!plan || plan.files.length === 0 || this.busy()) return;
    this.folderMessage.set('');
    this.folderError.set('');
    this.title.disable();

    let done = 0;
    try {
      for (const file of plan.files) {
        this.folderProgress.set({ done, total: plan.files.length, name: file.name });
        let toSend = file;
        if (needsConversion(file)) {
          this.uploadState.set({ status: 'converting', percent: null });
          toSend = await this.converter.toMp4(file, (percent) => this.uploadState.set({ status: 'converting', percent }));
        }
        await this.uploadOne(toSend, file.name, plan.folder);
        done += 1;
      }
      this.folderMessage.set(this.t('upload.folderDone', { folder: plan.folder, count: done }));
    } catch (error) {
      console.error('[MediaLibrary] Envoi du dossier arrêté', error);
      const reason =
        error instanceof HttpErrorResponse
          ? this.server(this.extractErrorMessage(error, this.t('upload.failed')))
          : this.t('upload.conversionFailed');
      this.folderError.set(this.t('upload.folderStopped', { done, reason }));
    } finally {
      this.folderProgress.set(null);
      this.uploadState.set({ status: 'idle' });
      this.title.enable();
      this.folderPlan.set(null);
      const input = this.folderInput()?.nativeElement;
      if (input) input.value = '';
      this.page.set(1);
      this.load();
    }
  }

  /** Un envoi, sous forme de promesse, avec la même barre de progression que l'envoi simple. */
  private uploadOne(file: File, title: string, folder: string): Promise<unknown> {
    this.uploadState.set({ status: 'uploading', percent: 0 });
    return firstValueFrom(
      this.service.upload(file, title, folder).pipe(
        tap((event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const percent = event.total ? Math.round((100 * event.loaded) / event.total) : null;
            this.uploadState.set({ status: 'uploading', percent });
          }
        }),
        filter((event) => event.type === HttpEventType.Response),
      ),
    );
  }

  // --- Téléchargement -------------------------------------------------------------

  /**
   * Télécharge un média envoyé sous son nom d'origine. Avec Backblaze B2,
   * chaque téléchargement compte dans le quota gratuit de 1 Go par jour.
   */
  download(track: Media): void {
    this.service.downloadUrl(track.id).subscribe({
      next: ({ url }) => {
        const link = document.createElement('a');
        link.href = url;
        link.download = track.originalName.split('/').pop() || track.title;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
      },
      error: (error: HttpErrorResponse) => {
        console.error('[MediaLibrary] Téléchargement impossible', error.status);
        this.notify(this.extractErrorMessage(error, this.t('library.downloadFailed')));
      },
    });
  }

  /** Un média local vient d'être ajouté : il apparaît en tête de la première page. */
  onLocalDeclared(): void {
    this.page.set(1);
    this.load();
  }

  formatDuration = formatDuration;

  // --- Lecture -----------------------------------------------------------

  /**
   * La bibliothèque ne lit rien elle-même : elle signale le média choisi à la
   * page du salon, qui pilote le lecteur.
   */
  choosePlayback(media: Media): void {
    console.debug('[MediaLibrary] Média choisi pour la lecture', media.id);
    this.selected.emit(media);
  }

  // --- Suppression ---------------------------------------------------------

  /**
   * Flux : bouton Supprimer -> confirmation -> MediaService.remove ->
   * HttpClient.delete -> DELETE /api/tracks/:id -> 204 -> SnackBar + rechargement.
   *
   * Tous les participants peuvent supprimer un média du salon. Le backend
   * renvoie 404 quand le média n'existe plus (supprimé entre-temps par un
   * autre participant) : la ligne affichée est alors obsolète, donc on
   * prévient l'utilisateur et on recharge la liste.
   */
  remove(track: Media): void {
    // Empêche les doubles clics pendant qu'une suppression est en cours.
    if (this.deletingId()) return;
    if (!confirm(this.t('library.confirmDelete', { title: track.title }))) return;

    this.deletingId.set(track.id);

    this.service.remove(track.id).subscribe({
      next: () => {
        console.debug('[MediaLibrary] Piste supprimée', track.id);
        this.deletingId.set(null);
        this.removed.emit(track);
        this.notify(this.t('library.deleted', { title: track.title }));
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        console.error('[MediaLibrary] Suppression impossible', error.status);
        this.deletingId.set(null);
        if (error.status === 404) {
          this.removed.emit(track);
          this.notify(this.t('library.gone'));
          this.load();
          return;
        }
        this.notify(this.extractErrorMessage(error, this.t('library.deleteFailed')));
      },
    });
  }

  private notify(message: string): void {
    // Un message du serveur (en français) est traduit ; les autres le sont déjà.
    this.snackBar.open(this.server(message), 'OK', { duration: SNACKBAR_DURATION });
  }

  // --- Formatage pour l'affichage ----------------------------------------

  formatSize(bytes: number): string {
    if (bytes < 1024) return this.t('size.bytes', { n: bytes });
    const units = this.t('size.units').split(',');
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(this.i18n.locale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatMimeType(mimeType: string): string {
    return mimeType.replace(/^(audio|video)\//, '').toUpperCase();
  }

  private extractErrorMessage(error: HttpErrorResponse, fallback: string): string {
    const serverMessage = error?.error?.message;
    return typeof serverMessage === 'string' && serverMessage.length > 0 ? serverMessage : fallback;
  }
}
