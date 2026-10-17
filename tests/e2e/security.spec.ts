import { expect, test } from "./fixtures";

test.describe("security in the browser", () => {
  test.skip(({ isMobile }) => isMobile, "browser-independent; desktop is enough");

  for (const next of ["//evil.example/x", "/\\evil.example/x", "/\t/evil.example/x", "https://evil.example/", "/.//evil.example"]) {
    test(`login never redirects off-site: ${JSON.stringify(next)}`, async ({ page }) => {
      const offsite: string[] = [];
      await page.route((u) => u.hostname.endsWith("evil.example"), (r) => {
        offsite.push(r.request().url());
        return r.fulfill({ body: "evil" });
      });
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await page.getByRole("button", { name: "Inscrivez-vous" }).click();
      await page.getByLabel("Prénom").fill("Redirect");
      await page.getByLabel("Adresse e-mail").fill(`redir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.sigma.test`);
      await page.getByLabel("Mot de passe").fill("motdepasse-e2e");
      await page.getByRole("button", { name: "Créer mon compte" }).click();
      await expect(page).not.toHaveURL(/\/login/);
      expect(new URL(page.url()).hostname).toBe("localhost");
      expect(offsite).toEqual([]);
    });
  }

  test("login keeps a legitimate next path", async ({ page }) => {
    await page.goto("/login?next=%2Ftrips");
    await page.getByRole("button", { name: "Inscrivez-vous" }).click();
    await page.getByLabel("Prénom").fill("Next");
    await page.getByLabel("Adresse e-mail").fill(`next-${Date.now()}@test.sigma.test`);
    await page.getByLabel("Mot de passe").fill("motdepasse-e2e");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page).toHaveURL(/\/trips$/);
  });

  test("markup in URLs and search text is shown as text, never run", async ({ page }) => {
    const payload = `<img src=x onerror="window.__xss=1">`;
    page.on("dialog", (d) => {
      throw new Error(`unexpected dialog: ${d.message()}`);
    });
    await page.goto(`/s/${encodeURIComponent(payload)}/homes`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aucun résultat");
    await page.getByTestId("little-search").getByRole("button").first().click();
    await expect(page.getByTestId("structured-search-input-field-query")).toHaveValue(payload);
    await page.getByTestId("structured-search-input-field-query").fill(`"><script>window.__xss=1</script>`);
    await page.getByTestId("structured-search-input-search-button").click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });
});
