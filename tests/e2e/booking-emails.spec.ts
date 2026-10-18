import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { buildEmail } from "../support/emails";
import { totpCode } from "../support/totp";
import { expect, stayDays, test } from "./fixtures";

/**
 * Lot 7b in the browser, desktop: an associé opens the step-by-step guide of a home's Airbnb connection (generic,
 * « à vérifier »), records the home's Airbnb id and ticks a step; drops an Airbnb confirmation (.eml file) and sees
 * the booking in the calendar at once; handles an Agoda e-mail whose home isn't recognized from « E-mails à
 * traiter »; creates a season for the home and reports it on each platform from « Prix à reporter ». Seeded home
 * 1091, from day 650 (shifted per retry), run-specific codes.
 */

const HOME = "1091";

async function signIn(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Adresse e-mail").fill("amine@demo.sigma.test");
  await page.getByLabel("Mot de passe").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByLabel("Code à 6 chiffres").fill(totpCode(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, "\\$&")}$`));
}

async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

/** Clicks « Fait » on every open reminder of this rule, one after the other (the list refreshes after each). */
async function reportAll(page: Page, ruleName: string) {
  const reminders = page.getByTestId("price-reminder").filter({ hasText: ruleName });
  for (let n = await reminders.count(); n > 0; n--) {
    await reminders.first().getByRole("button", { name: /^Fait sur / }).click();
    await expect(reminders).toHaveCount(n - 1);
  }
}

test("an associé follows the connection guide, drops booking e-mails, handles the queue and reports a price change", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop journey");
  const d = stayDays(testInfo, 650);
  const run = String(Date.now()).slice(-6);
  const airbnbId = `9${run}`;

  // The guide of the Airbnb connection, the home's Airbnb id, a step ticked by hand.
  await signIn(page, `/admin/biens/${HOME}/plateformes`);
  const airbnb = page.getByTestId("feed-AIRBNB");
  const guide = airbnb.getByTestId("setup-guide");
  await guide.locator("summary").click();
  await expect(guide).toContainText("À vérifier sur l'interface actuelle de la plateforme");
  await expect(guide).toContainText("Donner le lien Sigma à Airbnb (export)");
  await expect(guide).toContainText("Donner le lien Airbnb à Sigma (import)");
  await guide.getByLabel("Identifiant sur Airbnb").fill(airbnbId);
  await guide.getByRole("button", { name: "Enregistrer la correspondance" }).click();
  await expect(guide.getByText("Correspondance enregistrée")).toBeVisible();
  const rules = guide.getByTestId("check-rulesSet");
  if ((await rules.getAttribute("data-done")) === "1") {
    await rules.getByRole("button", { name: "Décocher" }).click();
    await expect(rules).toHaveAttribute("data-done", "0");
  }
  await rules.getByRole("button", { name: "Marquer comme fait" }).click();
  await expect(rules).toHaveAttribute("data-done", "1");
  await audit(page, "plateformes with guide");

  // An Airbnb confirmation dropped as a .eml file: the booking is there at once.
  await page.goto("/admin/synchronisation/emails");
  await expect(page.getByRole("heading", { level: 1, name: "E-mails de réservation" })).toBeVisible();
  await expect(page.getByText("Le service de réception d'e-mails n'est pas encore choisi")).toBeVisible();
  const code = `HM${run}E2`;
  const eml = buildEmail({ platform: "AIRBNB", kind: "CONFIRMATION", code, checkIn: d(0), checkOut: d(3), guest: "Camille E2e", adults: 2, amount: "2 400,00 MAD", listingId: airbnbId });
  const drop = page.getByTestId("drop-email");
  await drop.getByLabel("Fichier .eml").setInputFiles({ name: "reservation.eml", mimeType: "message/rfc822", buffer: Buffer.from(eml) });
  await drop.getByRole("button", { name: "Traiter l'e-mail" }).click();
  await expect(drop.getByRole("status")).toContainText("Réservation créée : les dates sont bloquées.");
  await audit(page, "e-mails page");
  await page.goto(`/admin/calendrier?du=${d(-1)}&jours=14`);
  const row = page.locator(`[data-testid=calendar-row][data-listing="${HOME}"]`);
  await expect(row.locator("[data-testid=calendar-bar][data-source=AIRBNB]").first()).toBeVisible();

  // An Agoda e-mail naming a home Sigma doesn't know: in the queue, applied to the home chosen.
  await page.goto("/admin/synchronisation/emails");
  const agodaCode = `70${run}01`;
  await drop.getByLabel("Ou le message collé").fill(buildEmail({ platform: "AGODA", kind: "CONFIRMATION", code: agodaCode, checkIn: d(5), checkOut: d(7), guest: "Sam E2e", adults: 2, amount: "USD 300.00", listingName: `Riad inconnu ${run}` }));
  await drop.getByRole("button", { name: "Traiter l'e-mail" }).click();
  await expect(drop.getByRole("status")).toContainText("logement non reconnu");
  await expect(page.getByTestId("sync-badge-emails")).toBeVisible();
  const item = page.getByTestId("inbound-email").filter({ hasText: agodaCode });
  await expect(item).toHaveAttribute("data-status", "PENDING");
  await item.getByLabel("Bien concerné").selectOption(HOME);
  await item.getByRole("button", { name: "Appliquer l'e-mail" }).click();
  await expect(item).toHaveCount(0);
  await page.getByRole("link", { name: "Traités", exact: true }).click();
  await expect(page.getByTestId("inbound-email").filter({ hasText: agodaCode })).toContainText("Réservation créée");

  // A season for the home: a reminder per connected platform, marked done one by one.
  const ruleName = `Saison e2e 7b ${run}`;
  await page.goto("/admin/prix/nouvelle");
  const field = (label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });
  await field("Type").selectOption("SEASON");
  await field("Nom").fill(ruleName);
  await field("Première nuit").fill(d(20));
  await field("Dernière nuit (incluse)").fill(d(25));
  await field("Pourcentage (%)").fill("+10");
  await page.getByLabel("Une sélection de biens").check();
  await page.getByTestId("rule-listings").locator(`input[value="${HOME}"]`).check();
  await page.getByRole("button", { name: "Créer la règle" }).click();
  await expect(page).toHaveURL(/\/admin\/prix\?cree=/);
  await page.goto("/admin/synchronisation/prix");
  const mine = page.getByTestId("price-reminder").filter({ hasText: ruleName });
  await expect(page.locator("[data-testid=price-reminder][data-source=AIRBNB]").filter({ hasText: ruleName })).toHaveCount(1);
  await expect(mine.first()).toContainText("+10 % sur le prix de base");
  await expect(page.getByTestId("sync-badge-prix")).toBeVisible();
  await audit(page, "prix à reporter");
  await reportAll(page, ruleName);
  await expect(page.getByText(`${ruleName}`).first()).toBeVisible();

  // Clean up: the rule goes, its removal is reported too.
  await page.goto("/admin/prix");
  await page.getByTestId("rule-row").filter({ hasText: ruleName }).getByRole("link", { name: ruleName }).click();
  await page.getByLabel("Je confirme la suppression").check();
  await page.getByRole("button", { name: "Supprimer" }).click();
  await expect(page).toHaveURL(/\/admin\/prix\?supprime=1$/);
  await page.goto("/admin/synchronisation/prix");
  await reportAll(page, ruleName);
});
