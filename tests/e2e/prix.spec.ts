import AxeBuilder from "@axe-core/playwright";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, stayDays, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Prix in the browser, desktop and phone: an associé creates an event for one home, sees it in the home's price
 * calendar, the public quote prices those nights with it and applies its minimum stay; deleting it brings the base
 * price back. Each project uses its own seeded Hivernage home (no seeded rule there) and its own dates, from day 250
 * (shifted per retry), inside the year the site books ahead.
 */

const HOME = { desktop: "1005", mobile: "1006" } as Record<string, string>;
const BASE_DAY = { desktop: 250, mobile: 280 } as Record<string, number>;

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

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Visible fields only: the router keeps pages visited before (hidden) in the document. */
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });

test("an associé creates an event, sees it in the price calendar, and the public quote follows it", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const home = HOME[project] ?? "1005";
  const d = stayDays(testInfo, BASE_DAY[project] ?? 250);
  const name = `Festival du rire e2e ${project} ${Date.now()}`;
  const listing = await (await page.request.get(`/api/listings/${home}`)).json();
  const base: number = listing.priceCents;
  // +40 % of a price in whole tens of dirhams: an exact number of dirhams.
  const up = (base * 14) / 10;
  const quote = async (from: number, to: number) => page.request.get(`/api/listings/${home}/quote?checkin=${d(from)}&checkout=${d(to)}&adults=1`);

  // Before: the base price on every night, a one-night stay accepted.
  const before = await (await quote(-1, 2)).json();
  expect(before.nightPrices.map((n: { priceCents: number }) => n.priceCents)).toEqual([base, base, base]);
  expect((await quote(0, 1)).status()).toBe(200);

  await signIn(page, "/admin/prix");
  await expect(page.getByRole("heading", { level: 1, name: "Prix" })).toBeVisible();
  // The seeded seasons and events, upcoming by default (yearly ones always are).
  await expect(page.getByTestId("rule-rows")).toContainText("Fêtes de fin d'année");
  await expect(page.getByTestId("rule-rows")).toContainText("chaque année du 20/12 au 04/01");
  await audit(page, "rules list");
  expect(await noSideScroll(page)).toBe(true);

  await page.getByRole("link", { name: "Nouvelle règle" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nouvelle règle de prix" })).toBeVisible();
  await field(page, "Type").selectOption("EVENT");
  await field(page, "Nom").fill(name);
  await field(page, "Première nuit").fill(d(0));
  await field(page, "Dernière nuit (incluse)").fill(d(1));
  await field(page, "Pourcentage (%)").fill("+40");
  await field(page, "Séjour minimum (nuits)").fill("2");
  await page.getByLabel("Une sélection de biens").check();
  await page.getByTestId("rule-listings").locator(`input[value="${home}"]`).check();
  await audit(page, "rule form");
  expect(await noSideScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Créer la règle" }).click();
  await expect(page).toHaveURL(/\/admin\/prix\?cree=/);
  await expect(page.getByRole("status")).toContainText("Règle créée.");
  const row = page.getByTestId("rule-row").filter({ hasText: name });
  await expect(row).toContainText("+40 %");
  await expect(row).toContainText("séjour minimum 2 nuits");

  // The home's price calendar: the event's nights at +40 %, with its minimum stay; the night before at the base price.
  await page.goto(`/admin/prix/apercu?bien=${home}&du=${d(-1)}&jours=30`);
  await expect(page.getByRole("heading", { level: 1, name: "Calendrier des prix" })).toBeVisible();
  const night = (n: number) => page.locator(`[data-testid=price-day][data-date="${d(n)}"]`);
  await expect(night(-1)).toHaveAttribute("data-price", String(base));
  for (const n of [0, 1]) {
    await expect(night(n)).toHaveAttribute("data-price", String(up));
    await expect(night(n)).toHaveAttribute("data-min-nights", "2");
    await expect(night(n)).toContainText(name);
  }
  await expect(night(2)).toHaveAttribute("data-price", String(base));
  await expect(page.getByTestId("price-rules-used")).toContainText(name);
  await audit(page, "price calendar");
  expect(await noSideScroll(page)).toBe(true);

  // The public quote: each night at its price, the total their sum plus cleaning; the event's minimum stay applies.
  const q = await (await quote(-1, 2)).json();
  expect(q.nightPrices.map((n: { priceCents: number }) => n.priceCents)).toEqual([base, up, up]);
  expect(q.stayCents).toBe(base + 2 * up);
  expect(q.totalCents).toBe(base + 2 * up + listing.cleaningFeeCents);
  expect(q.minNights).toBe(2);
  const short = await quote(0, 1);
  expect(short.status()).toBe(422);
  expect((await short.json()).error).toMatchObject({ code: "MIN_NIGHTS", message: "Ce logement se réserve pour 2 nuits minimum." });

  // Deleting the rule brings the base price back.
  await page.goto("/admin/prix");
  await page.getByTestId("rule-row").filter({ hasText: name }).getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByLabel("Je confirme la suppression").check();
  await page.getByRole("button", { name: "Supprimer" }).click();
  await expect(page).toHaveURL(/\/admin\/prix\?supprime=1$/);
  await expect(page.getByRole("status")).toContainText("Règle supprimée.");
  await expect(page.getByTestId("rule-row").filter({ hasText: name })).toHaveCount(0);
  const after = await (await quote(-1, 2)).json();
  expect(after.nightPrices.map((n: { priceCents: number }) => n.priceCents)).toEqual([base, base, base]);
});
