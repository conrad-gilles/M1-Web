import path from "node:path";
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, newPerson } from "./helpers.js";

/* Discussion du salon : en temps réel, historique pour les arrivants, texte jamais interprété. */

const chat = (page) => page.locator("app-chat");
const bubbles = (page) => chat(page).locator(".messages li:not(.empty)");

test("deux participants discutent en temps réel ; un arrivant voit l'historique", async ({ page, browser }) => {
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  await joinRoom(sam, code, "Sam");
  await expect(chat(sam)).toContainText("Aucun message pour l’instant");

  // Alex écrit et appuie sur Entrée.
  await chat(page).getByRole("textbox", { name: "Message à envoyer au salon" }).fill("On lance le film ?");
  await chat(page).getByRole("textbox", { name: "Message à envoyer au salon" }).press("Enter");
  await expect(bubbles(sam)).toHaveCount(1);
  await expect(bubbles(sam).first()).toContainText("Alex");
  await expect(bubbles(sam).first()).toContainText("On lance le film ?");
  await expect(bubbles(page).first()).toContainText("Vous");
  await expect(chat(page).getByRole("textbox")).toHaveValue("");

  // Sam répond avec le bouton.
  await chat(sam).getByRole("textbox").fill("Oui, vas-y !");
  await chat(sam).getByRole("button", { name: "Envoyer" }).click();
  await expect(bubbles(page)).toHaveCount(2);
  await expect(bubbles(page).nth(1)).toContainText("Sam");

  // Lou arrive après coup : il voit la conversation.
  const lou = await newPerson(browser);
  await joinRoom(lou, code, "Lou");
  await expect(bubbles(lou)).toHaveCount(2);
  await expect(bubbles(lou).nth(0)).toContainText("On lance le film ?");
});

test("en plein écran, un message apparaît par-dessus la vidéo puis s'efface", async ({ page, browser }) => {
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  await joinRoom(sam, code, "Sam");
  const card = page.locator("article", { has: page.getByRole("heading", { name: "Ajouter un média" }) });
  await card.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(path.resolve(import.meta.dirname, "../fixtures/clip.mp4"));
  await card.getByRole("button", { name: "Envoyer" }).click();
  await page.locator(".media-actions button", { hasText: "▶" }).first().click();
  await page.waitForFunction(() => (document.querySelector("app-sync-player video")?.readyState ?? 0) >= 1);

  await page.getByRole("button", { name: "Plein écran" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toContain("stage");

  await chat(sam).getByRole("textbox").fill("Regarde cette scène !");
  await chat(sam).getByRole("textbox").press("Enter");

  const toast = page.locator(".stage .chat-toast");
  await expect(toast).toHaveText("Sam Regarde cette scène !");
  await expect(toast).toBeHidden({ timeout: 9000 });
});

test("un message contenant du HTML est affiché tel quel, sans être exécuté", async ({ page, browser }) => {
  const code = await createRoom(page, "Alex");
  const sam = await newPerson(browser);
  await joinRoom(sam, code, "Sam");
  let alerted = false;
  sam.on("dialog", (dialog) => ((alerted = true), dialog.dismiss()));

  await chat(page).getByRole("textbox").fill('<img src=x onerror="alert(1)">');
  await chat(page).getByRole("textbox").press("Enter");

  await expect(bubbles(sam).first().locator(".text")).toHaveText('<img src=x onerror="alert(1)">');
  expect(await bubbles(sam).first().locator("img").count()).toBe(0);
  await sam.waitForTimeout(300);
  expect(alerted).toBe(false);
});
