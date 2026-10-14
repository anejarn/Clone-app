import { CONSENT_COOKIE } from "../../lib/browser-storage";
import { expect, test } from "./fixtures";

test("homepage shows the main sections and listing cards", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Sigma | Locations de vacances, cabanes, maisons de plage, etc.");
  for (const title of ["Destinations pour vous", "Trouvez des services à proximité", "Logements populaires · Paris"]) {
    await expect(page.getByRole("region", { name: title })).toBeVisible();
  }
  await expect(page.getByTestId("card-container").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Des idées pour vos prochaines escapades" })).toBeVisible();
});

test("category tabs switch the homepage content", async ({ page, isMobile }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Catégories" }).getByRole("link", { name: "Expériences" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/experiences$/);
  await expect(page.getByRole("region", { name: /^Expériences populaires/ })).toBeVisible();
  test.info().annotations.push({ type: "viewport", description: isMobile ? "chips" : "tab bar" });
});

test("inspiration tabs and 'Afficher plus'", async ({ page }) => {
  await page.goto("/");
  const grid = page.getByRole("tabpanel");
  await page.getByRole("tab", { name: "Montagnes" }).click();
  await expect(grid.getByText("Megève")).toBeVisible();
  await page.getByRole("tab", { name: "Équipements recherchés" }).click();
  await expect(grid.getByText("Dijon")).toHaveCount(0);
  await page.getByRole("button", { name: /Afficher plus/ }).click();
  await expect(grid.getByText("Dijon")).toBeVisible();
});

test.describe("cookie notice", () => {
  test.use({ consent: false });
  test("says what is stored, never takes focus, and is remembered for 180 days", async ({ page, context }) => {
    await page.goto("/");
    const notice = page.getByRole("region", { name: "Cookies", exact: true });
    await expect(notice).toBeVisible();
    // Non-modal: not a dialog, focus left where it was.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    // Only what is true: no audience measurement, no choice to make.
    await expect(notice).toContainText("Sigma utilise uniquement les cookies nécessaires au fonctionnement du site\u00a0: votre connexion et le souvenir de ce message.");
    await expect(notice).toContainText("Sans compte, vos favoris sont enregistrés sur cet appareil.");
    await expect(notice).not.toContainText(/audience|personnalis|publicit/i);
    await expect(notice.getByRole("button")).toHaveText(["J'ai compris"]);
    await expect(notice.getByRole("link", { name: "En savoir plus" })).toHaveAttribute("href", "/aide#cookies");

    await notice.getByRole("button", { name: "J'ai compris" }).click();
    await expect(notice).toBeHidden();
    const cookie = (await context.cookies()).find((c) => c.name === CONSENT_COOKIE);
    expect(cookie).toBeDefined();
    expect(Math.round((cookie!.expires - Date.now() / 1000) / 86_400)).toBe(180);
    await page.reload();
    await expect(page.getByTestId("card-container").first()).toBeVisible();
    await expect(notice).toBeHidden();
  });

  for (const path of ["/", "/aide"]) {
    test(`scrolled to the bottom of ${path}, the notice covers none of the footer's end`, async ({ page, isMobile }) => {
      await page.goto(path);
      const notice = page.getByRole("region", { name: "Cookies", exact: true });
      await expect(notice).toBeVisible();
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).paddingBottom)).not.toBe("0px");
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForFunction(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1);
      const footer = page.locator("footer");
      const targets = [footer.getByRole("link", { name: "Connexion ou inscription" }), footer.getByText("© 2026 Sigma"), footer.getByTestId("footer-locale")];
      // The last link, the © line and the locale line (on desktop, where the footer fits the screen, every
      // footer link too) are the topmost element at their centre. On a phone the stacked columns are taller
      // than the space above the notice, so links further up are covered until they are scrolled to.
      const uncovered = await footer.evaluate((f, all) => {
        const last = [...f.querySelectorAll("a")].at(-1)!;
        const els = [...(all ? f.querySelectorAll("a") : [last]), ...f.querySelectorAll("p")];
        return els
          .map((el) => {
            const r = el.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            if (y < 0 || y > window.innerHeight) return null;
            const hit = document.elementFromPoint(x, y);
            return { text: el.textContent, ok: !!hit && (el === hit || el.contains(hit)) };
          })
          .filter((v) => v !== null);
      }, !isMobile);
      expect(uncovered.filter((v) => !v.ok)).toEqual([]);
      for (const t of targets) await expect(t).toBeInViewport();
      // Dismissing gives the space back.
      await notice.getByRole("button", { name: "J'ai compris" }).click();
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).paddingBottom)).toBe("0px");
    });
  }

  test("En savoir plus opens the cookies section of the help page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("region", { name: "Cookies", exact: true }).getByRole("link", { name: "En savoir plus" }).click();
    await expect(page).toHaveURL(/\/aide#cookies$/);
    await expect(page.getByRole("heading", { name: "Cookies et stockage sur votre appareil" })).toBeInViewport();
  });
});

test("the footer: three columns of real links, French and euros as text, © Sigma", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.getByRole("heading", { level: 3 })).toHaveText(["Assistance", "Voyager", "Sigma"]);
  await expect(footer.getByTestId("footer-locale")).toHaveText(/Français \(FR\)\s*€ EUR/);
  await expect(footer.getByRole("button")).toHaveCount(0);
  await expect(footer.locator('a[href="#aide"], a[href="#"], a:not([href])')).toHaveCount(0);
  await expect(footer.getByRole("link", { name: "Centre d'aide" })).toHaveAttribute("href", "/aide");
  await expect(footer).toContainText("© 2026 Sigma");
  await expect(footer).not.toContainText("Inc.");
});

test("the menu's Centre d'aide opens the help page", async ({ page, isMobile }) => {
  test.skip(isMobile, "the menu button is in the desktop header");
  await page.goto("/");
  await page.getByRole("button", { name: "Menu principal" }).click();
  await page.getByRole("menuitem", { name: "Centre d'aide" }).click();
  await expect(page).toHaveURL(/\/aide$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aide");
});

test("saved listings appear in Favoris", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("card-container").first();
  const title = await card.getByTestId("listing-card-title").textContent();
  const heart = card.getByTestId("listing-card-save-button");
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await page.goto("/wishlists");
  await expect(page.getByTestId("listing-card-title")).toHaveText([title!]);
  await page.getByTestId("listing-card-save-button").click();
  await page.reload();
  await expect(page.getByText("Créez votre première liste de favoris")).toBeVisible();
});
