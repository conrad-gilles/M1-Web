import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, newPerson } from "./helpers.js";

/* Une session par navigateur : tous les onglets sont le même participant. */

test("un deuxième onglet est le même participant, avec ses droits d'hôte", async ({ page, context }) => {
  const code = await createRoom(page, "Alex");

  const secondTab = await context.newPage();
  await secondTab.goto(`/rooms/${code}`);

  await expect(secondTab).toHaveURL(new RegExp(`/rooms/${code}$`));
  await expect(secondTab.getByRole("button", { name: "Fermer le salon" })).toBeVisible();
  await expect(secondTab.locator(".participants li")).toHaveCount(1);
});

test("l'hôte qui ferme puis rouvre son onglet garde ses droits", async ({ page, context }) => {
  const code = await createRoom(page, "Alex");
  await page.close();

  const reopened = await context.newPage();
  await reopened.goto(`/rooms/${code}`);

  await expect(reopened.getByRole("button", { name: "Fermer le salon" })).toBeVisible();
});

test("quitter dans un onglet quitte dans tous, sans message « salon fermé »", async ({ page, context }) => {
  const code = await createRoom(page, "Alex");
  const secondTab = await context.newPage();
  await secondTab.goto(`/rooms/${code}`);
  await expect(secondTab.locator(".participants li")).toHaveCount(1);

  await page.getByRole("button", { name: "Quitter" }).click();

  await expect(secondTab).toHaveURL(/\/$/);
  await expect(secondTab.getByText("Ce salon a été fermé")).toHaveCount(0);
});

test("une fenêtre privée est un autre participant", async ({ page, browser }) => {
  const code = await createRoom(page, "Alex");
  const privateWindow = await newPerson(browser);

  await joinRoom(privateWindow, code, "Sam");

  await expect(page.locator(".participants li")).toHaveCount(2);
});
