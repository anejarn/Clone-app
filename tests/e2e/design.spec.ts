import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Design conformance: the layout measurements of docs/recon/airbnb-fr.md (1440×900 and 390×844), kept as the
 * reference grid, with Sigma's own colours (docs/design-system.md).
 */
const box = async (l: Locator) => (await l.boundingBox())!;
const css = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.describe("desktop 1440", () => {
  test.skip(({ isMobile }) => isMobile);

  test("header and search bar", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByTestId("big-search");
    expect((await box(page.locator("header > div").first().locator("> div").first())).height).toBe(96); // recon: 96
    const b = await box(bar);
    expect(b.width).toBe(850); // recon: ~850
    expect(b.height).toBe(66); // recon: ~66
    expect(Math.round(b.x + b.width / 2)).toBe(720); // centred
    const go = page.getByTestId("structured-search-input-search-button");
    expect(await box(go)).toMatchObject({ width: 48, height: 48 }); // recon: 48px circle
    expect(await css(go, "background-color")).toBe("rgb(53, 80, 168)"); // Sigma brand: #3550A8 (white icon on it: 7.3:1)
    await go.hover();
    await expect(go).toHaveCSS("background-color", "rgb(35, 60, 140)"); // brand-strong: #233C8C
    expect(await css(bar, "border-radius")).toBe("32px");
  });

  test("the logo link is only as wide as the logo (diff home-32)", async ({ page }) => {
    await page.goto("/");
    const logo = page.getByRole("link", { name: "Sigma, page d'accueil" });
    const link = await box(logo);
    // Mark (30px) + 6px gap + the "sigma" wordmark: about 100px, never the 380px grid column.
    const content = await logo.evaluate((a) => {
      const kids = Array.from(a.children).map((c) => c.getBoundingClientRect());
      return Math.max(...kids.map((r) => r.right)) - Math.min(...kids.map((r) => r.left));
    });
    expect(Math.abs(link.width - content)).toBeLessThanOrEqual(1);
    expect(link.width).toBeLessThan(120);
    expect(link.x).toBe(48);
    // The space right of it is no longer part of the link.
    const after = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("aria-label") ?? null, [link.x + link.width + 40, link.y + link.height / 2]);
    expect(after).toBeNull();
  });

  test("type, colour and grid", async ({ page }) => {
    await page.goto("/");
    expect(await css(page.locator("body"), "font-size")).toBe("14px"); // recon: 14px / 20px, #222
    expect(await css(page.locator("body"), "line-height")).toBe("20px");
    expect(await css(page.locator("body"), "color")).toBe("rgb(34, 34, 34)");
    expect(await css(page.getByRole("heading", { name: "Quartiers de Marrakech" }), "font-size")).toBe("22px");

    const row = page.getByRole("region", { name: "Logements populaires · Hivernage" });
    const cards = row.getByTestId("card-container");
    const first = await box(cards.first());
    expect(first.x).toBe(48); // recon: 48px page gutter
    // recon: 7 cards across at 1440 (~180px wide, 12px apart)
    const seventh = await box(cards.nth(6));
    expect(Math.round(seventh.x + seventh.width)).toBe(1440 - 48);
    expect(Math.round(first.width)).toBeGreaterThanOrEqual(178);
    const title = cards.first().getByTestId("listing-card-title");
    expect([await css(title, "font-size"), await css(title, "font-weight")]).toEqual(["13px", "500"]); // recon: 13px / 500
    const meta = cards.first().locator("p").first();
    expect(await css(meta, "font-size")).toBe("12px"); // recon: 12px, #6A6A6A
    expect(await css(meta, "color")).toBe("rgb(106, 106, 106)");
  });

  test("neighbourhood and service tiles are 10 across", async ({ page }) => {
    await page.goto("/");
    for (const name of ["Quartiers de Marrakech", "Services de conciergerie Sigma"]) {
      const first = await box(page.getByRole("region", { name }).getByRole("link").first());
      expect(Math.round(first.width), name).toBe(124); // recon: ~124px tiles, 12px apart
    }
    // 10 neighbourhoods: the tenth ends exactly at the right gutter.
    const tiles = page.getByRole("region", { name: "Quartiers de Marrakech" }).getByRole("link");
    await expect(tiles).toHaveCount(10);
    const tenth = await box(tiles.nth(9));
    expect(Math.round(tenth.x + tenth.width)).toBe(1440 - 48);
  });

  test("compact header after scrolling", async ({ page }) => {
    await page.goto("/");
    await page.mouse.wheel(0, 800);
    await expect(page.getByTestId("little-search")).toBeVisible();
    expect((await box(page.locator("header > div").first().locator("> div").first())).height).toBe(80); // recon: 80
  });

  test("footer and inspiration use the faint grey surface", async ({ page }) => {
    await page.goto("/");
    expect(await css(page.locator("footer"), "background-color")).toBe("rgb(247, 247, 247)"); // recon: #F7F7F7
  });
});

test.describe("mobile 390", () => {
  test.skip(({ isMobile }) => !isMobile);

  test("search pill, chips and bottom nav", async ({ page }) => {
    await page.goto("/");
    const pill = page.getByRole("button", { name: "Rechercher à Marrakech" });
    expect((await box(pill)).height).toBe(56); // recon: full-width pill, ~56px
    expect(await css(pill, "border-radius")).toBe("32px");
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    expect((await box(nav)).height).toBe(64); // recon: fixed bottom bar
    await expect(nav.getByRole("link")).toHaveText(["Rechercher", "Favoris", "Compte"]);
    await expect(nav.getByRole("link", { name: "Rechercher" })).toHaveCSS("color", "rgb(53, 80, 168)");
    // recon at 390px: cards 158px wide = 46% of the 342px content width (24px gutters), ~2.3 visible
    const row = page.getByRole("region", { name: "Logements populaires · Hivernage" });
    const w = (await box(row.getByTestId("card-container").first())).width;
    const content = page.viewportSize()!.width - 48;
    expect(w / content).toBeCloseTo(0.46, 2);
  });
});
