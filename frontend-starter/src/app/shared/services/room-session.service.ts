import { Injectable, computed, signal } from '@angular/core';
import { RoomAccess } from '../models/room-access.model';
import { RoomSession } from '../models/room-session.model';

const STORAGE_KEY = 'gpc_room_session';

/**
 * Holds the current room session (room token, participant, host token).
 *
 * La session vit dans sessionStorage : elle survit à un rechargement de la
 * page mais reste propre à l'onglet. Deux onglets du même navigateur sont donc
 * deux participants distincts, ce qui permet de tester un salon seul.
 */
@Injectable({ providedIn: 'root' })
export class RoomSessionService {
  readonly session = signal<RoomSession | null>(this.read());

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

  close(): void {
    sessionStorage.removeItem(STORAGE_KEY);
    this.session.set(null);
  }

  private store(session: RoomSession): void {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    this.session.set(session);
  }

  private read(): RoomSession | null {
    const raw = sessionStorage.getItem(STORAGE_KEY);
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
