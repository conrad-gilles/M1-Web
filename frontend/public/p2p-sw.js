/*
 * Service worker du partage direct (P2P).
 *
 * Le lecteur vidéo charge /p2p-stream/<média>?page=<page> et demande des
 * plages d'octets (en-tête Range), comme auprès d'un serveur ordinaire. Ce
 * service worker transmet chaque demande à la page (P2pService), qui va
 * chercher ces octets chez le participant qui partage le fichier (WebRTC),
 * puis répond « 206 Partial Content ». Le navigateur gère donc lui-même la
 * mise en mémoire tampon et le déplacement, comme pour un fichier en ligne.
 */
const PREFIX = "/p2p-stream/";
const PAGE_TIMEOUT_MS = 60_000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return;
  event.respondWith(serve(event.request, url));
});

/** « bytes=500-999 » -> { start: 500, end: 999 } ; « bytes=500- » -> fin ouverte. */
function parseRange(header) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header ?? "bytes=0-");
  if (!match) return { start: 0, end: null };
  return { start: Number(match[1]), end: match[2] === "" ? null : Number(match[2]) };
}

/** Demande les octets à une page ; null si ce n'est pas elle qui lit ce média. */
function ask(client, request) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ error: "timeout" }), PAGE_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data?.skip ? null : event.data);
    };
    client.postMessage({ type: "p2p-range", ...request }, [channel.port2]);
  });
}

async function serve(request, url) {
  const mediaId = decodeURIComponent(url.pathname.slice(PREFIX.length));
  const page = url.searchParams.get("page");
  const { start, end } = parseRange(request.headers.get("range"));

  const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of pages) {
    const answer = await ask(client, { mediaId, page, start, end });
    if (!answer) continue;
    if (answer.error) return new Response(`Partage direct : ${answer.error}`, { status: 502 });
    return new Response(answer.body, {
      status: 206,
      headers: {
        "Content-Type": answer.mime,
        "Content-Length": String(answer.body.byteLength),
        "Content-Range": `bytes ${answer.start}-${answer.end}/${answer.total}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response("Partage direct : page introuvable", { status: 404 });
}
