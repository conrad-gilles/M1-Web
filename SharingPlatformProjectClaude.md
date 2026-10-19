# Sharing Platform — revised project plan

> Cleaned-up version of [SharingPlatformProject.md](SharingPlatformProject.md), written after reading the
> current codebase (October 2026). The original notes are kept as they are.

## 1. The idea in one paragraph

A "watch party" platform built on top of the current Guitar Practice Cloud app. A user uploads an
audio or video file once, invites other users into a **room**, and everyone in the room plays the same
file at the same moment: play, pause, seek and "next file" are synchronized. Each participant
**streams** the file progressively (playback starts before the whole file is downloaded, seeking works).
A later version lets every user keep the media file on their own machine and only exchange playback
commands, peer to peer, so no file has to be hosted at all.

## 2. Goals and non-goals

**Goals (v1)**
- Upload audio, then video, once; files are stored in a single place.
- Rooms: an owner invites other users; members can play the room's media.
- Progressive streaming with seeking.
- Synchronized playback in a room, within about 0.5 s between participants in different places.
- Free deployment as a proof of concept.

**Non-goals (for now)**
- Live broadcasting (webcam, screen sharing, live events). That requires different technology
  (WebRTC media servers, HLS live). This project synchronizes **on-demand files**.
- Transcoding uploaded files into other formats (too CPU-heavy for free hosting).
- Sample-accurate sync for several speakers in the **same physical room** (< 50 ms). That is a much
  harder problem than a remote watch party.
- Large public audiences. The target is small groups (2 to 10 people per room).

## 3. Starting point: what the current app already does

| Need | Current state | Gap |
|---|---|---|
| File storage | Files are written to the backend's **local disk** (`backend/data/uploads`). MongoDB Atlas only stores metadata (title, size, MIME type, owner). | Local disk is wiped on free hosting (see §7). |
| Media types | Audio only, MIME whitelist, 25 MB maximum. | Video needs much larger files and another upload path. |
| Sharing | Every query filters on `ownerId`: a user can only see their own tracks. | Needs rooms and membership. |
| Streaming | The backend's `res.sendFile` already answers HTTP Range requests (`206 Partial Content`). **But** the frontend downloads the whole file as a Blob through `HttpClient`, because the JWT travels in the `Authorization` header and `<audio src>` / `<video src>` cannot send headers. | The media element needs a URL it can load directly. |
| Real time | REST only. | Needs a real-time channel (WebSocket). |
| Tests | `node --test` backend with mocked Mongoose, Vitest frontend. | Good base to extend. |

## 4. Target architecture

### Phase A: server-synchronized (v1)

```text
  Browser (Angular)                   Node / Express API              Object storage (R2 / S3)
 +-------------------+   REST + JWT   +----------------------+  signed  +------------------+
 | room page         | -------------> | auth, rooms, media   | -------> | media files      |
 | <audio>/<video>   | <--WebSocket-> | room state (sync)    |   URLs   |                  |
 +-------------------+   Socket.IO    +----------+-----------+          +--------^---------+
          |                                      | metadata                      |
          |                                MongoDB Atlas                         |
          +--------------- HTTP Range requests (streaming) ----------------------+
```

- The API stores metadata and room state. Files live in object storage.
- The browser streams **directly from storage** with a short-lived signed URL. The Node server never
  relays the media bytes, so it uses no bandwidth on the API host.
- Sync messages travel through the server over a WebSocket. The server is the single source of truth.

### Phase B: peer-to-peer sync with local files

```text
  Peer A (own copy of the file) <-- WebRTC DataChannel (sync messages) --> Peer B (own copy)
              ^                                                                    ^
              +------------ signaling (PeerServer) + STUN / TURN ------------------+
```

- No upload: each user opens their own copy of the file in the browser.
- Only small control messages travel between peers.
- A small server is still required: **signaling** (peers must find each other before connecting) and
  **STUN/TURN** (to get through home routers and firewalls; TURN relays traffic when a direct connection
  is impossible). "Serverless" here means "no media server", not "no server at all".

## 5. Synchronization design (the core of the project)

Room state, held by the server in phase A and by the host peer in phase B:

```ts
interface PlaybackState {
  mediaId: string;
  paused: boolean;
  position: number;   // seconds, valid at `updatedAt`
  rate: number;       // playback rate, normally 1
  updatedAt: number;  // server clock, in ms
  version: number;    // incremented on every change, used to drop stale messages
}
```

Where a client should be right now:
`expected = paused ? position : position + (serverNow() - updatedAt) / 1000 * rate`

Rules:
1. **Clock offset.** On join, the client pings the server a few times and keeps the offset measured
   with the shortest round trip (NTP-like). `serverNow() = Date.now() + offset`.
2. **Commands go through the server.** A click on play, pause or seek sends a command. The server stamps
   it with its time and a new version, then broadcasts the new state to **everyone, sender included**.
   Clients only ever apply the shared state, so everyone follows the same timeline.
3. **Drift correction** about once per second: under 0.1 s, do nothing; between 0.1 s and 1 s, nudge
   `playbackRate` (for example 0.95 or 1.05) until caught up; above 1 s, seek.
4. **No echo loops.** Applying a remote state fires `play`, `pause` and `seeked` events on the media
   element. Those events must not be sent back as new commands.
5. **Buffering policy.** Either the room waits for the slowest participant, or slow participants catch up
   on their own. Start with "catch up on their own", which is simpler.
6. **Autoplay.** Browsers block playback with sound until the user has interacted with the page. Every
   participant must click once ("Join room") before sync can start playback for them.
7. **Conflicts.** If two people seek at the same moment, the server keeps the last command it received.
   An optional "host controls only" mode avoids the problem entirely.
8. **Late joiners** receive the current state as soon as they connect.

## 6. Media formats and file identity

- **Formats (v1): only what browsers play natively.** Audio: MP3, AAC/M4A, OGG, WAV. Video: MP4
  (H.264 + AAC) and WebM (VP9/AV1 + Opus). MKV, AVI or HEVC often do not play: reject them at upload with
  a clear message instead of trying to transcode.
- **Check the real file type** from its first bytes (magic number). Today the backend trusts
  `file.mimetype`, which is the `Content-Type` declared by the browser.
- **Large uploads.** Video files weigh hundreds of MB to several GB. One multipart request through Node
  would be slow and fragile. Upload directly from the browser to object storage with a presigned URL
  (multipart upload for large files). The API only records the metadata once storage confirms.
- **File identity in P2P mode** (answers "do files need the same length or metadata?"): identify a file by
  its **content hash** (SHA-256), not by its name, duration or tags. Two copies of "the same film" from
  different sources usually differ (encoding, intro length, frame offset) and would drift apart even if
  their durations look identical.
  - Strict mode: hashes must match, so the content is guaranteed identical.
  - Loose mode: durations match within ±1 s. Allowed with a warning, plus a manual offset slider.
  - Hashing a multi-GB file in the browser: `crypto.subtle.digest` needs the whole file in memory. Use
    incremental hashing (for example `hash-wasm`), or a fast fingerprint: size + hash of the first and
    last few MB.
- Browsers cannot reopen a local file from its path after a reload. The user selects the file again for
  each session (the File System Access API can remember it, but only in Chromium browsers).

## 7. Hosting and storage

Free tiers as checked in October 2026. Re-check them before deploying.

| Service | Role | Limits that matter |
|---|---|---|
| [Render](https://render.com/docs/free) (free web service) | Node API + WebSocket | Sleeps after 15 min without traffic, about 1 min to wake up. The **local filesystem is wiped** on restart, redeploy and sleep. No persistent disk on the free plan. 750 instance hours per month per workspace. |
| [MongoDB Atlas](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) (free cluster) | Users, media metadata, rooms | 512 MB in total. Metadata only, never media files (GridFS). |
| [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/) (free tier) | Media files | 10 GB of storage, no egress fees (important for video). S3-compatible presigned URLs support Range requests. |
| GitHub Pages | Angular frontend (optional) | Static files only. Deep links such as `/rooms/abc` need a `404.html` fallback. The dev proxy (`proxy.conf.json`) does not exist in production, so the frontend needs an API base URL and the backend a CORS configuration. |

Consequences:
- The current upload code would lose every file on Render. **Storage must move to object storage before
  deploying anything that accepts uploads.**
- Simplest PoC deployment: serve the built Angular app from Express on Render (same origin). No CORS,
  no cross-site cookie problems, a single deployment. Use GitHub Pages only if separate hosting is wanted.
- Cold start: the first visitor after a quiet period waits about a minute. WebSocket messages count as
  traffic, so an active room keeps the instance awake.
- Room state kept in memory works for **a single server instance**. Several instances would need shared
  state (for example Redis). That is fine for a PoC.

## 8. Security and privacy

- **Access rule:** a user may stream a file only if they own it or belong to a room that contains it,
  enforced on the server. This extends the existing `ownerId` filtering pattern.
- **Media URLs:** short-lived and scoped to a single file. If the URL expires during playback, the next
  Range request fails and playback stops once the buffer is empty. The lifetime must cover the media
  duration plus a margin, or the client must refresh the URL.
- **Logs:** the current HTTP logger writes `req.originalUrl`, query string included. Tokens placed in URLs
  would land in the logs. Redact query strings before introducing signed URLs.
- **WebSocket authentication:** verify the JWT during the handshake and check room membership on every
  room event, not only on join.
- **Invites:** random, unguessable, expirable and revocable codes.
- **CORS:** `cors()` currently accepts every origin. Restrict it to the deployed frontend.
- **Quotas:** a per-user storage limit (free storage is shared by all users) and upload rate limiting.
- **Copyright:** letting users upload films or music and share them with others is distribution. A public
  deployment would need terms of use and a takedown process. The P2P mode where everyone uses their own
  copy avoids hosting content at all.

## 9. Roadmap

Each phase ends with something that can be demonstrated.

| Phase | Content | Done when |
|---|---|---|
| 0. Groundwork | Generalize `Track` into `Media` (`kind: audio \| video`). Short-lived media URLs. `<audio src>` loads the URL directly instead of a Blob. Redact URLs in logs. | The Network tab shows `206 Partial Content`, playback starts before the download finishes, seeking works, tests are updated and green. |
| 1. Rooms | `Room` model (owner, members, media list, invite code). Create, join, leave. Members can stream the room's media. | User B streams a file uploaded by user A only after joining A's room; a non-member gets `404`. |
| 2. Synced playback | Socket.IO on the Express server, room state, clock offset, commands, drift correction. | Two browsers with two accounts stay within 0.5 s through play, pause and seek; a late joiner starts at the right position. |
| 3. Cloud storage and deployment | R2 bucket, presigned upload and download, API + frontend on Render, environment configuration. | Files survive a Render restart; the app works from two different networks. |
| 4. Video | Video types and size limits, presigned multipart upload, magic-byte check, `<video>` player UI. | A 1 GB MP4 uploads, streams and stays in sync. |
| 5. P2P sync | PeerJS, local file picker, content fingerprint, DataChannel sync reusing the phase 2 protocol. | Two peers with the same local file stay in sync without uploading anything to a server. |
| 6. Optional | Docker image for self-hosting, host migration when the host leaves, P2P file transfer (WebTorrent-style). | — |

Phases 1 and 2 can be built and tested locally with the existing audio upload. Moving storage
(phase 3) only becomes urgent at deployment time.

## 10. Open questions

- Who controls playback: everyone, or only the host (who can hand control to others)?
- Buffering: does the room wait for everyone, or do slow participants catch up on their own?
- Sync tolerance: 0.5 s suits a remote watch party. Under 50 ms (same physical room) is a different project.
- Maximum room size. It drives the P2P topology: a full mesh (everyone connected to everyone) is fine
  for small groups only.
- P2P file matching: strict (hash) or loose (duration) by default?
- Does the P2P version keep accounts, or use anonymous rooms with invite links?
- Self-hosting: nice to have, not required. It would need a Docker image and an installation guide.
- Copyright position if the platform is ever deployed publicly.

## 11. Testing strategy

- **Backend:** extend the `node --test` suites: room access rules (member vs non-member), media URL
  expiry, WebSocket events with a real Socket.IO client against `createApp()`.
- **Sync logic:** put the expected-position and drift-correction math in pure functions with an
  injectable clock, so it can be unit tested without browsers.
- **Manual:** two browsers with two accounts, DevTools network throttling on one of them. Test seek,
  pause while buffering, late join, reconnection after a network drop.
- **P2P:** test across two different networks (home Wi-Fi + mobile hotspot) to find out whether TURN
  is needed.

## 12. Documentation to add as the project grows

- `API_CONTRACT.md`: the new endpoints (rooms, media URLs) and the WebSocket events with their payloads.
- `SYNC_PROTOCOL.md`: room state, messages, tolerances, conflict and buffering rules.
- A decision log: one short entry per choice (Socket.IO vs `ws`, R2 vs another storage, same origin vs
  GitHub Pages, strict vs loose matching) with the reason.
- A deployment guide: environment variables (`MONGODB_URI`, `JWT_SECRET`, storage keys, allowed origin),
  Render setup, bucket CORS rules.
- The list of supported formats, for users.
- Known limitations: cold start, storage quota, browser support.

## 13. Existing projects worth studying

- **Syncplay**: synchronizes local files played in mpv or VLC through a small server, and flags when
  participants' files differ. The closest existing tool to phase 5.
- **Watch2Gether**, **Teleparty**: server-synchronized watch parties.
- **PeerJS** documentation (https://peerjs.com/) and the official WebRTC samples.
