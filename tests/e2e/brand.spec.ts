import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** The product is called Sigma (renamed from Nidou on 14 October 2026): no page may still show the old name. */

const PAGES: [label: string, path: string, status: number][] = [
  ["home", "/", 200],
  ["homes", "/homes", 200],
  ["experiences", "/experiences", 200],
  ["services", "/services", 200],
  ["results", "/s/paris/homes", 200],
  ["login", "/login", 200],
  ["wishlists", "/wishlists", 200],
  ["help", "/aide", 200],
  ["404", "/cette-page-n-existe-pas", 404],
];

/** Visible text, title, and every accessible-name or tooltip attribute on the page. */
async function brandedStrings(page: Page) {
  return page.evaluate(() => {
    const attrs = ["aria-label", "title", "alt", "placeholder", "aria-description", "aria-roledescription"];
    const fromAttrs = Array.from(document.querySelectorAll(attrs.map((a) => `[${a}]`).join(","))).flatMap((el) =>
      attrs.map((a) => el.getAttribute(a)).filter((v): v is string => !!v),
    );
    const meta = Array.from(document.querySelectorAll('meta[name="description"], meta[property^="og:"], meta[name="application-name"]')).map(
      (m) => m.getAttribute("content") ?? "",
    );
    return { title: document.title, text: document.body.innerText, attrs: fromAttrs, meta };
  });
}

test.describe("no page shows the old name", () => {
  // The cookie notice stays up, so its text is checked too.
  test.use({ consent: false });
  for (const [label, path, status] of PAGES) {
    test(label, async ({ page }) => {
      const res = await page.goto(path);
      expect(res!.status()).toBe(status);
      await expect(page.getByRole("region", { name: "Cookies", exact: true })).toBeVisible();
      const { title, text, attrs, meta } = await brandedStrings(page);
      expect(title).toMatch(/Sigma/);
      expect(title).not.toMatch(/nidou/i);
      expect(text).not.toMatch(/nidou/i);
      for (const value of [...attrs, ...meta]) expect(value).not.toMatch(/nidou/i);
    });
  }
});

test("the header shows the Sigma mark, with the wordmark from lg up", async ({ page, isMobile }) => {
  test.skip(isMobile, "below md the header is the search pill only, without the logo, as on airbnb.fr");
  await page.goto("/");
  const logo = page.getByRole("link", { name: "Sigma, page d'accueil" });
  await expect(logo).toHaveAttribute("href", "/");
  const mark = logo.locator("svg");
  await expect(mark).toBeVisible();
  expect(await mark.boundingBox()).toMatchObject({ width: 30, height: 30 });
  // Drawn as a path in the brand colour: no font, no image.
  await expect(mark.locator("path")).toHaveAttribute("fill", "currentColor");
  expect(await logo.evaluate((a) => getComputedStyle(a).color)).toBe("rgb(255, 56, 92)");
  const wordmark = logo.getByText("sigma", { exact: true });
  await expect(wordmark).toBeVisible();
  // Between md and lg: the mark alone.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(wordmark).toBeHidden();
  await expect(mark).toBeVisible();
});

test("the 404 page shows the mark", async ({ page }) => {
  await page.goto("/cette-page-n-existe-pas");
  const mark = page.locator("main > svg").first();
  await expect(mark).toBeVisible();
  await expect(mark.locator("path")).toHaveAttribute("d", /^M6\.5 4h19/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Oups !");
});

test("the favicon is the Sigma mark", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('head link[rel="icon"]').first().getAttribute("href");
  expect(href).toMatch(/^\/icon\.svg/);
  const res = await request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^image\/svg\+xml/);
  const svg = await res.text();
  expect(svg).toContain('viewBox="0 0 32 32"');
  expect(svg).toContain('<rect width="32" height="32" rx="7" fill="#FF385C"/>');
  expect(svg).toMatch(/<path d="M8 6h16v4h-7\.68l4\.8 6-4\.8 6H24v4H8l8-10Z" fill="#fff"\/>/);
  expect(svg).not.toMatch(/nidou|<text/i);
});

test("favourites saved before the rename are still there", async ({ page, isMobile }) => {
  test.skip(isMobile, "browser storage doesn't depend on the viewport");
  await page.goto("/aide");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("nidou:wishlist", JSON.stringify(["1000"]));
  });
  await page.goto("/wishlists");
  await expect.poll(() => page.evaluate(() => ({ ...localStorage }))).toEqual({ "sigma:wishlist": JSON.stringify(["1000"]) });
  await expect(page.getByTestId("listing-card-title")).toHaveCount(1);
});
