import { test as base, expect, type Page } from "@playwright/test";
import { CONSENT_COOKIE } from "../../lib/browser-storage";

/** Pre-dismisses the cookie notice so it doesn't cover the page, except in tests about the notice. */
export const test = base.extend<{ consent: boolean }>({
  consent: [true, { option: true }],
  page: async ({ page, context, baseURL, consent }, run) => {
    if (consent) await context.addCookies([{ name: CONSENT_COOKIE, value: "ok", url: baseURL! }]);
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
export const uniqueEmail = (prefix = "e2e") => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.sigma.test`;

/** Creates an account from the login page and waits to leave it. */
export async function signUp(page: Page, name = "Camille") {
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
