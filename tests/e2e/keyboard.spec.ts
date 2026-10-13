import { expect, test } from "./fixtures";

test.describe("keyboard only", () => {
  test.skip(({ isMobile }) => isMobile, "keyboard flows on desktop");

  test("search from the homepage without a mouse", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("structured-search-input-field-query");
    // The destination field is reachable with Tab.
    for (let i = 0; i < 20 && !(await input.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(input).toBeFocused();

    await page.keyboard.type("orc");
    const resort = page.getByRole("list", { name: "Destinations suggérées" }).getByRole("button", { name: /Orcières/ });
    await expect(resort).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(resort).toBeFocused();
    await page.keyboard.press("Enter");

    // Focus stays in the search bar when the panel switches to dates.
    await expect(page.locator(".rdp-root")).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement?.closest("[data-testid=big-search]"))).toBe(true);

    await page.getByRole("button", { name: /Voyageurs/ }).focus();
    await page.keyboard.press("Enter");
    const plus = page.getByRole("button", { name: "Augmenter adultes" });
    await plus.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("big-search")).toContainText("2 voyageurs");

    await page.getByTestId("structured-search-input-search-button").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/s\/orcieres-merlette\/homes\?adults=2$/);
  });

  test("Escape closes the open panel", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Voyageurs/ }).click();
    await expect(page.getByRole("button", { name: "Augmenter adultes" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Augmenter adultes" })).toBeHidden();
  });

  test("cards are links with a name, and photo arrows show on focus", async ({ page }) => {
    await page.goto("/s/orcieres-merlette/homes");
    const card = page.getByTestId("card-container").first();
    const title = await card.getByTestId("listing-card-title").textContent();
    await expect(card.getByRole("link", { name: title! })).toBeVisible();
    const next = card.getByRole("button", { name: "Photo suivante" });
    await next.focus();
    await expect(next).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expect(card.getByRole("button", { name: "Photo précédente" })).toBeAttached();
  });

  test("pick a stay and guests on the listing page without a mouse", async ({ page }) => {
    // 1050: nothing in the tests books it.
    await page.goto("/rooms/1050");
    const card = page.getByTestId("booking-card");
    const dates = card.getByRole("button", { name: /Arrivée/ });
    for (let i = 0; i < 60 && !(await dates.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(dates).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dates).toHaveAttribute("aria-expanded", "true");
    // Into the grid (focus lands on today), four months ahead, then a 3-night stay.
    const grid = card.locator(".rdp-root");
    for (let i = 0; i < 10 && !(await grid.evaluate((el) => el.contains(document.activeElement) && document.activeElement?.closest("td") !== null)); i++) {
      await page.keyboard.press("Tab");
    }
    for (let i = 0; i < 4; i++) await page.keyboard.press("PageDown");
    await page.keyboard.press("Enter");
    await expect(card).toContainText("Choisissez la date de départ");
    // The day after check-in is disabled (2-night minimum), so arrow keys skip it: two presses = 3 nights.
    for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    // The calendar closes and focus goes back to the dates button, not to <body>.
    await expect(dates).toBeFocused();
    await expect(dates).toHaveAttribute("aria-expanded", "false");
    await expect(card.getByTestId("price-breakdown")).toContainText("× 3 nuits");

    const guests = card.getByRole("button", { name: /Voyageurs/ });
    await guests.focus();
    await page.keyboard.press("Enter");
    await card.getByRole("button", { name: "Augmenter adultes" }).focus();
    await page.keyboard.press("Enter");
    await expect(card.getByTestId("price-breakdown")).toContainText("Taxe de séjour (2 adultes)");
    await card.getByRole("button", { name: "Réserver" }).focus();
    await expect(card.getByRole("button", { name: "Réserver" })).toBeEnabled();
  });

  test("the host form can be filled and sent from the keyboard", async ({ page }) => {
    await page.goto("/devenir-hote");
    await page.getByLabel("Nom et prénom").focus();
    await page.keyboard.type("Paul Girard");
    await page.keyboard.press("Tab");
    await page.keyboard.type(`kbd-${Date.now()}@test.nidou.fr`);
    await page.keyboard.press("Tab"); // phone, optional
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Station")).toBeFocused();
    await page.getByLabel("Station").selectOption("orcieres-merlette");
    await page.keyboard.press("Tab");
    await page.getByLabel("Type de logement").selectOption("CHALET");
    await page.keyboard.press("Tab");
    await page.keyboard.type("8");
    await page.keyboard.press("Tab");
    await page.keyboard.type("10");
    await page.keyboard.press("Tab"); // registration number, optional
    await page.keyboard.press("Tab"); // message, optional
    await page.keyboard.press("Tab");
    await expect(page.getByRole("checkbox")).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Envoyer ma demande" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Merci");
  });
});
