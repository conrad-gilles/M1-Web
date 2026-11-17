# Gemini instructions

Follow `AGENTS.md` and `best-practices.md`. Keep one class per TypeScript file, colocate each component's `.ts`, `.html`, and `.css`, use `inject()` and Signals, preserve the documented API routes and Socket.IO events, and never put secrets in Angular code. If a route or an event changes intentionally, update `../Documentation/API_CONTRACT.md` or `../Documentation/SYNC_PROTOCOL.md` in the same change. Player buttons send commands to the server; the player only applies the shared state it receives back.
