import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  createRoom,
  gap,
  joinRoom,
  newPerson,
  playButton,
  player,
  uploadSong,
  waitForPlayer,
} from "./helpers.js";

/*
 * Vidéo de bout en bout : upload, lecteur <video> synchronisé entre deux
 * personnes, et conversion dans le navigateur des MOV/AVI/MKV (FFmpeg
 * WebAssembly, chargé seulement quand il sert).
 *
 * Les clips de test (8 s, 320x240, piste audio silencieuse) sont dans
 * e2e/fixtures/ :
 *   clip.mp4 : H.264 + AAC, envoyé tel quel ;
 *   clip.mkv : H.264 + AAC, pistes recopiées dans un MP4 ;
 *   clip.avi : MPEG-4 Part 2 + PCM, réencodé en H.264 + AAC.
 */
const clip = (name) => path.resolve(import.meta.dirname, "../fixtures", name);

/** Le convertisseur (~32 Mo) n'est téléchargé que si la page en a besoin. */
function watchConverterDownload(page) {
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("/ffmpeg/")) requests.push(request.url());
  });
  return requests;
}

async function uploadVideo(page, file, title) {
  await page.getByRole("textbox", { name: "Titre" }).fill(title);
  await page.locator('input[type="file"]').setInputFiles(clip(file));
  await page.getByRole("button", { name: "Envoyer" }).click();
  // La conversion d'une vidéo réencodée peut prendre quelques secondes.
  await expect(page.locator(".media-card", { hasText: title })).toBeVisible({ timeout: 60_000 });
}

async function play(person, title) {
  await person.locator(".media-card", { hasText: title }).locator(".media-actions button", { hasText: "▶" }).click();
}

test("une vidéo MP4 s'ouvre dans un lecteur <video> synchronisé, sans charger le convertisseur", async ({
  page,
  browser,
}) => {
  const downloads = watchConverterDownload(page);
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  await joinRoom(sam, code, "Sam");

  await uploadVideo(page, "clip.mp4", "Clip MP4");
  await expect(sam.locator(".media-card", { hasText: "Clip MP4" })).toContainText("MP4");
  await play(sam, "Clip MP4");
  await Promise.all([waitForPlayer(page), waitForPlayer(sam)]);

  for (const person of [page, sam]) {
    await expect(person.locator("app-sync-player video")).toBeVisible();
    await expect(person.locator("app-sync-player audio")).toHaveCount(0);
    await expect(person.getByRole("button", { name: "Plein écran" })).toBeVisible();
  }

  await playButton(page).click();
  await expect.poll(async () => (await player(sam)).time).toBeGreaterThan(1.5);
  expect((await player(page)).paused).toBe(false);
  expect(await gap(page, sam)).toBeLessThan(0.5);

  expect(downloads).toEqual([]);
});

test("passer d'un audio à une vidéo remplace <audio> par <video> chez tout le monde", async ({ page, browser }) => {
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  await joinRoom(sam, code, "Sam");
  await uploadSong(page);
  await uploadVideo(page, "clip.mp4", "Clip MP4");

  await play(page, "Song 1");
  await Promise.all([waitForPlayer(page), waitForPlayer(sam)]);
  await expect(sam.locator("app-sync-player audio")).toHaveCount(1);
  await expect(sam.getByRole("button", { name: "Plein écran" })).toHaveCount(0);

  await play(page, "Clip MP4");
  for (const person of [page, sam]) {
    await expect(person.locator("app-sync-player video")).toBeVisible();
    await expect(person.locator("app-sync-player audio")).toHaveCount(0);
    await expect(person.locator(".now-playing")).toContainText("Clip MP4");
  }
});

test("un MKV est converti en MP4 dans le navigateur, puis lu par les autres participants", async ({
  page,
  browser,
}) => {
  const downloads = watchConverterDownload(page);
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  const samDownloads = watchConverterDownload(sam);
  await joinRoom(sam, code, "Sam");

  await uploadVideo(page, "clip.mkv", "Clip MKV");

  // Seule la personne qui envoie le MKV télécharge le convertisseur.
  expect(downloads.some((url) => url.endsWith("ffmpeg-core.wasm"))).toBe(true);
  const card = sam.locator(".media-card", { hasText: "Clip MKV" });
  await expect(card).toContainText("clip.mp4");
  await expect(card).toContainText("MP4");

  await play(sam, "Clip MKV");
  await Promise.all([waitForPlayer(page), waitForPlayer(sam)]);
  await expect(sam.locator("app-sync-player video")).toBeVisible();
  const duration = await sam.evaluate(() => document.querySelector("video").duration);
  expect(duration).toBeGreaterThan(7.5);
  expect(samDownloads).toEqual([]);
});

test("un AVI dont les codecs ne sont pas lisibles est réencodé, puis lu", async ({ page }) => {
  await createRoom(page, "Alex");

  await uploadVideo(page, "clip.avi", "Clip AVI");

  await expect(page.locator(".media-card", { hasText: "Clip AVI" })).toContainText("clip.mp4");
  await play(page, "Clip AVI");
  await waitForPlayer(page);
  // Le navigateur sait décoder le résultat : dimensions et durée sont connues.
  const video = await page.evaluate(() => {
    const el = document.querySelector("video");
    return { width: el.videoWidth, height: el.videoHeight, duration: el.duration };
  });
  expect(video).toMatchObject({ width: 320, height: 240 });
  expect(video.duration).toBeGreaterThan(7.5);
});
