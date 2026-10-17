import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The product is called Sigma (renamed from Nidou on 14 October 2026): no page may still show the old name, Airbnb's name,
 * its pink, or the wording copied from airbnb.fr during the recon.
 */

/** Airbnb's pinks: Rausch, the search button, the CTA gradient stops and product Rausch. */
const OLD_PINK_HEX = ["#ff385c", "#da1249", "#e61e4d", "#e31c5f", "#d70466", "#e00b41"];
const OLD_PINK_RGB = ["255,56,92", "218,18,73", "230,30,77", "227,28,95", "215,4,102", "224,11,65"];
/** UI strings taken from airbnb.fr (docs/recon/airbnb-fr.md) and since rewritten. */
const COPIED_STRINGS = [
  "Coup de cœur voyageurs",
  "Des idées pour vos prochaines escapades",
  "Trouvez des services à proximité",
  "Destinations pour vous",
  "Devenir hôte",
  "Connexion ou inscription",
  "Centre d'aide",
  "Commencer ma recherche",
  "Rechercher une destination",
  "Ajouter des voyageurs",
  "Aucune correspondance exacte",
  "Créez votre première liste de favoris",
  "Locations de vacances, cabanes, maisons de plage",
];
const SIGMA_BRAND_RGB = "rgb(53, 80, 168)"; // #3550A8, Majorelle blue

const PAGES: [label: string, path: string, status: number][] = [
  ["home", "/", 200],
  ["homes", "/homes", 200],
  ["experiences", "/experiences", 200],
  ["services", "/services", 200],
  ["results", "/s/hivernage/homes", 200],
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
      expect(title).not.toMatch(/nidou|airbnb/i);
      expect(text).not.toMatch(/nidou|airbnb/i);
      for (const value of [...attrs, ...meta]) expect(value).not.toMatch(/nidou|airbnb/i);
      for (const s of COPIED_STRINGS) for (const value of [title, text, ...attrs, ...meta]) expect(value, s).not.toContain(s);
      expect(await oldPinkUses(page)).toEqual([]);
    });
  }
});

/** Every element's computed colours, and every stylesheet rule, that still use one of Airbnb's pinks. */
async function oldPinkUses(page: Page) {
  return page.evaluate(
    ([hexes, rgbs]) => {
      const found: string[] = [];
      const props = ["color", "background-color", "background-image", "border-top-color", "border-bottom-color", "border-left-color", "border-right-color", "fill", "stroke", "outline-color", "box-shadow", "text-decoration-color"];
      for (const el of [document.documentElement, ...document.querySelectorAll("*")]) {
        const style = getComputedStyle(el);
        for (const p of props) {
          const v = style.getPropertyValue(p).replace(/\s/g, "");
          if (rgbs.some((rgb) => v.includes(`(${rgb})`) || v.includes(`(${rgb},`))) found.push(`${el.tagName.toLowerCase()} ${p}: ${v}`);
        }
      }
      for (const sheet of Array.from(document.styleSheets)) {
        const css = Array.from(sheet.cssRules, (r) => r.cssText).join("\n").toLowerCase().replace(/\s/g, "");
        for (const hex of hexes) if (css.includes(hex)) found.push(`stylesheet ${sheet.href ?? "inline"}: ${hex}`);
        for (const rgb of rgbs) if (css.includes(`(${rgb})`)) found.push(`stylesheet ${sheet.href ?? "inline"}: rgb(${rgb})`);
      }
      return found;
    },
    [OLD_PINK_HEX, OLD_PINK_RGB],
  );
}

test("the guard catches the old pink and the old name", async ({ page }) => {
  // The checks above must be able to fail: plant each and see it found.
  await page.goto("/aide");
  await page.evaluate(() => {
    const b = document.createElement("b");
    b.style.color = "#FF385C";
    b.textContent = "Airbnb";
    document.body.append(b);
  });
  expect(await oldPinkUses(page)).toContain("b color: rgb(255,56,92)");
  expect(await page.evaluate(() => document.body.innerText)).toMatch(/airbnb/i);
});

test("phones show the mark alone, left of the search pill", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone header");
  await page.goto("/");
  const logo = page.getByRole("link", { name: "Sigma, page d'accueil" });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("href", "/");
  const mark = logo.locator("svg");
  expect(await mark.boundingBox()).toMatchObject({ width: 30, height: 30 });
  await expect(logo.getByText("sigma", { exact: true })).toHaveCount(0);
  expect(await logo.evaluate((a) => getComputedStyle(a).color)).toBe(SIGMA_BRAND_RGB);
  const pill = await page.getByRole("button", { name: "Rechercher à Marrakech" }).boundingBox();
  const box = (await logo.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThan(pill!.x);
  // The pill still fits the viewport (no horizontal scroll).
  expect(pill!.x + pill!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 16 + 0.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
});

test("the header shows the Sigma mark, with the wordmark from lg up", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop header; the phone header is checked above");
  await page.goto("/");
  const logo = page.getByRole("link", { name: "Sigma, page d'accueil" });
  await expect(logo).toHaveAttribute("href", "/");
  const mark = logo.locator("svg");
  await expect(mark).toBeVisible();
  expect(await mark.boundingBox()).toMatchObject({ width: 30, height: 30 });
  // Drawn as a path in the brand colour: no font, no image.
  await expect(mark.locator("path")).toHaveAttribute("fill", "currentColor");
  expect(await logo.evaluate((a) => getComputedStyle(a).color)).toBe(SIGMA_BRAND_RGB);
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page introuvable");
  await expect(mark).toHaveCSS("color", SIGMA_BRAND_RGB);
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
  // The square is the brand colour, Majorelle blue.
  expect(svg).toContain('<rect width="32" height="32" rx="7" fill="#3550A8"/>');
  for (const hex of OLD_PINK_HEX) expect(svg.toLowerCase()).not.toContain(hex);
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
