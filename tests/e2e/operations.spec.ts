import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { CONSENT_COOKIE } from "../../lib/browser-storage";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, stayDays, test } from "./fixtures";

/**
 * Field tasks in the browser, desktop and phone: an associé types a phone booking, its three tasks appear in
 * Opérations, the cleaning is given to an agent; the agent opens Mes tâches, starts the cleaning, ticks the
 * check-list, takes the required photos and finishes it (refused before the last photo). Each project books its own
 * seeded home, from day 540 (shifted per retry).
 */

const HOME = { desktop: "1112", mobile: "1113" } as Record<string, string>;
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
const jjmmaaaa = (iso: string) => iso.split("-").reverse().join("/");

test("a phone booking creates its tasks; the cleaning is given to an agent, who does it on the phone", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const home = HOME[testInfo.project.name] ?? "1112";
  const d = stayDays(testInfo, 540);

  // An associé types a phone booking.
  await signIn(page, "amine@demo.sigma.test", "/admin/reservations/nouvelle");
  await field(page, "Bien").selectOption(home);
  await field(page, "Arrivée").fill(d(0));
  await field(page, "Départ").fill(d(3));
  await field(page, "Nom du voyageur").fill("Nadia Tazi");
  await field(page, "Téléphone").fill("+212 6 98 76 54 32");
  await field(page, "Reçue par").selectOption("PHONE");
  await page.getByRole("button", { name: "Enregistrer la réservation" }).click();
  await expect(page).toHaveURL(/\/admin\/reservations\/[^/?]+\?cree=directe$/);

  // Its tasks in Opérations: linen and welcome on arrival, cleaning on departure, nobody assigned yet.
  await page.goto(`/admin/operations?du=${d(0)}&jours=7&bien=${home}`);
  await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
  const rows = page.getByTestId("task-row");
  await expect(rows).toHaveCount(3);
  await expect(page.locator(`[data-testid=task-day][data-day="${d(0)}"] [data-testid=task-row]`)).toHaveCount(2);
  const cleaning = page.locator(`[data-testid=task-day][data-day="${d(3)}"] [data-testid=task-row][data-type=CLEANING]`);
  await expect(cleaning).toContainText("11:00–15:00");
  await expect(cleaning.getByTestId("task-assignee")).toContainText("Non affectée");
  await audit(page, "operations");
  expect(await noSideScroll(page)).toBe(true);

  // The cleaning's page: assigned to Youssef (agent).
  await cleaning.getByRole("link", { name: /Ménage après départ/ }).click();
  await expect(page).toHaveURL(/\/admin\/operations\/[^/?]+$/);
  const taskUrl = new URL(page.url()).pathname;
  await expect(page.getByTestId("task-when")).toHaveText(`${jjmmaaaa(d(3))}, 11:00–15:00`);
  await expect(page.getByTestId("task-facts")).toContainText("Nadia Tazi");
  await page.getByLabel("Affecter à").filter({ visible: true }).selectOption({ label: "Youssef (agent)" });
  await page.getByRole("button", { name: "Enregistrer l'affectation" }).click();
  await expect(page.getByRole("status")).toContainText("Tâche affectée.");
  await expect(page.getByTestId("task-facts").getByTestId("task-assignee")).toHaveText("Youssef");
  await audit(page, "task page (associé)");

  // The agent, on their phone (or computer): Mes tâches on the departure day.
  await page.context().clearCookies();
  await page.context().addCookies([{ name: CONSENT_COOKIE, value: "ok", url: baseURL! }]);
  await signIn(page, "agent1@demo.sigma.test", `/admin/mes-taches?jour=${d(3)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Mes tâches" })).toBeVisible();
  const mine = page.locator(`[data-testid=task-row][data-listing="${home}"][data-type=CLEANING]`);
  await expect(mine).toHaveCount(1);
  await expect(mine.getByTestId("task-status")).toHaveText("À faire");
  await audit(page, "my tasks");
  expect(await noSideScroll(page)).toBe(true);
  // Opérations isn't for agents.
  await expect(page.getByRole("link", { name: "Opérations" })).toHaveCount(0);

  await mine.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`${taskUrl.replace("/admin/operations/", "/admin/mes-taches/")}$`));
  await page.getByRole("button", { name: "Commencer la tâche" }).click();
  await expect(page.getByRole("status")).toContainText("Tâche commencée.");
  const items = page.getByTestId("checklist-item");
  const count = await items.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i += 1) {
    const box = items.nth(i).getByRole("checkbox");
    await box.check();
    await expect(box).toBeChecked();
  }
  await expect(page.locator("[data-testid=checklist-item][data-checked=true]")).toHaveCount(count);

  // Every item ticked, photos missing: refused.
  await page.getByRole("button", { name: "Terminer la tâche" }).click();
  await expect(page.getByTestId("work-error")).toContainText("obligatoire");

  const photoInputs = page.locator('input[type=file][capture="environment"]');
  const photos = await photoInputs.count();
  expect(photos).toBeGreaterThan(0);
  for (let i = 0; i < photos; i += 1) {
    await photoInputs.nth(i).setInputFiles({ name: `piece-${i}.png`, mimeType: "image/png", buffer: PNG });
    await expect(page.getByRole("status")).toContainText("Photo ajoutée.");
    await expect(page.getByText(/^Photo ajoutée \(1\)$/)).toHaveCount(i + 1);
  }
  await expect(page.getByText("Photo obligatoire", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: /photo 1$/ }).first()).toBeVisible();
  await audit(page, "task page (agent)");
  expect(await noSideScroll(page)).toBe(true);

  await page.getByRole("button", { name: "Terminer la tâche" }).click();
  await expect(page.getByRole("status")).toContainText("Tâche terminée. Merci !");
  await expect(page.getByTestId("task-facts").getByTestId("task-status")).toHaveText("Fait");
  await expect(page.getByRole("button", { name: "Terminer la tâche" })).toHaveCount(0);

  // An agent can't open a task that isn't theirs: the welcome of the same stay is unassigned.
  await page.goto(`/admin/mes-taches?jour=${d(0)}`);
  await expect(page.locator(`[data-testid=task-row][data-listing="${home}"]`)).toHaveCount(0);
});
