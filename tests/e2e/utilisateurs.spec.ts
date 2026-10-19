import AxeBuilder from "@axe-core/playwright";
import { CONSENT_COOKIE } from "../../lib/browser-storage";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { base32Decode, totpCode } from "../support/totp";
import { expect, PASSWORD, test, uniqueEmail } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Utilisateurs in the browser, desktop and phone: an admin invites an agent, the agent accepts through the link,
 * enrolls double authentification and lands in the back-office with the agent's sections only; the admin then
 * changes the agent's role, which signs the agent out.
 */

async function signInAdmin(page: Page) {
  await page.goto("/login?next=%2Fadmin%2Futilisateurs");
  await page.getByLabel("Adresse e-mail").fill("amine@demo.sigma.test");
  await page.getByLabel("Mot de passe").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByLabel("Code à 6 chiffres").fill(totpCode(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).toHaveURL(/\/admin\/utilisateurs$/);
}

async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    label,
  ).toEqual([]);
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const nav = (page: Page) => page.getByRole("navigation", { name: "Espace équipe" });
/** Visible fields only: the router keeps pages visited before (hidden) in the document, forms included. */
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });

test("an admin invites an agent, who accepts, enrolls 2FA and gets the agent sections; a role change signs them out", async ({
  page,
  browser,
  baseURL,
}) => {
  // A long journey: two browsers, enrollment and four accessibility audits.
  test.setTimeout(120_000);
  const email = uniqueEmail("agent-invite");
  await signInAdmin(page);
  await expect(page.getByRole("heading", { level: 1, name: "Utilisateurs" })).toBeVisible();
  // The seeded team is listed, with roles and 2FA status.
  await expect(page.locator('[data-user-email="amine@demo.sigma.test"]')).toContainText("Associé (admin)");
  await expect(page.locator('[data-user-email="felicia@demo.sigma.test"] [data-two-factor=off]')).toBeVisible();
  await audit(page, "users list");
  expect(await noSideScroll(page)).toBe(true);

  // Role filter.
  await page.getByLabel("Rôle").filter({ visible: true }).selectOption({ label: "Agent terrain" });
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/role=agent/);
  await expect(page.locator('[data-user-email="agent1@demo.sigma.test"]')).toBeVisible();
  await expect(page.locator('[data-user-email="amine@demo.sigma.test"]')).toHaveCount(0);

  // Invite.
  await page.getByRole("link", { name: "Inviter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inviter" })).toBeVisible();
  await field(page, "Adresse e-mail").fill(email);
  await page.getByRole("radio", { name: /Agent terrain/ }).check();
  await field(page, "Téléphone WhatsApp (facultatif)").fill("06 12 34 56 78");
  await audit(page, "invite form");
  await page.getByRole("button", { name: "Créer l'invitation" }).click();
  const card = page.getByTestId("invitation-link");
  await expect(card).toContainText(`Invitation prête pour ${email}`);
  const link = await card.getByLabel("Lien d'invitation").inputValue();
  expect(link).toMatch(new RegExp(`^${baseURL}/invitation/[A-Za-z0-9_-]{43}$`));
  await expect(card.getByRole("link", { name: "Partager sur WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/212612345678\?text=/);
  expect(await noSideScroll(page)).toBe(true);

  // The invitee, in their own browser.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
  const invitee = await browser.newContext({
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    locale: "fr-FR",
    baseURL,
  });
  await invitee.addCookies([{ name: CONSENT_COOKIE, value: "ok", url: baseURL! }]);
  const agent = await invitee.newPage();
  await agent.goto(link);
  await expect(agent.getByRole("heading", { level: 1, name: "Rejoindre Sigma" })).toBeVisible();
  await expect(agent.getByText(email)).toBeVisible();
  await audit(agent, "invitation page");
  await field(agent, "Nom et prénom").fill("Recrue Invitée");
  await field(agent, "Mot de passe").fill(PASSWORD);
  await agent.getByRole("button", { name: "Créer mon compte et rejoindre l'équipe" }).click();
  await expect(agent).toHaveURL(/\/admin\/securite$/);

  await field(agent, "Mot de passe").fill(PASSWORD);
  await agent.getByRole("button", { name: "Commencer" }).click();
  const secret = base32Decode((await agent.getByTestId("totp-secret").textContent())!);
  await field(agent, "Code à 6 chiffres").fill(totpCode(secret));
  await agent.getByRole("button", { name: "Activer" }).click();
  await expect(agent.getByTestId("two-factor-on")).toBeVisible();
  await agent.getByRole("link", { name: "Accéder à l'espace équipe" }).click();
  await expect(agent.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
  await expect(nav(agent).getByRole("link", { name: /Calendrier/ })).toBeAttached();
  await expect(nav(agent).getByRole("link", { name: /Biens/ })).toHaveCount(0);
  await expect(nav(agent).getByRole("link", { name: /Utilisateurs/ })).toHaveCount(0);
  await agent.goto("/admin/utilisateurs");
  await expect(agent.getByRole("heading", { name: "Page introuvable" })).toBeVisible();

  // The link worked once.
  await agent.goto(link);
  await expect(agent.getByRole("heading", { name: /Bienvenue chez Sigma/ })).toBeVisible();

  // The admin finds the new agent (search: the list is paginated, 50 members a page) and makes them an owner.
  await page.goto(`/admin/utilisateurs?q=${encodeURIComponent(email)}`);
  const row = page.locator(`[data-user-email="${email}"]`);
  await expect(row.locator("[data-role=AGENT]")).toBeVisible();
  await expect(row.locator("[data-two-factor=on]")).toBeVisible();
  await row.getByRole("link", { name: "Recrue Invitée" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Recrue Invitée" })).toBeVisible();
  await audit(page, "user page");
  await field(page, "Nouveau rôle").selectOption({ label: "Propriétaire" });
  await page.getByRole("button", { name: "Changer le rôle" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Rôle modifié" })).toBeVisible();
  await expect(page.getByTestId("user-badges").locator("[data-role=OWNER]")).toBeVisible();
  await expect(page.getByTestId("audit-rows").filter({ visible: true })).toContainText("agent terrain → propriétaire");
  expect(await noSideScroll(page)).toBe(true);

  // The former agent's session is gone.
  await agent.goto("/admin");
  await expect(agent).toHaveURL(/\/login/);
  await invitee.close();
});
