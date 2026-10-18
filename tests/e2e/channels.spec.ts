import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";
import { expect, stayDays, test } from "./fixtures";

/**
 * Calendar synchronisation (Lot 7) in the browser, desktop: an associé pastes a platform's iCal link (served by a
 * local server here; the app runs with CHANNELS_ALLOW_PRIVATE_URLS=1 in the test env only), clicks « Synchroniser
 * maintenant », sees the imported booking in the calendar, gets the red banner for an overlapping second platform,
 * copies an export link and fetches it, then marks the conflict as handled. Seeded home 1090, from day 600.
 */

const HOME = "1090";
let server: http.Server;
let base = "";
const feeds = new Map<string, string>();

const ymd = (iso: string) => iso.replaceAll("-", "");
const ics = (uid: string, from: string, to: string, summary: string) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", "BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${ymd(from)}`, `DTEND;VALUE=DATE:${ymd(to)}`, `SUMMARY:${summary}`, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = feeds.get((req.url ?? "").split("?")[0]);
    if (!body) res.writeHead(404).end();
    else res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8" }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((r) => server.close(r));
});

async function signIn(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Adresse e-mail").fill("amine@demo.sigma.test");
  await page.getByLabel("Mot de passe").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByLabel("Code à 6 chiffres").fill(totpCode(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, "\\$&")}$`));
}

test("an associé imports a platform calendar, sees the booking, the conflict banner, and fetches the export link", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop journey");
  const d = stayDays(testInfo, 600);
  const run = `${Date.now()}`;
  feeds.set(`/air-${run}.ics`, ics(`air-${run}@airbnb.com`, d(0), d(3), "Reserved"));
  feeds.set(`/bk-${run}.ics`, ics(`bk-${run}@booking.com`, d(2), d(5), "CLOSED - Not available"));

  await signIn(page, `/admin/biens/${HOME}/plateformes`);
  await expect(page.getByRole("link", { name: "Plateformes", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("À reporter dans les paramètres de chaque plateforme", { exact: false })).toBeVisible();

  // Airbnb: paste the link, read it now.
  const airbnb = page.getByTestId("feed-AIRBNB");
  await airbnb.getByLabel(/Lien iCal de la plateforme|Remplacer le lien iCal/).fill(`${base}/air-${run}.ics`);
  await airbnb.getByRole("button", { name: "Enregistrer le lien" }).click();
  await expect(airbnb.getByText("Lien enregistré : il sera lu dans la minute")).toBeVisible();
  await expect(airbnb.getByText("127.0.0.1", { exact: true })).toBeVisible();
  await airbnb.getByRole("button", { name: "Synchroniser maintenant" }).click();
  await expect(airbnb.getByText(/Calendrier lu : 1 événement\(s\), 1 créée\(s\)/)).toBeVisible();
  await expect(airbnb.getByTestId("feed-status")).toContainText("Synchronisé");

  // The imported stay is in the calendar, as an Airbnb bar on the home's row.
  await page.goto(`/admin/calendrier?du=${d(-1)}&jours=14`);
  const row = page.locator(`[data-testid=calendar-row][data-listing="${HOME}"]`);
  await expect(row.locator("[data-testid=calendar-bar][data-source=AIRBNB]").first()).toBeVisible();

  // Booking.com on overlapping nights: a conflict, and the red banner on every page.
  await page.goto(`/admin/biens/${HOME}/plateformes`);
  const booking = page.getByTestId("feed-BOOKING");
  await booking.getByLabel(/Lien iCal de la plateforme|Remplacer le lien iCal/).fill(`${base}/bk-${run}.ics`);
  await booking.getByRole("button", { name: "Enregistrer le lien" }).click();
  await expect(booking.getByText("Lien enregistré : il sera lu dans la minute")).toBeVisible();
  await booking.getByRole("button", { name: "Synchroniser maintenant" }).click();
  await expect(booking.getByText(/1 conflit\(s\)/)).toBeVisible();
  await page.goto("/admin");
  const banner = page.getByTestId("sync-banner");
  await expect(banner).toContainText(/doubles? réservations? à résoudre/);

  // Copy Airbnb's export link and fetch it: Booking.com's nights (the conflict) are busy for Airbnb, nothing personal.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/admin/biens/${HOME}/plateformes`);
  const exportUrl = await airbnb.getByTestId("export-url").inputValue();
  expect(exportUrl).toMatch(/\/ical\/[A-Za-z0-9_-]{43}\.ics$/);
  await airbnb.getByRole("button", { name: "Copier le lien" }).click();
  await expect(airbnb.getByText("Lien copié")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(exportUrl);
  const res = await page.request.get(exportUrl);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
  const body = await res.text();
  expect(body).toContain(`DTSTART;VALUE=DATE:${ymd(d(2))}`);
  expect(body).toContain("SUMMARY:Sigma – indisponible");
  expect(body).not.toContain(`air-${run}`);

  // The conflicts page; marked as handled, the banner goes.
  await banner.getByRole("link", { name: /réservations? à résoudre/ }).click();
  await expect(page).toHaveURL(/\/admin\/synchronisation\/conflits$/);
  const conflict = page.getByTestId("conflict").filter({ hasText: `bk-${run}@booking.com` });
  await expect(conflict).toContainText("Booking.com");
  await expect(conflict).toContainText("Airbnb");
  await conflict.getByRole("button", { name: "Marquer comme traité" }).click();
  // The page refreshes: the conflict leaves the open list and is listed among the resolved ones.
  await expect(conflict).toHaveCount(0);
  await expect(page.getByText("Marqué comme traité", { exact: false }).first()).toBeVisible();
  await page.goto("/admin/synchronisation");
  await expect(page.getByTestId("sync-journal")).toContainText("Manuel");
});
