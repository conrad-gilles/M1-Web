# Claude instructions

Follow `AGENTS.md` and `best-practices.md`. This project uses Angular 22 standalone components, `inject()`, Signals, Reactive Forms, and native `@if`/`@for` control flow. Keep shared infrastructure in `src/app/shared`. Preserve `../Documentation/API_CONTRACT.md` and `../Documentation/SYNC_PROTOCOL.md`; if a route or a Socket.IO event must change, change `backend/` in the same mission and update the matching document. The server is the single source of truth for playback: buttons send commands, the player only applies the shared state.
