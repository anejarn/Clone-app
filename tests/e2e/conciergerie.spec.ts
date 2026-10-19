import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page, TestInfo } from "@playwright/test";
import { DEMO_GUIDE_TOKENS, DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, test } from "./fixtures";

/**
 * Conciergerie (Lot 4b) in the browser. On a phone, a guest of the seeded stay in progress opens their guide, asks for
 * a hammam and sees the request's status. On a desktop, an associé creates a service, a guest asks for it from the
 * guide, the associé finds the request, opens the partner's WhatsApp link, marks it sent, confirms it, records the
 * cash payment, and finds the conciergerie on the dashboard. Requests are for tomorrow (Marrakech), always inside the
 * demo stay (it ends two days from now at the earliest).
 */

const TZ = "Africa/Casablanca";
/** yyyy-MM-dd `n` days from today in Marrakech. */
const localDay = (n: number) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
  return new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
};
const jjmmaaaa = (iso: string) => iso.split("-").reverse().join("/");
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function signIn(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Adresse e-mail").fill("amine@demo.sigma.test");
  await page.getByLabel("Mot de passe").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByLabel("Code à 6 chiffres").fill(totpCode(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, "\\$&")}$`));
}

/** The guest asks for `title` from the demo guide, for tomorrow at `time`; returns the guide page. */
async function guestAsks(page: Page, title: string, time: string, persons: string) {
  await page.goto(`/guide/${DEMO_GUIDE_TOKENS.current}`);
  const service = page.getByTestId("guest-service").filter({ hasText: title });
  await service.getByRole("button", { name: `Demander — ${title}` }).click();
  const f = service.getByTestId("service-request-form");
  await f.getByLabel("Date").fill(localDay(1));
  await f.getByLabel("Heure").fill(time);
  await f.getByLabel("Nombre de personnes").fill(persons);
  await f.getByLabel("Votre téléphone (WhatsApp de préférence)").fill("+34 600 000 000");
  await f.getByLabel("Précisions (facultatif)").fill("Demande e2e");
  await expect(f.getByTestId("service-estimate")).toContainText("Paiement sur place ou à la conciergerie");
  await f.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(service.getByTestId("service-request-sent")).toContainText(/Demande envoyée.*Réf\. [A-Z0-9]{6}/);
  const row = page.getByTestId("guest-request").filter({ hasText: title }).filter({ hasText: `Le ${jjmmaaaa(localDay(1))} à ${time}` });
  await expect(row).toHaveCount(1);
  return row;
}

test("on a phone, a guest asks for a hammam from the welcome guide and follows its status", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the guest's flow is checked on a phone");
  await page.goto(`/guide/${DEMO_GUIDE_TOKENS.current}`);
  const services = page.locator("#services");
  await expect(services.getByRole("heading", { name: "Services" })).toBeVisible();
  const hammam = page.getByTestId("guest-service").filter({ hasText: "Hammam traditionnel et gommage" });
  await expect(hammam.getByTestId("service-price")).toHaveText("300 MAD par personne");
  // Never a partner's price, margin or name.
  const html = await page.content();
  for (const secret of ["220 MAD", "Hammam des Jardins", "+212600000105", "marge"]) expect(html).not.toContain(secret);
  // The seeded requests of this stay: a hammam confirmed and paid, a transfer received.
  await expect(page.getByTestId("guest-requests")).toContainText("Confirmée");

  await hammam.getByRole("button", { name: "Demander — Hammam traditionnel et gommage" }).click();
  const f = hammam.getByTestId("service-request-form");
  await f.getByLabel("Nombre de personnes").fill("2");
  await f.getByLabel("Massage 30 min").check();
  // 2 × 300 + 2 × 250
  await expect(f.getByTestId("service-estimate")).toContainText(`1${" "}100 MAD`);
  // Too soon or outside the stay: told in the guest's language.
  await f.getByLabel("Date").fill(localDay(-30));
  await f.getByLabel("Heure").fill("18:00");
  await f.getByLabel("Votre téléphone (WhatsApp de préférence)").fill("+34 600 000 000");
  await f.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(hammam.getByText("Choisissez une date pendant votre séjour.")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await audit(page, "guide services form");

  await f.getByLabel("Date").fill(localDay(1));
  await f.getByLabel("Massage 30 min").check();
  await f.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(hammam.getByTestId("service-request-sent")).toContainText("Demande envoyée");
  const row = page.getByTestId("guest-request").filter({ hasText: "Hammam traditionnel et gommage" }).filter({ hasText: `Le ${jjmmaaaa(localDay(1))} à 18:00` });
  await expect(row.getByTestId("guest-request-status")).toHaveText("Reçue");
  await expect(row).toContainText(`Total : 1${" "}100 MAD · À régler sur place ou à la conciergerie`);
  await expect(row).toContainText("Massage 30 min");

  // In Spanish.
  await page.getByRole("navigation", { name: "Langue" }).getByRole("link", { name: "Español" }).click();
  await expect(page.getByRole("heading", { name: "Sus solicitudes" })).toBeVisible();
  await expect(page.getByTestId("guest-request").filter({ hasText: `${jjmmaaaa(localDay(1))} a las 18:00` }).getByTestId("guest-request-status")).toHaveText("Recibida");
});

test("on a desktop, an associé creates a service, sends the guest's request to the partner, confirms it and records the cash payment", async ({ page, context }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the back-office flow is checked on a desktop");
  test.setTimeout(120_000);
  const title = `Balade en calèche e2e ${Date.now().toString(36)}`;

  await signIn(page, "/admin/conciergerie/gestion/services/nouveau");
  const f = page.getByTestId("service-form");
  await f.getByLabel("Catégorie", { exact: true }).selectOption("ACTIVITY");
  await f.getByLabel("Partenaire", { exact: true }).selectOption({ label: "Atlas Autos (démo)" });
  await f.getByLabel("Titre (français)", { exact: true }).fill(title);
  await f.getByLabel("Description (français)", { exact: true }).fill("Tour de la médina en calèche, une heure.");
  await f.getByLabel("Tarification", { exact: true }).selectOption("PER_PERSON");
  await f.getByLabel("Prix de vente (MAD)", { exact: true }).fill("200");
  await f.getByLabel("Prix partenaire (MAD)", { exact: true }).fill("150");
  await expect(f.getByTestId("margin-preview")).toHaveText("Marge : 50 MAD (25 % du prix de vente)");
  await f.getByLabel("Délai de prévenance (heures)", { exact: true }).fill("2");
  await f.getByRole("button", { name: "Créer le service" }).click();
  await expect(page).toHaveURL(/\/admin\/conciergerie\/gestion\/services\/[^/?]+\?cree=1$/);
  await expect(page.getByText("Service créé.")).toBeVisible();
  await page.goto("/admin/conciergerie?categorie=activite");
  const row = page.getByTestId("service-row").filter({ hasText: title });
  await expect(row.getByTestId("service-margin")).toHaveText("50 MAD (25 %)");
  await audit(page, "catalogue");

  // The guest of the stay in progress asks for it, without an account.
  const guest = await (context.browser() as Browser).newContext({ locale: "fr-FR", viewport: { width: 1280, height: 900 } });
  const g = await guest.newPage();
  const asked = await guestAsks(g, title, "17:00", "2");
  await expect(asked.getByTestId("guest-request-status")).toHaveText("Reçue");

  // The associé finds it, sends it to the partner and follows it.
  await page.goto("/admin/conciergerie/demandes?statut=nouvelles");
  await page.getByTestId("request-row").filter({ hasText: title }).getByRole("link").click();
  await expect(page.getByTestId("request-when")).toHaveText(`${jjmmaaaa(localDay(1))} à 17:00`);
  await expect(page.getByTestId("request-sale-total")).toHaveText("400 MAD");
  await expect(page.getByTestId("request-margin")).toHaveText("100 MAD (25 %)");
  const send = page.getByTestId("send-to-partner");
  await expect(send.getByRole("link", { name: "Ouvrir WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/212600000101\?text=Bonjour%20Atlas%20Autos/);
  await expect(send.getByRole("link", { name: "Ouvrir l'e-mail" })).toHaveAttribute("href", /^mailto:atlas-autos@demo\.sigma\.test\?subject=/);
  await expect(send.getByTestId("partner-message")).toHaveValue(new RegExp(`Service : ${title}[\\s\\S]*Votre prix : 300 MAD`));
  await expect(send.getByTestId("partner-message")).not.toHaveValue(/400/);
  await send.getByRole("button", { name: "Marquer comme transmise (WhatsApp)" }).click();
  await expect(page.getByTestId("request-status").first()).toHaveText("Transmise au partenaire");
  await page.getByRole("button", { name: "Confirmer (le partenaire a accepté)" }).click();
  await expect(page.getByTestId("request-status").first()).toHaveText("Confirmée");
  const pay = page.getByTestId("payment-form");
  await pay.getByLabel("Moyen de paiement").selectOption("CASH");
  await pay.getByRole("button", { name: "Enregistrer le paiement" }).click();
  await expect(page.getByTestId("request-paid")).toContainText("Espèces");
  await expect(page.getByTestId("audit-rows")).toContainText("a enregistré le paiement : 400 MAD, espèces");
  await expect(page.getByTestId("audit-rows")).toContainText("a transmis la demande au partenaire (WhatsApp)");
  await audit(page, "request detail");

  // The guest sees it confirmed and paid.
  await g.reload();
  const confirmed = g.getByTestId("guest-request").filter({ hasText: title });
  await expect(confirmed.getByTestId("guest-request-status")).toHaveText("Confirmée");
  await expect(confirmed).toContainText("Payé");
  await guest.close();

  // The dashboard: new requests and the month's margin (at least the seeded paid hammam of today: 2 × 80 MAD).
  await page.goto("/admin");
  await expect(page.getByTestId("count-service-requests")).toBeVisible();
  await expect(page.getByTestId("concierge-margin-month").locator("[data-value]")).toHaveText(/^\d[\d ]*(,\d\d)? MAD$/);
  const margin = Number((await page.getByTestId("concierge-margin-month").locator("[data-value]").textContent())!.replace(/[^\d,]/g, "").replace(",", "."));
  expect(margin).toBeGreaterThanOrEqual(localDay(1).slice(0, 7) === localDay(0).slice(0, 7) ? 260 : 160);
});
