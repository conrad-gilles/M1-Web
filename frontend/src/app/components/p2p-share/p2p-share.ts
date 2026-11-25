import { Component, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { I18nService } from '../../shared/i18n/i18n.service';
import { LocalFileInfo, formatDuration } from '../../shared/local-media/local-media';
import { Media } from '../../shared/models/media.model';
import { P2pService } from '../../shared/p2p/p2p.service';
import { LocalFilesService } from '../../shared/services/local-files.service';
import { MediaService } from '../../shared/services/media.service';

/**
 * « Partager en direct (P2P) » : le fichier reste sur l'appareil de celui qui
 * le partage et part directement vers les autres navigateurs (WebRTC), en
 * qualité d'origine. Fonction distincte de l'envoi et des fichiers locaux.
 */
@Component({
  selector: 'app-p2p-share',
  imports: [ReactiveFormsModule],
  templateUrl: './p2p-share.html',
  styleUrl: '../media-library/media-library.css',
})
export class P2pShareComponent {
  private readonly media = inject(MediaService);
  private readonly localFiles = inject(LocalFilesService);
  private readonly p2p = inject(P2pService);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t;
  readonly server = this.i18n.server;

  /** Émis quand le partage a été ajouté au salon. */
  readonly shared = output<Media>();

  readonly title = new FormControl('', { nonNullable: true });
  readonly file = signal<File | null>(null);
  readonly info = signal<LocalFileInfo | null>(null);
  readonly reading = signal(false);
  readonly sending = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('p2pInput');

  formatDuration = formatDuration;

  /** Le navigateur lit la durée du fichier (le lecteur de la salle la connaît ainsi d'avance). */
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
    } catch (error) {
      console.warn('[P2pShare] Fichier illisible', error);
      this.file.set(null);
      this.error.set(this.t('local.unreadable'));
    } finally {
      this.reading.set(false);
    }
  }

  share(): void {
    const file = this.file();
    const info = this.info();
    if (!file || !info || this.sending()) return;
    this.sending.set(true);
    this.error.set('');
    this.media
      .declareP2p({
        title: this.title.value.trim() || file.name,
        duration: info.duration,
        kind: info.kind,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
      })
      .subscribe({
        next: (media) => {
          // Le fichier reste ici : c'est cette page qui le diffusera aux autres.
          this.p2p.share(media.id, file);
          this.localFiles.remember(media.id, { file, info });
          this.sending.set(false);
          this.success.set(this.t('p2p.success', { title: media.title }));
          this.title.setValue('');
          this.file.set(null);
          this.info.set(null);
          const input = this.fileInput()?.nativeElement;
          if (input) input.value = '';
          this.shared.emit(media);
        },
        error: (error: HttpErrorResponse) => {
          console.error('[P2pShare] Partage impossible', error.status);
          this.sending.set(false);
          const message: unknown = error.error?.message;
          this.error.set(typeof message === 'string' ? message : this.t('p2p.failed'));
        },
      });
  }
}
