# Instructions for coding assistants

This is an Angular 22 standalone application. Read `best-practices.md` before changing code.

- Keep one class per TypeScript file and one component per component folder.
- Keep each component's TypeScript, HTML, and CSS files together.
- Use `inject()`, Signals, Reactive Forms, `@if`, and `@for`.
- Keep services, guards, authentication, interceptors, and models in `src/app/shared`.
- Preserve the HTTP contract in `../API_CONTRACT.md` and never modify `backend/`.
- If a mission intentionally changes an API route, update `../API_CONTRACT.md` in the same change and document method, URL, auth, parameters, body, responses, and errors.
- Do not put passwords or JWT secrets in frontend code.
- Keep explicit `subscribe({ next, error })` blocks at user-action/HTTP boundaries so behavior can be traced in the console.
- After a change, run `npm run build` and manually verify the browser Network panel.
