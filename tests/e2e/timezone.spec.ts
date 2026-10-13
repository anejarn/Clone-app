import { expect, test } from "./fixtures";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** The dates a visitor clicks are the dates in the URL, whatever their timezone. */
for (const timezoneId of ["Pacific/Kiritimati", "America/Los_Angeles"]) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });
    test.skip(({ isMobile }) => isMobile, "desktop calendar");

    test("clicked days end up in the URL unchanged", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /Dates/ }).click();
      const second = page.locator(".rdp-month").nth(1);
      const [monthName, year] = (await second.locator(".rdp-caption_label").innerText()).toLowerCase().split(" ");
      const mm = String(MONTHS.indexOf(monthName) + 1).padStart(2, "0");
      await second.getByRole("button", { name: /\b20\b/ }).first().click();
      await second.getByRole("button", { name: /\b22\b/ }).first().click();
      await expect(page.getByTestId("big-search")).toContainText("20–22");
      await page.getByTestId("structured-search-input-search-button").click();
      await expect(page).toHaveURL(new RegExp(`checkin=${year}-${mm}-20&checkout=${year}-${mm}-22`));
      await expect(page.getByText(/^2 nuits · /)).toBeVisible();
    });

    test("the listing page books the days clicked in its calendar", async ({ page }) => {
      // 1060: no test books it. The card's calendar shows one month; go two ahead.
      await page.goto("/rooms/1060");
      const card = page.getByTestId("booking-card");
      await card.getByRole("button", { name: /Arrivée/ }).click();
      const calendar = card.locator(".rdp-root");
      await calendar.getByRole("button", { name: "Aller au mois suivant" }).click();
      await calendar.getByRole("button", { name: "Aller au mois suivant" }).click();
      const [monthName, year] = (await calendar.locator(".rdp-caption_label").innerText()).toLowerCase().split(" ");
      const mm = String(MONTHS.indexOf(monthName) + 1).padStart(2, "0");
      await calendar.getByRole("button", { name: /\b20\b/ }).first().click();
      await calendar.getByRole("button", { name: /\b22\b/ }).first().click();
      await expect(card.getByRole("button", { name: /Arrivée/ })).toContainText(`20/${mm}/${year}`);
      await expect(card.getByTestId("price-breakdown")).toContainText("× 2 nuits");
      // Signed out, "Réserver" carries the same calendar days to the login page.
      await card.getByRole("button", { name: "Réserver" }).click();
      await expect(page).toHaveURL(/\/login\?next=/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(`/rooms/1060?checkin=${year}-${mm}-20&checkout=${year}-${mm}-22&adults=1`);
    });
  });
}
