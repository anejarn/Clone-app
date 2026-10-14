import { expect, test } from "./fixtures";

test.describe("keyboard only", () => {
  test.skip(({ isMobile }) => isMobile, "keyboard flows on desktop");

  test("search from the homepage without a mouse", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("structured-search-input-field-query");
    // The destination field is reachable with Tab.
    for (let i = 0; i < 20 && !(await input.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(input).toBeFocused();

    await page.keyboard.type("lyo");
    const lyon = page.getByRole("listbox", { name: "Destinations suggérées" }).getByRole("option", { name: /Lyon/ });
    await expect(lyon).toBeVisible();
    // Combobox: the highlight moves, focus stays in the input.
    await page.keyboard.press("ArrowDown");
    await expect(input).toBeFocused();
    await expect(lyon).toHaveAttribute("aria-selected", "true");
    await expect(input).toHaveAttribute("aria-activedescendant", (await lyon.getAttribute("id"))!);
    await page.keyboard.press("Enter");

    // The input shows the picked place, and focus moves on to the dates segment.
    await expect(input).toHaveValue("Lyon");
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
    await expect(page).toHaveURL(/\/s\/lyon\/homes\?adults=2$/);
  });

  test("destination combobox: semantics, arrow keys, Escape, click", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("big-search").getByRole("combobox", { name: "Destination" });
    await expect(input).toHaveAttribute("aria-autocomplete", "list");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await input.focus();
    const listbox = page.getByRole("listbox", { name: "Destinations suggérées" });
    const options = listbox.getByRole("option");
    // Popular places first.
    await expect(options).toHaveCount(8);
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await expect(input).toHaveAttribute("aria-controls", (await listbox.getAttribute("id"))!);
    await expect(input).not.toHaveAttribute("aria-activedescendant");
    // No nested controls inside options (axe nested-interactive).
    await expect(listbox.locator("button, a, input, [tabindex]")).toHaveCount(0);

    // "mar": Marrakech (Maroc) and Marseille.
    await page.keyboard.type("mar");
    await expect(options).toHaveText([/Marrakech/, /Marseille/]);
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
    await page.keyboard.type("s");
    await expect(options).toHaveText([/Marseille/]);
    await expect(input).not.toHaveAttribute("aria-activedescendant");

    // Escape closes the list, focus stays; typing opens it again.
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(input).toBeFocused();
    await page.keyboard.press("Backspace");
    await expect(options).toHaveCount(2);

    // Clicking an option picks it, like Enter.
    await options.filter({ hasText: "Marrakech" }).click();
    await expect(input).toHaveValue("Marrakech");
    await expect(page.locator(".rdp-root")).toBeVisible();
    await expect(page.getByTestId("big-search").getByRole("button", { name: /Dates/ })).toBeFocused();
  });

  test("leaving the destination field with Tab collapses its list", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("big-search").getByRole("combobox", { name: "Destination" });
    const listbox = page.getByRole("listbox", { name: "Destinations suggérées" });
    await input.focus();
    await expect(listbox.getByRole("option")).toHaveCount(8);
    await page.keyboard.press("ArrowDown");
    await expect(input).toHaveAttribute("aria-activedescendant", /destinations-0$/);
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("big-search").getByRole("button", { name: /Dates/ })).toBeFocused();
    await expect(listbox).toHaveCount(0);
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(input).not.toHaveAttribute("aria-activedescendant");
    // Shift+Tab back in opens it again.
    await page.keyboard.press("Shift+Tab");
    await expect(input).toBeFocused();
    await expect(listbox.getByRole("option")).toHaveCount(8);
    await expect(input).toHaveAttribute("aria-expanded", "true");
    // A mouse press on the search button is not a Tab: the list stays until the click submits.
    await page.keyboard.type("lyo");
    await expect(listbox.getByRole("option")).toHaveCount(1);
    await page.getByTestId("structured-search-input-search-button").click();
    await expect(page).toHaveURL(/\/s\/lyon\/homes$/);
  });

  test("Enter with nothing highlighted still searches the typed text", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("big-search").getByRole("combobox", { name: "Destination" });
    await input.focus();
    await page.keyboard.type("nant");
    await expect(page.getByRole("listbox", { name: "Destinations suggérées" }).getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/s\/nantes\/homes$/);
  });

  test("Escape closes the open panel", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Voyageurs/ }).click();
    await expect(page.getByRole("button", { name: "Augmenter adultes" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Augmenter adultes" })).toBeHidden();
  });

  test("cards are links with a name, and photo arrows show on focus", async ({ page }) => {
    await page.goto("/s/paris/homes");
    const card = page.getByTestId("card-container").first();
    const title = await card.getByTestId("listing-card-title").textContent();
    await expect(card.getByRole("link", { name: title! })).toBeVisible();
    const next = card.getByRole("button", { name: "Photo suivante" });
    await next.focus();
    await expect(next).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expect(card.getByRole("button", { name: "Photo précédente" })).toBeAttached();
  });
});
