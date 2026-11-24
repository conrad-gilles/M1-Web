# Claude instructions

Each part of the project has its own instructions: `backend/CLAUDE.md`,
`frontend/CLAUDE.md`. The rules below apply everywhere.

## Tests

- Every new feature or behaviour change ships with tests in the same change:
  - **unit tests** for the new logic (`backend/test/*.test.js`,
    `frontend/src/**/*.spec.ts`);
  - **integration tests** for the full path it touches: HTTP routes through
    Express in `backend/test/`, and a Playwright scenario in `e2e/tests/` when
    the feature is visible in the browser.
- After any significant change, run the suites and report the results:
  - `backend/`: `npm test`
  - `frontend/`: `npm test` and `npm run build`
  - `e2e/`: `npx playwright test` when the change affects what the user sees.
- `.githooks/pre-push` runs the backend and frontend suites and the build
  before every push; CI (`.github/workflows/ci.yml`) also runs e2e. Keep both
  in sync when a suite or command is added.
- Never consider a feature done while a related test fails. A failing test
  that is unrelated to the change is reported, not silenced.

## Documentation

Every new feature or behaviour change is documented in the same change:

- `README.md` when it changes what a user or developer sees (features,
  formats, limits, commands);
- `SharingPlatformProjectClaude.md`: the implementation status (§11.1), and
  the decisions table (§10) when a choice was made;
- `Documentation/API_CONTRACT.md` or `Documentation/SYNC_PROTOCOL.md` when the
  HTTP contract or the real-time protocol changes.
