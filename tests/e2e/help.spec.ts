import type { Page } from "@playwright/test";
import { formatPrice } from "../../lib/format";
import { TOURIST_TAX_GRIDS } from "../../lib/tourist-tax";
import { expect, signUp, test } from "./fixtures";

/** /aide: the help page, its sections and links, and the storage list checked against a real session. */

const SECTIONS = {
  reserver: "Réserver un logement",
  annuler: "Annuler une réservation",
  "taxe-de-sejour": "La taxe de séjour",
  favoris: "Vos favoris",
  proprietaires: "Propriétaires",
  cookies: "Cookies et stockage sur votre appareil",
};

test("has a title, a description and every section under its id", async ({ page }) => {
  await page.goto("/aide");
  await expect(page).toHaveTitle("Aide · Nidou");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /taxe de séjour/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aide");
  for (const [id, title] of Object.entries(SECTIONS)) {
    await expect(page.locator(`section#${id}`).getByRole("heading", { level: 2 })).toHaveText(title);
    await expect(page.getByRole("navigation", { name: "Sommaire" }).getByRole("link", { name: title })).toHaveAttribute("href", `#${id}`);
  }
});

test("says what the product does, and nothing it doesn't", async ({ page }) => {
  await page.goto("/aide");
  const section = (id: keyof typeof SECTIONS) => page.locator(`section#${id}`);
  await expect(section("reserver")).toContainText("Vous arrivez le jour de votre choix.");
  await expect(section("reserver")).toContainText(/2\snuits pour la plupart, 3\spour certains/);
  await expect(section("reserver")).toContainText("le prix des nuits, les frais de ménage et la taxe de séjour");
  await expect(section("reserver")).toContainText("Nidou ne facture aucun frais de service aux voyageurs.");
  await expect(section("reserver")).toContainText("Votre réservation est confirmée immédiatement");
  await expect(section("annuler")).toContainText("jusqu'à la veille de votre arrivée");
  await expect(section("annuler").getByRole("link", { name: "Voyages" })).toHaveAttribute("href", "/trips");
  await expect(section("favoris")).toContainText("ajoutés à votre compte");
  await expect(section("proprietaires").getByRole("link", { name: "Devenir hôte" })).toHaveAttribute("href", "/devenir-hote");
  await expect(section("cookies")).toContainText("Nidou n'utilise aucun traceur de mesure d'audience ni de publicité.");
  // No refund, payment or contact promises.
  const main = page.getByRole("main");
  await expect(main).not.toContainText(/rembours|paiement|payer|carte bancaire|@|\+33|0\d( ?\d\d){4}/i);
});

test("the taxe de séjour section shows each commune's grid and links its sources", async ({ page }) => {
  await page.goto("/aide");
  const section = page.locator("section#taxe-de-sejour");
  await expect(section).toContainText("Elle est due par adulte et par nuit ; les mineurs en sont exonérés.");
  for (const grid of Object.values(TOURIST_TAX_GRIDS)) {
    const table = section.getByRole("table", { name: `Taxe de séjour par adulte et par nuit, commune de ${grid.commune}` });
    const cells = await table.getByRole("cell").allTextContents();
    // The amounts come straight from the grids in lib/tourist-tax.ts, in the app's price format.
    expect(cells.slice(0, 5)).toEqual([1, 2, 3, 4, 5].map((n) => formatPrice(grid.classified[n as 1 | 2 | 3 | 4 | 5])));
    expect(cells[5]).toContain(formatPrice(grid.unclassifiedCapCents));
    expect(cells[5]).toContain(`${String(grid.unclassifiedBps / 100).replace(".", ",")}\u00a0%`);
    for (const url of grid.sources.map((s) => /https?:\/\/[^\s)]+/.exec(s)![0])) {
      // Once per commune that cites it (the DGFiP dataset covers both).
      const citing = Object.values(TOURIST_TAX_GRIDS).filter((g) => g.sources.some((src) => src.includes(url))).length;
      await expect(section.locator(`a[href="${url}"]`)).toHaveCount(citing);
    }
  }
});

/** Every link on the page leads somewhere real: internal paths answer 200 and their #anchors exist. */
async function checkLinks(page: Page, scope: string) {
  const hrefs = [...new Set(await page.locator(`${scope} a[href]`).evaluateAll((as) => as.map((a) => a.getAttribute("href")!)))];
  expect(hrefs.length).toBeGreaterThan(0);
  const allowedExternal = Object.values(TOURIST_TAX_GRIDS).flatMap((g) => g.sources.map((s) => /https?:\/\/[^\s)]+/.exec(s)![0]));
  for (const href of hrefs) {
    if (/^https?:/.test(href)) {
      expect(allowedExternal, `${scope}: unexpected external link ${href}`).toContain(href);
      continue;
    }
    const url = new URL(href, page.url());
    const target = url.pathname === new URL(page.url()).pathname ? page : await page.context().newPage();
    if (target !== page) {
      const res = await target.goto(url.pathname + url.search);
      expect(res!.status(), href).toBe(200);
    }
    if (url.hash) await expect(target.locator(`[id="${url.hash.slice(1)}"]`), href).toHaveCount(1);
    if (target !== page) await target.close();
  }
}

test("every link on the help page works", async ({ page }) => {
  await page.goto("/aide");
  await checkLinks(page, "main");
});

test("every footer link works, the help ones included", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("footer").getByRole("link", { name: "Centre d'aide" })).toHaveAttribute("href", "/aide");
  await checkLinks(page, "footer");
  await page.locator("footer").getByRole("link", { name: "Taxe de séjour" }).click();
  await expect(page).toHaveURL(/\/aide#taxe-de-sejour$/);
  await expect(page.getByRole("heading", { name: "La taxe de séjour" })).toBeInViewport();
});

test.describe("the storage list matches what the site really stores", () => {
  test.use({ consent: false });
  test("cookies and local storage, signed out, signed in and signed out again", async ({ page, context, isMobile }) => {
    test.skip(isMobile, "browser storage doesn't depend on the viewport");
    await page.goto("/aide");
    const listed = (await page.getByTestId("storage-list").locator("code").allTextContents()).map((s) => s.trim());
    expect(listed).toEqual(["better-auth.session_token", "better-auth.session_data", "nidou_consent", "nidou:wishlist", "better-auth.message"]);
    await expect(page.getByTestId("storage-list")).toContainText(/180\sjours/);

    // Signed out: a favourite in local storage, the notice dismissed.
    await page.goto("/");
    await page.getByRole("region", { name: "Cookies" }).getByRole("button", { name: "J'ai compris" }).click();
    await page.getByTestId("listing-card-save-button").first().click();
    const storageKeys = () => page.evaluate(() => Object.keys(localStorage));
    expect(await storageKeys()).toEqual(["nidou:wishlist"]);

    // Signed in: Better Auth's cookies; the device's favourites move to the account.
    await signUp(page, "Aide");
    await expect.poll(storageKeys).toEqual([]);
    const names = (await context.cookies()).map((c) => c.name.replace(/^__Secure-/, ""));
    expect(names.sort()).toEqual(["better-auth.session_data", "better-auth.session_token", "nidou_consent"]);
    for (const name of names) expect(listed).toContain(name);

    // Signed out again: the session cookies go; Better Auth leaves its cross-tab sign-out message behind.
    await page.getByRole("button", { name: "Menu principal" }).click();
    await page.getByRole("menuitem", { name: "Déconnexion" }).click();
    await expect(page.getByRole("link", { name: "Connexion" })).toBeVisible();
    await expect.poll(storageKeys).toEqual(["better-auth.message"]);
    const message = JSON.parse((await page.evaluate(() => localStorage.getItem("better-auth.message")))!);
    expect(Object.keys(message).sort()).toEqual(["clientId", "data", "event", "timestamp"]);
    expect(message.data).toEqual({ trigger: "signout" });
    const after = (await context.cookies()).map((c) => c.name.replace(/^__Secure-/, ""));
    expect(after).toEqual(["nidou_consent"]);
    for (const key of await storageKeys()) expect(listed).toContain(key);
  });
});
