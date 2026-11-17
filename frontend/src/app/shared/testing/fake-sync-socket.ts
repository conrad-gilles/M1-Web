import { SyncSocket } from '../services/sync.service';

type Listener = (...args: unknown[]) => void;

/** In-memory stand-in for a Socket.IO client socket, for unit tests only. */
export class FakeSyncSocket implements SyncSocket {
  readonly emitted: { event: string; args: unknown[] }[] = [];
  disconnected = false;
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    this.emitted.push({ event, args });
    return this;
  }

  disconnect(): this {
    this.disconnected = true;
    return this;
  }

  /** Simule un message reçu du serveur. */
  receive(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  /** Messages envoyés au serveur pour un événement donné. */
  sent(event: string): unknown[][] {
    return this.emitted.filter((message) => message.event === event).map((message) => message.args);
  }

  /** Répond au dernier message envoyé avec accusé de réception (dernier argument). */
  acknowledge(event: string, response: unknown): void {
    const last = this.sent(event).at(-1);
    const ack = last?.at(-1);
    if (typeof ack !== 'function') throw new Error(`Aucun accusé de réception en attente pour ${event}`);
    (ack as Listener)(response);
  }
}
