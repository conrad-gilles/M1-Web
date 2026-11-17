import { expect, test } from "@playwright/test";
import {
  createRoom,
  gap,
  joinRoom,
  newPerson,
  playButton,
  player,
  seekTo,
  uploadSong,
  waitForPlayer,
} from "./helpers.js";

/*
 * Lecture synchronisée entre deux personnes (deux contextes de navigateur).
 * Tolérance visée par le projet : 0,5 s entre participants.
 */

/** Salon avec Alex (hôte) et Sam, le média chargé dans les deux lecteurs. */
async function roomWithMedia(page, browser) {
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  await joinRoom(sam, code, "Sam");
  await uploadSong(page);
  await expect(sam.locator(".media-card")).toHaveCount(1); // liste mise à jour sans recharger

  await sam.locator(".media-actions button", { hasText: "▶" }).click();
  await Promise.all([waitForPlayer(page), waitForPlayer(sam)]);
  return { code, alex: page, sam };
}

test("choisir un média le charge pour tout le salon, en pause au début", async ({ page, browser }) => {
  const { alex, sam } = await roomWithMedia(page, browser);

  for (const person of [alex, sam]) {
    expect(await player(person)).toMatchObject({ time: 0, paused: true });
    await expect(person.locator(".now-playing")).toContainText("Song 1");
  }
});

test("lecture, saut et pause : les deux lecteurs restent à moins de 0,5 s", async ({ page, browser }) => {
  const { alex, sam } = await roomWithMedia(page, browser);

  // Alex lance : les deux lisent.
  await playButton(alex).click();
  await expect.poll(async () => (await player(sam)).time).toBeGreaterThan(2);
  expect((await player(alex)).paused).toBe(false);
  expect(await gap(alex, sam)).toBeLessThan(0.5);
  // Notice « qui a fait quoi » chez l'autre participant.
  await expect(sam.getByText("Alex a lancé la lecture")).toBeVisible();

  // Sam se déplace à 60 s : Alex suit, toujours en lecture.
  await seekTo(sam, 60);
  await expect.poll(async () => (await player(alex)).time).toBeGreaterThan(60);
  await alex.waitForTimeout(1500);
  expect((await player(alex)).paused).toBe(false);
  expect(await gap(alex, sam)).toBeLessThan(0.5);

  // Sam met en pause : les deux s'arrêtent au même endroit.
  await playButton(sam).click();
  await expect.poll(async () => (await player(alex)).paused).toBe(true);
  expect(await gap(alex, sam)).toBeLessThan(0.1);
});

test("un participant en retard est rattrapé, un participant en avance aussi", async ({ page, browser }) => {
  const { alex, sam } = await roomWithMedia(page, browser);
  await playButton(alex).click();
  await expect.poll(async () => (await player(sam)).time).toBeGreaterThan(1);

  // Retard de 5 s chez Sam : rattrapé par un saut.
  await sam.evaluate(() => (document.querySelector("audio").currentTime -= 5));
  await expect.poll(() => gap(alex, sam)).toBeLessThan(0.5);

  // Avance de 0,5 s chez Alex : rattrapée en douceur, sans saut (vitesse 0,95).
  await alex.evaluate(() => (document.querySelector("audio").currentTime += 0.5));
  await expect.poll(async () => (await player(alex)).rate).toBe(0.95);
  await expect.poll(() => gap(alex, sam), { timeout: 30_000 }).toBeLessThan(0.15);
  await expect.poll(async () => (await player(alex)).rate, { timeout: 30_000 }).toBe(1);
});

test("un arrivant tardif démarre à la position courante", async ({ page, browser }) => {
  const { code, alex } = await roomWithMedia(page, browser);
  await seekTo(alex, 90);
  await playButton(alex).click();
  await alex.waitForTimeout(1500);

  const lou = await newPerson(browser);
  await joinRoom(lou, code, "Lou");
  await waitForPlayer(lou);

  await expect.poll(async () => (await player(lou)).paused).toBe(false);
  expect((await player(lou)).time).toBeGreaterThan(90);
  await expect.poll(() => gap(alex, lou)).toBeLessThan(0.5);
});

test("le fichier est diffusé en streaming (206 Partial Content)", async ({ page, browser }) => {
  const statuses = [];
  page.on("response", (response) => response.url().includes("/stream") && statuses.push(response.status()));

  const { alex } = await roomWithMedia(page, browser);
  await playButton(alex).click();
  await expect.poll(async () => (await player(alex)).time).toBeGreaterThan(1);

  expect(statuses).toContain(206);
});

test("supprimer le média en cours vide le lecteur chez tout le monde", async ({ page, browser }) => {
  const { alex, sam } = await roomWithMedia(page, browser);
  alex.on("dialog", (dialog) => dialog.accept());

  await alex.locator(".media-card").getByRole("button", { name: /Supprimer/ }).click();

  await expect(sam.locator("audio")).toHaveCount(0);
  await expect(sam.locator(".media-card")).toHaveCount(0);
});
