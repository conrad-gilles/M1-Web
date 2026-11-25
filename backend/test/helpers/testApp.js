import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { io as connectSocket } from "socket.io-client";
import { createApp } from "../../src/app.js";
import { SECRET } from "../../src/config.js";
import { Media } from "../../src/models/Media.js";
import { Room } from "../../src/models/Room.js";
import { attachRealtime } from "../../src/realtime.js";
import { createLocalStorage } from "../../src/storage/localStorage.js";
import { installFakeDb } from "./fakeDb.js";

/**
 * Démarre l'application sur un port libre, avec une base simulée en mémoire
 * et un stockage dans un dossier temporaire.
 */
export async function startTestApp({ limits = { creationsPerHour: Infinity } } = {}) {
  const db = installFakeDb(Room, Media);
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharing-platform-uploads-"));
  const storage = createLocalStorage({ directory: uploadsDir, secret: SECRET });
  const app = createApp({ storage, limits, frontendDir: path.join(uploadsDir, "aucun-build") });
  // Comme server.js : Express et Socket.IO partagent le même serveur HTTP.
  const server = http.createServer(app);
  const realtime = attachRealtime(server);
  const sockets = [];
  server.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const json = (method, url, { token, body, headers } = {}) =>
    fetch(base + url, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  return {
    app,
    base,
    db,
    server,
    storage,
    uploadsDir,
    json,

    /** Crée un salon et renvoie `{ room, participant, token, hostToken }`. */
    async createRoom(name = "Hôte") {
      return (await json("POST", "/api/rooms", { body: { name } })).json();
    },

    /** Rejoint un salon et renvoie `{ room, participant, token }`. */
    async joinRoom(code, name = "Invité") {
      return (await json("POST", `/api/rooms/${code}/join`, { body: { name } })).json();
    },

    /** Envoie un multipart avec les champs demandés. */
    upload(token, { title, file } = {}) {
      const form = new FormData();
      if (title) form.append("title", title);
      if (file) form.append("file", new Blob([file.content], { type: file.type }), file.name);
      return fetch(base + "/api/media", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
      });
    },

    /**
     * Ouvre un WebSocket avec un jeton de salon et attend l'état initial.
     * Renvoie le socket, complété par `initial` (premier "room:state") par
     * `next(event)` qui attend le prochain événement de ce nom, par `until` et
     * par `command` qui envoie une commande de lecture.
     */
    connect(token) {
      const socket = connectSocket(base, { auth: { token }, transports: ["websocket"], reconnection: false });
      sockets.push(socket);
      // Envoyé juste après l'état initial : retenu dès la création du socket.
      socket.chatHistory = new Promise((resolve) => socket.once("chat:history", resolve));
      socket.next = (event) => new Promise((resolve) => socket.once(event, resolve));
      // Attend le premier événement de ce nom qui satisfait la condition.
      socket.until = (event, predicate) =>
        new Promise((resolve) => {
          const listener = (payload) => {
            if (!predicate(payload)) return;
            socket.off(event, listener);
            resolve(payload);
          };
          socket.on(event, listener);
        });
      socket.command = (command) =>
        new Promise((resolve) => socket.emit("playback:command", command, resolve));
      return new Promise((resolve, reject) => {
        socket.once("room:state", (state) => resolve(Object.assign(socket, { initial: state })));
        socket.once("connect_error", reject);
      });
    },

    /** Fichiers présents dans le stockage. */
    storedFiles: () => fs.readdirSync(uploadsDir),

    async stop() {
      for (const socket of sockets) socket.disconnect();
      await realtime.close();
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    },
  };
}

export const mp3 = (content = "ID3-données", name = "morceau.mp3") => ({
  content,
  type: "audio/mpeg",
  name,
});
