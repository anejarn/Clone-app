import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, test } from "./fixtures";

/**
 * Owner statements and the owner portal (Lot 6b) in the browser, desktop and phone: an associé closes a past month
 * (reopening it first on a retry) — closing generates the owners' statements —, finds Hassan Benjelloun's statement
 * with the overview's net due and downloads the PDF; Hassan signs in, lands on his portal, opens the statement,
 * switches to Arabic (right to left); another owner (Nadia El Fassi) gets « introuvable » for Hassan's statement, as
 * a PDF and as a page. Each project closes its own month (desktop two months back, phone three), so the two runs and
 * the finances spec (previous month) never close the same month. Hassan sub-lets two homes from Sigma: every closed
 * month posts his rents, so he always has a statement.
 */

test.describe.configure({ mode: "serial" });

const OWNER = "owner_benjelloun";
let statementUrl = "";
let month = "";

const marrakechMonth = (shift: number) => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + shift, 1)).toISOString().slice(0, 7);
};

async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function signIn(page: Page, email: string, opts: { next?: string; totp?: boolean } = {}) {
  await page.goto(opts.next ? `/login?next=${encodeURIComponent(opts.next)}` : "/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  if (opts.totp) {
    await page.getByLabel("Code à 6 chiffres").fill(totpCode(DEMO_TOTP_SECRET));
    await page.getByRole("button", { name: "Valider" }).click();
  }
}

test("an associé closes a month: the owners' statements are generated, with the overview's figures, and download as PDF", async ({ page }, testInfo) => {
  month = marrakechMonth(testInfo.project.name === "mobile" ? -3 : -2);
  await signIn(page, "amine@demo.sigma.test", { next: `/admin/finances?mois=${month}`, totp: true });
  await expect(page).toHaveURL(new RegExp(`/admin/finances\\?mois=${month}$`));
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

  await page.goto(`/admin/finances/releves?mois=${month}`);
  await expect(page.getByTestId("statements-month-status")).toHaveText("Clôturé");
  const row = page.locator(`[data-testid=statement-row][data-owner=${OWNER}]`);
  await expect(row.getByTestId("statement-latest")).toBeVisible();
  // The statement's net due is the monthly overview's.
  await expect(row.getByTestId("statement-net-due")).toHaveText((await row.getByTestId("overview-net-due").textContent())!);
  await audit(page, "statements");
  expect(await noSideScroll(page)).toBe(true);

  statementUrl = (await row.getByTestId("statement-pdf").getAttribute("href"))!;
  expect(statementUrl).toMatch(/^\/api\/finances\/statements\/[A-Za-z0-9_-]+$/);
  const pdf = await page.request.get(statementUrl);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const all = await page.request.get((await page.getByTestId("statements-all").getAttribute("href"))!);
  expect(all.status()).toBe(200);
  expect(all.headers()["content-disposition"]).toContain(`releves_${month}.pdf`);
});

test("the owner signs in to the portal, opens the statement and switches to Arabic (right to left)", async ({ page }) => {
  test.skip(!statementUrl, "needs the statement of the previous test");
  await signIn(page, "hassan.benjelloun@demo.sigma.test");
  await expect(page).toHaveURL(/\/proprietaire$/);
  await expect(page.getByRole("heading", { level: 1, name: "Bonjour, Hassan" })).toBeVisible();
  await expect(page.getByTestId("owner-portal")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("owner-occupancy")).toHaveCount(2);
  await audit(page, "owner dashboard");
  expect(await noSideScroll(page)).toBe(true);

  await page.getByRole("navigation", { name: "Espace propriétaire" }).getByRole("link", { name: "Relevés" }).click();
  await expect(page).toHaveURL(/\/proprietaire\/releves$/);
  const item = page.locator(`[data-testid=owner-statements] [data-month="${month}"]`);
  await expect(item).toBeVisible();
  await audit(page, "owner statements");
  await item.getByRole("heading").getByRole("link").click();
  await expect(page).toHaveURL(/\/proprietaire\/releves\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId("statement-summary")).toContainText("Solde à vous verser");
  const pdfHref = (await page.getByTestId("statement-pdf").getAttribute("href"))!;
  expect(pdfHref).toBe(statementUrl);
  const pdf = await page.request.get(pdfHref);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  await audit(page, "owner statement");
  expect(await noSideScroll(page)).toBe(true);

  // Arabic: right to left, Arabic headings, amounts kept left to right.
  await page.getByRole("navigation", { name: "Langue" }).getByRole("link", { name: /العربية/ }).click();
  await expect(page.getByTestId("owner-portal")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("owner-portal")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("الكشوفات");
  await expect(page.getByTestId("statement-summary")).toContainText("الرصيد الواجب أداؤه لكم");
  await expect(page.getByTestId("statement-balance")).toContainText("MAD");
  expect(await page.getByTestId("owner-portal").evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  await audit(page, "owner statement in Arabic");
  expect(await noSideScroll(page)).toBe(true);
  // The choice is kept from page to page.
  await page.getByRole("navigation", { name: "فضاء المالك" }).getByRole("link", { name: "عقاراتي" }).click();
  await expect(page.getByTestId("owner-portal")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("owner-listings")).toBeVisible();
});

test("another owner gets « introuvable » for that statement and for that owner's home; visitors are sent to sign in", async ({ page }) => {
  test.skip(!statementUrl, "needs the statement of the first test");
  await page.goto("/proprietaire/releves");
  await expect(page).toHaveURL(/\/login\?next=%2Fproprietaire%2Freleves$/);

  await signIn(page, "nadia.elfassi@demo.sigma.test");
  await expect(page).toHaveURL(/\/proprietaire$/);
  expect((await page.request.get(statementUrl)).status()).toBe(404);
  const id = statementUrl.split("/").pop()!;
  await page.goto(`/proprietaire/releves/${id}`);
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  await page.goto("/proprietaire/biens/1003");
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  // Her own homes are there; Hassan's aren't.
  await page.goto("/proprietaire/biens");
  await expect(page.locator("[data-listing='1004']")).toBeVisible();
  await expect(page.locator("[data-listing='1003']")).toHaveCount(0);
});
