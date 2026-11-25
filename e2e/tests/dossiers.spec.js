import path from "node:path";
import { expect, test } from "@playwright/test";
import { createRoom, gap, joinRoom, newPerson, player, uploadCard } from "./helpers.js";

/*
 * Dossiers : synchroniser un dossier local (rien n'est envoyé) et envoyer un
 * dossier entier ; télécharger un média envoyé. Les dossiers de test :
 *   alex/Ma série : ep01.mp4 (8 s), ep02.mp4 (5 s)
 *   sam/Ma série  : ep01.mp4 (8 s, identique), ep02.mp4 (8 s, autre durée), bonus.mp4 (5 s, nouveau)
 */
const FOLDERS = path.resolve(import.meta.dirname, "../fixtures/dossiers");
const alexFolder = path.join(FOLDERS, "alex", "Ma série");
const samFolder = path.join(FOLDERS, "sam", "Ma série");

const localCard = (page) => page.locator("app-local-media");
const folderInput = (card) => card.locator("input[webkitdirectory]");

/** Choisit un dossier dans la carte « Synchroniser un fichier local » et attend le résultat. */
async function syncFolder(page, folder) {
  await folderInput(localCard(page)).setInputFiles(folder);
  await expect(localCard(page).getByText(/Dossier « Ma série » : \d+ fichier/)).toBeVisible();
  return (await localCard(page).textContent()).replace(/\s+/g, " ");
}

const playCard = (page, title) =>
  page.locator(".media-card", { hasText: title }).locator(".media-actions button", { hasText: "▶" }).click();

const readyVideo = (page) =>
  page.waitForFunction(() => (document.querySelector("app-sync-player video")?.readyState ?? 0) >= 1);

test("deux dossiers locaux de même nom : mêmes noms et mêmes durées synchronisés, sans rien envoyer", async ({
  page,
  browser,
}) => {
  const uploads = [];
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  for (const person of [page, sam]) {
    person.on("request", (r) => {
      if ((r.headers()["content-type"] ?? "").startsWith("multipart/")) uploads.push(r.url());
    });
  }
  await joinRoom(sam, code, "Sam");

  // Alex synchronise son dossier : les deux fichiers sont ajoutés au salon.
  expect(await syncFolder(page, alexFolder)).toContain("0 fichier(s) relié(s) au salon, 2 ajouté(s)");
  await expect(sam.locator(".media-card", { hasText: "Dossier « Ma série »" })).toHaveCount(2);

  // Sam choisit son dossier de même nom : ep01 relié, ep02 refusé (autre durée), bonus ajouté.
  const samResult = await syncFolder(sam, samFolder);
  expect(samResult).toContain("1 fichier(s) relié(s) au salon, 1 ajouté(s)");
  expect(samResult).toContain("non synchronisés : ep02.mp4");
  await expect(page.locator(".media-card", { hasText: "Dossier « Ma série »" })).toHaveCount(3);

  // ep01 : chacun lit sa copie, synchronisée.
  await playCard(sam, "ep01.mp4");
  await Promise.all([readyVideo(page), readyVideo(sam)]);
  for (const person of [page, sam]) {
    await expect(person.locator("app-sync-player .local-pick")).toHaveCount(0);
    expect(await person.evaluate(() => document.querySelector("app-sync-player video").src)).toMatch(/^blob:/);
  }
  await sam.locator("app-sync-player .controls .main").click();
  await expect.poll(async () => (await player(page)).time).toBeGreaterThan(1.5);
  expect(await gap(page, sam)).toBeLessThan(0.5);

  // bonus : Alex n'a pas ce fichier dans son dossier, le lecteur le dit.
  await playCard(page, "bonus.mp4");
  await expect(page.locator("app-sync-player [role=alert]")).toContainText(
    "Votre dossier « Ma série » ne contient pas « bonus.mp4 »",
  );

  expect(uploads).toEqual([]);
});

test("envoyer un dossier entier, puis télécharger un de ses fichiers sous son nom d'origine", async ({ page }) => {
  await createRoom(page, "Alex");
  const card = uploadCard(page);

  await folderInput(card).setInputFiles(alexFolder);
  await expect(card.getByText(/Dossier « Ma série » : 2 fichier\(s\)/)).toContainText("stockage gratuit partagé");
  await card.getByRole("button", { name: "Envoyer le dossier" }).click();
  await expect(card.getByText("Dossier « Ma série » : 2 fichier(s) ajouté(s) au salon.")).toBeVisible();

  const ep01 = page.locator(".media-card", { hasText: "ep01.mp4" });
  await expect(ep01).toContainText("Dossier « Ma série »");
  const [download] = await Promise.all([page.waitForEvent("download"), ep01.locator("button.download").click()]);
  expect(download.suggestedFilename()).toBe("ep01.mp4");
});
