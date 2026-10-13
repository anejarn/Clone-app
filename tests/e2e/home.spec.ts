import { expect, test } from "./fixtures";

test("homepage states the promise and shows the resorts and listing rows", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Nidou/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Les appartements de ski d'Orcières-Merlette et des Orres");
  await expect(page.getByText(/Arrivée n'importe quel jour, à partir de 2\snuits\. Avec vos dates, le prix affiché est tout compris, taxe de séjour incluse\./)).toBeVisible();
  const resorts = page.getByRole("region", { name: "Nos deux stations" });
  await expect(resorts.getByRole("link")).toHaveText([/Orcières-Merlette 1850/, /Les Orres/]);
  for (const title of [
    "Logements populaires · Orcières-Merlette 1850",
    "Logements populaires · Les Orres",
    "Ski aux pieds",
    "Grands logements pour les familles",
  ]) {
    await expect(page.getByRole("region", { name: title, exact: true }).getByTestId("card-container").first()).toBeVisible();
  }
  // Cards: the listing's title, then "Type · Resort", classification and lift distance, nightly price without dates.
  const card = page.getByRole("region", { name: "Ski aux pieds", exact: true }).getByTestId("card-container").first();
  await expect(card.getByTestId("listing-card-title")).toHaveText(/^(Appartement|Studio|Chalet) \S+ .+/);
  await expect(card.getByTestId("listing-card-kind")).toHaveText(/^(Appartement|Studio|Chalet) · (Orcières-Merlette 1850|Les Orres)$/);
  await expect(card).toContainText(/(Meublé [1-5]★|Non classé) · Ski aux pieds/);
  await expect(card).toContainText("par nuit");
  await expect(page.getByRole("heading", { name: "Trouver un logement par station" })).toBeVisible();
});

test("no category tabs; the old tab pages redirect home for good", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Catégories" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Expériences|Services/ })).toHaveCount(0);
  for (const path of ["/experiences", "/services", "/homes"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(308);
    expect(res.headers().location, path).toMatch(/^(http:\/\/localhost:\d+)?\/$/);
  }
  await page.goto("/experiences");
  await expect(page).toHaveURL(/\/$/);
});

test("resort tiles and the by-resort links open filtered searches", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("region", { name: "Nos deux stations" }).getByRole("link", { name: /Les Orres/ }).click();
  await expect(page).toHaveURL(/\/s\/les-orres\/homes$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Les Orres");

  await page.goto("/");
  await page.getByRole("navigation", { name: "Les Orres" }).getByRole("link", { name: "Chalets" }).click();
  await expect(page).toHaveURL(/\/s\/les-orres\/homes\?type=chalet$/);
  await expect(page.getByText(/^Chalets · /)).toBeVisible();
  await expect(page.getByTestId("listing-card-kind").first()).toHaveText("Chalet · Les Orres");
  // The homepage stays mounted but hidden after a client-side navigation: count visible cards only.
  const titles = await page.getByTestId("listing-card-kind").filter({ visible: true }).allTextContents();
  expect(titles.length).toBeGreaterThan(0);
  expect(new Set(titles)).toEqual(new Set(["Chalet · Les Orres"]));

  await page.goto("/");
  await page.getByRole("navigation", { name: "Orcières-Merlette 1850" }).getByRole("link", { name: "Ski aux pieds" }).click();
  await expect(page).toHaveURL(/\/s\/orcieres-merlette\/homes\?ski=1$/);
  await expect(page.getByText(/^Ski aux pieds · /)).toBeVisible();
  const cards = await page.getByTestId("card-container").filter({ visible: true }).allTextContents();
  expect(cards.length).toBeGreaterThan(0);
  for (const text of cards) expect(text).toContain("Ski aux pieds");
});

test("owners are pointed to the host page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("region", { name: /Propriétaire à Orcières-Merlette 1850 ou aux Orres/ }).getByRole("link", { name: "Devenir hôte" }).click();
  await expect(page).toHaveURL(/\/devenir-hote$/);
});

test.describe("cookie banner", () => {
  test.use({ consent: false });
  test("is shown once and remembered", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByRole("dialog", { name: "Améliorez votre expérience" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Uniquement les nécessaires" }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("card-container").first()).toBeVisible();
    await expect(banner).toBeHidden();
  });
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
