# Instructions for coding assistants

This is the Angular 22 standalone frontend of Sharing Platform. Read `best-practices.md` before changing code.

- Keep one class per TypeScript file and one component per component folder.
- Keep each component's TypeScript, HTML, and CSS files together.
- Use `inject()`, Signals, Reactive Forms, `@if`, and `@for`.
- Keep services, guards, interceptors, models, sync logic, and test helpers in `src/app/shared`.
- There are no user accounts: the room session (room token, participant, host token) lives in `RoomSessionService` and is shared by all tabs of a browser.
- The server is the single source of truth for playback. Player buttons send commands through `SyncService` and the player only applies the shared state it receives back; never let media element events (`play`, `pause`, `seeked`) send commands, or echo loops appear.
- Keep sync math (expected position, drift correction, clock offset) in pure functions in `src/app/shared/sync/`, with time passed as a parameter, and unit test them.
- Preserve the HTTP contract in `../Documentation/API_CONTRACT.md` and the real-time protocol in `../Documentation/SYNC_PROTOCOL.md`.
- If a change needs a new or modified API route or Socket.IO event, change `backend/` in the same mission and update the matching document with method, URL, auth, parameters, body, responses, and errors (or the event and its payload).
- Do not put secrets in frontend code. Tokens come from the API at runtime only.
- Keep explicit `subscribe({ next, error })` blocks at user-action/HTTP boundaries so behavior can be traced in the console.
- After a change, run `npm test` and `npm run build`, then check the browser Network panel (HTTP and WebSocket).
