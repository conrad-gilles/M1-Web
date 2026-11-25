import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SONG, createRoom, gap, joinRoom, newPerson, playButton, player } from "./helpers.js";

/*
 * Fichiers locaux synchronisés : rien n'est envoyé, chaque participant choisit
 * sa propre copie, reconnue à sa durée seulement (le nom peut différer). La
 * lecture passe par le même lecteur et la même synchronisation que les
 * fichiers envoyés.
 */
const CLIP = path.resolve(import.meta.dirname, "../fixtures/clip.mp4");

/** La même vidéo sous un autre nom, comme la copie d'un autre participant. */
const copyOfClip = (name) => ({ name, mimeType: "video/mp4", buffer: fs.readFileSync(CLIP) });

/** Toute requête qui enverrait un fichier au serveur ou au stockage. */
function watchUploads(page) {
  const uploads = [];
  page.on("request", (request) => {
    const isMultipart = (request.headers()["content-type"] ?? "").startsWith("multipart/");
    if (isMultipart || request.url().includes("backblazeb2.com")) uploads.push(request.url());
  });
  return uploads;
}

async function declareLocal(page, file, title) {
  const card = page.locator("app-local-media");
  await card.getByRole("textbox", { name: "Titre" }).fill(title);
  await card.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(file);
  await expect(card.getByText(/Durée : 0:08 \(vidéo\)/)).toBeVisible();
  await card.getByRole("button", { name: "Ajouter au salon" }).click();
  await expect(card.getByText("chacun lira sa propre copie")).toBeVisible();
}

const readyVideo = (page) =>
  page.waitForFunction(() => (document.querySelector("app-sync-player video")?.readyState ?? 0) >= 1);

test("deux personnes lisent chacune leur copie locale, synchronisées, sans rien envoyer", async ({ page, browser }) => {
  const alexUploads = watchUploads(page);
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  const samUploads = watchUploads(sam);
  await joinRoom(sam, code, "Sam");

  await declareLocal(page, CLIP, "Clip local");

  // Sam voit le média local dans la bibliothèque, sans en avoir le fichier.
  const samCard = sam.locator(".media-card", { hasText: "Clip local" });
  await expect(samCard.locator(".badge.local")).toBeVisible();
  await samCard.locator(".media-actions button", { hasText: "▶" }).click();

  // Alex a déclaré le fichier : son lecteur le lit tout de suite. Sam doit choisir sa copie.
  await readyVideo(page);
  const picker = sam.locator("app-sync-player .local-pick");
  await expect(picker).toContainText("Choisissez votre copie de « Clip local »");

  // Mauvais fichier (autre durée) : refusé.
  await picker.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(SONG);
  await expect(picker.getByRole("alert")).toContainText("celui du salon 0:08");
  await expect(sam.locator("app-sync-player video, app-sync-player audio")).toHaveCount(0);

  // Même vidéo sous un autre nom : acceptée.
  await picker.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(copyOfClip("Ma copie à moi.mp4"));
  await readyVideo(sam);
  await expect(picker).toHaveCount(0);
  expect(await sam.evaluate(() => document.querySelector("app-sync-player video").src)).toMatch(/^blob:/);

  // Même lecteur, même synchronisation que pour un fichier envoyé.
  await playButton(sam).click();
  await expect.poll(async () => (await player(page)).time).toBeGreaterThan(1.5);
  expect((await player(sam)).paused).toBe(false);
  expect(await gap(page, sam)).toBeLessThan(0.5);

  expect(alexUploads).toEqual([]);
  expect(samUploads).toEqual([]);
});

test("l'upload reste disponible à côté des fichiers locaux", async ({ page }) => {
  await createRoom(page, "Alex");

  await expect(page.getByRole("heading", { name: "Ajouter un média" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Synchroniser un fichier local" })).toBeVisible();
});
