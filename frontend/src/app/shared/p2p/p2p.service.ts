import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Media } from '../models/media.model';
import { SyncService } from '../services/sync.service';
import { FileChannel, FileClient, P2pError, serveChannel } from './p2p-transfer';

/** Serveur STUN public et gratuit : il aide deux navigateurs à se trouver. Pas de TURN (payant). */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
/** Sans canal ouvert passé ce délai, la connexion directe est jugée impossible. */
const CONNECT_TIMEOUT_MS = 15_000;
/** Adresse que le lecteur charge ; le service worker la sert depuis le pair. */
const STREAM_PREFIX = '/p2p-stream/';

interface Peer {
  connection: RTCPeerConnection;
  /** Spectateur : client du canal vers celui qui partage. */
  client?: Promise<FileClient>;
  /** Candidats ICE arrivés avant la description distante. */
  queued: RTCIceCandidateInit[];
}

type Signal = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

/**
 * Partage direct (P2P) entre navigateurs, sans serveur pour le fichier :
 *
 * - celui qui partage garde ses fichiers ici (`share`) et répond aux demandes
 *   d'octets reçues sur un canal de données WebRTC (voir p2p-transfer.ts) ;
 * - le spectateur ouvre la connexion (offre WebRTC relayée par Socket.IO),
 *   puis son lecteur charge `/p2p-stream/<média>` : le service worker
 *   (public/p2p-sw.js) transforme chaque requête Range du lecteur en demande
 *   d'octets au pair. Mise en mémoire tampon, déplacement et qualité
 *   d'origine sont donc ceux d'un fichier ordinaire.
 */
@Injectable({ providedIn: 'root' })
export class P2pService {
  private readonly sync = inject(SyncService);
  /** Fichiers partagés par ce participant : identifiant de média -> fichier. */
  private readonly shared = new Map<string, File>();
  private readonly peers = new Map<string, Peer>();
  /** Médias en lecture chez ce spectateur : identifiant -> qui partage et taille. */
  private readonly streams = new Map<string, { ownerId: string; size: number; mime: string }>();
  /** Identifiant de cette page, pour que le service worker s'adresse à elle. */
  readonly pageId = crypto.randomUUID();
  private worker?: Promise<void>;

  constructor() {
    this.sync.signals$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(({ from, data }) => {
      void this.onSignal(from, data as Signal).catch((error) => console.error('[P2P] Signal ignoré', error));
    });
    navigator.serviceWorker?.addEventListener('message', (event) => this.onWorkerRequest(event));
  }

  // --- Celui qui partage ---------------------------------------------------------------

  share(mediaId: string, file: File): void {
    this.shared.set(mediaId, file);
  }

  sharedFile(mediaId: string): File | undefined {
    return this.shared.get(mediaId);
  }

  // --- Spectateur --------------------------------------------------------------------------

  /**
   * Prépare la lecture d'un média partagé par un autre participant : service
   * worker actif, connexion directe ouverte, taille du fichier connue.
   * Renvoie l'adresse à donner au lecteur. Échoue avec une P2pError.
   */
  async prepare(media: Media): Promise<string> {
    const ownerId = media.owner?.id;
    if (!ownerId) throw new P2pError('failed');
    if (!this.sync.participants().some((participant) => participant.id === ownerId)) throw new P2pError('offline');
    await this.ensureWorker();
    const client = await this.clientFor(ownerId);
    const { size, mime } = await client.info(media.id);
    this.streams.set(media.id, { ownerId, size, mime });
    return `${STREAM_PREFIX}${media.id}?page=${this.pageId}`;
  }

  /** Oublie la connexion à un pair (pour réessayer après un échec). */
  forget(ownerId: string): void {
    this.peers.get(ownerId)?.connection.close();
    this.peers.delete(ownerId);
  }

  private clientFor(ownerId: string): Promise<FileClient> {
    const existing = this.peers.get(ownerId);
    if (existing?.client) return existing.client;

    const peer = this.newPeer(ownerId);
    const channel = peer.connection.createDataChannel('fichier', { ordered: true });
    channel.binaryType = 'arraybuffer';
    peer.client = new Promise<FileClient>((resolve, reject) => {
      const timer = setTimeout(() => {
        console.warn('[P2P] Connexion directe impossible avec', ownerId);
        this.forget(ownerId);
        reject(new P2pError('failed'));
      }, CONNECT_TIMEOUT_MS);
      channel.addEventListener('open', () => {
        clearTimeout(timer);
        console.debug('[P2P] Canal ouvert avec', ownerId);
        resolve(new FileClient(channel as unknown as FileChannel));
      });
    });
    peer.client.catch(() => undefined); // l'erreur est remontée par prepare()

    void (async () => {
      const offer = await peer.connection.createOffer();
      await peer.connection.setLocalDescription(offer);
      this.sync.sendSignal(ownerId, { sdp: peer.connection.localDescription!.toJSON() });
    })();
    return peer.client;
  }

  private newPeer(remoteId: string): Peer {
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { connection, queued: [] };
    connection.addEventListener('icecandidate', (event) => {
      if (event.candidate) this.sync.sendSignal(remoteId, { candidate: event.candidate.toJSON() });
    });
    connection.addEventListener('connectionstatechange', () => {
      if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
        if (this.peers.get(remoteId) === peer) this.peers.delete(remoteId);
      }
    });
    this.peers.set(remoteId, peer);
    return peer;
  }

  /** Offre, réponse et candidats relayés par le serveur. */
  private async onSignal(from: string, data: Signal): Promise<void> {
    if (data.sdp?.type === 'offer') {
      // Un spectateur se connecte à ce participant : on répond et on sert ses demandes.
      this.forget(from);
      const peer = this.newPeer(from);
      peer.connection.addEventListener('datachannel', (event) => {
        event.channel.binaryType = 'arraybuffer';
        serveChannel(event.channel as unknown as FileChannel, (mediaId) => this.shared.get(mediaId));
      });
      await peer.connection.setRemoteDescription(data.sdp);
      await this.flushCandidates(peer);
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
      this.sync.sendSignal(from, { sdp: peer.connection.localDescription!.toJSON() });
      return;
    }
    const peer = this.peers.get(from);
    if (!peer) return;
    if (data.sdp?.type === 'answer') {
      await peer.connection.setRemoteDescription(data.sdp);
      await this.flushCandidates(peer);
    } else if (data.candidate) {
      if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(data.candidate);
      else peer.queued.push(data.candidate);
    }
  }

  private async flushCandidates(peer: Peer): Promise<void> {
    for (const candidate of peer.queued.splice(0)) await peer.connection.addIceCandidate(candidate);
  }

  // --- Pont avec le service worker -----------------------------------------------------------

  /** Enregistre le service worker et attend qu'il contrôle la page. */
  private ensureWorker(): Promise<void> {
    this.worker ??= (async () => {
      if (!('serviceWorker' in navigator)) throw new P2pError('failed');
      await navigator.serviceWorker.register('/p2p-sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }),
        );
      }
    })().catch((error) => {
      this.worker = undefined;
      throw error;
    });
    return this.worker;
  }

  /**
   * Le service worker transmet une requête Range du lecteur : on demande ces
   * octets au pair et on répond par le port fourni.
   */
  private onWorkerRequest(event: MessageEvent): void {
    const message = event.data as { type?: string; page?: string; mediaId?: string; start?: number; end?: number | null };
    const port = event.ports[0];
    if (message?.type !== 'p2p-range' || !port) return;
    if (message.page !== this.pageId) return port.postMessage({ skip: true });

    const stream = this.streams.get(message.mediaId ?? '');
    if (!stream) return port.postMessage({ error: 'unknown' });
    void this.clientFor(stream.ownerId)
      .then((client) => client.range(message.mediaId!, message.start ?? 0, message.end ?? null))
      .then((answer) =>
        port.postMessage({ start: answer.start, end: answer.end, total: answer.total, mime: stream.mime, body: answer.bytes.buffer }, [
          answer.bytes.buffer,
        ]),
      )
      .catch((error: unknown) => {
        console.warn('[P2P] Octets indisponibles', error);
        port.postMessage({ error: error instanceof P2pError ? error.code : 'failed' });
      });
  }
}
