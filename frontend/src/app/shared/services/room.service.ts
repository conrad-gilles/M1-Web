import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { Room } from '../models/room.model';
import { RoomAccess } from '../models/room-access.model';
import { RoomSessionService } from './room-session.service';

/** Encapsulates all HTTP operations for rooms. */
@Injectable({ providedIn: 'root' })
export class RoomService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(RoomSessionService);

  /** Crée un salon ; l'appelant en devient l'hôte. */
  create(name: string) {
    return this.http
      .post<RoomAccess>('/api/rooms', { name })
      .pipe(tap((access) => this.session.open(access)));
  }

  /** Rejoint un salon avec son code et un nom d'affichage. */
  join(code: string, name: string) {
    return this.http
      .post<RoomAccess>(`/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`, { name })
      .pipe(tap((access) => this.session.open(access)));
  }

  /** Salon désigné par le jeton de la session courante. */
  current() {
    return this.http
      .get<Room>('/api/rooms/current')
      .pipe(tap((room) => this.session.updateCode(room.code)));
  }

  leave() {
    return this.http
      .post<void>('/api/rooms/current/leave', null)
      .pipe(tap(() => this.session.close()));
  }

  /** Réservé à l'hôte : tire un nouveau code pour le salon. */
  changeCode() {
    return this.http
      .post<Room>('/api/rooms/current/code', null, { headers: this.hostHeaders() })
      .pipe(tap((room) => this.session.updateCode(room.code)));
  }

  /** Réservé à l'hôte : ferme le salon et supprime ses médias. */
  close() {
    return this.http
      .delete<void>('/api/rooms/current', { headers: this.hostHeaders() })
      .pipe(tap(() => this.session.close()));
  }

  private hostHeaders(): Record<string, string> {
    const hostToken = this.session.session()?.hostToken;
    return hostToken ? { 'X-Host-Token': hostToken } : {};
  }
}
