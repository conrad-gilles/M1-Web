# Help — Running the Guitar Practice Cloud project

This file summarizes everything needed to start the project again (backend +
frontend) after a restart, closed terminals, etc. It is not required by the
assignment: it is just a personal memo.

## Prerequisites (already in place)

- Node.js **v22.22.3 or newer** (checked: v22.23.2 installed via
  `winget upgrade OpenJS.NodeJS.22`). Check with:

  ```bash
  node -v
  ```

  If the version is too old, `ng serve`/`ng build` refuse to start.

- `backend/.env` is already created and filled in with the MongoDB Atlas URI
  and a randomly generated `JWT_SECRET`. **Never commit this file** (check
  with `git status` that it does not appear).

- **Do not use PowerShell** as the terminal for this project (course
  instruction): use Git Bash.

## 1. Start the backend

In a first terminal:

```bash
cd backend
npm install       # only if node_modules was deleted
npm start
```

The backend listens on `http://localhost:3000`. Check that it responds:

```bash
curl http://localhost:3000/api/health
# should respond {"status":"ok"}
```

On startup, the terminal should display (the app's log messages are in
French):

```text
[startup] Connecté à MongoDB Atlas
[startup] La base guitar-practice-cloud est prête à recevoir des données
[startup] Compte de démonstration déjà présent   (or "créé" the first time)
Guitar Practice Cloud API: http://localhost:3000/api/health
```

If a MongoDB connection error is displayed instead: check `backend/.env`
(URI, password, IP allowed in Atlas → Network Access).

## 2. Start the frontend

In a **second** terminal (leave the first one running):

```bash
cd frontend-starter
npm install       # only if node_modules was deleted
npm start
```

Then open `http://localhost:4200` in the browser.

### If `npm install` fails with a `Cannot read properties of null (reading 'edgesOut')` error

This is a known npm bug with dependency resolution (peer deps). Fix:

```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

## 3. Log in

Demo account:

- email: `demo@example.com`
- password: `Demo1234!`

Or create an account through the sign-up page.

## 4. Stop the servers

In each terminal, `Ctrl + C`.

## Quick summary (once everything is configured)

```bash
# Terminal 1
cd backend && npm start

# Terminal 2
cd frontend-starter && npm start

# Browser
http://localhost:4200
```

## Quick troubleshooting

| Symptom | Likely cause | Solution |
|---|---|---|
| `ng serve`/`ng build` refuses to start, Node version error | Node too old | `winget upgrade OpenJS.NodeJS.22` (or reinstall Node ≥ 22.22.3) then open a new terminal |
| `Cannot read properties of null (reading 'edgesOut')` during `npm install` | npm/Arborist bug with peer deps | `rm -rf node_modules package-lock.json && npm install --legacy-peer-deps` |
| Backend: `Échec de connexion à MongoDB` (MongoDB connection failed) | Wrong URI/password, or IP not allowed | Check `backend/.env`, check Atlas → Network Access → IP Access List |
| Blank page or CORS/404 errors on `/api/...` | Backend not started, or `proxy.conf.json` misconfigured | Check that the backend is running on port 3000 and that `frontend-starter/proxy.conf.json` points to `http://localhost:3000` |
| `401` on every request after a while | JWT token expired (lifetime: 2h) | Log in again; the app now automatically redirects to `/login` in this case |
| Upload rejected with an error message | Unsupported format (only MP3, WAV, OGG, M4A) or file > 25 MB | Check the file you are using, try the ones in `frontend-starter/fichiers-audio-de-test/` |
