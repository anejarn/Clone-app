import type { Page } from "@playwright/test";
import { SERVICE_FEE_RATE } from "../../lib/pricing";
import { expect, signUp, test } from "./fixtures";

/** /aide: the help page, its sections and links, and the storage list checked against a real session. */

const SECTIONS = {
  rechercher: "Rechercher un logement",
  sejours: "Vos séjours",
  favoris: "Vos favoris",
  compte: "Votre compte",
  cookies: "Cookies et stockage sur votre appareil",
  proprietaires: "Confier votre bien à Sigma",
};

test("has a title, a description and every section under its id", async ({ page }) => {
  await page.goto("/aide");
  await expect(page).toHaveTitle("Aide · Sigma");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /cookies/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aide");
  for (const [id, title] of Object.entries(SECTIONS)) {
    await expect(page.locator(`section#${id}`).getByRole("heading", { level: 2 })).toHaveText(title);
    await expect(page.getByRole("navigation", { name: "Sommaire" }).getByRole("link", { name: title })).toHaveAttribute("href", `#${id}`);
  }
});

test("says what the replica does, and nothing it doesn't", async ({ page }) => {
  await page.goto("/aide");
  const section = (id: keyof typeof SECTIONS) => page.locator(`section#${id}`);
  await expect(section("rechercher")).toContainText("le quartier, les dates et les voyageurs");
  await expect(section("rechercher")).toContainText("Adultes (18 ans et plus), enfants (de 2 à 17 ans), bébés (moins de 2 ans)");
  // The price formula, with the rate lib/pricing.ts applies: no service fee, so no fee line.
  expect(SERVICE_FEE_RATE).toBe(0);
  await expect(section("rechercher")).toContainText("Les prix sont en dirhams marocains (MAD), arrondis au dirham.");
  await expect(section("rechercher")).toContainText(
    "le prix de la nuit multiplié par le nombre de nuits, plus les frais de ménage du logement. Sigma n'ajoute pas de frais de service.",
  );
  await expect(section("rechercher")).not.toContainText(/14|%/);
  await expect(section("sejours")).toContainText("jusqu'à la veille de votre arrivée");
  await expect(section("sejours")).toContainText("C'est la date du jour à la destination qui compte");
  await expect(section("sejours")).toContainText("JJ/MM/AAAA");
  await expect(section("sejours").getByRole("link", { name: "Mes séjours" })).toHaveAttribute("href", "/trips");
  await expect(section("favoris")).toContainText("Sans compte, ils sont gardés sur cet appareil");
  await expect(section("favoris")).toContainText("ajoutés à votre compte");
  await expect(section("compte").getByRole("link", { name: "Connexion" })).toHaveAttribute("href", "/login");
  await expect(section("cookies")).toContainText("Sigma n'utilise aucun traceur de mesure d'audience ni de publicité.");
  // Owners: only the business plan's facts, and no contact details that don't exist yet.
  const owners = section("proprietaires");
  await expect(owners).toContainText("commission de gestion de 20\u00a0% des revenus locatifs de votre bien, tout compris");
  await expect(owners.getByRole("heading", { level: 3 })).toHaveText(["Ce que comprend la gestion", "Autorisation 80-14"]);
  await expect(owners.locator("li")).toHaveText([
    "La mise en ligne de votre bien sur plusieurs plateformes de location.",
    "La fixation des prix.",
    "L'accueil des voyageurs.",
    "Le ménage et le linge.",
    "L'entretien et la maintenance.",
    "Les photos du bien.",
    "Un rapport mensuel.",
  ]);
  await expect(owners).toContainText("La décoration du bien avant sa mise en location est possible en plus, sur devis.");
  await expect(owners).toContainText("Sigma prépare pour vous le dossier d'autorisation prévu par la loi 80-14");
  await expect(owners.getByTestId("owners-next")).toContainText("ne sont pas encore disponibles");
  await expect(owners.locator("form, input, textarea, a")).toHaveCount(0);
  // No booking from the site, no payment, refund or contact promises.
  const main = page.getByRole("main");
  await expect(main).not.toContainText(/réserv|rembours|paiement|payer|carte bancaire|@|\+33|\+212|0\d( ?\d\d){4}|contact/i);
});

test("the stated price is what the API quotes", async ({ request }) => {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const listing = await (await request.get("/api/listings/1003")).json();
  const q = await (await request.get(`/api/listings/1003/quote?checkin=${day(200)}&checkout=${day(204)}&adults=1`)).json();
  const stay = listing.priceCents * 4;
  expect(q.stayCents).toBe(stay);
  expect(q.cleaningFeeCents).toBe(listing.cleaningFeeCents);
  expect(q.serviceFeeCents).toBe(0);
  expect(q.totalCents).toBe(stay + listing.cleaningFeeCents);
});

/** Every link leads somewhere real: internal paths answer 200 and their #anchors exist. No external links. */
async function checkLinks(page: Page, scope: string) {
  const hrefs = [...new Set(await page.locator(`${scope} a[href]`).evaluateAll((as) => as.map((a) => a.getAttribute("href")!)))];
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(href, `${scope}: external link`).toMatch(/^[/#]/);
    const url = new URL(href, page.url());
    const target = url.pathname === new URL(page.url()).pathname ? page : await page.context().newPage();
    if (target !== page) {
      const res = await target.goto(url.pathname + url.search);
      expect(res!.status(), href).toBe(200);
    }
    if (url.hash) await expect(target.locator(`[id="${url.hash.slice(1)}"]`), href).toHaveCount(1);
    if (target !== page) await target.close();
  }
  return hrefs;
}

test("every link on the help page works", async ({ page }) => {
  await page.goto("/aide");
  await checkLinks(page, "main");
});

test("every footer link works and goes where its column says", async ({ page }) => {
  await page.goto("/");
  const hrefs = await checkLinks(page, "footer");
  expect(hrefs.sort()).toEqual(
    [
      "/aide",
      "/aide#rechercher",
      "/aide#sejours",
      "/aide#favoris",
      "/aide#compte",
      "/aide#cookies",
      "/aide#proprietaires",
      "/aide#gestion",
      "/aide#autorisation",
      "/homes",
      "/experiences",
      "/services",
      "/wishlists",
      "/trips",
      "/login",
    ].sort(),
  );
  // Each column's links stay in their column.
  const column = (title: string) => page.locator("footer section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  expect(await column("Propriétaires").locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).toEqual([
    "/aide#proprietaires",
    "/aide#gestion",
    "/aide#autorisation",
  ]);
  await page.locator("footer").getByRole("link", { name: "Séjours et annulation" }).click();
  await expect(page).toHaveURL(/\/aide#sejours$/);
  await expect(page.getByRole("heading", { name: "Vos séjours" })).toBeInViewport();
});

test.describe("the storage list matches what the site really stores", () => {
  test.use({ consent: false });
  test("cookies and local storage, signed out, signed in and signed out again", async ({ page, context, isMobile }) => {
    test.skip(isMobile, "browser storage doesn't depend on the viewport");
    await page.goto("/aide");
    const listed = (await page.getByTestId("storage-list").locator("code").allTextContents()).map((s) => s.trim());
    expect(listed).toEqual(["better-auth.session_token", "better-auth.session_data", "sigma_consent", "sigma:wishlist", "better-auth.message"]);
    await expect(page.getByTestId("storage-list")).toContainText(/180\sjours/);
    await expect(page.getByTestId("storage-list")).toContainText(/30\sjours/);

    // Signed out: nothing until the notice is dismissed and a favourite is saved.
    expect(await context.cookies()).toEqual([]);
    await page.goto("/");
    await page.getByRole("region", { name: "Cookies", exact: true }).getByRole("button", { name: "Fermer ce message" }).click();
    await page.getByTestId("listing-card-save-button").first().click();
    const storageKeys = () => page.evaluate(() => Object.keys(localStorage).sort());
    expect(await storageKeys()).toEqual(["sigma:wishlist"]);
    expect((await context.cookies()).map((c) => c.name)).toEqual(["sigma_consent"]);

    // Signed in: Better Auth's cookies; the device's favourites move to the account.
    await signUp(page, "Aide");
    await expect.poll(storageKeys).toEqual([]);
    const names = (await context.cookies()).map((c) => c.name.replace(/^__Secure-/, ""));
    expect(names.sort()).toEqual(["better-auth.session_data", "better-auth.session_token", "sigma_consent"]);
    for (const name of names) expect(listed).toContain(name);

    // Signed out again: the session cookies go; Better Auth leaves its cross-tab sign-out message behind.
    await page.getByRole("button", { name: "Menu principal" }).click();
    await page.getByRole("menuitem", { name: "Déconnexion" }).click();
    await expect(page.getByRole("link", { name: "Connexion" }).first()).toBeVisible();
    await expect.poll(storageKeys).toEqual(["better-auth.message"]);
    const message = JSON.parse((await page.evaluate(() => localStorage.getItem("better-auth.message")))!);
    expect(Object.keys(message).sort()).toEqual(["clientId", "data", "event", "timestamp"]);
    expect(message.data).toEqual({ trigger: "signout" });
    await expect.poll(async () => (await context.cookies()).map((c) => c.name)).toEqual(["sigma_consent"]);
    for (const key of await storageKeys()) expect(listed).toContain(key);
  });
});
