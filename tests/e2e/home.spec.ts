import { CONSENT_COOKIE } from "../../lib/browser-storage";
import { expect, test } from "./fixtures";

test("homepage shows the main sections and listing cards", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Sigma · Locations et conciergerie à Marrakech");
  for (const title of [
    "Quartiers de Marrakech",
    "Services de conciergerie Sigma",
    "Logements populaires · Hivernage",
    "Villas avec piscine · Palmeraie",
    "Activités populaires · Marrakech",
  ]) {
    await expect(page.getByRole("region", { name: title })).toBeAttached();
  }
  await expect(page.getByRole("region", { name: "Quartiers de Marrakech" }).getByRole("link")).toHaveText(
    ["Hivernage", "Guéliz", "Médina", "Palmeraie", "Agdal", "Targa", "Route de l'Ourika", "Agafay", "Semlalia", "Ménara"].map((n) => new RegExp(`^${n}`)),
    { useInnerText: true, ignoreCase: false },
  );
  await expect(page.getByRole("region", { name: "Services de conciergerie Sigma" }).getByRole("link")).toHaveText([
    "Location de voitures",
    "Transferts aéroport",
    "Excursions",
    "Chef à domicile",
    "Hammam et soins",
    "Ménage",
    "Courses livrées",
    "Photographe",
  ].map((s) => new RegExp(s)));
  const card = page.getByTestId("card-container").first();
  await expect(card).toBeVisible();
  // Prices in whole dirhams: "1 392 MAD".
  await expect(card).toContainText(/\d\u00a0MAD/);
  await expect(page.getByRole("heading", { name: "Marrakech, quartier par quartier" })).toBeVisible();
});

test("category tabs switch the homepage content", async ({ page, isMobile }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Catégories" }).getByRole("link", { name: "Activités" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/experiences$/);
  await expect(page).toHaveTitle("Activités · Sigma");
  const row = page.getByRole("region", { name: "Activités populaires · Marrakech" });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("card-container").first()).toContainText(/Dès \d[\d\u202f]*\u00a0MAD par personne/);
  test.info().annotations.push({ type: "viewport", description: isMobile ? "chips" : "tab bar" });
});

test("neighbourhood links: tabs and 'Voir tout'", async ({ page }) => {
  await page.goto("/");
  const grid = page.getByRole("tabpanel");
  await page.getByRole("tab", { name: "Avec un animal" }).click();
  await expect(grid.getByRole("link", { name: /Agafay/ })).toHaveAttribute("href", "/s/agafay/homes?adults=1&pets=1");
  await page.getByRole("tab", { name: "Par quartier" }).click();
  // 20 links (two per neighbourhood), 17 shown until "Voir tout".
  await expect(grid.getByRole("link")).toHaveCount(17);
  await expect(grid.getByText("Ménara")).toHaveCount(0);
  await page.getByRole("button", { name: /Voir tout/ }).click();
  await expect(grid.getByRole("link")).toHaveCount(20);
  const menara = grid.getByRole("link", { name: /Ménara.*4 voyageurs/ });
  await expect(menara).toHaveAttribute("href", "/s/menara/homes?adults=4");
  await menara.click();
  await expect(page).toHaveURL(/\/s\/menara\/homes\?adults=4$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ménara");
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
    await expect(notice).toContainText("Sigma ne dépose que les cookies qui vous gardent connecté et celui qui retient que ce message a été fermé.");
    await expect(notice).toContainText("Sans compte, vos favoris restent sur cet appareil.");
    await expect(notice).not.toContainText(/audience|personnalis|publicit/i);
    await expect(notice.getByRole("button")).toHaveText(["Fermer ce message"]);
    await expect(notice.getByRole("link", { name: "Détail des cookies" })).toHaveAttribute("href", "/aide#cookies");

    await notice.getByRole("button", { name: "Fermer ce message" }).click();
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
      const targets = [footer.getByRole("link", { name: "Se connecter" }), footer.getByText("© Sigma SARL, Marrakech"), footer.getByTestId("footer-locale")];
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
      await notice.getByRole("button", { name: "Fermer ce message" }).click();
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).paddingBottom)).toBe("0px");
    });
  }

  test("'Détail des cookies' opens the cookies section of the help page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("region", { name: "Cookies", exact: true }).getByRole("link", { name: "Détail des cookies" }).click();
    await expect(page).toHaveURL(/\/aide#cookies$/);
    await expect(page.getByRole("heading", { name: "Cookies et stockage sur votre appareil" })).toBeInViewport();
  });
});

test("the footer: Assistance, Propriétaires and Sigma, French (MA) and dirhams as text, © Sigma SARL", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.getByRole("heading", { level: 3 })).toHaveText(["Assistance", "Propriétaires", "Sigma"]);
  await expect(footer.getByTestId("footer-locale")).toHaveText(/^Français \(MA\)\s*MAD$/);
  await expect(footer.getByRole("button")).toHaveCount(0);
  await expect(footer.locator('a[href="#aide"], a[href="#"], a:not([href])')).toHaveCount(0);
  await expect(footer.getByRole("link", { name: "Aide", exact: true })).toHaveAttribute("href", "/aide");
  await expect(footer.getByRole("link", { name: "Confier mon bien" })).toHaveAttribute("href", "/aide#proprietaires");
  await expect(footer).toContainText("© Sigma SARL, Marrakech");
  await expect(footer).not.toContainText(/Inc\.|€|EUR|\(FR\)/);
});

test("the menu's Aide opens the help page", async ({ page, isMobile }) => {
  test.skip(isMobile, "the menu button is in the desktop header");
  await page.goto("/");
  await page.getByRole("button", { name: "Menu principal" }).click();
  await page.getByRole("menuitem", { name: "Aide", exact: true }).click();
  await expect(page).toHaveURL(/\/aide$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aide");
});

test("'Confier mon bien', in the header and the menu, presents Sigma's offer to owners", async ({ page, isMobile }) => {
  test.skip(isMobile, "the header link and the menu are in the desktop header");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Profil" });
  await expect(nav.getByRole("link", { name: "Confier mon bien" })).toHaveAttribute("href", "/aide#proprietaires");
  await page.getByRole("button", { name: "Menu principal" }).click();
  await page.getByRole("menuitem", { name: "Confier mon bien" }).click();
  await expect(page).toHaveURL(/\/aide#proprietaires$/);
  const section = page.locator("section#proprietaires");
  await expect(section.getByRole("heading", { level: 2 })).toBeInViewport();
  await expect(section).toContainText("commission de gestion de 20\u00a0% des revenus locatifs");
  await expect(section.locator("form, input, textarea")).toHaveCount(0);
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
  await expect(page.getByText("Aucun favori pour l'instant")).toBeVisible();
});
