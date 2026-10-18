import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { DEMO_GUIDE_TOKENS, DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, stayDays, test } from "./fixtures";

/**
 * Welcome guide in the browser, desktop and phone (Lot 4a): an associé fills a home's guide with an access code,
 * reveals it, types a booking to come and creates its guide link; the guest opens the link (no account) and is told
 * when the codes will appear. A guest on the seeded stay in progress sees the codes and the Wi-Fi password and
 * switches the guide to Spanish and English. Each project uses its own seeded home, bookings from day 620.
 */

const HOME = { desktop: "1040", mobile: "1041" } as Record<string, string>;

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
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });
const jjmmaaaa = (iso: string) => iso.split("-").reverse().join("/");

test("an associé fills a home's guide, creates a stay's link; before arrival the guest sees when the codes will appear", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const home = HOME[testInfo.project.name] ?? "1040";
  const d = stayDays(testInfo, 620);
  const code = `${testInfo.project.name === "desktop" ? 7 : 8}${String(Date.now()).slice(-5)}`;

  await signIn(page, `/admin/biens/${home}/guide`);
  await expect(page.getByRole("link", { name: "Guide d'accueil", exact: true })).toHaveAttribute("aria-current", "page");
  await field(page, "Instructions d'accès (français)").fill("Sonnez à la porte bleue, la boîte à clés est à gauche.");
  await page.getByRole("button", { name: "Enregistrer le guide" }).click();
  await expect(page.getByText("Guide enregistré.")).toBeVisible();

  const add = page.getByTestId("add-code-form");
  await add.getByLabel("Type de code").selectOption("GATE");
  await add.getByLabel("Précision (facultatif)").fill(`Portail e2e ${testInfo.project.name}`);
  await add.getByLabel("Code", { exact: true }).fill(code);
  await add.getByRole("button", { name: "Ajouter le code" }).click();
  await expect(page.getByText("Code ajouté.")).toBeVisible();
  // Masked until asked; then shown (and audited).
  const row = page.getByTestId("guide-code-row").filter({ hasText: `Portail e2e ${testInfo.project.name}` });
  await expect(row.getByTestId("code-value")).toHaveText("••••••");
  await page.getByRole("button", { name: "Afficher les codes" }).click();
  await expect(row.getByTestId("code-value")).toHaveText(code);
  await expect(page.getByTestId("audit-rows")).toContainText("a affiché les codes d'accès du guide");
  expect(await noSideScroll(page)).toBe(true);
  await audit(page, "guide editor");

  // A phone booking to come, then its guide link.
  await page.goto("/admin/reservations/nouvelle");
  await field(page, "Bien").selectOption(home);
  await field(page, "Arrivée").fill(d(0));
  await field(page, "Départ").fill(d(2));
  await field(page, "Nom du voyageur").fill("Marta Gómez");
  await field(page, "Téléphone").fill("+34 600 000 000");
  await field(page, "Reçue par").selectOption("WHATSAPP");
  await page.getByRole("button", { name: "Enregistrer la réservation" }).click();
  await expect(page).toHaveURL(/\/admin\/reservations\/[^/?]+\?cree=directe$/);
  const card = page.getByTestId("guide-link-card");
  await card.getByRole("button", { name: "Créer le lien du guide" }).click();
  await expect(card.getByText("Lien du guide créé.")).toBeVisible();
  const link = await card.getByTestId("guide-link").inputValue();
  expect(link).toMatch(/\/guide\/[A-Za-z0-9_-]{43}$/);
  await expect(card.getByRole("link", { name: "Partager sur WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/34600000000\?text=/);
  await card.getByRole("button", { name: "Copier le lien" }).click();
  await expect(card.getByText("Lien copié").or(card.getByText("Copier le lien"))).toBeVisible();

  // The guest, without an account.
  const guest = await context.browser()!.newContext({ locale: "fr-FR", ...(testInfo.project.use.viewport && { viewport: testInfo.project.use.viewport }) });
  const g = await guest.newPage();
  await g.goto(new URL(link).pathname);
  await expect(g.getByTestId("guest-guide")).toHaveAttribute("data-state", "BEFORE");
  await expect(g.getByRole("heading", { level: 1 })).toHaveText("Bienvenue, Marta");
  await expect(g.getByTestId("guide-codes")).toContainText(`Les codes seront affichés ici à partir du ${jjmmaaaa(d(0))} à 15:00`);
  await expect(g.getByTestId("guide-code")).toHaveCount(0);
  await expect(g.getByText("Sonnez à la porte bleue, la boîte à clés est à gauche.")).toBeVisible();
  expect(await g.content()).not.toContain(code);
  await guest.close();
});

test("a guest during the stay sees the codes and the Wi-Fi, and reads the guide in Spanish and English", async ({ page }) => {
  await page.goto(`/guide/${DEMO_GUIDE_TOKENS.current}`);
  const guide = page.getByTestId("guest-guide");
  await expect(guide).toHaveAttribute("data-state", "OPEN");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByTestId("guide-code").first()).toBeVisible();
  await expect(page.getByTestId("guide-code").first()).toContainText(/\d{3,}/);
  await expect(page.getByTestId("wifi-password")).toHaveText(/^marrakech-/);
  await expect(page.getByTestId("guide-emergency")).toContainText("19");
  await expect(page.getByTestId("guide-contact-bar").getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+$/);
  // No cookie notice on the guide.
  await expect(page.getByTestId("cookie-notice")).toHaveCount(0);
  expect(await noSideScroll(page)).toBe(true);
  await audit(page, "guest guide");

  await page.getByRole("navigation", { name: "Langue" }).getByRole("link", { name: "Español" }).click();
  await expect(page).toHaveURL(/\?lang=es$/);
  await expect(guide).toHaveAttribute("lang", "es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { name: "Códigos de acceso" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bienvenido");

  await page.getByRole("navigation", { name: "Idioma" }).getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\?lang=en$/);
  await expect(page.getByRole("heading", { name: "Access codes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "House rules" })).toBeVisible();
  await expect(page.getByTestId("guide-code").first()).toBeVisible();
});

test("a stay to come shows when the codes will be available, in the guest's language", async ({ page }) => {
  await page.goto(`/guide/${DEMO_GUIDE_TOKENS.upcoming}`);
  await expect(page.getByTestId("guest-guide")).toHaveAttribute("data-state", "BEFORE");
  // The seeded booking's language is English.
  await expect(page.getByTestId("guide-codes")).toContainText(/The codes will appear here from \d{2}\/\d{2}\/\d{4} at 15:00/);
  await expect(page.getByTestId("codes-countdown")).toContainText("Available in");
  await expect(page.getByTestId("guide-code")).toHaveCount(0);
});

test("an unknown link is a 404 in every guest language", async ({ page }) => {
  const r = await page.goto(`/guide/${"z".repeat(43)}`);
  expect(r?.status()).toBe(404);
  await expect(page.getByTestId("guide-not-found")).toContainText("Guide introuvable");
  expect(r?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByTestId("guide-not-found")).toContainText("Guía no encontrada");
  await expect(page.getByTestId("guide-not-found")).toContainText("Guide not found");
});
