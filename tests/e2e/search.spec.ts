import { expect, test } from "./fixtures";

test.describe("desktop search", () => {
  test.skip(({ isMobile }) => isMobile, "desktop search bar only");

  test("destination → dates → guests → results", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByTestId("big-search");
    await bar.getByLabel("Destination").fill("orres");
    await page.getByRole("listbox", { name: "Destinations suggérées" }).getByRole("option", { name: /Les Orres/ }).click();
    // The picked resort's name replaces what was typed (diff search-24).
    await expect(bar.getByRole("combobox", { name: "Destination" })).toHaveValue("Les Orres");

    const days = page.locator(".rdp-day:not(.rdp-disabled) button");
    await days.nth(10).click();
    await days.nth(13).click();
    await expect(bar.getByRole("button", { name: /Dates/ })).not.toContainText("Quand");

    await bar.getByRole("button", { name: /Voyageurs/ }).click();
    // Age bands as the law has them: the taxe de séjour is per adult, minors are exempt.
    await expect(bar).toContainText("Adultes18 ans et plus");
    await expect(bar).toContainText("EnfantsDe 2 à 17 ans");
    await expect(bar).toContainText("BébésMoins de 2 ans");
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
  await sheet.getByRole("listbox", { name: "Destinations suggérées" }).getByRole("option", { name: /Orcières/ }).click();
  await expect(sheet.getByRole("heading", { name: "Quand ?" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Destination/ })).toContainText("Orcières-Merlette 1850");
  await sheet.getByRole("button", { name: /Voyageurs/ }).click();
  await expect(sheet).toContainText("Adultes18 ans et plus");
  await expect(sheet).toContainText("EnfantsDe 2 à 17 ans");
  await expect(sheet).toContainText("BébésMoins de 2 ans");
  await sheet.getByRole("button", { name: "Augmenter adultes" }).click();
  await sheet.getByRole("button", { name: "Rechercher" }).click();
  await expect(page).toHaveURL(/\/s\/orcieres-merlette\/homes\?adults=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Orcières");
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
  await expect(listbox.getByRole("option")).toHaveCount(2);
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(input).toHaveAttribute("aria-controls", (await listbox.getAttribute("id"))!);
  await input.fill("les");
  await expect(listbox.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  const option = listbox.getByRole("option", { name: /Les Orres/ });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", (await option.getAttribute("id"))!);
  await expect(input).toBeFocused();
  // Escape closes the list, not the sheet; typing opens it again.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeVisible();
  await expect(listbox).toBeHidden();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.type(" orres");
  await expect(listbox.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(sheet.getByRole("heading", { name: "Quand ?" })).toBeFocused();
  await expect(sheet.getByRole("button", { name: /Destination/ })).toContainText("Les Orres");
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
  await expect(listbox.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  // Second Escape closes the sheet; reopen it, then the same again with the close button.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await trigger.click();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(listbox.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  await sheet.getByRole("button", { name: "Fermer" }).click();
  await expect(sheet).toBeHidden();
  await trigger.click();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(listbox.getByRole("option")).toHaveCount(2);
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
