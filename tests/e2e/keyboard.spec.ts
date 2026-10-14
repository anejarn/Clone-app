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
    const lyon = page.getByRole("list", { name: "Destinations suggérées" }).getByRole("button", { name: /Lyon/ });
    await expect(lyon).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(lyon).toBeFocused();
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
    await expect(page).toHaveURL(/\/s\/lyon\/homes\?adults=2$/);
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
