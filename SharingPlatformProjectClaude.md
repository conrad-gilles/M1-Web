# Sharing Platform — revised project plan

> Cleaned-up version of [SharingPlatformProject.md](SharingPlatformProject.md), written after reading the
> current codebase (October 2026). The original notes are kept as they are.

## 1. The idea in one paragraph

A "watch party" platform built on top of the course's Guitar Practice Cloud app (the TP). A user uploads an
audio or video file once, shares a short **room code**, and everyone who joins with it (no account
needed) plays the same
file at the same moment: play, pause, seek and "next file" are synchronized. Each participant
**streams** the file progressively (playback starts before the whole file is downloaded, seeking works).
A later version lets every user keep the media file on their own machine and only exchange playback
commands, peer to peer, so no file has to be hosted at all.

## 2. Goals and non-goals

**Goals (v1)**
- Upload audio, then video, once; files are stored in a single place.
- Rooms joined with a **simple code, no accounts**: the host creates a room and shares its code; anyone
  who enters it joins with just a display name and can play the room's media.
- **Everything synced:** when anyone plays, pauses or seeks, everyone sees it and follows (§5).
- Progressive streaming with seeking.
- Synchronized playback in a room, within about 0.5 s between participants in different places.
- Host the **entire finished application** for free, under the hard constraint below.

**Non-goals (for now)**
- Live broadcasting (webcam, screen sharing, live events). That requires different technology
  (WebRTC media servers, HLS live). This project synchronizes **on-demand files**.
- Transcoding on a server (too CPU-heavy for free hosting). More advanced formats are a **future goal**,
  converted in the user's own browser instead (§6).
- Sample-accurate sync for several speakers in the **same physical room** (< 50 ms). That is a much
  harder problem than a remote watch party.
- Large public audiences. The target is small groups (2 to 10 people per room).

**Hard constraint: 100 % free, no credit card on any service, no paid service ever**
- The **entire finished application** (frontend, API, WebSocket server, database, media storage and the
  P2P helper services) runs on free tiers. This applies to the final version, not only the PoC.
- **No service may ask for a credit card, PayPal or any other payment method**, not even "for
  verification" or to unlock a free tier. A service that asks for one is rejected, whatever its limits.
  Firebase Storage and Cloudflare R2 already fail this rule (§7.1).
- **No paid service, paid plan or paid upgrade, ever.** Every choice in this plan is final under that
  rule: there is no "switch to a paid option later".
- When a free limit is reached, the app degrades gracefully (clear message, try again later). The answer
  is never "add a card" or "upgrade the plan".
- Limits accepted by design: cold starts, a daily download allowance, small storage, and free subdomains
  only (`*.onrender.com`, `*.github.io`); no custom domain, since domains cost money.
- Free tiers change: check each service's sign-up page before creating the account.

## 3. Starting point: what the current app already does

| Need | Current state | Gap |
|---|---|---|
| File storage | Files are written to the backend's **local disk** (`backend/data/uploads`). MongoDB Atlas only stores metadata (title, size, MIME type, owner). | Local disk is wiped on free hosting (see §7). |
| Media types | Audio only, MIME whitelist, 25 MB maximum. | Video needs much larger files and another upload path. |
| Sharing | Every query filters on `ownerId`: a user can only see their own tracks. Accounts (register, login, JWT) are required. | Needs rooms joined by code, **without accounts**. The account system is removed (phase 3.2). |
| Streaming | The backend's `res.sendFile` already answers HTTP Range requests (`206 Partial Content`). **But** the frontend downloads the whole file as a Blob through `HttpClient`, because the JWT travels in the `Authorization` header and `<audio src>` / `<video src>` cannot send headers. | The media element needs a URL it can load directly. |
| Real time | REST only. | Needs a real-time channel (WebSocket). |
| Tests | `node --test` backend with mocked Mongoose, Vitest frontend. | Good base to extend. |

## 4. Target architecture

### Phase A: server-synchronized (v1)

```text
  Browser (Angular)                   Node / Express API              Object storage (B2, S3 API)
 +-------------------+   room token   +----------------------+  signed  +------------------+
 | room page         | -------------> | auth, rooms, media   | -------> | media files      |
 | <audio>/<video>   | <--WebSocket-> | room state (sync)    |   URLs   |                  |
 +-------------------+   Socket.IO    +----------+-----------+          +--------^---------+
          |                                      | metadata                      |
          |                                MongoDB Atlas                         |
          +--------------- HTTP Range requests (streaming) ----------------------+
```

- The API stores metadata and room state. Files live in object storage.
- **No accounts.** The host creates a room and gets a short code (6 characters, for example `K7P2QX`,
  without look-alike characters such as `0`/`O`). Others join with the code and a display name. The
  server then gives each browser a signed **room token**, scoped to that room, which it uses for the API,
  the WebSocket and media URLs. The host's browser also keeps a secret host token.
- Media belongs to a **room**, not to a person. When a room has been inactive for a while (for example
  24 h), it expires and its files are deleted from storage, which keeps the free 10 GB from filling up.
- The browser streams **directly from storage** with a short-lived signed URL. The Node server never
  relays the media bytes, so it uses no bandwidth on the API host.
- Sync messages travel through the server over a WebSocket. The server is the single source of truth.

### Phase B: peer-to-peer sync with local files

```text
  Peer A (own copy of the file) <-- WebRTC DataChannel (sync messages) --> Peer B (own copy)
              ^                                                                    ^
              +------------ signaling (no own server) + public STUN ---------------+
```

- No upload: each user opens their own copy of the file in the browser.
- Only small control messages travel between peers.
- **Goal: completely serverless.** The project runs no server at all for the P2P version: the Angular
  app can be a static site (GitHub Pages or Render), and everything else happens between browsers. Same
  room code as phase A, no accounts.
- What WebRTC still needs, and how to get it without a server of our own:
  - **Signaling** (the first messages that let two browsers find each other): through free public
    infrastructure, for example the Trystero library, which meets peers with the room code over public
    BitTorrent trackers or Nostr relays, no account. Fully manual fallback: peers copy-paste (or scan as
    a QR code) a connection code to each other, with no server involved at all.
  - **STUN** (each browser learns its public address): free public STUN servers, no account.
  - **No TURN relay.** A relay is a server; without it, peers behind very strict networks (some
    company or university Wi-Fi) cannot connect. Accepted limitation.
- **Known limitation of the first P2P version:** one peer, the host, holds the room state. **When the host
  leaves, the room ends** for everyone, who must create or join a new room. Handing the room over to
  another peer (host migration) is planned later (phase 3.7).

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
5. **Buffering: the room waits for the slowest participant** (decision, §10).
   - **Short buffering is ignored.** Browsers buffer briefly after every play and seek (drift correction
     seeks too). A client only reports buffering once its player has been stuck for more than 0.5 s;
     otherwise the room would keep pausing itself.
   - When a participant reports buffering, the server pauses the room and remembers who is buffering.
     Once every one of them reports `canplay` again, the server resumes the room for everyone.
   - **10 s limit.** If a participant is still buffering after 10 s, the room resumes without them. They
     stay in the room and catch up on their own (drift correction seeks them back to the right position
     once their player can play). This way one slow connection cannot freeze the room.
   - A participant who disconnects is removed from the waiting list immediately.
6. **Autoplay.** Browsers block playback with sound until the user has interacted with the page. Every
   participant must click once ("Join room") before sync can start playback for them.
7. **Everyone controls playback, and everyone follows** (decision, §10). When anyone plays, pauses or
   seeks, every participant's player does the same, and a short notice shows who did it (for example
   "Alex jumped to 12:34"). If two people seek at the same moment, the server keeps the last command it
   received. Finer-grained control (host only, delegated control) may come later.
8. **Late joiners** receive the current state as soon as they connect.

## 6. Media formats and file identity

- **Formats: the server stores only what browsers play natively.** Audio: MP3, AAC/M4A, OGG, WAV.
  Video: MP4 (H.264 + AAC), WebM (VP9/AV1 + Opus) and OGV. **MOV, AVI and MKV are converted to MP4 in
  the uploader's browser** before the upload (done early, November 2026, see the conversion bullet
  below and §11.1); the server never receives them. Other formats are rejected with a clear message.
- **Check the real file type** from its first bytes (magic number). Today the backend trusts
  `file.mimetype`, which is the `Content-Type` declared by the browser.
- **Large uploads.** Video files weigh hundreds of MB to several GB. One multipart request through Node
  would be slow and fragile. Upload directly from the browser to object storage with a presigned URL
  (multipart upload for large files). The API only records the metadata once storage confirms.
- **File identity in P2P mode** (answers "do files need the same length or metadata?").
  - **v1, very loose matching** (decision, §10): peers can sync if their files have the **same duration**
    (within 1 s, to absorb rounding differences between browsers) and the **same file type**. Nothing
    else is compared.
  - Known risk: two copies of "the same film" from different sources can have the same duration but a
    different encoding, intro length or frame offset, and then drift apart or show different scenes.
    Accepted for now.
  - Later, if that becomes a problem: a strict mode comparing a **content hash** (SHA-256), and a manual
    offset slider. Hashing a multi-GB file in the browser needs incremental hashing (for example
    `hash-wasm`) or a fast fingerprint (size + hash of the first and last few MB), because
    `crypto.subtle.digest` needs the whole file in memory.
- **More advanced formats** (MKV, AVI, MOV, HEVC/H.265, FLAC, ...), without paying for a server:
  convert in the user's own browser with `ffmpeg.wasm` (FFmpeg compiled to WebAssembly). MOV, AVI and
  MKV are done (§11.1); HEVC detection and FLAC are not.
  - *Remuxing* (changing only the container, for example MKV with H.264 inside → MP4) is fast.
  - *Transcoding* (changing the codec, for example HEVC → H.264) is slow, especially for full films, and
    runs on the user's CPU.
  - Server version: the uploader's browser converts before uploading. P2P version: each user converts
    their own copy, and matching (duration + type) compares the converted files.
  - Some codecs, such as HEVC, play natively only on some devices; check support with
    `MediaSource.isTypeSupported()` before converting.
- Browsers cannot reopen a local file from its path after a reload. The user selects the file again for
  each session (the File System Access API can remember it, but only in Chromium browsers).

## 7. Hosting and storage

Free tiers as checked in October–November 2026. Every service below is used **without a card** (§2).
Re-check them before creating the accounts.

| Service | Role | Card? | Limits that matter |
|---|---|---|---|
| [Render](https://render.com/docs/free) (free web service) | Node API + WebSocket, and the built Angular app | No | Sleeps after 15 min without traffic, about 1 min to wake up. The **local filesystem is wiped** on restart, redeploy and sleep. No persistent disk on the free plan. 750 instance hours per month per workspace: enough for **one** service running all month, which is another reason to serve API and frontend from the same service. |
| [MongoDB Atlas](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) (free cluster) | Users, media metadata, rooms | No | 512 MB in total. Metadata only, never media files (GridFS). Paused after 30 days without any connection; resume it from the Atlas dashboard. |
| [Backblaze B2](https://www.backblaze.com/cloud-storage/pricing) (free tier) | Media files (choice explained in §7.1) | No (private bucket) | 10 GB of storage. Per day: 1 GB of downloads and 2,500 download requests. S3-compatible: private bucket, presigned URLs, Range requests. |
| GitHub Pages | Angular frontend (optional) | No | Static files only. Deep links such as `/rooms/abc` need a `404.html` fallback. The dev proxy (`proxy.conf.json`) does not exist in production, so the frontend needs an API base URL and the backend a CORS configuration. |
| Public signaling (for example Trystero over public BitTorrent trackers or Nostr relays) | P2P signaling (phase 3.6) | No account | Not run by the project. Fallback: manual copy-paste of connection codes, no server at all (§4). |
| Google public STUN (`stun:stun.l.google.com:19302`) | P2P address discovery (phase 3.6) | No account | Enough for most home connections. |
| TURN relay | Not used | — | The P2P version is completely serverless (§4). Peers behind very strict networks cannot connect; accepted limitation. |

Consequences:
- The current upload code would lose every file on Render. **Storage must move to object storage
  (Backblaze B2, see §7.1) before deploying anything that accepts uploads.**
- Simplest PoC deployment: serve the built Angular app from Express on Render (same origin). No CORS,
  no cross-site cookie problems, a single deployment. Use GitHub Pages only if separate hosting is wanted.
- Cold start: the first visitor after a quiet period waits about a minute. WebSocket messages count as
  traffic, so an active room keeps the instance awake.
- Room state kept in memory works for **a single server instance**. Several instances would need shared
  state (for example Redis). That is fine for a PoC.

### 7.1 Media storage (free, no card)

The uploaded files are already outside Git (`backend/data/uploads/` is gitignored), but they sit on the
server's own disk, which Render wipes. The app needs a storage service that the backend talks to. The
choice below is the final one, not only the PoC's (§2: no paid service ever).

**Requirements**
- Free **without a credit card** (project rule, §2), so an unexpected bill is impossible.
- Usable from the Node backend, ideally through the **S3 API** so the code is not tied to one provider.
- **Private files** with expiring signed URLs: rooms decide who may play what (§8).
- **HTTP Range requests**, so `<audio>` and `<video>` can stream and seek.
- A per-file limit large enough for video (phase 3.5).

**Options compared** (researched October 2026; free tiers change often, re-check before signing up)

| Service | Free allowance | Card needed? | Verdict |
|---|---|---|---|
| **Backblaze B2** | 10 GB stored. Per day: 1 GB of downloads, 2,500 download requests (Class B) and 2,500 Class C requests (listing and similar). Uploads are free. | No. Only a *public* bucket needs payment history or a small card payment, and this project uses a private one. | **Chosen.** S3-compatible, private buckets, presigned URLs, Range requests. The 1 GB/day download allowance is the real limit. |
| Cloudflare R2 | 10 GB stored, no egress fees, 1 million Class A (write) and 10 million Class B (read) operations per month | **Yes**, a card or PayPal to activate R2. Usage beyond the free tier is billed; there is no hard cap. | **Rejected.** Technically the best fit for video, but it needs a card, which the project rules out (§2). |
| Firebase Storage | No free usage without billing anymore | **Yes.** Since 3 February 2026, Cloud Storage for Firebase requires the pay-as-you-go Blaze plan; Spark projects get 402/403 errors. | **Rejected.** The "Spark plan, no card" claim is out of date. |
| Supabase Storage | 1 GB stored, 5 GB of egress per month, 50 MB per file (reported by third-party guides) | No | **Rejected.** Too small for video, adds a Postgres project the app does not use, and free projects pause after one week without activity. |
| Cloudinary | 25 credits per month shared by storage, bandwidth and transformations (1 credit = 1 GB stored *or* 1 GB of video delivered *or* 1,000 transformations) | No | **Not now.** The only option that converts formats (MOV → MP4), but video processing uses credits fast, it has its own API instead of S3, and its free per-file video limit is not documented. Worth revisiting if format support becomes the main problem. |
| UploadThing | 2 GB stored | No | **Rejected.** An upload service aimed at Next.js/React apps, with its own API and small default per-file limits (video 16 MB, audio 8 MB, configurable). Nothing gained over B2 for Express + Angular. |
| Internet Archive | Unlimited | No | **Rejected.** Everything uploaded is public and indexed, you must hold the rights to all of it, and it is a library rather than storage for an app. Incompatible with private rooms. |
| MongoDB GridFS (existing Atlas cluster) | Shares the cluster's 512 MB | No, already set up | **Fallback.** No new account, but tiny, and every byte goes through Node. Enough for an audio-only demo. |

**Decision: Backblaze B2, private bucket, used through the S3 API.**

Setup:
1. Create the account and choose the **EU data region** at sign-up. It cannot be changed afterwards
   (moving means creating a new account).
2. Create a **private** bucket and an application key restricted to that bucket.
3. Put the settings in `backend/.env` only: `S3_ENDPOINT` (shown on the bucket page, for example
   `https://s3.eu-central-003.backblazeb2.com`), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY`, with empty placeholders in `.env.example`. Same rule as the MongoDB URI:
   never in Angular, Git, a screenshot or a prompt.

How the code uses it:
- **A storage module** with three functions (`save`, `signedUrl`, `remove`) and two implementations:
  local disk for development and tests, S3 for B2. Tests keep running offline, and the code is not tied
  to B2: another free S3-compatible service would only change environment variables.
- **Upload.** Audio (up to 25 MB): Node keeps receiving the upload with Multer and forwards it to B2
  (`@aws-sdk/lib-storage`), then saves the metadata. Video (phase 3.5): the browser uploads directly to B2
  with a presigned URL (this needs CORS rules on the bucket) and Node only records the metadata.
- **Playback.** The API checks the room token (the file must belong to that room), then returns a presigned GET URL
  (`@aws-sdk/s3-request-presigner`) valid for at least the media's duration (presigned URLs last 7 days
  at most). The `<audio>` or `<video>` element loads it, and its Range requests go straight to B2.
- **Delete.** `DeleteObject` together with the metadata, as `unlink` does today.

Living with the free limits:
- Every viewer downloads the file separately: a 300 MB video watched by 4 people uses 1.2 GB, more than
  the daily allowance. Audio (a few MB per MP3) and short videos are fine.
- Once an allowance is used up, B2 refuses requests with a `403` error (`download_cap_exceeded` or
  `transaction_cap_exceeded` in B2's API) until the daily counter resets. The media element only reports
  a generic `error` event, so the player should show "media temporarily unavailable" instead of failing
  silently. Never add a payment method to the B2 account: without one, B2 cannot bill anything.
- When the free limits are too small, they are accepted, not bought off: keep files short, enforce
  per-room quotas, and rely on phase 3.6, where every viewer plays their own local copy and storage
  bandwidth drops to zero.

Sources: [B2 pricing](https://www.backblaze.com/cloud-storage/pricing),
[B2 regions](https://www.backblaze.com/docs/cloud-storage-data-regions),
[B2 buckets](https://www.backblaze.com/docs/cloud-storage-create-and-manage-buckets),
[B2 caps & alerts](https://help.backblaze.com/hc/en-us/articles/217931138-How-to-use-B2-data-caps-alerts),
[B2 error codes](https://www.backblaze.com/docs/cloud-storage-native-api-error-handling-and-status-codes),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[R2 card requirement (Cloudflare Community)](https://community.cloudflare.com/t/why-using-r2-free-tier-involves-giving-card-info/945179),
[Firebase storage changes](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024),
[Supabase pricing](https://supabase.com/pricing),
[Cloudinary plans](https://cloudinary.com/documentation/billing_and_plans),
[UploadThing file routes](https://docs.uploadthing.com/file-routes),
[Render: free tier without a card](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026),
[MongoDB Atlas sign-up](https://www.mongodb.com/cloud/atlas/register),
[Metered TURN](https://www.metered.ca/stun-turn).

### 7.2 Deployment pipeline (continuous deployment)

The whole app (Angular + Express API) runs as **one free Render web service**, connected to the public
GitHub repo. MongoDB Atlas stays where it is. No service needs a card (§2).

**Branches.** `main` keeps the course TPs as they are. The project lives on **`sharing-platform`**: it is
the deployed branch, the one CI must keep green, and the one personal branches (`gilles`, `reese`, ...)
are merged into through pull requests.

**Code changes needed before the first deploy** (roadmap step 1, §9; done)
- `backend/src/app.js`: when `frontend/dist/sharing-platform/browser/index.html` exists, serve that folder with
  `express.static`, and answer every other `GET` outside `/api` with `index.html` so the Angular router
  handles `/tracks`, `/login`, etc. Placed after the API routes, before the error handler.
- `backend/src/server.js`: refuse to start when `JWT_SECRET` is missing, like it already does for
  `MONGODB_URI` (reason below).

**CI workflow** (roadmap step 2): `.github/workflows/ci.yml`, not created yet.

```yaml
name: CI
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: backend/package-lock.json }
      - run: npm ci
      - run: npm test
  frontend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: frontend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: npm ci
      - run: npm test
      - run: npm run build
```

```text
push / PR ──► GitHub Actions (CI: backend tests, frontend tests, build)
                    │ checks green on sharing-platform
                    ▼
              Render: builds Angular, starts Express ──► MongoDB Atlas (free cluster)
              https://<service>.onrender.com
```

**How it works**
1. Anyone pushes to any branch or opens a pull request → CI runs all tests (GitHub Actions is free for
   public repos).
2. A merge (or push) to `sharing-platform` → Render waits until CI is green, then redeploys automatically.
3. Commits that only touch documentation do not redeploy (build filters below).
4. The database needs no redeploy: Mongoose creates collections and indexes when the server starts.
   Data migrations, if ever needed, would be a separate script.

Express serves the Angular build, so the frontend and the API share one URL: no CORS configuration, and
Angular's relative `/api/...` calls work as in development.

**Step 1 setup: MongoDB Atlas** (roadmap step 1, §9)
- **Network Access:** Render's free plan has no fixed IP. Add the outbound IPs shown in the Render
  service (Connect → Outbound), or `0.0.0.0/0` with a strong database password.
- Use a separate database name for production (`sharing-platform-prod` in the URI) so
  development data stays apart.

**Step 1 setup: Render service (dashboard, not Blueprint)**

Create the service from the dashboard: **New → Web Service → connect GitHub → `conrad-gilles/M1-Web`**.
Blueprints (`render.yaml`) were reported to ask for a card even for free services; the dashboard flow
does not.

| Setting | Value |
|---|---|
| Branch | `sharing-platform` |
| Region | Frankfurt |
| Root Directory | *(empty)* |
| Runtime | Node |
| Build Command | `cd frontend && npm ci && npm run build && cd ../backend && npm ci --omit=dev` |
| Start Command | `cd backend && node src/server.js` (not `npm start`, which needs a `.env` file) |
| Instance Type | **Free** |

Environment variables (Render dashboard only, never in Git):

| Key | Value |
|---|---|
| `MONGODB_URI` | The Atlas URI with the production database name |
| `JWT_SECRET` | A long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `NODE_VERSION` | `22` |
| `TRUST_PROXY` | `1`, so rate limits per IP see the visitor's address behind Render's proxy |

The server refuses to start without `JWT_SECRET`: the fallback secret in `app.js` is visible in the
public repo, so anyone could forge tokens with it. The B2 settings (`S3_*`, §7.1) join this list in
phase 3.4.

**Step 2 setup: Render auto-deploy** (roadmap step 2, §9)

In the service's **Settings**:
- **Health Check Path:** `/api/health`
- **Auto-Deploy:** *After CI checks pass*
- **Build Filters → Included paths:** `backend/**`, `frontend/**`

**Step 2 setup: GitHub branch protection**

**Settings → Branches → add a rule for `sharing-platform`:** require a pull request and require the `backend` and
`frontend` checks to pass. Nobody (human or AI assistant) can then push untested code to production.

**Team workflow**
1. Work on a branch (`gilles`, the teammate's branch, ...) and push it: CI runs.
2. Open a pull request to `sharing-platform`. Merge once CI is green.
3. Render deploys `sharing-platform` a few minutes later. Follow it in the service's **Events** and **Logs** tabs.
4. Something broke? Render → **Events** → *Rollback* to the previous deploy, then fix on a branch.

**Known limitations of the current deployment**
- **Uploaded files disappear** on every restart, redeploy and sleep: they stay on Render's local disk
  until storage moves to Backblaze B2 (§7.1, phase 3.4).
- **Cold start:** after 15 minutes without traffic, the first request waits about a minute.
- **Atlas pause takes the app down:** after 30 days without any connection, Atlas pauses the free
  cluster. `server.js` refuses to start without the database, so Render keeps restarting the service and
  the app is unreachable. Fix: resume the cluster in the Atlas dashboard; Render then starts normally.

Sources: [Render Blueprint reference](https://render.com/docs/blueprint-spec),
[Render build filters](https://render.com/docs/build-filters),
[Render community: Blueprint asking for a card](https://community.render.com/t/blueprint-asking-for-credit-card-even-for-free-services/15257).

## 8. Security and privacy

- **Access rule (no accounts):** knowing the room code is what grants access. A browser may stream a
  file only with a room token for the room that contains it, checked on the server. This replaces the
  current `ownerId` filtering.
- **Room codes are short, so they must be hard to guess by brute force:** limit join attempts per IP
  address, let rooms expire after inactivity, and let the host change the code if it leaks. Anyone with
  the code can join; that is the intended trade-off of "no accounts".
- **Media URLs:** short-lived and scoped to a single file. If the URL expires during playback, the next
  Range request fails and playback stops once the buffer is empty. The lifetime must cover the media
  duration plus a margin, or the client must refresh the URL.
  **Known limitation, accepted for now:** for a long film the URL stays valid for hours, and anyone it is
  forwarded to can stream the file outside the room until it expires, using up the shared B2 daily
  download allowance (§7.1).
- **Logs:** the current HTTP logger writes `req.originalUrl`, query string included. Tokens placed in URLs
  would land in the logs. Redact query strings before introducing signed URLs.
- **WebSocket authentication:** verify the room token during the handshake, and check on every room
  event that it belongs to that room, not only on join. `JWT_SECRET` stays: it signs the room tokens.
- **CORS:** `cors()` currently accepts every origin. Restrict it to the deployed frontend.
- **Quotas:** a per-room storage limit, upload rate limiting per IP address, and rooms (with their files)
  deleted after inactivity. B2's free 10 GB and 1 GB of downloads per day are shared by all rooms.
- **Copyright:** not addressed for now; the project is too small (decision, §10). For later: letting users
  upload films or music and share them with others is distribution, which would need terms of use and a
  takedown process. The P2P mode where everyone uses their own copy avoids hosting content at all.

## 9. Roadmap

Three steps, in this order: set up the free services, automate deployment, then write the project's
code. Each step and phase ends with something that can be demonstrated.

### Step 1: free services and first deploy (no card anywhere, §2)

Mostly account setup, plus the **two small backend changes** listed in §7.2 (serve the Angular build,
require `JWT_SECRET`). They are the only code written in this step, because the app cannot run on Render
without them. They go through a normal pull request to `sharing-platform`.

| Service | What to do | Details |
|---|---|---|
| GitHub | Make `conrad-gilles/M1-Web` public and add the teammate as a collaborator. | No secret has ever been committed (checked November 2026). Keep `.env` out of Git. |
| MongoDB Atlas | Production database name, network access for Render. | §7.2 |
| Render | Sign up with GitHub, create the free web service from the dashboard, set the environment variables. | §7.2 |
| Backblaze B2 | Account (EU region), private bucket, application key restricted to that bucket. Keep the keys in a password manager; they go into Render in phase 3.4. | §7.1 |
| P2P services | Nothing to create: the P2P version uses public signaling and STUN without accounts, and no TURN relay. | §4, §7 |

**Done when:** the current app runs at `https://<service>.onrender.com` (register, log in, upload and play
a track), and no service has asked for a card. This requires the `app.js` and `server.js` changes listed
in §7.2 to be on `sharing-platform`.

### Step 2: continuous deployment

**Content:** the CI workflow (§7.2) on `sharing-platform`, Render auto-deploy after CI checks pass, build filters, health
check, branch protection on `sharing-platform` (§7.2).

**Done when:** a pull request merged into `sharing-platform` goes live with no manual action; a pull request with a
failing test cannot be merged and does not deploy; a documentation-only commit does not redeploy.

### Step 3: project coding

From here on, every phase ships through the step 2 pipeline: merged into `sharing-platform` means deployed.

| Phase | Content | Done when |
|---|---|---|
| 3.1 Groundwork | Generalize `Track` into `Media` (`kind: audio \| video`). Storage module with a local-disk implementation (§7.1). Short-lived media URLs. `<audio src>` loads the URL directly instead of a Blob. Redact URLs in logs. | The Network tab shows `206 Partial Content`, playback starts before the download finishes, seeking works, tests are updated and green. |
| 3.2 Rooms | `Room` model (code, host token, participants with display names, media list, expiry). Create a room, join with the code, leave. Room tokens. Media belongs to the room. Remove the account system (register, login, profile, demo account). | Someone without an account joins with the code and streams the room's media; a wrong code or a token from another room gets `404`. |
| 3.3 Synced playback | Socket.IO on the Express server, room state, clock offset, commands, drift correction, buffering rules, "who did what" notices. | Two browsers stay within 0.5 s through play, pause and seek; a seek by either one moves both; a late joiner starts at the right position. |
| 3.4 Cloud storage | S3 implementation of the storage module for B2, presigned download URLs, `S3_*` variables added on Render. | Files survive a Render restart; reaching B2's daily limit shows a clear message. |
| 3.5 Video | Video types and size limits, direct browser upload to B2 with presigned URLs (multipart for large files, bucket CORS rules), magic-byte check, `<video>` player UI. | A 300 MB MP4 uploads, streams and stays in sync for two viewers, within B2's free 1 GB a day. |
| 3.6 P2P sync (serverless) | WebRTC DataChannels with serverless signaling (public infrastructure such as Trystero, manual copy-paste fallback), public STUN, no TURN. Local file picker, same room codes, file matching on duration and type (§6), sync reusing the phase 3.3 protocol. The room ends when the host leaves (§4). | Two peers with matching local files stay in sync with no server run by the project, no upload and no account. |
| 3.7 Future | More advanced formats converted in the browser with `ffmpeg.wasm` (§6), host migration when the host leaves, P2P file transfer (WebTorrent-style), finer-grained playback control. | — |

Until phase 3.4, uploads live on Render's local disk and are lost on every restart. That is acceptable
for demos of phases 3.1 to 3.3; if it becomes annoying, do phase 3.4 earlier.

## 10. Decisions and open questions

**Decided (November 2026)**

| Question | Decision |
|---|---|
| Who controls playback? | **Everyone** in the room. Finer-grained control may come later (§5 rule 7). |
| Buffering | The **room waits for the slowest participant**, at most 10 s, then continues without them; buffering under 0.5 s is ignored (§5 rule 5). |
| Paid services | **Never**, not even later (§2). |
| P2P host leaves | The room ends; accepted for the first P2P version (§4). |
| Forwarded playback URLs | Accepted for now (§8). |
| Sync tolerance | **0.5 s** between participants. |
| P2P file matching | **Very loose at first:** same duration and same file type only (§6). |
| Accounts | **None, in both versions.** The host shares a simple room code; others join with it and a display name (§4). |
| Seeking | **When one person seeks, everyone follows**, with a notice showing who did it (§5 rule 7). |
| P2P architecture | **Completely serverless** in the future: no server run by the project (§4). |
| Formats | Browser-native formats on the server; **MOV, AVI and MKV converted to MP4 in the uploader's browser** with `ffmpeg.wasm`, not on the server, to stay on Render's free tier (§6). |
| Size limits | **The server keeps a hard limit** (25 MB per file today) because it protects the shared free storage. **Limits that only protect the user's own device are recommendations:** a MOV/AVI/MKV over 200 MB shows a warning but can still be converted. |
| Self-hosting | **None for now.** Users do not host anything; everything the project hosts runs on free services (§2). |
| Free limit reached (B2, Atlas, Render) | **Do nothing, or show an error message.** Never pay (§2). |
| Copyright | **Nothing for now**, the project is too small (§8). |
| Demo account (`demo@example.com`) | **Removed** with the account system in phase 3.2. |

**Still open (for later)**
- Maximum room size. It drives the P2P topology: a full mesh (everyone connected to everyone) is fine
  for small groups only.
- When to add finer-grained playback control, and stricter file matching (content hash) if loose
  matching causes problems.
- Copyright position, if the platform ever grows.

## 11. Testing strategy

- **Backend:** extend the `node --test` suites: room access rules (right code vs wrong code, token from another room), media URL
  expiry, WebSocket events with a real Socket.IO client against `createApp()`.
- **Sync logic:** put the expected-position and drift-correction math in pure functions with an
  injectable clock, so it can be unit tested without browsers.
- **Manual:** two browsers in the same room, DevTools network throttling on one of them. Test seek,
  pause while buffering, late join, reconnection after a network drop.
- **P2P:** test across two different networks (home Wi-Fi + mobile hotspot) to find out whether TURN
  is needed.

## 11.1 Implementation status (branch `reese`, November 2026)

Phases 3.1, 3.2 and 3.3 are implemented, together with the two backend changes of step 1 (§7.2) and
the CI workflow of step 2. The account setup (Render, Atlas production database, Backblaze B2, branch
protection) is still to do, as are phases 3.4 to 3.7.

| Item | Where |
|---|---|
| Serve the Angular build, require `JWT_SECRET` | `backend/src/app.js`, `backend/src/server.js` |
| CI workflow | `.github/workflows/ci.yml` |
| 3.1 `Media` model, storage module (local disk), signed streaming URLs, redacted logs | `backend/src/models/Media.js`, `backend/src/storage/`, `backend/src/routes/mediaRoutes.js`, `backend/src/middleware/httpLogger.js` |
| 3.2 Rooms, room tokens, host token, expiry, accounts removed | `backend/src/models/Room.js`, `backend/src/routes/roomRoutes.js`, `backend/src/services/roomService.js`, `backend/src/middleware/roomAuth.js` |
| 3.3 Socket.IO, room state, buffering rules | `backend/src/realtime.js`, `backend/src/sync/` |
| 3.3 Clock offset, drift correction, synced player, notices | `frontend/src/app/shared/sync/`, `shared/services/sync.service.ts`, `components/sync-player/` |
| HTTP contract, WebSocket protocol | `Documentation/API_CONTRACT.md`, `Documentation/SYNC_PROTOCOL.md` |
| 3.5 (part) Video types: MP4, WebM, OGV accepted, `kind: "video"`, `<video>` player with full screen | `backend/src/config.js`, `components/media-library/`, `components/sync-player/` |
| 3.7 (early) MOV/AVI/MKV converted to MP4 in the browser (`ffmpeg.wasm`, loaded only when needed) | `frontend/src/app/shared/video/`, `shared/services/video-converter.service.ts`, `frontend/angular.json` (assets) |
| End-to-end video tests and their clips | `e2e/tests/video.spec.js`, `e2e/fixtures/` |

Choices made while implementing, to review:

- **Media URLs last 6 hours** (`MEDIA_URL_TTL_SECONDS`): the server does not know a media's duration.
- **Room size: 10 participants, 20 media per room.** This settles the "maximum room size" open
  question for now (§10).
- **A closed tab does not leave the room.** When a room is full, participants who joined more than
  2 minutes ago and are not connected to the WebSocket give up their place.
- **Rate limits per IP address:** 10 wrong codes per 10 minutes, 10 rooms created per hour. Behind
  Render's proxy, set `TRUST_PROXY=1` so the client address is used.
- **CORS is closed by default** (same origin). `CORS_ORIGIN` opens it for a frontend hosted elsewhere.
- **One session per browser (`localStorage`):** every tab of a browser is the same participant, and
  the host keeps their rights after closing the tab. Leaving the room in one tab leaves it in all of
  them. To test alone with several participants, use a private window or another browser.
- **The player has no native controls:** buttons send commands, the player only applies the shared
  state, so echo loops cannot happen (§5 rule 4).
- **Loading a media leaves it paused at 0 s**; anyone then presses play.
- **During a buffering wait:** pause cancels the automatic resume, play resumes at once, seek keeps
  waiting (§5 rule 5 did not say).
- **Video is accepted, still with the 25 MB limit** (a few minutes of video). Still missing from phase
  3.5: direct upload to B2 with presigned URLs for large files, a higher video limit, and the
  magic-byte check.
- **In-browser conversion (MOV/AVI/MKV):**
  - Tracks that browsers already play (H.264 video, AAC or MP3 audio) are copied into an MP4 in about a
    second. Anything else is re-encoded to H.264/AAC (`ultrafast` preset), which is slower, especially
    on phones. Only the first video and audio tracks are kept (MKV subtitles are dropped).
  - The ~32 MB converter is served from our own site (`/ffmpeg/`) and downloaded only when someone
    uploads one of these formats; other users never load it. The single-threaded build is used so no
    COOP/COEP headers are needed.
  - Above 200 MB, a warning explains that the conversion may be very slow or run out of memory, but the
    upload is not blocked (§10). The converted file must still fit the server's 25 MB limit.
  - The converted file is uploaded as `name.mp4`, so the library shows `.mp4` as the original name.
- **Existing data:** tracks and users created before these phases stay in their old MongoDB
  collections and are no longer read.

## 12. Documentation to add as the project grows

- `API_CONTRACT.md`: the new endpoints (rooms, media URLs) and the WebSocket events with their payloads.
- `SYNC_PROTOCOL.md`: room state, messages, tolerances, conflict and buffering rules.
- A decision log: one short entry per choice (Socket.IO vs `ws`, Backblaze B2 as the storage, same origin
  vs GitHub Pages, strict vs loose matching) with the reason.
- Keep the deployment pipeline (§7.2) up to date: new environment variables (the `S3_*` storage
  settings), B2 bucket and application key setup, bucket CORS rules.
- The list of supported formats, for users.
- Known limitations: cold start, storage quota, browser support.

## 13. Existing projects worth studying

- **Syncplay**: synchronizes local files played in mpv or VLC through a small server, and flags when
  participants' files differ. The closest existing tool to phase 3.6.
- **Watch2Gether**, **Teleparty**: server-synchronized watch parties.
- **Trystero** (serverless WebRTC signaling over public infrastructure), **PeerJS**
  (https://peerjs.com/), the official WebRTC samples, and **ffmpeg.wasm** for in-browser conversion.
