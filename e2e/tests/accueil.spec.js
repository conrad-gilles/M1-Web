import { expect, test } from "@playwright/test";
import { createRoom, joinError, newPerson, tryToJoin } from "./helpers.js";

test("l'API répond et le site s'affiche", async ({ page, request }) => {
  expect(await (await request.get("/api/health")).json()).toEqual({ status: "ok" });

  await page.goto("/");

  await expect(page).toHaveTitle("Sharing Platform");
  await expect(page.getByRole("heading", { name: "Créer un salon" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rejoindre un salon" })).toBeVisible();
});

test("créer un salon sans compte, avec un simple nom", async ({ page }) => {
  const code = await createRoom(page, "Alex");

  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await expect(page.locator(".code")).toHaveText(code);
  await expect(page.locator(".participants li")).toContainText(["Alex"]);
  // Le créateur est l'hôte.
  await expect(page.getByRole("button", { name: "Fermer le salon" })).toBeVisible();
});

test("rejoindre avec le code, en minuscules", async ({ page, browser }) => {
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);

  await sam.goto("/");
  const form = sam.getByRole("article").filter({ hasText: "Rejoindre un salon" });
  await form.getByLabel("Code du salon").fill(code.toLowerCase());
  await form.getByLabel("Votre nom").fill("Sam");
  await sam.getByRole("button", { name: "Rejoindre le salon" }).click();

  await sam.waitForURL(new RegExp(`/rooms/${code}$`));
  await expect(page.locator(".participants li")).toContainText(["Alex", "Sam"]);
  // Un invité n'a pas les droits d'hôte.
  await expect(sam.getByRole("button", { name: "Fermer le salon" })).toHaveCount(0);
});

test("un lien partagé ouvre l'accueil avec le code prérempli", async ({ page, browser }) => {
  const code = await createRoom(page);
  const sam = await newPerson(browser);

  await sam.goto(`/rooms/${code}`);

  await expect(sam).toHaveURL(new RegExp(`\\?code=${code}$`));
  await expect(sam.getByLabel("Code du salon")).toHaveValue(code);
});

test("mauvais code : message d'erreur, on reste sur l'accueil", async ({ browser }) => {
  const sam = await newPerson(browser);

  await tryToJoin(sam, "ZZZZZZ", "Sam");

  await expect(joinError(sam)).toHaveText("Salon inconnu");
  await expect(sam).toHaveURL(/\/\?code=ZZZZZZ$/);
});

test("le nom d'affichage est mémorisé pour le salon suivant", async ({ page }) => {
  await createRoom(page, "Alexandra");

  await page.goto("/");

  await expect(page.getByRole("article").filter({ hasText: "Créer un salon" }).getByLabel("Votre nom")).toHaveValue(
    "Alexandra",
  );
});
