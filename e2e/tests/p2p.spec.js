import path from "node:path";
import { expect, test } from "@playwright/test";
import { createRoom, gap, joinRoom, newPerson, player, playButton, seekTo } from "./helpers.js";

/*
 * Partage direct (P2P) : Alex garde le fichier sur son appareil, Sam le reçoit
 * directement de son navigateur (WebRTC), le lecteur le lit comme un fichier
 * en ligne (service worker, requêtes Range) et la lecture reste synchronisée.
 * Rien n'est envoyé au serveur ni au stockage.
 */
const CLIP = path.resolve(import.meta.dirname, "../fixtures/clip.mp4");

const p2pCard = (page) => page.locator("app-p2p-share");

async function shareLive(page, title) {
  const card = p2pCard(page);
  await card.getByRole("textbox", { name: "Titre" }).fill(title);
  await card.locator('input[type="file"]').setInputFiles(CLIP);
  await expect(card.getByText(/Durée : 0:08 \(vidéo\)/)).toBeVisible();
  await card.getByRole("button", { name: "Partager", exact: true }).click();
  await expect(card.getByText("est partagé en direct depuis votre appareil")).toBeVisible();
}

const readyVideo = (page) =>
  page.waitForFunction(() => (document.querySelector("app-sync-player video")?.readyState ?? 0) >= 1, null, {
    timeout: 30_000,
  });

function watchUploads(page) {
  const uploads = [];
  page.on("request", (request) => {
    const multipart = (request.headers()["content-type"] ?? "").startsWith("multipart/");
    if (multipart || request.url().includes("backblazeb2.com")) uploads.push(request.url());
  });
  return uploads;
}

test("Sam lit en direct le fichier d'Alex, synchronisé, sans rien envoyer au serveur", async ({ page, browser }) => {
  const uploads = watchUploads(page);
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  uploads.push(...watchUploads(sam));
  await joinRoom(sam, code, "Sam");

  await shareLive(page, "Film en direct");
  const card = sam.locator(".media-card", { hasText: "Film en direct" });
  await expect(card).toContainText("Partagé en direct par Alex");
  await expect(card.locator("button.download")).toHaveCount(0);

  await card.locator(".media-actions button", { hasText: "▶" }).click();
  await Promise.all([readyVideo(page), readyVideo(sam)]);
  // Alex lit son propre fichier ; Sam, le flux reçu d'Alex.
  expect(await page.evaluate(() => document.querySelector("app-sync-player video").currentSrc)).toMatch(/^blob:/);
  expect(await sam.evaluate(() => document.querySelector("app-sync-player video").currentSrc)).toContain("/p2p-stream/");
  expect(await sam.evaluate(() => document.querySelector("app-sync-player video").duration)).toBeGreaterThan(7.5);

  await playButton(sam).click();
  await expect.poll(async () => (await player(page)).time).toBeGreaterThan(1.5);
  expect((await player(sam)).paused).toBe(false);
  expect(await gap(page, sam)).toBeLessThan(0.5);

  // Déplacement : Sam demande une autre partie du fichier à Alex.
  await seekTo(page, 5);
  await expect.poll(async () => (await player(sam)).time).toBeGreaterThan(5);
  await expect.poll(() => gap(page, sam)).toBeLessThan(0.5);

  expect(uploads).toEqual([]);
});

test("Alex recharge sa page : Sam est prévenu qu'Alex ne partage plus le fichier", async ({ page, browser }) => {
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  await joinRoom(sam, code, "Sam");
  await shareLive(page, "Film en direct");

  await page.reload();
  // Après le rechargement, Alex est invité à choisir de nouveau son fichier…
  await sam.locator(".media-card", { hasText: "Film en direct" }).locator(".media-actions button", { hasText: "▶" }).click();
  await expect(page.locator("app-sync-player .local-pick")).toContainText("choisissez de nouveau ce fichier");
  // … et Sam sait pourquoi rien ne se lit.
  await expect(sam.locator("app-sync-player [role=alert]")).toContainText("Alex ne partage plus ce fichier");

  // Alex rechoisit son fichier : Sam réessaie et le lit.
  await page.locator("app-sync-player .local-pick input[type=file]").setInputFiles(CLIP);
  await sam.locator("app-sync-player").getByRole("button", { name: "Réessayer" }).click();
  await readyVideo(sam);
});
