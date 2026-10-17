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
    await page.getByRole("button", { name: "Rechercher à Marrakech" }).click();
    await expect(page.getByRole("dialog").getByRole("listbox", { name: "Quartiers suggérés" }).getByRole("option").first()).toBeVisible();
    await audit(page, "mobile sheet");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("dialog").getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await audit(page, "mobile sheet, option highlighted");
    return;
  }
  await page.getByTestId("structured-search-input-field-query").click();
  await expect(page.getByRole("listbox", { name: "Quartiers suggérés" }).getByRole("option").first()).toBeVisible();
  await audit(page, "destination panel");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await audit(page, "destination panel, option highlighted");
  await page.getByRole("button", { name: /Dates/ }).click();
  await audit(page, "dates panel");
  await page.getByRole("button", { name: /Voyageurs/ }).click();
  await audit(page, "guests panel");
});

test("results, login, favourites", async ({ page }) => {
  await page.goto("/s/hivernage/homes?adults=2");
  await expect(page.getByTestId("card-container").first()).toBeVisible();
  await audit(page, "results");
  await page.goto("/login");
  await audit(page, "login");
  await page.goto("/wishlists");
  await expect(page.getByText("Aucun favori pour l'instant")).toBeVisible();
  await audit(page, "wishlists");
});

test("help page", async ({ page }) => {
  await page.goto("/aide");
  await expect(page.getByRole("heading", { level: 1, name: "Aide" })).toBeVisible();
  await audit(page, "help page");
  await page.goto("/aide#proprietaires");
  await expect(page.getByTestId("owners-next")).toBeVisible();
  await audit(page, "help page, owners section");
});

test.describe("cookie notice", () => {
  test.use({ consent: false });
  test("is accessible, on the home page and the help page", async ({ page }) => {
    for (const path of ["/", "/aide"]) {
      await page.goto(path);
      await expect(page.getByRole("region", { name: "Cookies", exact: true })).toBeVisible();
      await audit(page, `cookie notice on ${path}`);
    }
  });
});

test("signed-in screens: account menu and trips", async ({ page, baseURL, isMobile }, testInfo) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Inscrivez-vous" }).click();
  await page.getByLabel("Prénom").fill("Axe");
  await page.getByLabel("Adresse e-mail").fill(`axe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.sigma.test`);
  await page.getByLabel("Mot de passe").fill("motdepasse-e2e");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/$/);
  const listingId = isMobile ? "1020" : "1021";
  const day = stayDays(testInfo, 300);
  expect((await page.request.post("/api/bookings", { headers: { Origin: baseURL! }, data: { listingId, checkIn: day(0), checkOut: day(2), adults: 1 } })).status()).toBe(201);
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
