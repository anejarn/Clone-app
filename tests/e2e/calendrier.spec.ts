import AxeBuilder from "@axe-core/playwright";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, stayDays, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Calendrier and Réservations in the browser, desktop and phone: the timeline (desktop) or agenda (phone) with
 * bars coloured by source, a phone booking and an owner block typed by an associé, an overlap refused; an agent
 * reads without amounts and can't type. Each project books its own seeded home, from day 500 (shifted per retry).
 */

const HOME = { desktop: "1111", mobile: "1116" } as Record<string, string>;

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
/** Visible fields only: the router keeps pages visited before (hidden) in the document. */
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });
const jjmmaaaa = (iso: string) => iso.split("-").reverse().join("/");

test("an associé reads the calendar, types a phone booking and an owner block, and an overlap is refused", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  const home = HOME[testInfo.project.name] ?? "1111";
  const d = stayDays(testInfo, 500);
  await signIn(page, "amine@demo.sigma.test", "/admin/calendrier");
  await expect(page.getByRole("heading", { level: 1, name: "Calendrier" })).toBeVisible();

  // Legend: every source by name, owner blocks hatched.
  const legend = page.getByTestId("calendar-legend");
  for (const s of ["Directe", "Airbnb", "Booking.com", "Agoda", "Trip.com", "Expedia", "Blocage propriétaire"]) await expect(legend).toContainText(s);

  // The seeded stays of the next 30 days, coloured by source: the grid on a computer, the agenda on a phone.
  const item = mobile ? page.getByTestId("agenda-item") : page.getByTestId("calendar-bar");
  if (mobile) {
    await expect(page.getByTestId("calendar-grid")).toBeHidden();
    await expect(page.getByTestId("calendar-agenda")).toBeVisible();
    await expect(page.getByTestId("agenda-summary")).toContainText(/\d+ biens? occupés?/);
  } else {
    await expect(page.getByTestId("calendar-agenda")).toBeHidden();
    await expect(page.getByTestId("calendar-row").first()).toBeVisible();
  }
  const direct = item.and(page.locator("[data-source=DIRECT]")).first();
  await expect(direct).toBeVisible();
  if (!mobile) await expect(direct).toHaveCSS("background-color", "rgb(53, 80, 168)");
  const airbnb = page.getByTestId("calendar-bar").and(page.locator("[data-source=AIRBNB]")).first();
  if (!mobile && (await airbnb.count())) await expect(airbnb).toHaveCSS("background-color", "rgb(168, 50, 94)");
  await audit(page, "calendar");
  expect(await noSideScroll(page)).toBe(true);

  // A booking's detail, in a panel: dates JJ/MM/AAAA, nights, amounts for an associé.
  await direct.click();
  const panel = page.getByTestId("booking-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("booking-dates")).toHaveText(/^du \d{2}\/\d{2}\/\d{4} au \d{2}\/\d{2}\/\d{4}$/);
  await expect(panel).toContainText(/\d+ nuits?/);
  await expect(panel.getByTestId("booking-amounts")).toContainText("MAD");
  await panel.getByRole("button", { name: "Fermer" }).click();
  await expect(panel).toBeHidden();

  // A phone booking, priced from the listing.
  await page.goto("/admin/reservations/nouvelle");
  await expect(page.getByRole("heading", { level: 1, name: "Nouvelle saisie" })).toBeVisible();
  await field(page, "Bien").selectOption(home);
  await field(page, "Arrivée").fill(d(0));
  await field(page, "Départ").fill(d(3));
  await expect(page.getByTestId("price-preview")).toContainText("3 nuits ×");
  const total = await page.getByTestId("price-total").textContent();
  expect(total).toMatch(/MAD$/);
  await field(page, "Nom du voyageur").fill("Yassine El Amrani");
  await field(page, "Téléphone").fill("+212 6 12 34 56 78");
  await field(page, "Reçue par").selectOption("PHONE");
  await audit(page, "entry form");
  expect(await noSideScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Enregistrer la réservation" }).click();
  await expect(page).toHaveURL(/\/admin\/reservations\/[^/?]+\?cree=directe$/);
  await expect(page.getByRole("status")).toContainText("Réservation directe enregistrée");
  await expect(page.getByTestId("booking-dates")).toHaveText(`du ${jjmmaaaa(d(0))} au ${jjmmaaaa(d(3))}`);
  await expect(page.getByTestId("booking-detail")).toContainText("Téléphone");
  await expect(page.getByTestId("booking-amounts")).toContainText(total!);

  // An owner block over the booking is refused, with what is in the way; right after it, it is accepted.
  await page.goto("/admin/reservations/nouvelle?type=blocage");
  await field(page, "Bien").selectOption(home);
  await field(page, "Arrivée").fill(d(2));
  await field(page, "Départ").fill(d(9));
  await field(page, "Motif du blocage").fill("Séjour du propriétaire");
  await page.getByRole("button", { name: "Bloquer ces dates" }).click();
  await expect(page.locator("#entry-error")).toContainText(`Ces dates chevauchent une réservation directe du ${jjmmaaaa(d(0))} au ${jjmmaaaa(d(3))}`);
  await expect(field(page, "Motif du blocage")).toHaveValue("Séjour du propriétaire");
  await field(page, "Arrivée").fill(d(3));
  await page.getByRole("button", { name: "Bloquer ces dates" }).click();
  await expect(page).toHaveURL(/\?cree=blocage$/);
  await expect(page.getByRole("status")).toContainText("Blocage propriétaire enregistré");

  // Both in the calendar, on that home's row (desktop) or in its agenda (phone).
  await page.goto(`/admin/calendrier?du=${d(-1)}&jours=14`);
  const row = page.locator(mobile ? `[data-testid=agenda-listing][data-listing="${home}"]` : `[data-testid=calendar-row][data-listing="${home}"]`);
  const sel = mobile ? "agenda-item" : "calendar-bar";
  await expect(row.getByTestId(sel).and(page.locator("[data-source=DIRECT]"))).toHaveAccessibleName(new RegExp(`Yassine El Amrani · du ${jjmmaaaa(d(0))} au ${jjmmaaaa(d(3))}`));
  const block = row.getByTestId(sel).and(page.locator("[data-source=OWNER]"));
  await expect(block).toHaveAccessibleName(new RegExp(`Blocage propriétaire · du ${jjmmaaaa(d(3))} au ${jjmmaaaa(d(9))}`));
  await block.click();
  await expect(page.getByTestId("booking-panel")).toContainText("Séjour du propriétaire");
  await expect(page.getByTestId("booking-panel").getByTestId("booking-amounts")).toHaveCount(0);
  expect(await noSideScroll(page)).toBe(true);
});

test("an agent reads the calendar and the bookings without amounts, and can't type one", async ({ page }) => {
  await signIn(page, "agent1@demo.sigma.test", "/admin/reservations");
  await expect(page.getByRole("heading", { level: 1, name: "Réservations" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nouvelle saisie" })).toHaveCount(0);
  const rows = page.getByTestId("booking-rows").getByRole("listitem");
  await expect(rows.first()).toBeVisible();
  await expect(page.getByTestId("booking-rows")).not.toContainText("MAD");
  // Filter: Airbnb only.
  await page.getByLabel("Source").selectOption("airbnb");
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/source=airbnb/);
  await expect(rows.first()).toHaveAttribute("data-source", "AIRBNB");
  await rows.first().getByRole("link").click();
  await expect(page.getByTestId("booking-detail")).toBeVisible();
  await expect(page.getByTestId("booking-ref")).toHaveText(/^HM[A-Z0-9]{8}$/);
  await expect(page.getByTestId("booking-detail")).not.toContainText("Montant");
  await expect(page.getByRole("button", { name: "Annuler la réservation" })).toHaveCount(0);
  await audit(page, "booking page (agent)");

  await page.goto("/admin/reservations/nouvelle");
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
});
