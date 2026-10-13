import { test as base, expect, type Page } from "@playwright/test";

/** Pre-accepts cookies so the banner doesn't cover the page, except in tests about the banner. */
export const test = base.extend<{ consent: boolean }>({
  consent: [true, { option: true }],
  page: async ({ page, context, baseURL, consent }, run) => {
    if (consent) await context.addCookies([{ name: "nidou_consent", value: "all", url: baseURL! }]);
    await run(page);
  },
});

export { expect };

/**
 * yyyy-MM-dd `base + n` days from today, shifted per repetition and retry so a test that books fixed
 * listings never collides with its own earlier attempt in the same database.
 */
export function stayDays(testInfo: { repeatEachIndex: number; retry: number }, base: number) {
  const shift = (testInfo.repeatEachIndex * 2 + testInfo.retry) * 5;
  return (n: number) => new Date(Date.now() + (base + shift + n) * 86_400_000).toISOString().slice(0, 10);
}

export const PASSWORD = "motdepasse-e2e";
export const uniqueEmail = (prefix = "e2e") => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.nidou.fr`;

/** Creates an account from the login page (optionally reached with ?next=) and waits to leave it. */
export async function signUp(page: Page, name = "Camille", { from = "/login", expectUrl = /\/$/ as RegExp } = {}) {
  const email = uniqueEmail();
  if (from) await page.goto(from);
  await page.getByRole("button", { name: "Inscrivez-vous" }).click();
  await page.getByLabel("Prénom").fill(name);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(expectUrl);
  return email;
}

/**
 * Picks a stay in the listing page's booking card: opens the calendar if needed, moves to each date's month
 * and clicks it (cells carry data-day="yyyy-MM-dd").
 */
export async function pickStay(page: Page, checkIn: string, checkOut: string) {
  const card = page.getByTestId("booking-card");
  const calendar = card.locator(".rdp-root");
  if (!(await calendar.isVisible())) await card.getByRole("button", { name: /Arrivée/ }).click();
  for (const day of [checkIn, checkOut]) {
    const cell = calendar.locator(`[data-day="${day}"]`);
    await expect(calendar).toBeVisible();
    for (let i = 0; i < 14 && !(await cell.isVisible()); i++) await calendar.getByRole("button", { name: "Aller au mois suivant" }).click();
    await cell.getByRole("button").click();
  }
}
