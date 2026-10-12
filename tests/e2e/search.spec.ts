import { expect, test } from "./fixtures";

test.describe("desktop search", () => {
  test.skip(({ isMobile }) => isMobile, "desktop search bar only");

  test("destination → dates → guests → results", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByTestId("big-search");
    await bar.getByLabel("Destination").fill("anne");
    await page.getByRole("option").getByRole("button", { name: /Annecy/ }).click();

    const days = page.locator(".rdp-day:not(.rdp-disabled) button");
    await days.nth(10).click();
    await days.nth(13).click();
    await expect(bar.getByRole("button", { name: /Dates/ })).not.toContainText("Quand");

    await bar.getByRole("button", { name: /Voyageurs/ }).click();
    await page.getByRole("button", { name: "Augmenter enfants" }).click();
    await page.getByRole("button", { name: "Augmenter adultes" }).click();
    await expect(bar).toContainText("3 voyageurs");

    await page.getByTestId("structured-search-input-search-button").click();
    await expect(page).toHaveURL(/\/s\/annecy\/homes\?checkin=\d{4}-\d\d-\d\d&checkout=\d{4}-\d\d-\d\d&adults=2&children=1$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Annecy");
    await expect(page.getByText(/3 nuits · 3 voyageurs/)).toBeVisible();
    await expect(page.getByTestId("card-container").first()).toContainText("pour 3 nuits");
    // The compact bar carries the query over.
    await expect(page.getByTestId("little-search")).toContainText("Annecy");
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
  await sheet.getByRole("option").getByRole("button", { name: /Lyon/ }).click();
  await expect(sheet.getByRole("heading", { name: "Quand ?" })).toBeVisible();
  await sheet.getByRole("button", { name: /Voyageurs/ }).click();
  await sheet.getByRole("button", { name: "Augmenter adultes" }).click();
  await sheet.getByRole("button", { name: "Rechercher" }).click();
  await expect(page).toHaveURL(/\/s\/lyon\/homes\?adults=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lyon");
});

test("results tolerate unknown places and junk params", async ({ page }) => {
  await page.goto("/s/atlantide/homes?checkin=demain&adults=-4&pets=99");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aucun résultat");
  await page.goto("/s/partout/homes?adults=2");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Plus de \d+ logements$/);
});

test("clicking a homepage card pins it first in the results", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("region", { name: "Logements populaires · Paris" }).getByTestId("card-container").nth(2);
  const title = await card.getByTestId("listing-card-title").textContent();
  await card.click();
  await expect(page).toHaveURL(/\/s\/paris\/homes\?.*pinned=\d+/);
  await expect(page.getByTestId("listing-card-title").first()).toHaveText(title!);
});
