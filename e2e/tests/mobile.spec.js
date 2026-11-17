import { expect, test } from "@playwright/test";
import { createRoom, uploadSong } from "./helpers.js";

/* Affichage sur téléphone : rien ne déborde, les cibles restent cliquables. */

for (const width of [320, 375]) {
  test.describe(`téléphone ${width} px`, () => {
    test.use({ viewport: { width, height: 740 }, isMobile: true, hasTouch: true });

    /** Vérifie qu'aucun élément ne dépasse de l'écran ni de sa carte. */
    async function expectNoOverflow(page) {
      const problems = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const found = [];
        if (document.documentElement.scrollWidth > width) found.push("défilement horizontal");
        for (const el of document.querySelectorAll(".card input, .card button")) {
          const box = el.getBoundingClientRect();
          const card = el.closest(".card").getBoundingClientRect();
          if (box.width > 0 && (box.right > card.right + 1 || box.left < card.left - 1)) {
            found.push(`${el.tagName.toLowerCase()} hors de sa carte`);
          }
        }
        return found;
      });
      expect(problems).toEqual([]);
    }

    test("accueil", async ({ page }) => {
      await page.goto("/?code=K7P2QX");
      await expectNoOverflow(page);
    });

    test("salon avec un média dans le lecteur", async ({ page }) => {
      await createRoom(page, "Alexandra-Marie");
      await uploadSong(page, "Un titre de morceau vraiment très long pour un écran de téléphone");
      await page.locator(".media-actions button", { hasText: "▶" }).click();
      await expect(page.locator("app-sync-player .controls")).toBeVisible();

      await expectNoOverflow(page);
      // Les boutons du lecteur restent assez grands pour le doigt (44 px).
      for (const button of await page.locator("app-sync-player .controls > button").all()) {
        expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
    });
  });
}
