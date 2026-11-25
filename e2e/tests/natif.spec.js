import path from "node:path";
import { expect, test } from "@playwright/test";
import { createRoom, gap, joinRoom, newPerson, player, uploadCard, waitForPlayer } from "./helpers.js";

/*
 * Contrôles natifs du navigateur : jouer, mettre en pause ou se déplacer avec
 * le lecteur de Firefox/Chrome (aussi en plein écran) pilote tout le salon,
 * sans boucle d'écho entre les participants. Les clics sont de vrais clics de
 * souris sur le lecteur natif.
 */
const CLIP = path.resolve(import.meta.dirname, "../fixtures/clip.mp4");

async function roomWithVideo(page, browser) {
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  await joinRoom(sam, code, "Sam");
  const card = uploadCard(page);
  await card.getByRole("textbox", { name: "Titre" }).fill("Clip");
  await card.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(CLIP);
  await card.getByRole("button", { name: "Envoyer" }).click();
  await expect(sam.locator(".media-card", { hasText: "Clip" })).toBeVisible();
  await sam.locator(".media-card", { hasText: "Clip" }).locator(".media-actions button", { hasText: "▶" }).click();
  await Promise.all([waitForPlayer(page), waitForPlayer(sam)]);
  return { alex: page, sam };
}

/** Points du lecteur natif : l'image (lecture / pause au clic) et la barre de temps. */
async function nativePlayer(page) {
  // Les clics se font à des coordonnées de l'écran : la vidéo doit y être visible.
  const video = page.locator("app-sync-player video");
  await video.scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(2);
  const box = await video.boundingBox();
  return {
    image: () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 3),
    // Barre de temps native de Chromium, en bas de la vidéo : clic à `fraction` de sa longueur.
    timeline: (fraction) => page.mouse.click(box.x + 20 + (box.width - 40) * fraction, box.y + box.height - 15),
  };
}

/** Relève l'état des deux lecteurs pendant `ms` : il ne doit pas osciller. */
async function watch(alex, sam, ms) {
  const samples = [];
  for (let elapsed = 0; elapsed < ms; elapsed += 250) {
    samples.push(await Promise.all([player(alex), player(sam)]));
    await alex.waitForTimeout(250);
  }
  return samples;
}

test("vrais clics sur le lecteur natif (lecture, barre de temps, pause) : tout le salon suit, sans écho", async ({
  page,
  browser,
}) => {
  const { alex, sam } = await roomWithVideo(page, browser);
  await expect(alex.locator("app-sync-player video")).toHaveAttribute("controls", "");
  const native = await nativePlayer(alex);

  // Clic sur l'image : lecture pour tout le salon.
  await native.image();
  await expect.poll(async () => (await player(sam)).paused).toBe(false);
  await expect(sam.getByText("Alex a lancé la lecture")).toBeVisible();
  expect(await gap(alex, sam)).toBeLessThan(0.5);

  // Clic aux trois quarts de la barre de temps native (clip de 8 s) : Sam suit.
  await native.timeline(0.7);
  await expect.poll(async () => (await player(sam)).time).toBeGreaterThan(5);
  await expect(sam.getByText(/Alex est allé à 0:0[5-6]/)).toBeVisible();
  expect(await gap(alex, sam)).toBeLessThan(0.5);

  // Nouveau clic sur l'image : pause pour tout le salon…
  await native.image();
  await expect.poll(async () => (await player(sam)).paused).toBe(true);
  // … et ça tient : aucune relance ni aucun saut ne revient en écho.
  const samples = await watch(alex, sam, 3000);
  for (const [a, s] of samples) {
    expect(a.paused && s.paused).toBe(true);
    expect(Math.abs(a.time - s.time)).toBeLessThan(0.1);
  }
  const first = samples[0][0].time;
  expect(samples.every(([a]) => Math.abs(a.time - first) < 0.1)).toBe(true);
});

test("au clavier sur le lecteur natif (espace) : tout le salon suit", async ({ page, browser }) => {
  const { alex, sam } = await roomWithVideo(page, browser);

  await alex.locator("app-sync-player video").focus();
  await alex.keyboard.press("Space");
  await expect.poll(async () => (await player(sam)).paused).toBe(false);
  expect(await gap(alex, sam)).toBeLessThan(0.5);

  await alex.keyboard.press("Space");
  await expect.poll(async () => (await player(sam)).paused).toBe(true);
  await alex.waitForTimeout(500);
  expect(await gap(alex, sam)).toBeLessThan(0.1);
});

test("une pause venue d'ailleurs (touche multimédia, casque) arrête aussi tout le salon", async ({ page, browser }) => {
  const { alex, sam } = await roomWithVideo(page, browser);
  await (await nativePlayer(alex)).image();
  await expect.poll(async () => (await player(sam)).paused).toBe(false);

  // Comme une touche multimédia : la page n'a reçu aucun clic.
  await alex.evaluate(() => document.querySelector("app-sync-player video").pause());

  await expect.poll(async () => (await player(sam)).paused).toBe(true);
  await alex.waitForTimeout(1500);
  expect((await player(alex)).paused).toBe(true);
  expect(await gap(alex, sam)).toBeLessThan(0.1);
});
