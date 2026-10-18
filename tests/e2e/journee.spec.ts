import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { CONSENT_COOKIE } from "../../lib/browser-storage";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, test } from "./fixtures";

/**
 * « Ma journée » offline, desktop and phone: an associé gives an agent a cleaning for today; the agent opens Ma journée
 * online (the service worker keeps the page), the network goes away, and the agent starts the task, ticks the
 * check-list, takes the required photos, writes a remark and finishes it — all queued on the device, still there after
 * reloading the page offline. Back online, everything is sent: the server has the task done with its photos. Signing
 * out removes the offline data. Each project uses its own seeded home.
 */

const HOME = { desktop: "1114", mobile: "1115" } as Record<string, string>;
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

/** Fields by role and name: a <label> wrapping a <select> also holds the options' text. */
const select = (page: Page, name: string) => page.getByRole("combobox", { name, exact: true }).filter({ visible: true });
const field = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true }).filter({ visible: true });
const marrakechToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

test("an agent does a task offline in Ma journée; it is sent when the network comes back", async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const home = HOME[testInfo.project.name] ?? "1114";

  // An associé gives Youssef a cleaning today.
  await signIn(page, "amine@demo.sigma.test", "/admin/operations/nouvelle");
  await select(page, "Bien").selectOption(home);
  await select(page, "Type").selectOption("CLEANING");
  await field(page, "Date").fill(marrakechToday());
  await field(page, "Début").fill("10:00");
  await field(page, "Fin").fill("12:00");
  await select(page, "Affecter à").selectOption({ label: "Youssef (agent)" });
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await expect(page).toHaveURL(/\/admin\/operations\/[^/?]+\?cree=1$/);
  const taskId = new URL(page.url()).pathname.split("/").pop()!;

  // The agent opens Ma journée with network: the day is stored on the device, the page kept for offline use.
  await context.clearCookies();
  await context.addCookies([{ name: CONSENT_COOKIE, value: "ok", url: baseURL! }]);
  await signIn(page, "agent1@demo.sigma.test", "/admin/ma-journee");
  await expect(page.getByRole("heading", { level: 1, name: "Ma journée" })).toBeVisible();
  await expect(page.locator('head link[rel="manifest"]')).toHaveAttribute("href", "/equipe.webmanifest");
  const card = page.locator(`[data-testid=day-task][data-task="${taskId}"]`);
  await expect(card).toHaveAttribute("data-status", "TODO");
  await expect(page.getByTestId("network-status")).toHaveText("En ligne");
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 15_000 });
  await audit(page, "ma journée");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // No network.
  await context.setOffline(true);
  await expect(page.getByTestId("network-status")).toHaveText("Hors connexion");
  await card.getByRole("button", { name: /Ménage après départ/ }).click();
  await card.getByRole("button", { name: "Commencer la tâche" }).click();
  await expect(card).toHaveAttribute("data-status", "IN_PROGRESS");
  const items = card.getByTestId("day-item");
  const count = await items.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i += 1) {
    const box = items.nth(i).getByRole("checkbox");
    await box.check();
    await expect(box).toBeChecked();
  }
  // A required photo is missing: finishing is refused on the device already.
  await card.getByRole("button", { name: "Terminer la tâche" }).click();
  await expect(card.getByTestId("day-error")).toContainText("obligatoire");
  const photoInputs = card.locator('input[type=file][capture="environment"]');
  const photos = await photoInputs.count();
  expect(photos).toBeGreaterThan(0);
  for (let i = 0; i < photos; i += 1) {
    await photoInputs.nth(i).setInputFiles({ name: `piece-${i}.png`, mimeType: "image/png", buffer: PNG });
    await expect(card.getByText(/en attente d'envoi$/)).toHaveCount(i + 1);
  }
  await card.getByLabel("Remarques (pour l'équipe)").fill("Ampoule grillée dans la chambre");
  await card.getByRole("button", { name: "Enregistrer la remarque" }).click();
  await card.getByRole("button", { name: "Terminer la tâche" }).click();
  await expect(card).toHaveAttribute("data-status", "DONE");
  await expect(card.getByRole("status")).toContainText("au retour du réseau");
  const queued = Number(await page.getByTestId("pending-count").getAttribute("data-count"));
  expect(queued).toBe(1 + count + photos + 2);

  // Still offline, the page opens again from the device, with the queued changes.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Ma journée" })).toBeVisible();
  await expect(page.getByTestId("network-status")).toHaveText("Hors connexion");
  await expect(card).toHaveAttribute("data-status", "DONE");
  await expect(page.getByTestId("pending-count")).toHaveAttribute("data-count", String(queued));

  // Network back: everything is sent, in order.
  await context.setOffline(false);
  await expect(page.getByTestId("pending-count")).toHaveAttribute("data-count", "0", { timeout: 30_000 });
  await expect(page.getByTestId("pending-count")).toHaveText("Tout est envoyé");
  await expect(page.getByTestId("sync-conflicts")).toHaveCount(0);

  // The server's view: done, with the photos and the remark.
  await page.goto(`/admin/mes-taches/${taskId}`);
  await expect(page.getByTestId("task-facts").getByTestId("task-status")).toHaveText("Fait");
  await expect(page.getByTestId("task-field-notes")).toHaveText("Ampoule grillée dans la chambre");
  await expect(page.locator("[data-testid=checklist-item][data-checked=true]")).toHaveCount(count);
  await expect(page.getByText(/^Photo ajoutée \(1\)$/)).toHaveCount(photos);

  // Signing out removes the offline data from the device.
  await page.goto("/admin/ma-journee");
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Déconnexion" }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/login/);
  const left = await page.evaluate(async () => ({
    caches: (await caches.keys()).filter((k) => k.startsWith("sigma-journee")),
    dbs: ((await indexedDB.databases?.()) ?? []).map((d) => d.name).filter((n) => n === "sigma-journee"),
    workers: (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope),
  }));
  expect(left).toEqual({ caches: [], dbs: [], workers: [] });
});
