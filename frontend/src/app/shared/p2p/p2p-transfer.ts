/*
 * Partage direct (P2P) : protocole de transfert sur un canal de données
 * WebRTC, indépendant de WebRTC lui-même (testé avec de faux canaux reliés).
 *
 * Le spectateur demande la taille du fichier (`info`), puis des plages
 * d'octets (`range`), comme le ferait un lecteur vidéo auprès d'un serveur.
 * Celui qui partage répond `begin`, envoie les octets en morceaux binaires de
 * 64 Ko, puis `end`. Le canal est fiable et ordonné : les morceaux arrivent
 * dans l'ordre, une réponse à la fois.
 */

/** Taille d'un morceau binaire (sûre pour tous les navigateurs). */
export const CHUNK_BYTES = 64 * 1024;
/** Une requête ne reçoit pas plus que cela : le lecteur redemande la suite. */
export const MAX_RANGE_BYTES = 4 * 1024 * 1024;
/** Au-delà, celui qui partage attend que le canal se vide (contre-pression). */
const HIGH_WATER_BYTES = 8 * 1024 * 1024;
const LOW_WATER_BYTES = 1024 * 1024;

/** Ce que ce module utilise d'un RTCDataChannel. */
export interface FileChannel {
  send(data: string | ArrayBuffer): void;
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  addEventListener(type: 'message', listener: (event: { data: string | ArrayBuffer }) => void): void;
  addEventListener(type: 'bufferedamountlow' | 'close', listener: () => void): void;
}

type RequestBody = { t: 'info'; mediaId: string } | { t: 'range'; mediaId: string; start: number; end: number };
type Request = RequestBody & { req: number };
type Reply =
  | { t: 'info'; req: number; size: number; mime: string }
  | { t: 'begin'; req: number; start: number; end: number; total: number }
  | { t: 'end'; req: number }
  | { t: 'error'; req: number; code: 'not-shared' | 'bad-range' };

/** Erreur de transfert, avec un code que l'interface sait expliquer. */
export class P2pError extends Error {
  constructor(readonly code: 'not-shared' | 'bad-range' | 'closed' | 'failed' | 'offline') {
    super(`Partage direct : ${code}`);
  }
}

/**
 * Plage demandée, bornée au fichier et à MAX_RANGE_BYTES (fin incluse, comme
 * l'en-tête HTTP Range). Null si elle commence après la fin du fichier.
 */
export function clampRange(start: number, end: number | null, size: number): { start: number; end: number } | null {
  if (!Number.isInteger(start) || start < 0 || start >= size) return null;
  const last = Math.min(size - 1, end ?? size - 1, start + MAX_RANGE_BYTES - 1);
  return last < start ? null : { start, end: last };
}

// --- Côté celui qui partage -----------------------------------------------------------

/**
 * Répond aux demandes reçues sur un canal, à partir des fichiers partagés
 * (`fileFor` : identifiant de média -> fichier, ou undefined s'il n'est plus
 * partagé, par exemple après un rechargement de la page).
 */
export function serveChannel(channel: FileChannel, fileFor: (mediaId: string) => File | undefined): void {
  channel.bufferedAmountLowThreshold = LOW_WATER_BYTES;
  let queue = Promise.resolve();
  let closed = false;
  channel.addEventListener('close', () => (closed = true));

  const reply = (message: Reply) => channel.send(JSON.stringify(message));
  const drained = () =>
    channel.bufferedAmount <= HIGH_WATER_BYTES
      ? Promise.resolve()
      : new Promise<void>((resolve) => channel.addEventListener('bufferedamountlow', () => resolve()));

  async function handle(request: Request): Promise<void> {
    const file = fileFor(request.mediaId);
    if (!file) return reply({ t: 'error', req: request.req, code: 'not-shared' });
    if (request.t === 'info') {
      return reply({ t: 'info', req: request.req, size: file.size, mime: file.type || 'application/octet-stream' });
    }
    const range = clampRange(request.start, request.end, file.size);
    if (!range) return reply({ t: 'error', req: request.req, code: 'bad-range' });

    reply({ t: 'begin', req: request.req, start: range.start, end: range.end, total: file.size });
    for (let offset = range.start; offset <= range.end && !closed; offset += CHUNK_BYTES) {
      const stop = Math.min(range.end + 1, offset + CHUNK_BYTES);
      channel.send(await file.slice(offset, stop).arrayBuffer());
      await drained();
    }
    if (!closed) reply({ t: 'end', req: request.req });
  }

  channel.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    let request: Request;
    try {
      request = JSON.parse(event.data) as Request;
    } catch {
      return;
    }
    // Une réponse à la fois : les morceaux binaires ne se mélangent jamais.
    queue = queue.then(() => handle(request)).catch((error) => console.error('[P2P] Envoi impossible', error));
  });
}

// --- Côté spectateur ------------------------------------------------------------------

interface Pending {
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  kind: 'info' | 'range';
  parts?: ArrayBuffer[];
  begin?: { start: number; end: number; total: number };
}

/** Pose des questions à celui qui partage, sur un canal ouvert. */
export class FileClient {
  private nextReq = 1;
  private readonly pending = new Map<number, Pending>();
  /** Réponse dont les morceaux binaires arrivent (une seule à la fois). */
  private receiving: Pending | null = null;

  constructor(channel: FileChannel) {
    this.channel = channel;
    channel.addEventListener('message', (event) => this.onMessage(event.data));
    channel.addEventListener('close', () => this.failAll(new P2pError('closed')));
  }

  private readonly channel: FileChannel;

  info(mediaId: string): Promise<{ size: number; mime: string }> {
    return this.ask({ t: 'info', mediaId }, 'info');
  }

  /** Octets [start, end] (fin incluse), éventuellement moins si la plage est grande. */
  range(mediaId: string, start: number, end: number | null): Promise<{ start: number; end: number; total: number; bytes: Uint8Array }> {
    return this.ask({ t: 'range', mediaId, start, end: end ?? Number.MAX_SAFE_INTEGER }, 'range');
  }

  private ask<T>(request: RequestBody, kind: Pending['kind']): Promise<T> {
    const req = this.nextReq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req, { resolve: resolve as (value: never) => void, reject, kind });
      this.channel.send(JSON.stringify({ ...request, req }));
    });
  }

  private onMessage(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      this.receiving?.parts?.push(data);
      return;
    }
    const reply = JSON.parse(data) as Reply;
    const pending = this.pending.get(reply.req);
    if (!pending) return;

    if (reply.t === 'error') {
      this.pending.delete(reply.req);
      pending.reject(new P2pError(reply.code));
    } else if (reply.t === 'info') {
      this.pending.delete(reply.req);
      pending.resolve({ size: reply.size, mime: reply.mime } as never);
    } else if (reply.t === 'begin') {
      pending.begin = { start: reply.start, end: reply.end, total: reply.total };
      pending.parts = [];
      this.receiving = pending;
    } else if (reply.t === 'end') {
      this.pending.delete(reply.req);
      this.receiving = null;
      const bytes = new Uint8Array(pending.parts!.reduce((total, part) => total + part.byteLength, 0));
      let offset = 0;
      for (const part of pending.parts!) {
        bytes.set(new Uint8Array(part), offset);
        offset += part.byteLength;
      }
      pending.resolve({ ...pending.begin!, bytes } as never);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.receiving = null;
  }
}
