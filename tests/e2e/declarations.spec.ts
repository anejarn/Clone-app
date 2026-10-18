import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { CONSENT_COOKIE } from "../../lib/browser-storage";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, test } from "./fixtures";

/**
 * Travellers' declaration (Lot 5) in the browser.
 * - Phone: an associé types a stay arriving today and gives its welcome to Youssef (agent); the agent opens the task,
 *   « Saisir les voyageurs », records two travellers, the first with a photo of the passport (camera input).
 * - Desktop: an associé types a stay arriving today; the dashboard flags it as not declared; the associé records the
 *   traveller, exports the day's CSV (BOM, « ; », JJ/MM/AAAA), marks the stay declared (the alert goes), and reads the
 *   taxe de séjour on the booking (the seed's demo rate: 10 MAD a taxable guest a night).
 * Each project (and retry) uses its own seeded home, free today and tomorrow.
 */

const HOMES = { desktop: ["1007", "1009"], mobile: ["1008", "1015"] } as Record<string, string[]>;
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
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });
const marrakechDay = (n = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + n * 86_400_000));
const jjmmaaaa = (iso: string) => iso.split("-").reverse().join("/");

/** Types a direct stay of `nights` nights from today on `home`, for `adults` adults; returns its id. */
async function typeStay(page: Page, home: string, guest: string, adults: number, nights = 2) {
  await page.goto("/admin/reservations/nouvelle");
  await field(page, "Bien").selectOption(home);
  await field(page, "Arrivée").fill(marrakechDay(0));
  await field(page, "Départ").fill(marrakechDay(nights));
  await field(page, "Adultes").fill(String(adults));
  await field(page, "Nom du voyageur").fill(guest);
  await field(page, "Téléphone").fill("+33 6 00 00 00 00");
  await field(page, "Reçue par").selectOption("WHATSAPP");
  await page.getByRole("button", { name: "Enregistrer la réservation" }).click();
  await expect(page).toHaveURL(/\/admin\/reservations\/[^/?]+\?cree=directe$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

async function fillTraveler(form: ReturnType<Page["getByTestId"]>, t: { last: string; first: string; sex: "M" | "F"; birth: string; nationality: string; doc: string }) {
  await form.getByLabel("Nom", { exact: true }).fill(t.last);
  await form.getByLabel("Prénom", { exact: true }).fill(t.first);
  await form.getByLabel("Sexe", { exact: true }).selectOption(t.sex);
  await form.getByLabel("Date de naissance", { exact: true }).fill(t.birth);
  await form.getByLabel("Nationalité", { exact: true }).selectOption(t.nationality);
  await form.getByLabel("Type de pièce", { exact: true }).selectOption("PASSPORT");
  await form.getByLabel("Numéro de la pièce", { exact: true }).fill(t.doc);
}

test("on the phone, the agent of a check-in records two travellers, the first with a photo of the passport", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone journey");
  test.setTimeout(120_000);
  const home = HOMES.mobile[testInfo.retry % 2];
  const today = marrakechDay(0);

  // An associé types the stay and gives its welcome to Youssef.
  await signIn(page, "amine@demo.sigma.test", "/admin/reservations/nouvelle");
  await typeStay(page, home, "Famille Demo-Test", 2);
  await page.goto(`/admin/operations?du=${today}&jours=1&bien=${home}`);
  const welcome = page.locator(`[data-testid=task-day][data-day="${today}"] [data-testid=task-row][data-type=CHECKIN]`);
  await welcome.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/admin\/operations\/[^/?]+$/);
  const taskId = new URL(page.url()).pathname.split("/").pop()!;
  await page.getByLabel("Affecter à").filter({ visible: true }).selectOption({ label: "Youssef (agent)" });
  await page.getByRole("button", { name: "Enregistrer l'affectation" }).click();
  await expect(page.getByRole("status")).toContainText("Tâche affectée.");

  // The agent, on the phone.
  await page.context().clearCookies();
  await page.context().addCookies([{ name: CONSENT_COOKIE, value: "ok", url: baseURL! }]);
  await signIn(page, "agent1@demo.sigma.test", `/admin/mes-taches/${taskId}`);
  await expect(page.getByTestId("task-travelers")).toBeVisible();
  // Déclarations isn't for agents.
  await expect(page.getByRole("link", { name: "Déclarations" })).toHaveCount(0);
  await page.getByRole("link", { name: "Saisir les voyageurs" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/mes-taches/${taskId}/voyageurs$`));
  await expect(page.getByTestId("traveler-counts")).toContainText("0 adulte enregistré sur 2 annoncés");

  // First traveller, with the passport photographed (the camera input).
  let form = page.getByTestId("traveler-form");
  await fillTraveler(form, { last: "DEMO-TEST", first: "Alpha", sex: "F", birth: "1985-06-15", nationality: "FR", doc: "TEST000101" });
  const camera = form.locator('input[type=file][capture="environment"]');
  await expect(camera).toHaveCount(1);
  await camera.setInputFiles({ name: "passeport.png", mimeType: "image/png", buffer: PNG });
  await form.getByRole("button", { name: "Enregistrer le voyageur" }).click();
  await expect(page.getByRole("status")).toContainText("Voyageur enregistré.");
  await expect(page.getByTestId("traveler-row")).toHaveCount(1);
  await expect(page.getByTestId("traveler-documents")).toHaveText("1 photo de la pièce enregistrée");
  // The agent never gets a link to the photo.
  await expect(page.getByTestId("traveler-document-link")).toHaveCount(0);

  // Second traveller.
  await page.getByRole("button", { name: "Ajouter un voyageur" }).click();
  form = page.getByTestId("traveler-form");
  await fillTraveler(form, { last: "DEMO-TEST", first: "Bravo", sex: "M", birth: "1983-02-01", nationality: "ES", doc: "TEST000102" });
  await form.getByRole("button", { name: "Enregistrer le voyageur" }).click();
  await expect(page.getByTestId("traveler-row")).toHaveCount(2);
  await expect(page.getByTestId("traveler-counts")).toContainText("2 adultes enregistrés sur 2 annoncés");
  await expect(page.getByTestId("traveler-row").nth(1)).toContainText("DEMO-TEST Bravo");
  await expect(page.getByTestId("traveler-row").nth(1)).toContainText("Espagne");
  expect(await noSideScroll(page)).toBe(true);
  await audit(page, "check-in travellers (agent)");
});

test("on a computer, an associé records a traveller, exports the CSV, marks the stay declared and reads its taxe de séjour", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop journey");
  test.setTimeout(120_000);
  const home = HOMES.desktop[testInfo.retry % 2];
  const today = marrakechDay(0);
  const guest = `Voyageur Demo ${testInfo.retry}`;

  await signIn(page, "amine@demo.sigma.test", "/admin/reservations/nouvelle");
  const bookingId = await typeStay(page, home, guest, 2);

  // Arrived today, nothing declared: the dashboard says so (the first few, linked to Déclarations).
  await page.goto("/admin");
  const alert = page.getByTestId("undeclared-alert");
  await expect(alert).toContainText("Arrivées des dernières 24 h non déclarées");
  await expect(alert.getByRole("link", { name: "Voir les déclarations" })).toBeVisible();
  await audit(page, "dashboard with the alert");

  // The booking's page: no fiche yet; the stay's fiches.
  await page.goto(`/admin/reservations/${bookingId}`);
  await expect(page.getByTestId("booking-travelers")).toHaveText("Aucune fiche voyageur enregistrée.");
  await page.getByRole("link", { name: "Fiches voyageurs" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/declarations/${bookingId}$`));
  const form = page.getByTestId("traveler-form");
  await fillTraveler(form, { last: "DEMO-TEST", first: "Charlie", sex: "F", birth: "1979-11-30", nationality: "GB", doc: "TEST000201" });
  await form.getByLabel("Photo de la pièce d'identité (facultatif)").setInputFiles({ name: "passport.png", mimeType: "image/png", buffer: PNG });
  await form.getByRole("button", { name: "Enregistrer le voyageur" }).click();
  await expect(page.getByRole("status").first()).toContainText("Voyageur enregistré.");
  await expect(page.getByTestId("traveler-row")).toHaveCount(1);
  // The associé can open the photo (decrypted by the server).
  const docHref = await page.getByTestId("traveler-document-link").getAttribute("href");
  const doc = await page.request.get(docHref!);
  expect(doc.status()).toBe(200);
  expect(doc.headers()["cache-control"]).toContain("no-store");
  expect(Buffer.from(await doc.body()).equals(PNG)).toBe(true);
  await audit(page, "stay's fiches (associé)");

  // Déclarations: the day's arrivals, the CSV export.
  await page.goto(`/admin/declarations?du=${today}&au=${today}&bien=${home}`);
  await expect(page.getByTestId("format-warning")).toContainText("Format à valider avec la DGSN");
  await expect(page.getByTestId("undeclared-row").filter({ hasText: guest })).toHaveCount(1);
  const stay = page.locator(`[data-testid=declaration-stay][data-booking="${bookingId}"]`);
  await expect(stay.getByTestId("declaration-traveler")).toContainText("DEMO-TEST Charlie");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-csv").click()]);
  expect(download.suggestedFilename()).toBe(`declaration-voyageurs_${today}_${today}.csv`);
  const bytes = await readFile((await download.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csv = bytes.toString("utf8");
  expect(csv).toContain("N°;Nom;Prénom;Sexe;Date de naissance;");
  expect(csv).toContain(`;DEMO-TEST;Charlie;Féminin;30/11/1979;;Royaume-Uni;Passeport;TEST000201;`);
  expect(csv).toContain(`;${jjmmaaaa(today)};${jjmmaaaa(marrakechDay(2))};`);
  await audit(page, "declarations");
  expect(await noSideScroll(page)).toBe(true);

  // Declared: the stay leaves the alert.
  await stay.getByRole("button", { name: "Marquer comme déclaré" }).click();
  await expect(stay.getByRole("status")).toContainText("Déclaration enregistrée (1 voyageur).");
  await expect(stay.getByRole("button", { name: "Annuler la déclaration" })).toBeVisible();
  await expect(page.getByTestId("undeclared-row").filter({ hasText: guest })).toHaveCount(0);

  // The taxe de séjour on the booking: 1 traveller recorded + 1 adult announced, 2 nights, demo rate 10 MAD.
  await page.goto(`/admin/reservations/${bookingId}`);
  await expect(page.getByTestId("booking-travelers")).toContainText("1 fiche voyageur (1 adulte) · déclarées");
  await expect(page.getByTestId("tourist-tax-total")).toHaveText("40,00 MAD");
  await expect(page.getByTestId("tourist-tax")).toContainText("4 nuitées taxables sur 2 nuits");
  await audit(page, "booking with tax");
});

test("Paramètres show the taxe de séjour rates and the retention delay, with the warnings to confirm them", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only");
  await signIn(page, "amine@demo.sigma.test", "/admin/parametres");
  await expect(page.getByTestId("tax-warning")).toContainText("à confirmer par Sigma");
  await expect(page.getByTestId("retention-warning")).toContainText("Délai légal à confirmer par Sigma / avocat — loi 09-08, CNDP");
  await expect(page.getByTestId("org-rate").first()).toContainText("TAUX FICTIF DE DÉMONSTRATION");
  await expect(page.getByLabel("Durée de conservation après le départ (jours)")).toHaveValue("365");
  await audit(page, "paramètres");
});
