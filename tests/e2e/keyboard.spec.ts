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
    const resort = page.getByRole("listbox", { name: "Destinations suggérées" }).getByRole("option", { name: /Orcières/ });
    await expect(resort).toBeVisible();
    // Combobox: the highlight moves, focus stays in the input.
    await page.keyboard.press("ArrowDown");
    await expect(input).toBeFocused();
    await expect(resort).toHaveAttribute("aria-selected", "true");
    await expect(input).toHaveAttribute("aria-activedescendant", (await resort.getAttribute("id"))!);
    await page.keyboard.press("Enter");

    // The input shows the picked resort, and focus moves on to the dates segment.
    await expect(input).toHaveValue("Orcières-Merlette 1850");
    await expect(page.locator(".rdp-root")).toBeVisible();
    await expect(page.getByTestId("big-search").getByRole("button", { name: /Dates/ })).toBeFocused();

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

  test("destination combobox: semantics, arrow keys, Escape, click", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("big-search").getByRole("combobox", { name: "Destination" });
    await expect(input).toHaveAttribute("aria-autocomplete", "list");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await input.focus();
    const listbox = page.getByRole("listbox", { name: "Destinations suggérées" });
    const options = listbox.getByRole("option");
    await expect(options).toHaveCount(2);
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await expect(input).toHaveAttribute("aria-controls", (await listbox.getAttribute("id"))!);
    await expect(input).not.toHaveAttribute("aria-activedescendant");
    // No nested controls inside options (axe nested-interactive).
    await expect(listbox.locator("button, a, input, [tabindex]")).toHaveCount(0);

    const ids = await options.evaluateAll((els) => els.map((e) => e.id));
    const highlighted = () => input.getAttribute("aria-activedescendant");
    // Down from nothing: first; down past the last: wraps to the first; up from the first: wraps to the last.
    await page.keyboard.press("ArrowDown");
    expect(await highlighted()).toBe(ids[0]);
    await page.keyboard.press("ArrowDown");
    expect(await highlighted()).toBe(ids[1]);
    await page.keyboard.press("ArrowDown");
    expect(await highlighted()).toBe(ids[0]);
    await page.keyboard.press("ArrowUp");
    expect(await highlighted()).toBe(ids[1]);
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "false");
    await expect(input).toBeFocused();

    // Typing resets the highlight.
    await page.keyboard.type("o");
    await expect(input).not.toHaveAttribute("aria-activedescendant");

    // Escape closes the list, focus stays; typing opens it again.
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(input).toBeFocused();
    await page.keyboard.press("Backspace");
    await expect(options).toHaveCount(2);

    // Clicking an option picks it, like Enter.
    await options.filter({ hasText: "Les Orres" }).click();
    await expect(input).toHaveValue("Les Orres");
    await expect(page.locator(".rdp-root")).toBeVisible();
    await expect(page.getByTestId("big-search").getByRole("button", { name: /Dates/ })).toBeFocused();
  });

  test("leaving the destination field with Tab collapses its list", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("big-search").getByRole("combobox", { name: "Destination" });
    const listbox = page.getByRole("listbox", { name: "Destinations suggérées" });
    await input.focus();
    await expect(listbox.getByRole("option")).toHaveCount(2);
    await page.keyboard.press("ArrowDown");
    await expect(input).toHaveAttribute("aria-activedescendant", /destinations-0$/);
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("big-search").getByRole("button", { name: /Dates/ })).toBeFocused();
    await expect(listbox).toHaveCount(0);
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(input).not.toHaveAttribute("aria-activedescendant");
    await expect(page.getByText("Suggestions de destinations")).toHaveCount(0);
    // Shift+Tab back in opens it again.
    await page.keyboard.press("Shift+Tab");
    await expect(input).toBeFocused();
    await expect(listbox.getByRole("option")).toHaveCount(2);
    await expect(input).toHaveAttribute("aria-expanded", "true");
    // A mouse press on the search button is not a Tab: the list stays until the click submits.
    await page.keyboard.type("orres");
    await expect(listbox.getByRole("option")).toHaveCount(1);
    await page.getByTestId("structured-search-input-search-button").getByText("Rechercher").click();
    await expect(page).toHaveURL(/\/s\/les-orres\/homes$/);
  });

  test("Enter with nothing highlighted still searches the typed text", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("big-search").getByRole("combobox", { name: "Destination" });
    await input.focus();
    await page.keyboard.type("orres");
    await expect(page.getByRole("listbox", { name: "Destinations suggérées" }).getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/s\/les-orres\/homes$/);
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
