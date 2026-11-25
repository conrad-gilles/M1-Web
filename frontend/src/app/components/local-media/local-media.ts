import { Component, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { I18nService } from '../../shared/i18n/i18n.service';
import { Media } from '../../shared/models/media.model';
import { firstValueFrom } from 'rxjs';
import { LocalFileInfo, formatDuration } from '../../shared/local-media/local-media';
import { ProbedFile, matchFolder, readFolder } from '../../shared/local-media/local-folder';
import { LocalFilesService } from '../../shared/services/local-files.service';
import { MediaService } from '../../shared/services/media.service';

/**
 * « Synchroniser un fichier local » : ajoute au salon un média qui n'est
 * jamais envoyé. Seuls son titre, sa durée et son type partent au serveur ;
 * à la lecture, chaque participant choisit sa propre copie, reconnue à sa
 * durée. C'est une fonction distincte de l'upload, qui reste disponible.
 */
@Component({
  selector: 'app-local-media',
  imports: [ReactiveFormsModule],
  templateUrl: './local-media.html',
  styleUrl: '../media-library/media-library.css',
})
export class LocalMediaComponent {
  private readonly media = inject(MediaService);
  private readonly localFiles = inject(LocalFilesService);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t;
  readonly server = this.i18n.server;

  /** Émis quand le média local a été ajouté au salon. */
  readonly declared = output<Media>();

  readonly title = new FormControl('', { nonNullable: true });
  readonly file = signal<File | null>(null);
  readonly info = signal<LocalFileInfo | null>(null);
  readonly reading = signal(false);
  readonly sending = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('localInput');

  formatDuration = formatDuration;

  // --- Dossier local ----------------------------------------------------------
  readonly folderBusy = signal(false);
  readonly folderProgress = signal<{ done: number; total: number } | null>(null);
  readonly folderResult = signal('');
  readonly folderProblems = signal<string[]>([]);
  readonly folderError = signal('');

  /**
   * Flux : dossier choisi -> durée de chaque fichier lue dans le navigateur ->
   * GET /api/media/folder (médias du salon dans un dossier de même nom) ->
   * mêmes chemin et durée : reliés à ce participant ; inconnus du salon :
   * déclarés (POST /api/media/local-folder) ; durée différente : signalés.
   * Aucun fichier n'est envoyé.
   */
  async chooseFolder(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const chosen = readFolder(Array.from(input.files ?? []));
    this.folderResult.set('');
    this.folderProblems.set([]);
    this.folderError.set('');
    if (!chosen) return;
    if (chosen.files.length === 0) {
      this.folderError.set(this.t('local.folderEmpty'));
      input.value = '';
      return;
    }

    this.folderBusy.set(true);
    try {
      const probed: ProbedFile[] = [];
      const unreadable: string[] = [];
      this.folderProgress.set({ done: 0, total: chosen.files.length });
      for (const entry of chosen.files) {
        try {
          probed.push({ ...entry, info: await this.localFiles.probe(entry.file) });
        } catch {
          unreadable.push(entry.path);
        }
        this.folderProgress.set({ done: probed.length + unreadable.length, total: chosen.files.length });
      }

      const room = await firstValueFrom(this.media.folder(chosen.folder));
      const match = matchFolder(room, probed);
      this.localFiles.rememberFolder(chosen.folder, chosen.files);
      for (const { media, file } of match.linked) this.localFiles.remember(media.id, file);

      let added: Media[] = [];
      if (match.added.length > 0) {
        added = await firstValueFrom(
          this.media.declareLocalFolder(
            chosen.folder,
            match.added.map((file) => ({
              originalName: file.path,
              duration: file.info.duration,
              kind: file.info.kind,
              mimeType: file.file.type,
              size: file.file.size,
            })),
          ),
        );
        const byPath = new Map(match.added.map((file) => [file.path, file]));
        for (const media of added) {
          const file = byPath.get(media.originalName);
          if (file) this.localFiles.remember(media.id, file);
        }
      }

      console.debug('[LocalMedia] Dossier synchronisé', chosen.folder, match);
      this.folderResult.set(
        this.t('local.folderDone', { folder: chosen.folder, linked: match.linked.length, added: added.length }),
      );
      const problems: string[] = [];
      if (match.mismatched.length > 0) {
        problems.push(this.t('local.folderMismatch', { files: match.mismatched.map((m) => m.file.path).join(', ') }));
      }
      if (unreadable.length > 0) problems.push(this.t('local.folderUnreadable', { files: unreadable.join(', ') }));
      this.folderProblems.set(problems);
      if (added.length > 0) this.declared.emit(added[0]);
    } catch (error) {
      console.error('[LocalMedia] Dossier impossible à synchroniser', error);
      const message: unknown = error instanceof HttpErrorResponse ? error.error?.message : null;
      this.folderError.set(typeof message === 'string' ? message : this.t('local.folderFailed'));
    } finally {
      this.folderBusy.set(false);
      this.folderProgress.set(null);
      input.value = '';
    }
  }

  /** Le navigateur lit la durée du fichier, sans rien envoyer. */
  async choose(event: Event): Promise<void> {
    const selected = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.file.set(selected);
    this.info.set(null);
    this.error.set('');
    this.success.set('');
    if (!selected) return;

    this.reading.set(true);
    try {
      this.info.set(await this.localFiles.probe(selected));
      console.debug('[LocalMedia] Durée lue', selected.name, this.info());
    } catch (error) {
      console.warn('[LocalMedia] Fichier illisible', error);
      this.file.set(null);
      this.error.set(this.t('local.unreadable'));
    } finally {
      this.reading.set(false);
    }
  }

  declare(): void {
    const file = this.file();
    const info = this.info();
    if (!file || !info || this.sending()) return;

    const title = this.title.value.trim() || file.name;
    this.sending.set(true);
    this.error.set('');
    this.media
      .declareLocal({
        title,
        duration: info.duration,
        kind: info.kind,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
      })
      .subscribe({
        next: (media) => {
          // Celui qui déclare le fichier n'aura pas à le choisir une seconde fois.
          this.localFiles.remember(media.id, { file, info });
          this.sending.set(false);
          this.success.set(this.t('local.success', { title: media.title }));
          this.title.setValue('');
          this.file.set(null);
          this.info.set(null);
          const input = this.fileInput()?.nativeElement;
          if (input) input.value = '';
          this.declared.emit(media);
        },
        error: (error: HttpErrorResponse) => {
          console.error('[LocalMedia] Déclaration impossible', error.status);
          this.sending.set(false);
          const message: unknown = error.error?.message;
          this.error.set(typeof message === 'string' ? message : this.t('local.failed'));
        },
      });
  }
}
