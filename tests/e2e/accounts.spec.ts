import type { Page } from "@playwright/test";
import { expect, stayDays, test } from "./fixtures";

const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.sigma.test`;
const PASSWORD = "motdepasse-e2e";

async function signUp(page: Page, name = "Camille") {
  const email = uniqueEmail();
  await page.goto("/login");
  await page.getByRole("button", { name: "Inscrivez-vous" }).click();
  await page.getByLabel("Prénom").fill(name);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/$/);
  return email;
}

test("sign up, save to the account, sign out, sign back in", async ({ page, isMobile }) => {
  const email = await signUp(page);
  const card = page.getByTestId("card-container").first();
  const heart = card.getByTestId("listing-card-save-button");
  const title = await card.getByTestId("listing-card-title").textContent();

  const saved = page.waitForResponse((r) => r.url().includes("/api/wishlist/") && r.request().method() === "PUT");
  await heart.click();
  expect((await saved).status()).toBe(204);

  await page.goto("/wishlists");
  await expect(page.getByTestId("listing-card-title")).toHaveText([title!]);

  // Signing out leaves nothing of the account's list in this browser.
  if (isMobile) {
    await page.goto("/login");
    await page.getByRole("button", { name: "Déconnexion" }).click();
    // Wait for the sign-out to land: navigating earlier aborts the request and the session survives.
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Menu principal" }).click();
    await page.getByRole("menuitem", { name: "Déconnexion" }).click();
    await expect(page.getByRole("link", { name: "Connexion" })).toBeVisible();
  }
  await page.goto("/wishlists");
  await expect(page.getByText("Aucun favori pour l'instant")).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/wishlists");
  await expect(page.getByTestId("listing-card-title")).toHaveText([title!]);
});

test("favourites saved while signed out move into the new account", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("card-container").nth(1);
  const title = await card.getByTestId("listing-card-title").textContent();
  await card.getByTestId("listing-card-save-button").click();
  await signUp(page, "Léa");
  await page.goto("/wishlists");
  await expect(page.getByTestId("listing-card-title")).toHaveText([title!]);
});

test("wrong password shows an error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(uniqueEmail());
  await page.getByLabel("Mot de passe").fill("pas-le-bon-mdp");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Adresse e-mail ou mot de passe incorrect.");
});

test("trips need an account", async ({ page }) => {
  await page.goto("/trips");
  await expect(page).toHaveURL(/\/login\?next=%2Ftrips|\/login\?next=\/trips/);
});

test("book through the API, see it in Voyages, cancel it", async ({ page, baseURL }, testInfo) => {
  await signUp(page, "Hugo");
  // Each project books a different home so parallel runs don't compete for the same dates.
  const listingId = testInfo.project.name === "desktop" ? "1003" : "1004";
  const day = stayDays(testInfo, 280);
  const res = await page.request.post("/api/bookings", {
    headers: { Origin: baseURL! },
    data: { listingId, checkIn: day(0), checkOut: day(3), adults: 1 },
  });
  expect(res.status()).toBe(201);
  const again = await page.request.post("/api/bookings", {
    headers: { Origin: baseURL! },
    data: { listingId, checkIn: day(1), checkOut: day(2), adults: 1 },
  });
  expect(again.status()).toBe(409);

  await page.goto("/trips");
  const trip = page.getByTestId("trip");
  await expect(page.getByRole("heading", { name: "Séjours à venir" })).toBeVisible();
  await expect(trip).toHaveCount(1);
  // Full dates JJ/MM/AAAA, total in dirhams.
  const [y, m, d] = day(0).split("-");
  const [y2, m2, d2] = day(3).split("-");
  await expect(trip).toContainText(`Du ${d}/${m}/${y} au ${d2}/${m2}/${y2}`);
  await expect(trip).toContainText(/Total \d[\d\u202f]*\u00a0MAD/);
  page.once("dialog", (d) => d.accept());
  await trip.getByRole("button", { name: "Annuler la réservation" }).click();
  await expect(page.getByRole("heading", { name: "Séjours passés et annulés" })).toBeVisible();
  await expect(trip).toContainText("Annulée");
});
