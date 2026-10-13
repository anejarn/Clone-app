import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, stayDays, test } from "./fixtures";

/** WCAG 2.1 A/AA checks with axe. Fails on serious or critical violations. */
async function audit(page: Page, label: string) {
  // Placeholder photos are remote; their loading state doesn't affect markup rules.
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = blocking.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n    ")}`);
  expect(report, `${label}\n${report.join("\n")}`).toEqual([]);
}

test("homepage", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("card-container").first()).toBeVisible();
  await audit(page, "home");
});

test("search panels", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) {
    await page.getByRole("button", { name: "Commencer ma recherche" }).click();
    await expect(page.getByRole("dialog").getByRole("list", { name: "Destinations suggérées" }).getByRole("button").first()).toBeVisible();
    await audit(page, "mobile sheet");
    return;
  }
  await page.getByTestId("structured-search-input-field-query").click();
  await expect(page.getByRole("list", { name: "Destinations suggérées" }).getByRole("button").first()).toBeVisible();
  await audit(page, "destination panel");
  await page.getByRole("button", { name: /Dates/ }).click();
  await audit(page, "dates panel");
  await page.getByRole("button", { name: /Voyageurs/ }).click();
  await audit(page, "guests panel");
});

test("results, login, favourites", async ({ page }) => {
  await page.goto("/s/orcieres-merlette/homes?adults=2");
  await expect(page.getByTestId("card-container").first()).toBeVisible();
  await audit(page, "results");
  await page.goto("/login");
  await audit(page, "login");
  await page.goto("/wishlists");
  await expect(page.getByText("Créez votre première liste de favoris")).toBeVisible();
  await audit(page, "wishlists");
});

test("listing page: facts, booking card with a price, calendar and guests open", async ({ page }, testInfo) => {
  const day = stayDays(testInfo, 180);
  await page.goto(`/rooms/1005?checkin=${day(0)}&checkout=${day(3)}&adults=2`);
  await expect(page.getByTestId("price-breakdown")).toBeVisible();
  await audit(page, "listing with quote");
  const card = page.getByTestId("booking-card");
  await card.getByRole("button", { name: /Arrivée/ }).click();
  await expect(card.locator(".rdp-root")).toBeVisible();
  await audit(page, "listing calendar");
  await card.getByRole("button", { name: /Voyageurs/ }).click();
  await expect(card.getByRole("button", { name: "Augmenter adultes" })).toBeVisible();
  await audit(page, "listing guests");
});

test("host page, with form errors and after sending", async ({ page }) => {
  await page.goto("/devenir-hote");
  await audit(page, "host page");
  await page.getByRole("button", { name: "Envoyer ma demande" }).click();
  await expect(page.getByLabel("Nom et prénom")).toBeFocused();
  await audit(page, "host form errors");
});

test.describe("cookie banner", () => {
  test.use({ consent: false });
  test("is accessible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog", { name: "Améliorez votre expérience" })).toBeVisible();
    await audit(page, "cookie banner");
  });
});

test("signed-in screens: account menu and trips", async ({ page, baseURL, isMobile }, testInfo) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Inscrivez-vous" }).click();
  await page.getByLabel("Prénom").fill("Axe");
  await page.getByLabel("Adresse e-mail").fill(`axe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.nidou.fr`);
  await page.getByLabel("Mot de passe").fill("motdepasse-e2e");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/$/);
  const listingId = isMobile ? "1020" : "1021";
  const day = stayDays(testInfo, 300);
  expect((await page.request.post("/api/bookings", { headers: { Origin: baseURL! }, data: { listingId, checkIn: day(0), checkOut: day(3), adults: 1 } })).status()).toBe(201);
  if (!isMobile) {
    await page.getByRole("button", { name: "Menu principal" }).click();
    await expect(page.getByRole("menuitem", { name: "Déconnexion" })).toBeVisible();
    await audit(page, "account menu");
    await page.keyboard.press("Escape");
  }
  await page.goto("/trips");
  await expect(page.getByTestId("trip")).toHaveCount(1);
  await audit(page, "trips");
});
