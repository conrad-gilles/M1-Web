import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { io } from 'socket.io-client';
import { I18nService } from '../i18n/i18n.service';
import { Participant } from '../models/participant.model';
import { PlaybackChange } from '../models/playback-change.model';
import { CommandResult, PlaybackCommand } from '../models/playback-command.model';
import { PlaybackState } from '../models/playback-state.model';
import { Room } from '../models/room.model';
import { RoomSnapshot } from '../models/room-snapshot.model';
import { ClockSample, bestClockOffset } from '../sync/sync-math';

/** The part of a Socket.IO client socket this service relies on. */
export interface SyncSocket {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  disconnect(): unknown;
}

export type SyncSocketFactory = (token: string) => SyncSocket;

/**
 * Opens the WebSocket. Remplaçable dans les tests par un faux socket.
 * Sans URL, Socket.IO se connecte à l'origine de la page (proxy `ng serve` en
 * développement, même serveur Express en production).
 */
export const SYNC_SOCKET_FACTORY = new InjectionToken<SyncSocketFactory>('SYNC_SOCKET_FACTORY', {
  providedIn: 'root',
  factory: () => (token) => io({ auth: { token } }),
});

/** Nombre d'allers-retours utilisés pour mesurer le décalage d'horloge. */
const CLOCK_SAMPLES = 5;

export type SyncStatus = 'offline' | 'connecting' | 'online';

/**
 * Pourquoi le salon n'est plus accessible : fermé par l'hôte ou expiré
 * (`closed`), quitté par ce participant, éventuellement dans un autre onglet
 * (`left`), jeton expiré (`expired`) ou jeton refusé à la connexion (`refused`).
 */
export type RoomClosedReason = 'closed' | 'left' | 'expired' | 'refused';

/**
 * Real-time channel of a room: shared playback state, presence, clock offset.
 *
 * Le serveur est la seule source de vérité. Ce service envoie des commandes
 * et n'expose que l'état diffusé par le serveur : le lecteur n'applique jamais
 * directement un clic local.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly createSocket = inject(SYNC_SOCKET_FACTORY);
  private readonly i18n = inject(I18nService);
  private socket: SyncSocket | null = null;
  private version = -1;

  readonly status = signal<SyncStatus>('offline');
  readonly online = computed(() => this.status() === 'online');
  readonly playback = signal<PlaybackState | null>(null);
  readonly waitingFor = signal<Participant[]>([]);
  /** Participants actuellement connectés au salon. */
  readonly participants = signal<Participant[]>([]);
  /** Décalage mesuré entre l'horloge du serveur et l'horloge locale, en ms. */
  readonly clockOffset = signal(0);

  private readonly changeSubject = new Subject<PlaybackChange>();
  private readonly mediaChangedSubject = new Subject<void>();
  private readonly roomUpdatedSubject = new Subject<Room>();
  private readonly roomClosedSubject = new Subject<RoomClosedReason>();

  /** Chaque changement d'état, avec son auteur (pour les notices). */
  readonly changes$ = this.changeSubject.asObservable();
  /** Un média a été ajouté ou supprimé par un participant. */
  readonly mediaChanged$ = this.mediaChangedSubject.asObservable();
  /** Le salon a changé (nouveau code). */
  readonly roomUpdated$ = this.roomUpdatedSubject.asObservable();
  /** Le salon n'est plus accessible : fermé, expiré ou quitté. */
  readonly roomClosed$ = this.roomClosedSubject.asObservable();

  /** Heure du serveur estimée, en ms. */
  serverNow(): number {
    return Date.now() + this.clockOffset();
  }

  /** Ouvre le WebSocket du salon ; le jeton de salon authentifie la connexion. */
  connect(token: string): void {
    this.disconnect();
    this.status.set('connecting');
    const socket = this.createSocket(token);
    this.socket = socket;

    socket.on('connect', () => {
      console.debug('[Sync] Connecté');
      // À chaque (re)connexion : l'horloge est mesurée de nouveau.
      this.measureClock(socket);
    });

    // Premier message après chaque connexion : l'état courant du salon. Il est
    // toujours accepté, car un serveur redémarré repart de la version 0.
    socket.on('room:state', (snapshot: RoomSnapshot) => {
      this.version = snapshot.version;
      this.playback.set(snapshot.playback);
      this.waitingFor.set(snapshot.waitingFor);
      this.participants.set(snapshot.participants);
      this.status.set('online');
    });

    socket.on('playback:state', (change: PlaybackChange) => this.applyChange(change));
    socket.on('room:participants', (participants: Participant[]) => this.participants.set(participants));
    socket.on('media:changed', () => this.mediaChangedSubject.next());
    socket.on('room:updated', (room: Room) => this.roomUpdatedSubject.next(room));
    socket.on('room:closed', (event?: { reason?: RoomClosedReason }) =>
      this.roomClosedSubject.next(event?.reason ?? 'closed'),
    );

    socket.on('disconnect', (reason: string) => {
      console.warn('[Sync] Déconnecté', reason);
      // Socket.IO se reconnecte seul, sauf si le serveur a fermé la connexion.
      if (this.socket === socket) this.status.set(reason === 'io server disconnect' ? 'offline' : 'connecting');
    });

    socket.on('connect_error', (error: Error) => {
      console.error('[Sync] Connexion refusée ou impossible', error.message);
      // Un refus d'authentification est définitif : le salon n'est plus accessible.
      if (error.message === 'Salon fermé ou jeton invalide') this.roomClosedSubject.next('refused');
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.version = -1;
    this.status.set('offline');
    this.playback.set(null);
    this.waitingFor.set([]);
    this.participants.set([]);
  }

  /** Envoie une commande ; le nouvel état reviendra par "playback:state". */
  send(command: PlaybackCommand): Promise<CommandResult> {
    const socket = this.socket;
    if (!socket || !this.online()) {
      return Promise.resolve({ ok: false, message: this.i18n.t('sync.connectionLost') });
    }
    return new Promise((resolve) =>
      socket.emit('playback:command', command, (result: CommandResult) => {
        if (!result.ok) console.warn('[Sync] Commande refusée', command.type, result.message);
        resolve(result);
      }),
    );
  }

  /** Signale que ce lecteur est bloqué depuis plus de 0,5 s. */
  bufferStart(): void {
    this.socket?.emit('buffer:start');
  }

  /** Signale que ce lecteur peut de nouveau lire. */
  bufferEnd(): void {
    this.socket?.emit('buffer:end');
  }

  private applyChange(change: PlaybackChange): void {
    // Un message plus ancien que l'état connu est périmé : on l'écarte.
    if (change.version < this.version) return;
    this.waitingFor.set(change.waitingFor);
    if (change.version > this.version) {
      this.version = change.version;
      this.playback.set(change.playback);
    }
    this.changeSubject.next(change);
  }

  /** Quelques pings successifs ; on garde la mesure à l'aller-retour le plus court. */
  private measureClock(socket: SyncSocket): void {
    const samples: ClockSample[] = [];
    const ping = () => {
      const sentAt = Date.now();
      socket.emit('clock:ping', ({ serverTime }: { serverTime: number }) => {
        samples.push({ sentAt, receivedAt: Date.now(), serverTime });
        if (this.socket !== socket) return;
        this.clockOffset.set(bestClockOffset(samples));
        if (samples.length < CLOCK_SAMPLES) ping();
        else console.debug('[Sync] Décalage d’horloge mesuré', this.clockOffset(), 'ms');
      });
    };
    ping();
  }
}
