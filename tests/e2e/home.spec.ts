import { expect, test } from "./fixtures";

test("homepage shows the main sections and listing cards", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Nidou/);
  for (const title of ["Destinations pour vous", "Trouvez des services à proximité", "Logements populaires · Paris"]) {
    await expect(page.getByRole("region", { name: title })).toBeVisible();
  }
  await expect(page.getByTestId("card-container").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Des idées pour vos prochaines escapades" })).toBeVisible();
});

test("category tabs switch the homepage content", async ({ page, isMobile }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Catégories" }).getByRole("link", { name: "Expériences" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/experiences$/);
  await expect(page.getByRole("region", { name: /^Expériences populaires/ })).toBeVisible();
  test.info().annotations.push({ type: "viewport", description: isMobile ? "chips" : "tab bar" });
});

test("inspiration tabs and 'Afficher plus'", async ({ page }) => {
  await page.goto("/");
  const grid = page.getByRole("tabpanel");
  await page.getByRole("tab", { name: "Montagnes" }).click();
  await expect(grid.getByText("Megève")).toBeVisible();
  await page.getByRole("tab", { name: "Équipements recherchés" }).click();
  await expect(grid.getByText("Dijon")).toHaveCount(0);
  await page.getByRole("button", { name: /Afficher plus/ }).click();
  await expect(grid.getByText("Dijon")).toBeVisible();
});

test.describe("cookie banner", () => {
  test.use({ consent: false });
  test("is shown once and remembered", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByRole("dialog", { name: "Améliorez votre expérience" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Uniquement les nécessaires" }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("card-container").first()).toBeVisible();
    await expect(banner).toBeHidden();
  });
});

test("saved listings appear in Favoris", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("card-container").first();
  const title = await card.getByTestId("listing-card-title").textContent();
  const heart = card.getByTestId("listing-card-save-button");
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await page.goto("/wishlists");
  await expect(page.getByTestId("listing-card-title")).toHaveText([title!]);
  await page.getByTestId("listing-card-save-button").click();
  await page.reload();
  await expect(page.getByText("Créez votre première liste de favoris")).toBeVisible();
});
