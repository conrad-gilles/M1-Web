import { expect, test } from "@playwright/test";
import { createRoom, joinError, joinRoom, newPerson, tryToJoin } from "./helpers.js";

/* Actions réservées à l'hôte : changer le code, fermer le salon. */

test("l'hôte change le code : l'ancien ne marche plus, les participants suivent", async ({ page, browser }) => {
  const oldCode = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  await joinRoom(sam, oldCode, "Sam");
  page.on("dialog", (dialog) => dialog.accept());

  await page.getByRole("button", { name: "Changer le code" }).click();

  await expect(page.locator(".code")).not.toHaveText(oldCode);
  const newCode = (await page.locator(".code").textContent()).trim();
  await expect(page).toHaveURL(new RegExp(`/rooms/${newCode}$`));
  await expect(sam).toHaveURL(new RegExp(`/rooms/${newCode}$`));

  const lou = await newPerson(browser);
  await tryToJoin(lou, oldCode, "Lou");
  await expect(joinError(lou)).toHaveText("Salon inconnu");
});

test("l'hôte ferme le salon : tout le monde revient à l'accueil avec un message", async ({ page, browser }) => {
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  await joinRoom(sam, code, "Sam");
  page.on("dialog", (dialog) => dialog.accept());

  await page.getByRole("button", { name: "Fermer le salon" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(sam).toHaveURL(/closed=1/);
  await expect(sam.getByText("Ce salon a été fermé ou a expiré.")).toBeVisible();

  // Le code ne fonctionne plus.
  const lou = await newPerson(browser);
  await tryToJoin(lou, code, "Lou");
  await expect(joinError(lou)).toHaveText("Salon inconnu");
});
