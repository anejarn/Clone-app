import { expect, test } from "./fixtures";

test.describe("desktop search", () => {
  test.skip(({ isMobile }) => isMobile, "desktop search bar only");

  test("destination → dates → guests → results", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByTestId("big-search");
    await bar.getByLabel("Quartier").fill("guel");
    await page.getByRole("listbox", { name: "Quartiers suggérés" }).getByRole("option", { name: /Guéliz/ }).click();
    // The picked place's name replaces what was typed (diff search-24).
    await expect(bar.getByRole("combobox", { name: "Quartier" })).toHaveValue("Guéliz");

    const days = page.locator(".rdp-day:not(.rdp-disabled) button");
    await days.nth(10).click();
    // A check-in alone reads as one day ("24 nov."), not "24–24 nov." (diff search-34).
    await expect(bar.getByRole("button", { name: /Dates/ })).toContainText(/\d{1,2} \S+$/);
    await expect(bar.getByRole("button", { name: /Dates/ })).not.toContainText("–");
    await days.nth(13).click();
    await expect(bar.getByRole("button", { name: /Dates/ })).not.toContainText("Arrivée");

    await bar.getByRole("button", { name: /Voyageurs/ }).click();
    await expect(bar).toContainText("Adultes18 ans et plus");
    await expect(bar).toContainText("EnfantsDe 2 à 17 ans");
    await expect(bar).toContainText("BébésMoins de 2 ans");
    await page.getByRole("button", { name: "Augmenter enfants" }).click();
    await page.getByRole("button", { name: "Augmenter adultes" }).click();
    await expect(bar).toContainText("3 voyageurs");

    await page.getByTestId("structured-search-input-search-button").click();
    await expect(page).toHaveURL(/\/s\/gueliz\/homes\?checkin=\d{4}-\d\d-\d\d&checkout=\d{4}-\d\d-\d\d&adults=2&children=1$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Guéliz");
    // No service fee line: Sigma adds none.
    await expect(page.getByText("3 nuits · 3 voyageurs · Prix total, ménage compris")).toBeVisible();
    await expect(page.getByTestId("card-container").first()).toContainText(/\d\u00a0MAD pour 3 nuits/);
    // The compact bar carries the query over.
    await expect(page.getByTestId("little-search")).toContainText("Guéliz");
  });

  test("header collapses on scroll and re-expands from the pill", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("big-search")).toBeVisible();
    await page.mouse.wheel(0, 800);
    await expect(page.getByTestId("little-search")).toBeVisible();
    await expect(page.getByTestId("big-search")).toBeHidden();
    await page.getByTestId("little-search").getByRole("button", { name: "Voyageurs" }).click();
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
  await page.getByRole("button", { name: "Rechercher à Marrakech" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("combobox", { name: "Quartier" }).fill("semla");
  await sheet.getByRole("listbox", { name: "Quartiers suggérés" }).getByRole("option", { name: /Semlalia/ }).click();
  await expect(sheet.getByRole("heading", { name: "Quelles dates ?" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Quartier/ })).toContainText("Semlalia");
  await sheet.getByRole("button", { name: /Voyageurs/ }).click();
  await expect(sheet).toContainText("Adultes18 ans et plus");
  await expect(sheet).toContainText("EnfantsDe 2 à 17 ans");
  await expect(sheet).toContainText("BébésMoins de 2 ans");
  await sheet.getByRole("button", { name: "Augmenter adultes" }).click();
  await sheet.getByRole("button", { name: "Rechercher" }).click();
  await expect(page).toHaveURL(/\/s\/semlalia\/homes\?adults=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Semlalia");
});

test("mobile sheet: the destination is a combobox driven from the keyboard", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/");
  await page.getByRole("button", { name: "Rechercher à Marrakech" }).click();
  const sheet = page.getByRole("dialog");
  const input = sheet.getByRole("combobox", { name: "Quartier" });
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-autocomplete", "list");
  const listbox = sheet.getByRole("listbox", { name: "Quartiers suggérés" });
  await expect(listbox.getByRole("option")).toHaveCount(8);
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(input).toHaveAttribute("aria-controls", (await listbox.getAttribute("id"))!);
  await expect(listbox.locator("button, a, input, [tabindex]")).toHaveCount(0);
  // "ra": Ménara and Palmeraie.
  await input.fill("ra");
  await expect(listbox.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const option = listbox.getByRole("option", { name: /Palmeraie/ });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", (await option.getAttribute("id"))!);
  await expect(input).toBeFocused();
  // Wraps back to the first.
  await page.keyboard.press("ArrowDown");
  await expect(listbox.getByRole("option", { name: /Ménara/ })).toHaveAttribute("aria-selected", "true");
  // Escape closes the list, not the sheet; typing opens it again.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeVisible();
  await expect(listbox).toBeHidden();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.type("i");
  await expect(listbox.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(sheet.getByRole("heading", { name: "Quelles dates ?" })).toBeFocused();
  await expect(sheet.getByRole("button", { name: /Quartier/ })).toContainText("Palmeraie");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("mobile sheet: reopening after Escape shows the suggestions again", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Rechercher à Marrakech" });
  await trigger.click();
  const sheet = page.getByRole("dialog");
  const input = sheet.getByRole("combobox", { name: "Quartier" });
  const listbox = sheet.getByRole("listbox", { name: "Quartiers suggérés" });
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

test("mobile sheet: reopening starts with no highlighted suggestion", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Rechercher à Marrakech" });
  await trigger.click();
  const sheet = page.getByRole("dialog");
  const input = sheet.getByRole("combobox", { name: "Quartier" });
  const listbox = sheet.getByRole("listbox", { name: "Quartiers suggérés" });
  await expect(listbox.getByRole("option")).toHaveCount(8);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", /destinations-1$/);
  await sheet.getByRole("button", { name: "Fermer" }).click();
  await expect(sheet).toBeHidden();
  await trigger.click();
  await expect(listbox.getByRole("option")).toHaveCount(8);
  await expect(input).not.toHaveAttribute("aria-activedescendant");
  await expect(listbox.locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
  // Enter with nothing highlighted picks no place: the destination step stays open and empty.
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("");
  await expect(sheet.getByRole("heading", { name: "Quel quartier ?" })).toBeVisible();
});

test("results tolerate unknown places and junk params", async ({ page }) => {
  await page.goto("/s/atlantide/homes?checkin=demain&adults=-4&pets=99");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aucun résultat");
  await page.goto("/s/partout/homes?adults=2");
  // 120 homes sleep two: "more than 110", never "more than 120".
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plus de 110 logements");
  await expect(page.getByText("Sans dates · 2 voyageurs · Prix de la nuit, hors ménage")).toBeVisible();
});

test("clicking a homepage card pins it first in the results", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("region", { name: "Logements populaires · Hivernage" }).getByTestId("card-container").nth(2);
  const title = await card.getByTestId("listing-card-title").textContent();
  await card.click();
  await expect(page).toHaveURL(/\/s\/hivernage\/homes\?.*pinned=\d+/);
  await expect(page.getByTestId("listing-card-title").first()).toHaveText(title!);
});
