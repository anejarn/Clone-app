import { expect, test } from "./fixtures";

test.describe("desktop search", () => {
  test.skip(({ isMobile }) => isMobile, "desktop search bar only");

  test("destination → dates → guests → results", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByTestId("big-search");
    await bar.getByLabel("Destination").fill("orres");
    await page.getByRole("list", { name: "Destinations suggérées" }).getByRole("button", { name: /Les Orres/ }).click();

    const days = page.locator(".rdp-day:not(.rdp-disabled) button");
    await days.nth(10).click();
    await days.nth(13).click();
    await expect(bar.getByRole("button", { name: /Dates/ })).not.toContainText("Quand");

    await bar.getByRole("button", { name: /Voyageurs/ }).click();
    await page.getByRole("button", { name: "Augmenter enfants" }).click();
    await page.getByRole("button", { name: "Augmenter adultes" }).click();
    await expect(bar).toContainText("3 voyageurs");

    await page.getByTestId("structured-search-input-search-button").click();
    await expect(page).toHaveURL(/\/s\/les-orres\/homes\?checkin=\d{4}-\d\d-\d\d&checkout=\d{4}-\d\d-\d\d&adults=2&children=1$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Les Orres");
    await expect(page.getByText(/3 nuits · 3 voyageurs/)).toBeVisible();
    await expect(page.getByTestId("card-container").first()).toContainText("pour 3 nuits");
    // The compact bar carries the query over.
    await expect(page.getByTestId("little-search")).toContainText("Les Orres");
  });

  test("header collapses on scroll and re-expands from the pill", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("big-search")).toBeVisible();
    await page.mouse.wheel(0, 800);
    await expect(page.getByTestId("little-search")).toBeVisible();
    await expect(page.getByTestId("big-search")).toBeHidden();
    await page.getByTestId("little-search").getByRole("button", { name: "Ajouter des voyageurs" }).click();
    await expect(page.getByRole("button", { name: "Augmenter adultes" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("big-search")).toBeHidden();
  });
});

test("mobile search sheet", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/");
  await page.getByRole("button", { name: "Commencer ma recherche" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("list", { name: "Destinations suggérées" }).getByRole("button", { name: /Orcières/ }).click();
  await expect(sheet.getByRole("heading", { name: "Quand ?" })).toBeVisible();
  await sheet.getByRole("button", { name: /Voyageurs/ }).click();
  await sheet.getByRole("button", { name: "Augmenter adultes" }).click();
  await sheet.getByRole("button", { name: "Rechercher" }).click();
  await expect(page).toHaveURL(/\/s\/orcieres-merlette\/homes\?adults=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Orcières");
});

test("results tolerate unknown places and junk params", async ({ page }) => {
  await page.goto("/s/atlantide/homes?checkin=demain&adults=-4&pets=99");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aucun résultat");
  await page.goto("/s/partout/homes?adults=2");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Plus de \d+ logements$/);
});

test("clicking a homepage card opens its listing page", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("region", { name: "Logements populaires · Orcières-Merlette 1850" }).getByTestId("card-container").nth(2);
  const title = (await card.getByTestId("listing-card-title").textContent())!;
  await card.click();
  await expect(page).toHaveURL(/\/rooms\/\d+$/);
  // The card's heading is the listing's title, the page's h1.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
});

test("results show classification and lift distance, and price stays for the searched adults", async ({ page }) => {
  await page.goto("/s/orcieres-merlette/homes?checkin=2027-02-10&checkout=2027-02-14&adults=3");
  await expect(page.getByText(/^4 nuits · 3 voyageurs · Prix tout compris, taxe de séjour incluse$/)).toBeVisible();
  const first = page.getByTestId("card-container").first();
  await expect(first).toContainText(/(Meublé [1-5]★|Non classé) · (Ski aux pieds|À \d+\sm des pistes)/);
  await expect(first).toContainText("pour 4 nuits");
  await page.goto("/s/orcieres-merlette/homes");
  await expect(page.getByText(/Prix par nuit, hors ménage et taxe de séjour/)).toBeVisible();
  await expect(page.getByTestId("card-container").first()).toContainText("par nuit");
});
