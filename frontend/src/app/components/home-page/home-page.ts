import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RoomAccess } from '../../shared/models/room-access.model';
import { RoomService } from '../../shared/services/room.service';
import { RoomSessionService } from '../../shared/services/room-session.service';

/** Le nom d'affichage est mémorisé pour éviter de le ressaisir à chaque salon. */
const NAME_KEY = 'sharing_platform_name';
const MAX_NAME_LENGTH = 30; // identique au backend (backend/src/config.js)
const CODE_PATTERN = /^\s*[A-Za-z0-9]{6}\s*$/;

type PendingAction = 'create' | 'join' | null;

/** Entry point: create a room or join one with its code. No account needed. */
@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePageComponent {
  private readonly rooms = inject(RoomService);
  private readonly router = inject(Router);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  readonly session = inject(RoomSessionService).session;
  readonly pending = signal<PendingAction>(null);
  readonly createError = signal('');
  readonly joinError = signal('');
  /** Vrai quand on arrive ici parce que le salon précédent n'existe plus. */
  readonly roomClosed = this.query.has('closed');

  private readonly nameValidators = [
    Validators.required,
    Validators.maxLength(MAX_NAME_LENGTH),
    Validators.pattern(/\S/),
  ];

  readonly createForm = new FormGroup({
    name: new FormControl(this.rememberedName(), {
      nonNullable: true,
      validators: this.nameValidators,
    }),
  });

  readonly joinForm = new FormGroup({
    // Un lien partagé (/rooms/K7P2QX) arrive ici avec le code prérempli.
    code: new FormControl(this.query.get('code') ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(CODE_PATTERN)],
    }),
    name: new FormControl(this.rememberedName(), {
      nonNullable: true,
      validators: this.nameValidators,
    }),
  });

  create(): void {
    if (this.createForm.invalid || this.pending()) return;
    const name = this.createForm.controls.name.value.trim();

    this.pending.set('create');
    this.createError.set('');
    this.rooms.create(name).subscribe({
      next: (access) => this.enter(access, name),
      error: (error: HttpErrorResponse) => {
        console.error('[HomePage] Création du salon impossible', error.status);
        this.pending.set(null);
        this.createError.set(this.messageOf(error, 'Impossible de créer le salon.'));
      },
    });
  }

  join(): void {
    if (this.joinForm.invalid || this.pending()) return;
    const { code, name } = this.joinForm.getRawValue();

    this.pending.set('join');
    this.joinError.set('');
    this.rooms.join(code, name.trim()).subscribe({
      next: (access) => this.enter(access, name.trim()),
      error: (error: HttpErrorResponse) => {
        console.error('[HomePage] Entrée dans le salon impossible', error.status);
        this.pending.set(null);
        this.joinError.set(this.messageOf(error, 'Impossible de rejoindre le salon.'));
      },
    });
  }

  private enter(access: RoomAccess, name: string): void {
    console.debug('[HomePage] Entrée dans le salon', access.room.code);
    localStorage.setItem(NAME_KEY, name);
    this.pending.set(null);
    void this.router.navigate(['/rooms', access.room.code]);
  }

  private rememberedName(): string {
    return localStorage.getItem(NAME_KEY) ?? '';
  }

  private messageOf(error: HttpErrorResponse, fallback: string): string {
    const serverMessage: unknown = error.error?.message;
    return typeof serverMessage === 'string' && serverMessage.length > 0 ? serverMessage : fallback;
  }
}
