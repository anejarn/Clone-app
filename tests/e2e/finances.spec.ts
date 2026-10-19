import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, stayDays, test } from "./fixtures";

/**
 * Finances (Lot 6a) in the browser, desktop: an associé types a direct stay and reads its split on the booking's page
 * (20 % of the rent, the owner's share, the cleaning), adds an expense with its receipt and validates it, closes the
 * previous month (reopening it first on a retry), and exports the month's journal as CSV (BOM, « ; », JJ/MM/AAAA).
 * Desktop only: closing a month of the seeded organization is done once per run.
 */

const HOME = "1061";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });

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

const marrakechMonth = (shift = 0) => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + shift, 1));
  return d.toISOString().slice(0, 7);
};

test("an associé reads a booking's split, adds an expense with its receipt, closes the month and exports the journal", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only: closes a month of the seeded organization");
  const at = stayDays(testInfo, 420);
  await signIn(page, "/admin/finances");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Finances");
  await audit(page, "finances overview");

  // A direct stay: 2 nights at 1 000 MAD + 200 MAD cleaning.
  await page.goto("/admin/reservations/nouvelle");
  await field(page, "Bien").selectOption(HOME);
  await field(page, "Arrivée").fill(at(0));
  await field(page, "Départ").fill(at(2));
  await field(page, "Adultes").fill("2");
  await field(page, "Nom du voyageur").fill("Inès Finances");
  await field(page, "Téléphone").fill("+33 6 00 00 00 01");
  await field(page, "Reçue par").selectOption("PHONE");
  await field(page, "Prix par nuit (MAD)").fill("1000");
  await field(page, "Frais de ménage (MAD)").fill("200");
  await page.getByRole("button", { name: "Enregistrer la réservation" }).click();
  await expect(page).toHaveURL(/\/admin\/reservations\/[^/?]+\?cree=directe$/);
  const split = page.getByTestId("booking-finance");
  await expect(split).toHaveAttribute("data-status", "COMPLETE");
  await expect(split.getByTestId("split-gross")).toContainText(/2\s?200/);
  await expect(split.getByTestId("split-commission")).toContainText(/400/);
  await expect(split.getByTestId("split-owner")).toContainText(/1\s?600/);
  await expect(split.getByTestId("split-cleaning-sigma")).toContainText(/200/);
  await audit(page, "booking split");

  // An expense with its receipt, then validated.
  await page.goto("/admin/finances/depenses");
  const formEl = page.getByTestId("expense-form");
  await formEl.getByLabel("Bien").selectOption(HOME);
  await formEl.getByLabel("Catégorie").selectOption("REPAIR");
  await formEl.getByLabel("Montant TTC (MAD)").fill("349,90");
  await formEl.getByLabel("Description").fill(`Mitigeur e2e ${testInfo.retry}`);
  await formEl.getByLabel("Fournisseur (facultatif)").fill("Quincaillerie");
  await formEl.getByLabel(/Justificatif/).setInputFiles({ name: "facture.png", mimeType: "image/png", buffer: PNG });
  await formEl.getByRole("button", { name: "Enregistrer en brouillon" }).click();
  await expect(formEl.getByRole("status")).toContainText("brouillon");
  await formEl.getByTestId("expense-created-link").click();
  await expect(page.getByTestId("expense-status")).toHaveText("Brouillon");
  await expect(page.getByTestId("expense-receipt")).toContainText("photo");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("expense-validate").click();
  await expect(page.getByTestId("expense-status")).toHaveText("Validée");
  await expect(page.getByTestId("expense-ledger").getByTestId("ledger-entry")).toHaveCount(1);
  const receipt = await page.request.get(await page.getByTestId("expense-receipt").getByRole("link").getAttribute("href").then((h) => h!));
  expect(receipt.status()).toBe(200);
  expect(receipt.headers()["content-type"]).toBe("image/png");

  // Close the previous month (reopen it first if an earlier attempt closed it).
  const month = marrakechMonth(-1);
  await page.goto(`/admin/finances?mois=${month}`);
  if ((await page.getByTestId("month-status").textContent()) === "Clôturé") {
    await page.getByLabel("Raison de la réouverture").fill("Nouvel essai e2e");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Rouvrir le mois" }).click();
    await expect(page.getByTestId("month-status")).toHaveText("Ouvert");
  }
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("close-month").click();
  await expect(page.getByTestId("month-closing").getByRole("status")).toContainText("clôturé");
  await expect(page.getByTestId("month-status")).toHaveText("Clôturé");

  // Export the month's journal.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("month-csv").click()]);
  expect(download.suggestedFilename()).toBe(`journal-financier_${month}.csv`);
  const bytes = await readFile((await download.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString("utf8").slice(1);
  expect(text.split("\r\n")[0]).toContain("N°;Date d'écriture;Mois comptable");
  expect(text).toContain(`;${month.slice(5)}/${month.slice(0, 4)};;Clôture du mois;`);
});
