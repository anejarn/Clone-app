import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { CONSENT_COOKIE } from "../../lib/browser-storage";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, test } from "./fixtures";

/**
 * Pannes in the browser, desktop and phone: an agent reports an urgent breakdown with a photo; it shows on the
 * associé's dashboard; the associé assigns it, sets the cost and follows it to « réparée ». Each project reports on
 * its own seeded home, with a title unique to the run.
 */

const HOME = { desktop: "1020", mobile: "1021" } as Record<string, string>;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Adresse e-mail").fill(email);
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

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Fields by role and name: a <label> wrapping a <select> also holds the options' text. */
const select = (page: Page, name: string) => page.getByRole("combobox", { name, exact: true }).filter({ visible: true });
const field = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true }).filter({ visible: true });

test("an agent reports an urgent breakdown with a photo; the associé sees it, assigns it and follows it to the repair", async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const home = HOME[testInfo.project.name] ?? "1020";
  const title = `Fuite sous l'évier ${testInfo.project.name} ${Date.now()}`;

  await signIn(page, "agent1@demo.sigma.test", "/admin/pannes/nouvelle");
  await expect(page.getByRole("heading", { level: 1, name: "Signaler une panne" })).toBeVisible();
  await select(page, "Bien").selectOption(home);
  await field(page, "Ce qui ne va pas").fill(title);
  await select(page, "Catégorie").selectOption("PLUMBING");
  await select(page, "Priorité").selectOption("URGENT");
  await field(page, "Détails (facultatif)").fill("L'eau coule sous le meuble, robinet d'arrêt fermé.");
  await page.getByLabel("Prendre une photo").setInputFiles({ name: "fuite.png", mimeType: "image/png", buffer: PNG });
  await audit(page, "new ticket");
  expect(await noSideScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Signaler la panne" }).click();

  await expect(page).toHaveURL(/\/admin\/pannes\/[^/?]+\?cree=1$/);
  const ticketUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("status").first()).toContainText("Panne signalée");
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByTestId("ticket-facts").getByTestId("ticket-priority")).toHaveText("Urgente");
  await expect(page.getByTestId("ticket-facts").getByTestId("ticket-status")).toHaveText("Signalée");
  const img = page.getByTestId("ticket-photos").getByRole("img").first();
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await expect(page.getByTestId("ticket-thread").locator("li")).toHaveCount(2);
  // The reporter can't move it along (not assigned yet), nor assign it.
  await expect(page.getByRole("button", { name: "Enregistrer le statut" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enregistrer l'affectation" })).toHaveCount(0);
  await audit(page, "ticket page (agent)");
  expect(await noSideScroll(page)).toBe(true);

  // The associé: on the dashboard's urgent list, then on the ticket.
  await context.clearCookies();
  await context.addCookies([{ name: CONSENT_COOKIE, value: "ok", url: baseURL! }]);
  await signIn(page, "amine@demo.sigma.test", "/admin");
  await expect(page.getByTestId("urgent-tickets")).toContainText(title);
  expect(Number(await page.getByTestId("count-tickets-urgent").locator("[data-value]").textContent())).toBeGreaterThan(0);
  await audit(page, "dashboard");
  await page.getByTestId("urgent-tickets").getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketUrl}$`));

  await select(page, "Confier à").selectOption({ label: "Youssef (agent)" });
  await page.getByRole("button", { name: "Enregistrer l'affectation" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Panne affectée." })).toBeVisible();
  await expect(page.getByTestId("ticket-assignee")).toHaveText("Youssef");

  await field(page, "Montant (MAD)").fill("350");
  await page.getByLabel("À refacturer au propriétaire (repris dans son relevé, lot 6)").check();
  await page.getByRole("button", { name: "Enregistrer le coût" }).click();
  await expect(page.getByTestId("ticket-cost")).toContainText("350");
  await expect(page.getByTestId("ticket-cost")).toContainText("à refacturer au propriétaire");

  await select(page, "Nouveau statut").selectOption("WAITING");
  await select(page, "En attente").selectOption("CONTRACTOR");
  await field(page, "Note (facultatif)").fill("Plombier demain matin");
  await page.getByRole("button", { name: "Enregistrer le statut" }).click();
  await expect(page.getByTestId("ticket-facts").getByTestId("ticket-status")).toHaveText("En attente d'un prestataire");
  await select(page, "Nouveau statut").selectOption("RESOLVED");
  await page.getByRole("button", { name: "Enregistrer le statut" }).click();
  await expect(page.getByTestId("ticket-facts").getByTestId("ticket-status")).toHaveText("Réparée");
  await expect(page.getByTestId("ticket-thread")).toContainText("Plombier demain matin");
  await audit(page, "ticket page (associé)");

  // Off the open list once repaired; still there with « Toutes ».
  await page.goto(`/admin/pannes?bien=${home}`);
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  await page.goto(`/admin/pannes?statut=toutes&bien=${home}`);
  await expect(page.getByRole("link", { name: title })).toBeVisible();
});
