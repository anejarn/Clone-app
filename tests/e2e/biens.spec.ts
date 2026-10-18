import AxeBuilder from "@axe-core/playwright";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** Biens in the browser, desktop and phone: an admin creates a listing, adds a photo, edits and publishes it. */

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function signInAdmin(page: Page) {
  await page.goto("/login?next=%2Fadmin%2Fbiens");
  await page.getByLabel("Adresse e-mail").fill("amine@demo.sigma.test");
  await page.getByLabel("Mot de passe").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByLabel("Code à 6 chiffres").fill(totpCode(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).toHaveURL(/\/admin\/biens$/);
}

async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Visible fields only: the router keeps pages visited before (hidden) in the document, forms included. */
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });

test("an admin creates a listing with a photo, edits and publishes it, and sees the 80-14 alert", async ({ page }, testInfo) => {
  // One guest, in Hivernage: the other suites count the seeded homes for two guests and rank neighbourhoods by
  // their number of listings (Hivernage first), so this listing changes neither.
  const title = `Studio e2e ${testInfo.project.name} ${Date.now()}`;
  await signInAdmin(page);
  await expect(page.getByRole("heading", { level: 1, name: "Biens" })).toBeVisible();
  // The seeded authorisations: one expired, some expiring soon, some missing.
  await page.getByLabel("Autorisation 80-14").selectOption({ label: "Expirée" });
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/autorisation=expiree/);
  await expect(page.getByTestId("listing-rows").locator("[data-license=EXPIRED]").first()).toHaveText("Autorisation expirée");
  expect(await noSideScroll(page)).toBe(true);

  await page.getByRole("link", { name: "Nouveau bien" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nouveau bien" })).toBeVisible();
  // The organization's default commission is proposed.
  await expect(field(page, "Commission Sigma (%)")).toHaveValue("20");
  await audit(page, "new listing form");

  // Submitting with missing fields keeps what was typed and says what to fix.
  await field(page, "Titre").fill(title);
  await page.getByRole("button", { name: "Créer le bien" }).click();
  await expect(page.getByRole("alert").first()).toContainText("Corrigez les champs signalés.");
  await expect(field(page, "Titre")).toHaveValue(title);

  await field(page, "Type de logement").selectOption({ label: "Studio" });
  await field(page, "Description").fill("Studio lumineux près du jardin Majorelle.");
  await field(page, "Voyageurs").fill("1");
  await field(page, "Chambres").fill("0");
  await field(page, "Lits").fill("1");
  await field(page, "Salles de bain").fill("1");
  await field(page, "Adresse").fill("14 rue de la Liberté");
  await field(page, "Quartier").selectOption({ label: "Hivernage" });
  // Choosing the neighbourhood fills in its coordinates.
  await expect(field(page, "Latitude")).not.toHaveValue("");
  await field(page, "Wifi").check();
  await field(page, "Climatisation").check();
  await field(page, "Règles de la maison").fill("Pas de fête\nArrivée à partir de 15 h");
  await field(page, "Propriétaire").selectOption({ index: 1 });
  await field(page, "Commission Sigma (%)").fill("18,5");
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await field(page, "Numéro d'autorisation").fill("80-14/E2E/1");
  await field(page, "Date d'expiration").fill(in30);
  await field(page, "Prix par nuit (MAD)").fill("2 400");
  await field(page, "Frais de ménage (MAD)").fill("350");
  await field(page, "Séjour minimum (nuits)").fill("2");
  await page.getByRole("button", { name: "Créer le bien" }).click();

  // The fiche: draft, commission, and the 80-14 alert.
  await expect(page).toHaveURL(/\/admin\/biens\/[^/]+\?cree=1$/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Bien créé en brouillon");
  await expect(page.getByTestId("listing-badges")).toContainText("Brouillon");
  await expect(page.getByTestId("listing-badges")).toContainText("Mandat · 18,5 %");
  await expect(page.getByTestId("license-notice")).toHaveAttribute("data-license", "EXPIRING");
  await expect(page.getByTestId("license-notice")).toContainText(/à renouveler : elle expire le \d{2}\/\d{2}\/\d{4} \(dans (29|30|31) jours\)/);
  await expect(page.getByText("2 400 MAD")).toBeVisible();

  // A photo, served to the team while the listing is a draft.
  await page.locator('input[type="file"]').setInputFiles({ name: "salon.png", mimeType: "image/png", buffer: PNG });
  const photo = page.getByTestId("photos").getByRole("img");
  await expect(photo).toHaveCount(1);
  await expect(page.getByTestId("photos")).toContainText("Couverture");
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await audit(page, "listing page");
  expect(await noSideScroll(page)).toBe(true);

  // Edit: new title, published.
  await page.getByRole("link", { name: "Modifier" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Modifier le bien" })).toBeVisible();
  await expect(field(page, "Prix par nuit (MAD)")).toHaveValue("2400");
  await expect(field(page, "Commission Sigma (%)")).toHaveValue("18,5");
  await expect(field(page, "Wifi")).toBeChecked();
  await field(page, "Titre").fill(`${title} (rénové)`);
  await field(page, "Publié sur le site").check();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(/\?modifie=1$/);
  await expect(page.getByRole("heading", { level: 1, name: `${title} (rénové)` })).toBeVisible();
  await expect(page.getByTestId("listing-badges")).toContainText("Publié");
  await expect(page.getByRole("link", { name: "Voir sur le site" })).toBeVisible();

  // Back in the list, found by its title, with its badges.
  await page.goto(`/admin/biens?q=${encodeURIComponent(title)}`);
  const row = page.getByTestId("listing-rows").getByRole("listitem");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Expire sous 60 jours");
  await expect(row).toContainText("Publié");
  expect(await noSideScroll(page)).toBe(true);
});

test("the Biens pages are not found for an agent", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill("agent1@demo.sigma.test");
  await page.getByLabel("Mot de passe").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByLabel("Code à 6 chiffres").fill(totpCode(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  for (const path of ["/admin/biens", "/admin/biens/nouveau", "/admin/biens/1000", "/admin/biens/1000/modifier"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Page introuvable" }), path).toBeVisible();
  }
});
