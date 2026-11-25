import { Component, ElementRef, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { I18nService } from '../../shared/i18n/i18n.service';
import { RoomSessionService } from '../../shared/services/room-session.service';
import { SyncService } from '../../shared/services/sync.service';

/** Identique au backend (backend/src/sync/chat.js). */
export const MAX_CHAT_LENGTH = 500;

/**
 * Discussion du salon, en temps réel par le WebSocket du salon. Le serveur
 * vérifie et horodate chaque message, et donne l'auteur d'après le jeton.
 * Les messages sont affichés comme du texte (interpolation Angular), jamais
 * comme du HTML.
 */
@Component({
  selector: 'app-chat',
  imports: [ReactiveFormsModule],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
})
export class ChatComponent {
  private readonly sync = inject(SyncService);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t;
  readonly server = this.i18n.server;
  private readonly session = inject(RoomSessionService).session;

  readonly messages = this.sync.chatMessages;
  readonly online = this.sync.online;
  readonly sending = signal(false);
  readonly error = signal('');
  readonly maxLength = MAX_CHAT_LENGTH;
  readonly text = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(MAX_CHAT_LENGTH), Validators.pattern(/\S/)],
  });
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // Nouveau message : la liste défile jusqu'au plus récent.
    effect(() => {
      this.messages();
      const list = this.list()?.nativeElement;
      untracked(() => queueMicrotask(() => list && (list.scrollTop = list.scrollHeight)));
    });
  }

  isMine(authorId: string): boolean {
    return authorId === this.session()?.participant.id;
  }

  /** Heure du message (heure du serveur), selon la langue choisie. */
  time(at: number): string {
    return new Date(at).toLocaleTimeString(this.i18n.locale(), { hour: '2-digit', minute: '2-digit' });
  }

  send(): void {
    if (this.text.invalid || this.sending()) return;
    this.sending.set(true);
    this.error.set('');
    void this.sync.sendChat(this.text.value).then((result) => {
      this.sending.set(false);
      if (result.ok) this.text.setValue('');
      else this.error.set(result.message ?? this.t('chat.failed'));
    });
  }
}
