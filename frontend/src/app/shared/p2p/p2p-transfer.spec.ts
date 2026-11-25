import { CHUNK_BYTES, FileChannel, FileClient, MAX_RANGE_BYTES, P2pError, clampRange, serveChannel } from './p2p-transfer';

/**
 * Deux faux canaux reliés, comme les deux bouts d'un RTCDataChannel : fiable,
 * ordonné, livraison asynchrone. `bufferedAmount` simule un canal encombré.
 */
function linkedChannels() {
  type Listener = (event?: { data: string | ArrayBuffer }) => void;
  const make = () => {
    const listeners: Record<string, Listener[]> = {};
    const channel = {
      peer: null as unknown as { emit: (type: string, data?: string | ArrayBuffer) => void },
      sent: [] as (string | ArrayBuffer)[],
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      send(data: string | ArrayBuffer) {
        channel.sent.push(data);
        const copy = typeof data === 'string' ? data : data.slice(0);
        queueMicrotask(() => channel.peer.emit('message', copy));
      },
      addEventListener(type: string, listener: Listener) {
        (listeners[type] ??= []).push(listener);
      },
      emit(type: string, data?: string | ArrayBuffer) {
        for (const listener of listeners[type] ?? []) listener(data === undefined ? undefined : { data });
      },
    };
    return channel;
  };
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return { sharer: a, viewer: b };
}

/** Fichier de `size` octets dont chaque octet vaut sa position modulo 251. */
function patternFile(size: number, type = 'video/mp4'): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = i % 251;
  return new File([bytes], 'film.mp4', { type });
}

describe('p2p-transfer', () => {
  it('borne une plage au fichier et à 4 Mo, fin incluse', () => {
    expect(clampRange(0, null, 100)).toEqual({ start: 0, end: 99 });
    expect(clampRange(10, 20, 100)).toEqual({ start: 10, end: 20 });
    expect(clampRange(90, 500, 100)).toEqual({ start: 90, end: 99 });
    expect(clampRange(0, null, 10 * MAX_RANGE_BYTES)).toEqual({ start: 0, end: MAX_RANGE_BYTES - 1 });
    expect(clampRange(100, null, 100)).toBeNull();
    expect(clampRange(-1, null, 100)).toBeNull();
  });

  it('donne la taille et le type du fichier partagé', async () => {
    const { sharer, viewer } = linkedChannels();
    serveChannel(sharer as unknown as FileChannel, (id) => (id === 'm1' ? patternFile(1000) : undefined));
    const client = new FileClient(viewer as unknown as FileChannel);

    expect(await client.info('m1')).toEqual({ size: 1000, mime: 'video/mp4' });
  });

  it('envoie exactement les octets demandés, en morceaux de 64 Ko', async () => {
    const { sharer, viewer } = linkedChannels();
    const file = patternFile(3 * CHUNK_BYTES + 123);
    serveChannel(sharer as unknown as FileChannel, () => file);
    const client = new FileClient(viewer as unknown as FileChannel);

    const answer = await client.range('m1', 1000, 2 * CHUNK_BYTES + 50);

    expect({ start: answer.start, end: answer.end, total: answer.total }).toEqual({
      start: 1000,
      end: 2 * CHUNK_BYTES + 50,
      total: file.size,
    });
    expect(answer.bytes.length).toBe(2 * CHUNK_BYTES + 50 - 1000 + 1);
    expect(Array.from(answer.bytes.slice(0, 3))).toEqual([1000 % 251, 1001 % 251, 1002 % 251]);
    expect(answer.bytes[answer.bytes.length - 1]).toBe((2 * CHUNK_BYTES + 50) % 251);
    const binary = sharer.sent.filter((data) => typeof data !== 'string') as ArrayBuffer[];
    expect(binary.every((part) => part.byteLength <= CHUNK_BYTES)).toBe(true);
  });

  it('plage ouverte (« bytes=1000- ») : au plus 4 Mo, le lecteur redemande la suite', async () => {
    const { sharer, viewer } = linkedChannels();
    serveChannel(sharer as unknown as FileChannel, () => patternFile(MAX_RANGE_BYTES + 5000));
    const client = new FileClient(viewer as unknown as FileChannel);

    const answer = await client.range('m1', 1000, null);

    expect(answer.end).toBe(1000 + MAX_RANGE_BYTES - 1);
    expect(answer.bytes.length).toBe(MAX_RANGE_BYTES);
  });

  it('plusieurs demandes à la suite : chacune reçoit ses propres octets', async () => {
    const { sharer, viewer } = linkedChannels();
    serveChannel(sharer as unknown as FileChannel, () => patternFile(10 * CHUNK_BYTES));
    const client = new FileClient(viewer as unknown as FileChannel);

    const [a, b] = await Promise.all([client.range('m1', 0, CHUNK_BYTES * 2), client.range('m1', 500_000, 500_010)]);

    expect(a.bytes[0]).toBe(0);
    expect(Array.from(b.bytes)).toEqual(Array.from({ length: 11 }, (_, i) => (500_000 + i) % 251));
  });

  it('fichier plus partagé (page rechargée) ou plage invalide : erreur explicite', async () => {
    const { sharer, viewer } = linkedChannels();
    serveChannel(sharer as unknown as FileChannel, (id) => (id === 'm1' ? patternFile(100) : undefined));
    const client = new FileClient(viewer as unknown as FileChannel);

    await expect(client.info('autre')).rejects.toEqual(new P2pError('not-shared'));
    await expect(client.range('m1', 500, null)).rejects.toEqual(new P2pError('bad-range'));
  });

  it('attend que le canal se vide quand il est encombré (contre-pression)', async () => {
    const { sharer, viewer } = linkedChannels();
    serveChannel(sharer as unknown as FileChannel, () => patternFile(4 * CHUNK_BYTES));
    const client = new FileClient(viewer as unknown as FileChannel);
    sharer.bufferedAmount = 64 * 1024 * 1024; // canal plein

    let done = false;
    const answer = client.range('m1', 0, null).then((value) => ((done = true), value));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(done).toBe(false);
    const sentWhileFull = sharer.sent.filter((data) => typeof data !== 'string').length;
    expect(sentWhileFull).toBe(1); // un morceau, puis attente

    sharer.bufferedAmount = 0;
    while (!done) {
      sharer.emit('bufferedamountlow');
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect((await answer).bytes.length).toBe(4 * CHUNK_BYTES);
  });

  it('canal fermé : les demandes en cours échouent', async () => {
    const { viewer } = linkedChannels();
    const client = new FileClient(viewer as unknown as FileChannel);

    const pending = client.info('m1');
    viewer.emit('close');

    await expect(pending).rejects.toEqual(new P2pError('closed'));
  });
});
