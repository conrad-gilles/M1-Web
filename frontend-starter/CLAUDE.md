# Claude instructions

Follow `AGENTS.md` and `best-practices.md`. This project uses Angular 22 standalone components, `inject()`, Signals, Reactive Forms, and native `@if`/`@for` control flow. Preserve `API_CONTRACT.md`, keep shared infrastructure in `src/app/shared`, and do not modify `backend/`. If an API route must intentionally change, update `API_CONTRACT.md` in the same change with its method, URL, auth, parameters, body, responses, and errors.
