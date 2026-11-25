import { expect, test } from "@playwright/test";

/*
 * Langue de l'interface : celle du navigateur à la première visite (anglais
 * si ce n'est pas le français), puis le choix FR / EN de l'utilisateur,
 * retenu d'une visite à l'autre. Les messages du serveur sont traduits aussi.
 */

test("un navigateur anglais voit l'application en anglais, de l'accueil au salon", async ({ browser }) => {
  const page = await (await browser.newContext({ locale: "en-US" })).newPage();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "The same media, at the same moment" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // Message d'erreur du serveur (« Salon inconnu »), traduit.
  const join = page.getByRole("article").filter({ hasText: "Join a room" });
  await join.getByLabel("Room code").fill("ZZZZZZ");
  await join.getByLabel("Your name").fill("Sam");
  await join.getByRole("button", { name: "Join the room" }).click();
  await expect(join.getByRole("alert")).toHaveText("Unknown room");

  const create = page.getByRole("article").filter({ hasText: "Create a room" });
  await create.getByLabel("Your name").fill("Alex");
  await create.getByRole("button", { name: "Create a room" }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{6}$/);

  for (const heading of ["Room player", "Add a media", "Sync a local file", "Room media"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByText("Pick a media below: it will play for the whole room.")).toBeVisible();
});

test("le choix FR / EN change l'interface aussitôt et reste retenu", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Le même média, au même instant" })).toBeVisible();

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The same media, at the same moment" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Home" })).toBeVisible();

  // Le choix l'emporte sur la langue du navigateur (ici le français).
  await page.reload();
  await expect(page.getByRole("heading", { name: "The same media, at the same moment" })).toBeVisible();

  await page.getByRole("button", { name: "FR", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Le même média, au même instant" })).toBeVisible();
});
