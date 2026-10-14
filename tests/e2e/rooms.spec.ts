import { expect, pickStay, signUp, stayDays, test } from "./fixtures";

/** Listing page: facts and legal mentions, the booking card, booking signed in and signed out. */

test("shows the listing's facts, classification and registration number", async ({ page, request }) => {
  const listing = await (await request.get("/api/listings/1003")).json();
  await page.goto("/rooms/1003");
  await expect(page).toHaveTitle(new RegExp(listing.title));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(listing.title);
  await expect(page.getByTestId("listing-facts")).toContainText(`${listing.maxGuests} voyageurs`);
  await expect(page.getByTestId("listing-facts")).toContainText(/lits?/);
  await expect(page.getByTestId("classification")).toContainText(listing.stars ? `classé ${listing.stars}` : "non classé");
  await expect(page.getByTestId("legal")).toContainText(`Numéro d'enregistrement\u00a0: ${listing.registrationNumber}`);
  await expect(page.getByTestId("legal")).toContainText(/DPE/);
  await expect(page.getByText(/Station à 1\s?850\sm d'altitude/)).toBeVisible();
  await expect(page.getByText(/commune d'Orcières \(Hautes-Alpes\)/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Photos du logement" }).getByRole("img")).toHaveCount(5);
  // No dates yet: the nightly price and the booking rules.
  await expect(page.getByTestId("booking-card")).toContainText("par nuit");
  await expect(page.getByTestId("booking-card")).toContainText("Arrivée n'importe quel jour");
});

test("unknown listings are not found, from the first request", async ({ page, request }) => {
  // A fresh id each run: the first request must already be a 404, not the route's 200 App Shell.
  const fresh = `/rooms/${900_000 + Math.floor(Math.random() * 99_999)}`;
  expect((await request.get(fresh)).status()).toBe(404);
  expect((await page.goto("/rooms/n-existe-pas"))!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Oups !" })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
});

test("search cards open the listing page with the searched dates and guests", async ({ page }, testInfo) => {
  const day = stayDays(testInfo, 150);
  await page.goto(`/s/les-orres/homes?checkin=${day(0)}&checkout=${day(3)}&adults=2`);
  const card = page.getByTestId("card-container").first();
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/rooms/\\d+\\?checkin=${day(0)}&checkout=${day(3)}&adults=2$`));
  const breakdown = page.getByTestId("price-breakdown");
  await expect(breakdown).toContainText("× 3 nuits");
  await expect(breakdown).toContainText("Taxe de séjour (2 adultes)");
});

test("the price breakdown matches the quote API, line by line", async ({ page, request }, testInfo) => {
  const day = stayDays(testInfo, 160);
  const qs = `checkin=${day(0)}&checkout=${day(4)}&adults=2&children=1`;
  const quote = await (await request.get(`/api/listings/1005/quote?${qs}`)).json();
  await page.goto(`/rooms/1005?${qs}`);
  const breakdown = page.getByTestId("price-breakdown");
  const euros = (cents: number) => new RegExp(`${Math.floor(cents / 100)}(,${String(cents % 100).padStart(2, "0")})?\\s€`);
  await expect(breakdown.getByRole("definition").last()).toHaveText(euros(quote.totalCents));
  await expect(breakdown).toContainText("Taxe de séjour (2 adultes)");
  const lines = await breakdown.getByRole("definition").allTextContents();
  const cents = lines.map((t) => Math.round(Number(t.replace(/[^\d,]/g, "").replace(",", ".")) * 100));
  // stay + cleaning + tax = total, as displayed.
  expect(cents.slice(0, -1).reduce((a, b) => a + b, 0)).toBe(cents.at(-1));
  expect(cents.at(-1)).toBe(quote.totalCents);
  // The guest never sees host-side numbers.
  await expect(page.getByTestId("booking-card")).not.toContainText(/commission/i);
});

test("the calendar enforces the minimum stay and booked nights", async ({ page, request }, testInfo) => {
  // 1040 needs 3 nights.
  const listing = await (await request.get("/api/listings/1040/availability")).json();
  expect(listing.minNights).toBe(3);
  const day = stayDays(testInfo, 170);
  await page.goto("/rooms/1040");
  const card = page.getByTestId("booking-card");
  await card.getByRole("button", { name: /Arrivée/ }).click();
  const calendar = card.locator(".rdp-root");
  const click = async (d: string) => {
    const cell = calendar.locator(`[data-day="${d}"]`);
    for (let i = 0; i < 14 && !(await cell.isVisible()); i++) await calendar.getByRole("button", { name: "Aller au mois suivant" }).click();
    await cell.getByRole("button").click();
  };
  await click(day(0));
  await expect(card).toContainText("Choisissez la date de départ");
  // One or two nights later can't be a checkout (when the month shows them); three can.
  for (const n of [1, 2]) {
    const cell = calendar.locator(`[data-day="${day(n)}"]`);
    if (await cell.isVisible()) await expect(cell.getByRole("button")).toBeDisabled();
  }
  await click(day(3));
  await expect(card).toContainText("× 3 nuits");
});

/** A 3-night-minimum listing with a booked stay, whose three nights before are free and in the future. */
async function listingBeforeAStay(request: import("@playwright/test").APIRequestContext) {
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  for (let id = 1000; id < 1080; id++) {
    const a = (await (await request.get(`/api/listings/${id}/availability`)).json()) as { minNights: number; booked: { checkIn: string; checkOut: string }[] };
    if (a.minNights !== 3) continue;
    for (const [i, b] of a.booked.entries()) {
      const prevOut = i > 0 ? a.booked[i - 1].checkOut : "";
      if (shift(b.checkIn, -4) > today && prevOut <= shift(b.checkIn, -3)) return { id: String(id), stay: b, shift };
    }
  }
  throw new Error("no 3-night listing with a free gap before a stay");
}

test("arrival days with no valid checkout are disabled", async ({ page, request }) => {
  const { id, stay, shift } = await listingBeforeAStay(request);
  await page.goto(`/rooms/${id}`);
  const card = page.getByTestId("booking-card");
  await card.getByRole("button", { name: /Arrivée/ }).click();
  const calendar = card.locator(".rdp-root");
  const cell = (d: string) => calendar.locator(`[data-day="${d}"]`);
  // The calendar is loaded lazily: let it render before deciding whether to page forward.
  await expect(calendar.locator("[data-day]:not([data-hidden])").first()).toBeVisible();
  for (let i = 0; i < 14 && !(await cell(shift(stay.checkIn, -1)).isVisible()); i++) {
    await calendar.getByRole("button", { name: "Aller au mois suivant" }).click();
  }
  // One or two free nights before the stay can't hold the 3-night minimum; three can.
  for (const n of [-1, -2]) await expect(cell(shift(stay.checkIn, n)).getByRole("button")).toBeDisabled();
  if (await cell(shift(stay.checkIn, -3)).isVisible()) await expect(cell(shift(stay.checkIn, -3)).getByRole("button")).toBeEnabled();
});

test("unavailable dates show no total or breakdown", async ({ page, request }) => {
  const { id, stay, shift } = await listingBeforeAStay(request);
  await page.goto(`/rooms/${id}?checkin=${shift(stay.checkIn, -3)}&checkout=${shift(stay.checkIn, 1)}`);
  const card = page.getByTestId("booking-card");
  await expect(card.getByRole("alert")).toHaveText("Ces dates ne sont plus disponibles.");
  await expect(card).toContainText("par nuit");
  await expect(card).not.toContainText("au total");
  await expect(card.getByTestId("price-breakdown")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Réserver" })).toBeDisabled();
});

test("book from the listing page and find the stay in Voyages", async ({ page }, testInfo) => {
  await signUp(page, "Inès");
  const listingId = testInfo.project.name === "desktop" ? "1030" : "1031";
  const day = stayDays(testInfo, 200);
  await page.goto(`/rooms/${listingId}`);
  await pickStay(page, day(0), day(3));
  const card = page.getByTestId("booking-card");
  await expect(card.getByTestId("price-breakdown")).toContainText("× 3 nuits");
  const total = (await card.getByRole("definition").last().textContent())!;
  const booked = page.waitForResponse((r) => r.url().endsWith("/api/bookings") && r.request().method() === "POST");
  await card.getByRole("button", { name: "Réserver" }).click();
  expect((await booked).status()).toBe(201);
  await expect(page).toHaveURL(/\/trips$/);
  const trip = page.getByTestId("trip");
  await expect(trip).toHaveCount(1);
  await expect(trip).toContainText(total.trim());
  await expect(trip).toContainText("dont taxe de séjour");

  // The same dates are now taken: the card says so instead of booking twice.
  await page.goto(`/rooms/${listingId}?checkin=${day(0)}&checkout=${day(3)}`);
  await expect(card.getByRole("alert")).toHaveText("Ces dates ne sont plus disponibles.");
  await expect(card.getByRole("button", { name: "Réserver" })).toBeDisabled();
});

test("signed out, Réserver goes to the login page and back with the chosen stay", async ({ page }, testInfo) => {
  const listingId = testInfo.project.name === "desktop" ? "1032" : "1042";
  const day = stayDays(testInfo, 220);
  await page.goto(`/rooms/${listingId}`);
  await pickStay(page, day(0), day(2));
  const card = page.getByTestId("booking-card");
  await card.getByRole("button", { name: /Voyageurs/ }).click();
  await card.getByRole("button", { name: "Augmenter adultes" }).click();
  await expect(card.getByTestId("price-breakdown")).toContainText("Taxe de séjour (2 adultes)");
  await card.getByRole("button", { name: "Réserver" }).click();

  const back = `/rooms/${listingId}?checkin=${day(0)}&checkout=${day(2)}&adults=2`;
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(back)}`);
  await signUp(page, "Noé", { from: "", expectUrl: new RegExp(`${back.replace(/[?]/g, "\\?")}$`) });
  await expect(card.getByTestId("price-breakdown")).toContainText("× 2 nuits");
  await card.getByRole("button", { name: "Réserver" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByTestId("trip")).toContainText("2 voyageurs");
});

test("API errors show inline, in French", async ({ page }, testInfo) => {
  const day = stayDays(testInfo, 240);
  // Arrival in the past: the quote API refuses it.
  await page.goto(`/rooms/1003?checkin=2020-01-10&checkout=2020-01-13`);
  await expect(page.getByTestId("booking-card").getByRole("alert")).toHaveText("L'arrivée ne peut pas être dans le passé.");
  // Too many guests for the home, typed in the URL.
  await page.goto(`/rooms/1031?checkin=${day(0)}&checkout=${day(3)}&adults=9`);
  await expect(page.getByTestId("booking-card").getByRole("alert")).toHaveText(/accueille 4 voyageurs au maximum/);
});

test("phone booking bar: nightly price, then the all-in total and nights once a stay is quoted", async ({ page, request, isMobile }, testInfo) => {
  test.skip(!isMobile, "the bar shows under 768px");
  await page.goto("/rooms/1005");
  const bar = page.getByTestId("phone-booking-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("par nuit");

  const day = stayDays(testInfo, 170);
  const qs = `checkin=${day(0)}&checkout=${day(4)}&adults=2`;
  const quote = await (await request.get(`/api/listings/1005/quote?${qs}`)).json();
  await page.goto(`/rooms/1005?${qs}`);
  await expect(page.getByTestId("price-breakdown")).toBeAttached();
  // Same formatting as the card's total: "617,92 € · 4 nuits".
  const total = await page.getByTestId("price-breakdown").getByRole("definition").last().textContent();
  await expect(bar.locator("p")).toContainText(`${total} · 4\u00a0nuits`);
  expect(total).toMatch(new RegExp(`^${Math.floor(quote.totalCents / 100)}`));
  await expect(bar).not.toContainText("par nuit");
  await expect(bar).toContainText("Total tout compris");
  // Only one bar, and its link scrolls to the card.
  await expect(page.getByTestId("phone-booking-bar")).toHaveCount(1);
  await bar.getByRole("link", { name: "Réserver" }).click();
  await expect(page.getByTestId("booking-card").getByRole("button", { name: "Réserver" })).toBeInViewport();
});
