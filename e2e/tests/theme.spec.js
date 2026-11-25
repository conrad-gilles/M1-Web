import { expect, test } from "@playwright/test";
import { createRoom } from "./helpers.js";

/* Mode clair / sombre : bouton dans l'en-tête, choix retenu, préférence du système respectée. */

const colors = (page) =>
  page.evaluate(() => {
    const card = getComputedStyle(document.querySelector(".card"));
    return { theme: document.documentElement.dataset.theme, page: getComputedStyle(document.body).backgroundColor, card: card.backgroundColor, text: card.color };
  });

test("le bouton passe en mode sombre, le choix reste après rechargement, puis revient au clair", async ({ page }) => {
  await createRoom(page, "Alex");
  const light = await colors(page);
  expect(light.theme).toBe("light");
  expect(light.card).toBe("rgb(255, 255, 255)");

  await page.getByRole("button", { name: "Mode sombre" }).click();
  const dark = await colors(page);
  expect(dark).toEqual({ theme: "dark", page: "rgb(15, 23, 20)", card: "rgb(24, 35, 31)", text: "rgb(227, 238, 233)" });

  await page.reload();
  expect((await colors(page)).theme).toBe("dark");

  await page.getByRole("button", { name: "Mode sombre" }).click();
  expect((await colors(page)).card).toBe("rgb(255, 255, 255)");
});

test("système en mode sombre : l'application démarre en sombre", async ({ browser }) => {
  const page = await (await browser.newContext({ colorScheme: "dark", locale: "fr-FR" })).newPage();
  await page.goto("/");

  expect((await colors(page)).theme).toBe("dark");
});
