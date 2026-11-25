import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { createS3Storage } from "../src/storage/s3Storage.js";
import { createStorage } from "../src/storage/index.js";

/* -------------------------------------------------------------------------
 * Stockage S3 (Backblaze B2) avec un faux client : aucun accès réseau. Le
 * vrai bucket est vérifié à part par `npm run check:storage`.
 * ---------------------------------------------------------------------- */

const KEY = "0f8fad5b-d9cb-469f-a165-70867728950e.mp4";

/** Lit le flux jusqu'au bout, comme le vrai envoi, et renvoie son contenu. */
async function drain(stream) {
  let content = "";
  for await (const chunk of stream) content += chunk;
  return content;
}

function fakeStorage({ uploadFile, versions = [], deleteMarkers = [] } = {}) {
  const sent = [];
  const uploads = [];
  const client = {
    async send(command) {
      sent.push(command);
      if (command instanceof ListObjectVersionsCommand) return { Versions: versions, DeleteMarkers: deleteMarkers };
      return {};
    },
  };
  const presigned = [];
  const storage = createS3Storage({
    bucket: "medias",
    endpoint: "https://s3.example.test",
    client,
    uploadFile:
      uploadFile ??
      (async (_client, params) => {
        uploads.push({ ...params, content: await drain(params.Body) });
      }),
    presign: async (_client, command, options) => {
      presigned.push({ command, options });
      return `https://s3.example.test/medias/${command.input.Key}?X-Amz-Signature=abc`;
    },
  });
  return { storage, sent, uploads, presigned };
}

function tempFile(content = "données") {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "s3-test-")), "upload.tmp");
  fs.writeFileSync(file, content);
  return file;
}

test("S3 save : envoie le fichier avec son type, puis supprime le fichier temporaire", async () => {
  const { storage, uploads } = fakeStorage();
  const tempPath = tempFile();

  await storage.save({ tempPath, key: KEY, mimeType: "video/mp4" });

  assert.equal(uploads.length, 1);
  assert.deepEqual(
    { Bucket: uploads[0].Bucket, Key: uploads[0].Key, ContentType: uploads[0].ContentType },
    { Bucket: "medias", Key: KEY, ContentType: "video/mp4" },
  );
  assert.equal(uploads[0].content, "données");
  assert.equal(fs.existsSync(tempPath), false);
});

test("S3 save : quota de stockage B2 atteint → erreur STORAGE_FULL (507 côté API)", async () => {
  const capError = Object.assign(new Error("Cannot upload files, storage cap exceeded."), {
    $metadata: { httpStatusCode: 403 },
  });
  const { storage } = fakeStorage({
    uploadFile: async (_client, params) => {
      await drain(params.Body);
      throw capError;
    },
  });

  await assert.rejects(storage.save({ tempPath: tempFile(), key: KEY, mimeType: "video/mp4" }), {
    code: "STORAGE_FULL",
  });
});

test("S3 save : une autre erreur 403 n'est pas prise pour un quota", async () => {
  const denied = Object.assign(new Error("Access Denied"), { $metadata: { httpStatusCode: 403 } });
  const { storage } = fakeStorage({
    uploadFile: async (_client, params) => {
      await drain(params.Body);
      throw denied;
    },
  });

  await assert.rejects(storage.save({ tempPath: tempFile(), key: KEY }), (error) => error === denied);
});

test("S3 : une clé qui n'a pas été générée par le serveur est refusée", async () => {
  const { storage, uploads } = fakeStorage();

  await assert.rejects(storage.save({ tempPath: tempFile(), key: "../.env" }), /Clé de stockage invalide/);
  await assert.rejects(storage.signedUrl({ key: "a/b.mp4", expiresInSeconds: 60 }), /Clé de stockage invalide/);
  await assert.rejects(storage.remove("x"), /Clé de stockage invalide/);
  assert.equal(uploads.length, 0);
});

test("S3 signedUrl : URL présignée GET, type forcé, durée plafonnée à 7 jours", async () => {
  const { storage, presigned } = fakeStorage();

  const short = await storage.signedUrl({ key: KEY, mimeType: "video/mp4", expiresInSeconds: 6 * 3600 });
  const long = await storage.signedUrl({ key: KEY, mimeType: "video/mp4", expiresInSeconds: 30 * 24 * 3600 });

  assert.match(short.url, /^https:\/\/s3\.example\.test\/medias\//);
  assert.ok(presigned[0].command instanceof GetObjectCommand);
  assert.deepEqual(presigned[0].command.input, { Bucket: "medias", Key: KEY, ResponseContentType: "video/mp4" });
  assert.equal(presigned[0].options.expiresIn, 6 * 3600);
  assert.equal(presigned[1].options.expiresIn, 7 * 24 * 3600);
  const lifetime = new Date(long.expiresAt).getTime() - Date.now();
  assert.ok(lifetime <= 7 * 24 * 3600 * 1000 && lifetime > 7 * 24 * 3600 * 1000 - 60_000);
});

test("S3 signedUrl de téléchargement : pièce jointe au nom d'origine, accents compris", async () => {
  const { storage, presigned } = fakeStorage();

  await storage.signedUrl({ key: KEY, mimeType: "video/mp4", expiresInSeconds: 60, downloadName: "Été \"2026\".mp4" });

  assert.equal(
    presigned[0].command.input.ResponseContentDisposition,
    "attachment; filename=\"_t_ _2026_.mp4\"; filename*=UTF-8''%C3%89t%C3%A9%20%222026%22.mp4",
  );
});

test("S3 signedUrl de lecture : pas de pièce jointe", async () => {
  const { storage, presigned } = fakeStorage();

  await storage.signedUrl({ key: KEY, mimeType: "video/mp4", expiresInSeconds: 60 });

  assert.equal(presigned[0].command.input.ResponseContentDisposition, undefined);
});

test("S3 remove : supprime toutes les versions de ce fichier, et seulement lui", async () => {
  const { storage, sent } = fakeStorage({
    versions: [
      { Key: KEY, VersionId: "v2" },
      { Key: KEY, VersionId: "v1" },
      { Key: `${KEY}.autre`, VersionId: "x" }, // même préfixe, autre fichier
    ],
    deleteMarkers: [{ Key: KEY, VersionId: "hide" }],
  });

  await storage.remove(KEY);

  const deleted = sent.filter((command) => command instanceof DeleteObjectCommand).map((command) => command.input);
  assert.deepEqual(deleted, [
    { Bucket: "medias", Key: KEY, VersionId: "v2" },
    { Bucket: "medias", Key: KEY, VersionId: "v1" },
    { Bucket: "medias", Key: KEY, VersionId: "hide" },
  ]);
});

test("S3 remove : un fichier déjà absent n'est pas une erreur", async () => {
  const { storage, sent } = fakeStorage();

  await storage.remove(KEY);

  assert.equal(sent.filter((command) => command instanceof DeleteObjectCommand).length, 0);
});

test("createStorage : B2 si les cinq variables S3_* sont là, disque local sinon, erreur si incomplet", () => {
  const s3 = {
    S3_ENDPOINT: "https://s3.example.test",
    S3_REGION: "eu-central-003",
    S3_BUCKET: "medias",
    S3_ACCESS_KEY_ID: "id",
    S3_SECRET_ACCESS_KEY: "secret",
  };

  const remote = createStorage(s3);
  assert.equal(typeof remote.signedUrl, "function");
  assert.equal(remote.verifyUrlToken, undefined); // pas de route /stream : B2 sert les fichiers

  const local = createStorage({});
  assert.equal(typeof local.verifyUrlToken, "function");

  const { S3_BUCKET, ...incomplete } = s3;
  assert.throws(() => createStorage(incomplete), /Configuration S3 incomplète.*S3_BUCKET/);
});
