import path from "node:path";
import { expect } from "@playwright/test";

export const SONG = path.resolve(import.meta.dirname, "../../frontend/fichiers-audio-de-test/song1.mp3");

/** Nouvelle « personne » : un contexte de navigateur, comme une fenêtre privée. */
export async function newPerson(browser, options = {}) {
  const context = await browser.newContext(options);
  return context.newPage();
}

/** Crée un salon depuis l'accueil et renvoie son code. */
export async function createRoom(page, name = "Alex") {
  await page.goto("/");
  await page.getByRole("article").filter({ hasText: "Créer un salon" }).getByLabel("Votre nom").fill(name);
  await page.getByRole("button", { name: "Créer un salon" }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{6}$/);
  return page.url().split("/").pop();
}

/** Remplit le formulaire « Rejoindre un salon » et l'envoie, sans attendre le résultat. */
export async function tryToJoin(page, code, name = "Sam") {
  await page.goto(`/?code=${code}`);
  await page.getByRole("article").filter({ hasText: "Rejoindre un salon" }).getByLabel("Votre nom").fill(name);
  await page.getByRole("button", { name: "Rejoindre le salon" }).click();
}

/** Rejoint un salon avec son code depuis l'accueil. */
export async function joinRoom(page, code, name = "Sam") {
  await tryToJoin(page, code, name);
  await page.waitForURL(new RegExp(`/rooms/${code}$`));
}

/** Message d'erreur affiché sous le formulaire « Rejoindre un salon ». */
export const joinError = (page) =>
  page.getByRole("article").filter({ hasText: "Rejoindre un salon" }).locator(".message.error");

/**
 * Carte « Ajouter un média » (upload). La carte « Synchroniser un fichier
 * local » a aussi un champ Titre et un champ fichier : on vise donc la bonne.
 */
export const uploadCard = (page) =>
  page.locator("article", { has: page.getByRole("heading", { name: "Ajouter un média" }) });

/** Ajoute le MP3 de test au salon. */
export async function uploadSong(page, title = "Song 1") {
  const card = uploadCard(page);
  await card.getByRole("textbox", { name: "Titre" }).fill(title);
  await card.locator('input[type="file"]').setInputFiles(SONG);
  await card.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.locator(".media-card", { hasText: title })).toBeVisible();
}

/** État du lecteur de la page. */
export function player(page) {
  return page.evaluate(() => {
    const el = document.querySelector("audio, video");
    return el ? { time: el.currentTime, paused: el.paused, ready: el.readyState, rate: el.playbackRate } : null;
  });
}

/** Attend que le lecteur ait chargé les métadonnées du média. */
export async function waitForPlayer(page) {
  await page.waitForFunction(() => (document.querySelector("audio, video")?.readyState ?? 0) >= 1);
}

/** Écart de position entre deux lecteurs, en secondes. */
export async function gap(a, b) {
  const [x, y] = await Promise.all([player(a), player(b)]);
  return Math.abs(x.time - y.time);
}

/** Bouton principal du lecteur (Lecture / Pause). */
export const playButton = (page) => page.locator("app-sync-player .controls .main");

/** Déplace tout le salon avec le curseur de position. */
export async function seekTo(page, seconds) {
  await page.locator("app-sync-player .timeline input").evaluate((el, value) => {
    el.value = String(value);
    el.dispatchEvent(new Event("input"));
    el.dispatchEvent(new Event("change"));
  }, seconds);
}
