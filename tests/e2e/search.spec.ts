import { expect, test } from "./fixtures";

test.describe("desktop search", () => {
  test.skip(({ isMobile }) => isMobile, "desktop search bar only");

  test("destination → dates → guests → results", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByTestId("big-search");
    await bar.getByLabel("Destination").fill("anne");
    await page.getByRole("listbox", { name: "Destinations suggérées" }).getByRole("option", { name: /Annecy/ }).click();
    // The picked place's name replaces what was typed (diff search-24).
    await expect(bar.getByRole("combobox", { name: "Destination" })).toHaveValue("Annecy");

    const days = page.locator(".rdp-day:not(.rdp-disabled) button");
    await days.nth(10).click();
    // A check-in alone reads as one day ("24 nov."), not "24–24 nov." (diff search-34).
    await expect(bar.getByRole("button", { name: /Dates/ })).toContainText(/\d{1,2} \S+$/);
    await expect(bar.getByRole("button", { name: /Dates/ })).not.toContainText("–");
    await days.nth(13).click();
    await expect(bar.getByRole("button", { name: /Dates/ })).not.toContainText("Quand");

    await bar.getByRole("button", { name: /Voyageurs/ }).click();
    await expect(bar).toContainText("Adultes18 ans et plus");
    await expect(bar).toContainText("EnfantsDe 2 à 17 ans");
    await expect(bar).toContainText("BébésMoins de 2 ans");
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

test("a check-in alone is not sent as dates", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop search bar");
  await page.goto("/");
  const bar = page.getByTestId("big-search");
  await bar.getByRole("button", { name: /Dates/ }).click();
  await page.locator(".rdp-day:not(.rdp-disabled) button").nth(5).click();
  await page.getByTestId("structured-search-input-search-button").click();
  await expect(page).toHaveURL(/\/s\/partout\/homes$/);
});

test("mobile search sheet", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/");
  await page.getByRole("button", { name: "Commencer ma recherche" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("combobox", { name: "Destination" }).fill("lyo");
  await sheet.getByRole("listbox", { name: "Destinations suggérées" }).getByRole("option", { name: /Lyon/ }).click();
  await expect(sheet.getByRole("heading", { name: "Quand ?" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Destination/ })).toContainText("Lyon");
  await sheet.getByRole("button", { name: /Voyageurs/ }).click();
  await expect(sheet).toContainText("Adultes18 ans et plus");
  await expect(sheet).toContainText("EnfantsDe 2 à 17 ans");
  await expect(sheet).toContainText("BébésMoins de 2 ans");
  await sheet.getByRole("button", { name: "Augmenter adultes" }).click();
  await sheet.getByRole("button", { name: "Rechercher" }).click();
  await expect(page).toHaveURL(/\/s\/lyon\/homes\?adults=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lyon");
});

test("mobile sheet: the destination is a combobox driven from the keyboard", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/");
  await page.getByRole("button", { name: "Commencer ma recherche" }).click();
  const sheet = page.getByRole("dialog");
  const input = sheet.getByRole("combobox", { name: "Destination" });
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-autocomplete", "list");
  const listbox = sheet.getByRole("listbox", { name: "Destinations suggérées" });
  await expect(listbox.getByRole("option")).toHaveCount(8);
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(input).toHaveAttribute("aria-controls", (await listbox.getAttribute("id"))!);
  await expect(listbox.locator("button, a, input, [tabindex]")).toHaveCount(0);
  await input.fill("mar");
  await expect(listbox.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const option = listbox.getByRole("option", { name: /Marseille/ });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", (await option.getAttribute("id"))!);
  await expect(input).toBeFocused();
  // Wraps back to the first.
  await page.keyboard.press("ArrowDown");
  await expect(listbox.getByRole("option", { name: /Marrakech/ })).toHaveAttribute("aria-selected", "true");
  // Escape closes the list, not the sheet; typing opens it again.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeVisible();
  await expect(listbox).toBeHidden();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.type("s");
  await expect(listbox.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(sheet.getByRole("heading", { name: "Quand ?" })).toBeFocused();
  await expect(sheet.getByRole("button", { name: /Destination/ })).toContainText("Marseille");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("mobile sheet: reopening after Escape shows the suggestions again", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Commencer ma recherche" });
  await trigger.click();
  const sheet = page.getByRole("dialog");
  const input = sheet.getByRole("combobox", { name: "Destination" });
  const listbox = sheet.getByRole("listbox", { name: "Destinations suggérées" });
  await expect(listbox.getByRole("option")).toHaveCount(8);
  await page.keyboard.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  // Second Escape closes the sheet; reopen it, then the same again with the close button.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await trigger.click();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(listbox.getByRole("option")).toHaveCount(8);
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  await sheet.getByRole("button", { name: "Fermer" }).click();
  await expect(sheet).toBeHidden();
  await trigger.click();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(listbox.getByRole("option")).toHaveCount(8);
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
