import { Component, ElementRef, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Track } from '../../shared/models/track.model';
import { TrackService } from '../../shared/services/track.service';

/**
 * Formats audios acceptés par le backend (voir backend/src/app.js, la variable
 * `allowed`). Dupliquer cette liste côté frontend permet d'afficher une erreur
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
]);

/** Certains navigateurs ne renseignent pas `file.type` pour le m4a/wav : on
 * retombe alors sur l'extension du nom de fichier. */
const ACCEPTED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a']);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 Mo, identique au backend.

@Component({
  imports: [ReactiveFormsModule],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
})
export class TracksPageComponent implements OnDestroy {
  private readonly service = inject(TrackService);

  // --- Bibliothèque paginée (Mission 2) ---------------------------------
  readonly tracks = signal<Track[]>([]);
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
  readonly visibleTracks = computed(() => {
    const query = this.filterText().trim().toLowerCase();
    if (!query) return this.tracks();
    return this.tracks().filter((track) => track.title.toLowerCase().includes(query));
  });

  // --- Formulaire d'upload (Mission 3) -----------------------------------
  readonly title = new FormControl('', { nonNullable: true });
  readonly fileError = signal('');
  readonly uploading = signal(false);
  readonly uploadError = signal('');
  readonly uploadSuccess = signal('');
  /** Progression de l'envoi en pourcentage (0-100). */
  readonly uploadProgress = signal(0);
  file?: File;
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  // --- Lecture audio (Mission 3) -----------------------------------------
  readonly audioUrl = signal('');
  readonly playingTrackId = signal<string | null>(null);
  readonly playingTitle = signal('');
  readonly audioError = signal('');

  // --- Suppression (amélioration facultative) -----------------------------
  readonly deletingId = signal<string | null>(null);
  readonly deleteError = signal('');

  constructor() {
    this.load();
  }

  /**
   * Le composant ne conserve jamais plus d'une URL objet à la fois : elle est
   * révoquée dès qu'une nouvelle piste est chargée (voir `play`) et à la
   * destruction du composant, pour éviter une fuite mémoire côté navigateur.
   */
  ngOnDestroy(): void {
    const url = this.audioUrl();
    if (url) URL.revokeObjectURL(url);
  }

  choose(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selected = input.files?.[0];
    this.uploadError.set('');
    this.uploadSuccess.set('');

    if (!selected) {
      this.file = undefined;
      this.fileError.set('');
      return;
    }

    const validationError = this.validateFile(selected);
    if (validationError) {
      console.warn('[TracksPage] Fichier rejeté côté frontend', validationError);
      this.file = undefined;
      this.fileError.set(validationError);
      input.value = '';
      return;
    }

    this.file = selected;
    this.fileError.set('');
    console.debug('[TracksPage] Fichier sélectionné', this.file.name);
  }

  /**
   * Vérification frontend "meilleur effort" : elle améliore l'expérience en
   * évitant un aller-retour réseau inutile, mais le backend refait toujours
   * les mêmes contrôles (voir `fileFilter` et `limits.fileSize` dans
   * backend/src/app.js) car le frontend peut être contourné.
   */
  private validateFile(file: File): string | null {
    const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    const typeKnown = ACCEPTED_MIME_TYPES.has(file.type);
    const extensionKnown = ACCEPTED_EXTENSIONS.has(extension);

    if (!typeKnown && !extensionKnown) {
      return 'Format non supporté. Formats acceptés : MP3, WAV, OGG, M4A.';
    }
    if (file.size > MAX_FILE_SIZE) {
      return `Fichier trop volumineux (${this.formatSize(file.size)}). Taille maximale : 25 Mo.`;
    }
    return null;
  }

  // --- Bibliothèque paginée ------------------------------------------------

  /**
   * Flux : composant -> TrackService.list -> HttpClient.get -> GET
   * /api/tracks?page=...&limit=... . À chaque appel, une nouvelle requête
   * HTTP est envoyée avec la page demandée ; l'application ne récupère
   * jamais toutes les pistes pour les découper localement.
   */
  load(): void {
    this.loading.set(true);
    this.listError.set('');

    this.service.list(this.page()).subscribe({
      next: (response) => {
        console.debug('[TracksPage] Pistes chargées', response.items.length, 'page', response.page);
        this.tracks.set(response.items);
        this.pages.set(response.pages);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        console.error('[TracksPage] Chargement impossible', error);
        this.listError.set(this.extractErrorMessage(error, 'Impossible de charger la bibliothèque.'));
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

  upload(): void {
    // Empêche les doubles soumissions si l'utilisateur reclique pendant l'envoi.
    if (!this.file || this.uploading()) return;

    this.uploading.set(true);
    this.uploadProgress.set(0);
    this.uploadError.set('');
    this.uploadSuccess.set('');

    this.service.upload(this.file, this.title.value || this.file.name).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          if (event.total) this.uploadProgress.set(Math.round((100 * event.loaded) / event.total));
          return;
        }
        if (event.type !== HttpEventType.Response || !event.body) return;

        const track = event.body;
        console.debug('[TracksPage] Piste envoyée', track.id);
        this.uploading.set(false);
        this.uploadSuccess.set(`« ${track.title} » a été ajoutée à la bibliothèque.`);
        this.title.setValue('');
        this.file = undefined;
        // `file = undefined` ne vide pas le champ natif : on le réinitialise aussi.
        const input = this.fileInput()?.nativeElement;
        if (input) input.value = '';
        // Recharge la première page pour voir immédiatement le nouveau morceau.
        this.page.set(1);
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        console.error('[TracksPage] Envoi impossible', error);
        this.uploading.set(false);
        this.uploadError.set(this.extractErrorMessage(error, "Échec de l'envoi du fichier."));
      },
    });
  }

  // --- Lecture -----------------------------------------------------------

  /**
   * Flux : bouton Lire -> TrackService.audio -> HttpClient.get(responseType:
   * 'blob') -> GET /api/tracks/:id/audio (avec le JWT ajouté par
   * authInterceptor) -> Blob reçu en une fois -> URL.createObjectURL -> src
   * de l'élément <audio>. Une URL classique placée directement dans `src` ne
   * passerait pas par HttpClient et ne recevrait donc pas l'en-tête
   * Authorization ajouté par l'intercepteur : le serveur répondrait 401.
   */
  play(track: Track): void {
    this.audioError.set('');

    this.service.audio(track.id).subscribe({
      next: (blob) => {
        console.debug('[TracksPage] Audio chargé', track.id, blob.size, 'octets');
        const previousUrl = this.audioUrl();
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        this.audioUrl.set(URL.createObjectURL(blob));
        this.playingTrackId.set(track.id);
        this.playingTitle.set(track.title);
      },
      error: (error: HttpErrorResponse) => {
        console.error('[TracksPage] Lecture impossible', error);
        this.playingTrackId.set(null);
        this.playingTitle.set('');
        this.audioError.set(this.extractErrorMessage(error, 'Impossible de lire ce morceau.'));
      },
    });
  }

  /** Déclenché par l'événement (error) du lecteur HTML natif. */
  onPlaybackError(): void {
    console.error('[TracksPage] Le lecteur audio a signalé une erreur de décodage');
    this.audioError.set('Le fichier audio ne peut pas être décodé par le navigateur.');
    this.playingTrackId.set(null);
    this.playingTitle.set('');
  }

  onPlaybackEnded(): void {
    this.playingTrackId.set(null);
  }

  // --- Suppression (amélioration facultative) ---------------------------

  remove(track: Track): void {
    if (this.deletingId()) return;
    if (!confirm(`Supprimer définitivement « ${track.title} » ?`)) return;

    this.deletingId.set(track.id);
    this.deleteError.set('');

    this.service.remove(track.id).subscribe({
      next: () => {
        console.debug('[TracksPage] Piste supprimée', track.id);
        this.deletingId.set(null);
        if (this.playingTrackId() === track.id) {
          this.playingTrackId.set(null);
          this.playingTitle.set('');
          const url = this.audioUrl();
          if (url) URL.revokeObjectURL(url);
          this.audioUrl.set('');
        }
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        console.error('[TracksPage] Suppression impossible', error);
        this.deletingId.set(null);
        this.deleteError.set(this.extractErrorMessage(error, 'Impossible de supprimer cette piste.'));
      },
    });
  }

  // --- Formatage pour l'affichage ----------------------------------------

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} o`;
    const units = ['Ko', 'Mo', 'Go'];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatMimeType(mimeType: string): string {
    return mimeType.replace('audio/', '').toUpperCase();
  }

  private extractErrorMessage(error: HttpErrorResponse, fallback: string): string {
    const serverMessage = error?.error?.message;
    return typeof serverMessage === 'string' && serverMessage.length > 0 ? serverMessage : fallback;
  }
}
