import { Injectable, computed, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { RoomAccess } from '../models/room-access.model';
import { RoomSession } from '../models/room-session.model';

const STORAGE_KEY = 'sharing_platform_session';

/**
 * Holds the current room session (room token, participant, host token).
 *
 * La session vit dans localStorage : elle est partagée par tous les onglets
 * du navigateur et survit à leur fermeture. Une personne reste donc le même
 * participant d'un onglet à l'autre, et l'hôte garde ses droits s'il ferme
 * puis rouvre le salon. Pour tester seul à plusieurs, utiliser une fenêtre de
 * navigation privée ou un autre navigateur.
 */
@Injectable({ providedIn: 'root' })
export class RoomSessionService {
  readonly session = signal<RoomSession | null>(this.read());

  private readonly changedElsewhereSubject = new Subject<RoomSession | null>();
  /**
   * La session a été modifiée dans un autre onglet (salon quitté, autre salon
   * rejoint). N'émet jamais pour les changements faits dans cet onglet.
   */
  readonly changedElsewhere$ = this.changedElsewhereSubject.asObservable();

  constructor() {
    // L'événement "storage" n'est déclenché que dans les AUTRES onglets.
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const session = this.read();
      this.session.set(session);
      this.changedElsewhereSubject.next(session);
    });
  }

  readonly token = computed(() => this.session()?.token ?? null);
  readonly isHost = computed(() => Boolean(this.session()?.hostToken));

  /** Mémorise la session reçue après la création ou l'entrée dans un salon. */
  open(access: RoomAccess): void {
    this.store({
      code: access.room.code,
      token: access.token,
      participant: access.participant,
      ...(access.hostToken ? { hostToken: access.hostToken } : {}),
    });
  }

  /** L'hôte peut changer le code du salon : la session suit. */
  updateCode(code: string): void {
    const current = this.session();
    if (current && current.code !== code) this.store({ ...current, code });
  }

  /**
   * Relit la session dans localStorage, sans attendre l'événement "storage"
   * (qui peut arriver après un message du serveur).
   */
  refresh(): RoomSession | null {
    const session = this.read();
    this.session.set(session);
    return session;
  }

  close(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.session.set(null);
  }

  private store(session: RoomSession): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    this.session.set(session);
  }

  private read(): RoomSession | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return isRoomSession(value) ? value : null;
    } catch (error) {
      console.warn('[RoomSession] Session illisible, ignorée', error);
      return null;
    }
  }
}

function isRoomSession(value: unknown): value is RoomSession {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Partial<RoomSession>;
  return (
    typeof session.code === 'string' &&
    typeof session.token === 'string' &&
    typeof session.participant?.id === 'string' &&
    typeof session.participant?.name === 'string'
  );
}
