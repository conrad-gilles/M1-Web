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
- Host the **entire finished application** for free, under the hard constraint below.

**Non-goals (for now)**
- Live broadcasting (webcam, screen sharing, live events). That requires different technology
  (WebRTC media servers, HLS live). This project synchronizes **on-demand files**.
- Transcoding uploaded files into other formats (too CPU-heavy for free hosting).
- Sample-accurate sync for several speakers in the **same physical room** (< 50 ms). That is a much
  harder problem than a remote watch party.
- Large public audiences. The target is small groups (2 to 10 people per room).

**Hard constraint: 100 % free, no credit card on any service**
- The **entire finished application** (frontend, API, WebSocket server, database, media storage and the
  P2P helper services) runs on free tiers. This applies to the final version, not only the PoC.
- **No service may ask for a credit card, PayPal or any other payment method**, not even "for
  verification" or to unlock a free tier. A service that asks for one is rejected, whatever its limits.
  Firebase Storage and Cloudflare R2 already fail this rule (§7.1).
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
| Sharing | Every query filters on `ownerId`: a user can only see their own tracks. | Needs rooms and membership. |
| Streaming | The backend's `res.sendFile` already answers HTTP Range requests (`206 Partial Content`). **But** the frontend downloads the whole file as a Blob through `HttpClient`, because the JWT travels in the `Authorization` header and `<audio src>` / `<video src>` cannot send headers. | The media element needs a URL it can load directly. |
| Real time | REST only. | Needs a real-time channel (WebSocket). |
| Tests | `node --test` backend with mocked Mongoose, Vitest frontend. | Good base to extend. |

## 4. Target architecture

### Phase A: server-synchronized (v1)

```text
  Browser (Angular)                   Node / Express API              Object storage (B2, S3 API)
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

Free tiers as checked in October–November 2026. Every service below is used **without a card** (§2).
Re-check them before creating the accounts.

| Service | Role | Card? | Limits that matter |
|---|---|---|---|
| [Render](https://render.com/docs/free) (free web service) | Node API + WebSocket, and the built Angular app | No | Sleeps after 15 min without traffic, about 1 min to wake up. The **local filesystem is wiped** on restart, redeploy and sleep. No persistent disk on the free plan. 750 instance hours per month per workspace: enough for **one** service running all month, which is another reason to serve API and frontend from the same service. |
| [MongoDB Atlas](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) (free cluster) | Users, media metadata, rooms | No | 512 MB in total. Metadata only, never media files (GridFS). Paused after 30 days without any connection; resume it from the Atlas dashboard. |
| [Backblaze B2](https://www.backblaze.com/cloud-storage/pricing) (free tier) | Media files (choice explained in §7.1) | No (private bucket) | 10 GB of storage. Per day: 1 GB of downloads and 2,500 download requests. S3-compatible: private bucket, presigned URLs, Range requests. |
| GitHub Pages | Angular frontend (optional) | No | Static files only. Deep links such as `/rooms/abc` need a `404.html` fallback. The dev proxy (`proxy.conf.json`) does not exist in production, so the frontend needs an API base URL and the backend a CORS configuration. |
| PeerServer (`peer` package inside the Express app) | P2P signaling (phase 3.6) | No (runs on Render) | Reuses the Render service; no extra account. The public PeerJS cloud server is a no-account fallback. |
| Google public STUN (`stun:stun.l.google.com:19302`) | P2P address discovery (phase 3.6) | No account | Enough for most home connections. |
| TURN relay (for example [Metered](https://www.metered.ca/stun-turn) free tier) | P2P relay when a direct connection fails (phase 3.6) | No, at the time of writing | Small monthly allowance (500 MB advertised). Sync messages are tiny, so it is enough. If no card-free TURN remains, peers behind strict networks simply cannot join; accepted limitation. |

Consequences:
- The current upload code would lose every file on Render. **Storage must move to object storage
  (Backblaze B2, see §7.1) before deploying anything that accepts uploads.**
- Simplest PoC deployment: serve the built Angular app from Express on Render (same origin). No CORS,
  no cross-site cookie problems, a single deployment. Use GitHub Pages only if separate hosting is wanted.
- Cold start: the first visitor after a quiet period waits about a minute. WebSocket messages count as
  traffic, so an active room keeps the instance awake.
- Room state kept in memory works for **a single server instance**. Several instances would need shared
  state (for example Redis). That is fine for a PoC.

### 7.1 Media storage for the PoC (free, no card)

The uploaded files are already outside Git (`backend/data/uploads/` is gitignored), but they sit on the
server's own disk, which Render wipes. The PoC needs a storage service that the backend talks to.

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
  local disk for development and tests, S3 for B2. Tests keep running offline, and moving to R2 or AWS S3
  later only changes environment variables.
- **Upload.** Audio (up to 25 MB): Node keeps receiving the upload with Multer and forwards it to B2
  (`@aws-sdk/lib-storage`), then saves the metadata. Video (phase 3.5): the browser uploads directly to B2
  with a presigned URL (this needs CORS rules on the bucket) and Node only records the metadata.
- **Playback.** The API checks ownership or room membership, then returns a presigned GET URL
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
  per-user quotas, and rely on phase 3.6, where every viewer plays their own local copy and storage
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

**Code changes needed before the first deploy** (roadmap step 1, §9; not made yet)
- `backend/src/app.js`: when `frontend-starter/dist/gpc/browser/index.html` exists, serve that folder with
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
    defaults: { run: { working-directory: frontend-starter } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: frontend-starter/package-lock.json }
      - run: npm ci
      - run: npm test
      - run: npm run build
```

```text
push / PR ──► GitHub Actions (CI: backend tests, frontend tests, build)
                    │ checks green on main
                    ▼
              Render: builds Angular, starts Express ──► MongoDB Atlas (free cluster)
              https://<service>.onrender.com
```

**How it works**
1. Anyone pushes to any branch or opens a pull request → CI runs all tests (GitHub Actions is free for
   public repos).
2. A merge (or push) to `main` → Render waits until CI is green, then redeploys automatically.
3. Commits that only touch documentation do not redeploy (build filters below).
4. The database needs no redeploy: Mongoose creates collections and indexes when the server starts.
   Data migrations, if ever needed, would be a separate script.

Express serves the Angular build, so the frontend and the API share one URL: no CORS configuration, and
Angular's relative `/api/...` calls work as in development.

**Step 1 setup: MongoDB Atlas** (roadmap step 1, §9)
- **Network Access:** Render's free plan has no fixed IP. Add the outbound IPs shown in the Render
  service (Connect → Outbound), or `0.0.0.0/0` with a strong database password.
- Use a separate database name for production (for example `guitar-practice-prod` in the URI) so
  development data stays apart.

**Step 1 setup: Render service (dashboard, not Blueprint)**

Create the service from the dashboard: **New → Web Service → connect GitHub → `conrad-gilles/M1-Web`**.
Blueprints (`render.yaml`) were reported to ask for a card even for free services; the dashboard flow
does not.

| Setting | Value |
|---|---|
| Branch | `main` |
| Region | Frankfurt |
| Root Directory | *(empty)* |
| Runtime | Node |
| Build Command | `cd frontend-starter && npm ci && npm run build && cd ../backend && npm ci` |
| Start Command | `cd backend && node src/server.js` |
| Instance Type | **Free** |

Environment variables (Render dashboard only, never in Git):

| Key | Value |
|---|---|
| `MONGODB_URI` | The Atlas URI with the production database name |
| `JWT_SECRET` | A long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `NODE_VERSION` | `22` |

The server refuses to start without `JWT_SECRET`: the fallback secret in `app.js` is visible in the
public repo, so anyone could forge tokens with it. The B2 settings (`S3_*`, §7.1) join this list in
phase 3.4.

**Step 2 setup: Render auto-deploy** (roadmap step 2, §9)

In the service's **Settings**:
- **Health Check Path:** `/api/health`
- **Auto-Deploy:** *After CI checks pass*
- **Build Filters → Included paths:** `backend/**`, `frontend-starter/**`

**Step 2 setup: GitHub branch protection**

**Settings → Branches → add a rule for `main`:** require a pull request and require the `backend` and
`frontend` checks to pass. Nobody (human or AI assistant) can then push untested code to production.

**Team workflow**
1. Work on a branch (`gilles`, the teammate's branch, ...) and push it: CI runs.
2. Open a pull request to `main`. Merge once CI is green.
3. Render deploys `main` a few minutes later. Follow it in the service's **Events** and **Logs** tabs.
4. Something broke? Render → **Events** → *Rollback* to the previous deploy, then fix on a branch.

**Known limitations of the current deployment**
- **Uploaded files disappear** on every restart, redeploy and sleep: they stay on Render's local disk
  until storage moves to Backblaze B2 (§7.1, phase 3.4).
- **Cold start:** after 15 minutes without traffic, the first request waits about a minute.
- **Demo account:** `server.js` creates `demo@example.com` / `Demo1234!`, a password published in the
  README. Anyone can log in with it on the public deployment.

Sources: [Render Blueprint reference](https://render.com/docs/blueprint-spec),
[Render build filters](https://render.com/docs/build-filters),
[Render community: Blueprint asking for a card](https://community.render.com/t/blueprint-asking-for-credit-card-even-for-free-services/15257).

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
- **Quotas:** a per-user storage limit and upload rate limiting. B2's free 10 GB and 1 GB of downloads
  per day are shared by all users.
- **Copyright:** letting users upload films or music and share them with others is distribution. A public
  deployment would need terms of use and a takedown process. The P2P mode where everyone uses their own
  copy avoids hosting content at all.

## 9. Roadmap

Three steps, in this order: set up the free services, automate deployment, then write the project's
code. Each step and phase ends with something that can be demonstrated.

### Step 1: free services (no card anywhere, §2)

| Service | What to do | Details |
|---|---|---|
| GitHub | Make `conrad-gilles/M1-Web` public and add the teammate as a collaborator. | No secret has ever been committed (checked November 2026). Keep `.env` out of Git. |
| MongoDB Atlas | Production database name, network access for Render. | §7.2 |
| Render | Sign up with GitHub, create the free web service from the dashboard, set the environment variables. | §7.2 |
| Backblaze B2 | Account (EU region), private bucket, application key restricted to that bucket. Keep the keys in a password manager; they go into Render in phase 3.4. | §7.1 |
| TURN relay | Not yet: create the account in phase 3.6, only if peers cannot connect directly. | §7 |

**Done when:** the current app runs at `https://<service>.onrender.com` (register, log in, upload and play
a track), and no service has asked for a card. This requires the `app.js` and `server.js` changes listed
in §7.2 to be on `main`.

### Step 2: continuous deployment

**Content:** the CI workflow (§7.2) on `main`, Render auto-deploy after CI checks pass, build filters, health
check, branch protection on `main` (§7.2).

**Done when:** a pull request merged into `main` goes live with no manual action; a pull request with a
failing test cannot be merged and does not deploy; a documentation-only commit does not redeploy.

### Step 3: project coding

From here on, every phase ships through the step 2 pipeline: merged into `main` means deployed.

| Phase | Content | Done when |
|---|---|---|
| 3.1 Groundwork | Generalize `Track` into `Media` (`kind: audio \| video`). Storage module with a local-disk implementation (§7.1). Short-lived media URLs. `<audio src>` loads the URL directly instead of a Blob. Redact URLs in logs. | The Network tab shows `206 Partial Content`, playback starts before the download finishes, seeking works, tests are updated and green. |
| 3.2 Rooms | `Room` model (owner, members, media list, invite code). Create, join, leave. Members can stream the room's media. | User B streams a file uploaded by user A only after joining A's room; a non-member gets `404`. |
| 3.3 Synced playback | Socket.IO on the Express server, room state, clock offset, commands, drift correction. | Two browsers with two accounts stay within 0.5 s through play, pause and seek; a late joiner starts at the right position. |
| 3.4 Cloud storage | S3 implementation of the storage module for B2, presigned download URLs, `S3_*` variables added on Render. | Files survive a Render restart; reaching B2's daily limit shows a clear message. |
| 3.5 Video | Video types and size limits, direct browser upload to B2 with presigned URLs (multipart for large files, bucket CORS rules), magic-byte check, `<video>` player UI. | A 300 MB MP4 uploads, streams and stays in sync for two viewers, within B2's free 1 GB a day. |
| 3.6 P2P sync | PeerJS, local file picker, content fingerprint, DataChannel sync reusing the phase 3.3 protocol. | Two peers with the same local file stay in sync without uploading anything to a server. |
| 3.7 Optional | Docker image for self-hosting, host migration when the host leaves, P2P file transfer (WebTorrent-style). | — |

Until phase 3.4, uploads live on Render's local disk and are lost on every restart. That is acceptable
for demos of phases 3.1 to 3.3; if it becomes annoying, do phase 3.4 earlier.

## 10. Open questions

- Who controls playback: everyone, or only the host (who can hand control to others)?
- Buffering: does the room wait for everyone, or do slow participants catch up on their own?
- Sync tolerance: 0.5 s suits a remote watch party. Under 50 ms (same physical room) is a different project.
- Maximum room size. It drives the P2P topology: a full mesh (everyone connected to everyone) is fine
  for small groups only.
- P2P file matching: strict (hash) or loose (duration) by default?
- Does the P2P version keep accounts, or use anonymous rooms with invite links?
- Self-hosting: nice to have, not required. It would need a Docker image and an installation guide.
- The exact behaviour at each free limit (B2 daily allowance, Atlas 512 MB, Render hours), since paying
  is never an option (§2).
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
- A decision log: one short entry per choice (Socket.IO vs `ws`, Backblaze B2 for the PoC and when to
  switch, same origin vs GitHub Pages, strict vs loose matching) with the reason.
- Keep the deployment pipeline (§7.2) up to date: new environment variables (the `S3_*` storage
  settings), B2 bucket and application key setup, bucket CORS rules.
- The list of supported formats, for users.
- Known limitations: cold start, storage quota, browser support.

## 13. Existing projects worth studying

- **Syncplay**: synchronizes local files played in mpv or VLC through a small server, and flags when
  participants' files differ. The closest existing tool to phase 3.6.
- **Watch2Gether**, **Teleparty**: server-synchronized watch parties.
- **PeerJS** documentation (https://peerjs.com/) and the official WebRTC samples.
