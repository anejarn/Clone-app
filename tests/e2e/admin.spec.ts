import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { TEST_DATABASE_URL } from "../../playwright.config";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET, SIGMA_ORG } from "../../prisma/fixtures";
import { base32Decode, totpCode } from "../support/totp";
import { expect, PASSWORD, signUp, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** Back-office in the browser, desktop and phone: sign-in with double authentification, enrollment, refusals. */

async function passwordStep(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Espace équipe" });

test("an admin signs in with password and TOTP code, and reaches the dashboard", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
  await passwordStep(page, "amine@demo.sigma.test");
  await expect(page.getByRole("heading", { name: "Double authentification" })).toBeVisible();
  await page.getByLabel("Code à 6 chiffres").fill(totpCode(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
  expect(Number(await page.getByTestId("count-listings").locator("[data-value]").textContent())).toBeGreaterThan(0);
  await expect(page.getByTestId("license-alerts")).toContainText(/Expir/);
  await audit(page, "dashboard");
  for (const label of ["Biens", "Réservations", "Calendrier", "Prix", "Utilisateurs"]) {
    await expect(nav(page).getByRole("link", { name: new RegExp(label) })).toBeAttached();
  }
  await nav(page).getByRole("link", { name: /Biens/ }).click();
  await expect(page).toHaveURL(/\/admin\/biens$/);
  await expect(page.getByText("Bientôt disponible")).toBeVisible();
  // No sideways scrolling on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("an agent sees the day-to-day sections only, and admin-only pages are not found", async ({ page }) => {
  await page.goto("/login");
  await passwordStep(page, "agent1@demo.sigma.test");
  await page.getByLabel("Code à 6 chiffres").fill(totpCode(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(nav(page).getByRole("link", { name: /Calendrier/ })).toBeAttached();
  await expect(nav(page).getByRole("link", { name: /Biens/ })).toHaveCount(0);
  await page.goto("/admin/utilisateurs");
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
});

test("a guest is refused: the back-office is not found and shows no team data", async ({ page }) => {
  await signUp(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  await expect(page.getByText("Bonjour")).toHaveCount(0);
  await expect(nav(page)).toHaveCount(0);
});

test("a new staff member must enroll before the back-office, then signs in with a code or a backup code", async ({ page }) => {
  const email = await signUp(page, "Recrue");
  // Promote the fresh account to ADMIN of Sigma, as Lot 2's user management will.
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query(`UPDATE users SET role = 'ADMIN', "organizationId" = $1 WHERE email = $2`, [SIGMA_ORG.id, email]);
  await client.end();

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/securite$/);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Commencer" }).click();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  await audit(page, "enrollment");
  const secret = base32Decode((await page.getByTestId("totp-secret").textContent())!);
  await page.getByLabel("Code à 6 chiffres").fill(totpCode(secret));
  await page.getByRole("button", { name: "Activer" }).click();
  await expect(page.getByTestId("two-factor-on")).toBeVisible();
  const codes = await page.getByTestId("backup-codes").locator("li").allTextContents();
  expect(codes).toHaveLength(10);
  await page.getByRole("link", { name: "Accéder à l'espace équipe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();

  await page.getByRole("button", { name: "Déconnexion" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await passwordStep(page, email, PASSWORD);
  await page.getByRole("button", { name: "Utiliser un code de secours" }).click();
  await page.getByLabel("Code de secours").fill(codes[0]);
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
});

