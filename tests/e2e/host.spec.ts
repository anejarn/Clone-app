import { expect, test, uniqueEmail } from "./fixtures";

/** /devenir-hote: the owner offer and the lead form. */

test("states the offer from the business plan", async ({ page }) => {
  await page.goto("/devenir-hote");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const offer = page.getByRole("region", { name: "Notre offre" });
  await expect(offer).toContainText(/10\s%\sHT/);
  await expect(offer).toContainText(/12\s%\sTTC/);
  await expect(offer).toContainText(/5\s%\sHT/);
  // The founding rate's terms from the business plan: who qualifies, and until when it applies.
  await expect(offer).toContainText(/ouvrent au moins quatre semaines d'hiver avant le 15\sdécembre\s2026, sur les séjours dont l'arrivée a lieu au plus tard le 30\savril\s2027/);
  // 1 000 € base: 100 € + 20 € VAT, 880 € to the owner; founding 50 € + 10 €, 940 €.
  await expect(page.getByTestId("offer-example")).toContainText(/880\s€/);
  await expect(page.getByTestId("offer-example")).toContainText(/940\s€/);
  // Only what the product does: no partner or verification promises.
  const services = page.getByRole("region", { name: "Ce que Nidou prend en charge" });
  await expect(services).toContainText("Taxe de séjour collectée");
  await expect(services).not.toContainText(/ménage|clés|vérifions|loi/i);
  await expect(page.getByText(/RGPD/)).toHaveCount(0);
});

test("the header and menu lead owners here", async ({ page, isMobile }) => {
  test.skip(isMobile, "the header link shows from 1128px");
  await page.goto("/");
  await page.getByRole("navigation", { name: "Profil" }).getByRole("link", { name: "Devenir hôte" }).click();
  await expect(page).toHaveURL(/\/devenir-hote$/);
});

test("validates the lead form, then sends it", async ({ page }) => {
  await page.goto("/devenir-hote");
  const form = page.getByRole("form", { name: "Parlez-nous de votre logement" });
  const send = form.getByRole("button", { name: "Envoyer ma demande" });

  // Empty: every required field explains itself, and focus goes to the first one.
  await send.click();
  await expect(form.getByLabel("Nom et prénom")).toBeFocused();
  await expect(form.getByLabel("Nom et prénom")).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByLabel("Nom et prénom")).toHaveAccessibleDescription("Indiquez votre nom.");
  await expect(form).toContainText("Votre accord est nécessaire");

  await form.getByLabel("Nom et prénom").fill("Claire Martin");
  await form.getByLabel("Adresse e-mail").fill(uniqueEmail("lead"));
  await form.getByLabel("Station").selectOption({ label: "Les Orres" });
  await form.getByLabel("Type de logement").selectOption({ label: "Studio" });
  await form.getByLabel("Nombre de lits").fill("4");
  await form.getByLabel("Semaines que vous pouvez ouvrir cet hiver").fill("6");
  // An Orcières number for a Les Orres flat: refused before sending.
  await form.getByLabel("Numéro d'enregistrement (facultatif)").fill("05096 004217 kx");
  await form.getByRole("checkbox").check();
  await send.click();
  const reg = form.getByLabel("Numéro d'enregistrement (facultatif)");
  await expect(reg).toBeFocused();
  await expect(reg).toHaveAttribute("aria-invalid", "true");
  await expect(form).toContainText("il doit commencer par 05098");

  await reg.fill("05098 004217 kx");
  const posted = page.waitForResponse((r) => r.url().endsWith("/api/host-leads"));
  await send.click();
  const res = await posted;
  expect(res.status()).toBe(201);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.request().postDataJSON()).toMatchObject({ placeSlug: "les-orres", propertyType: "STUDIO", beds: 4, openWinterWeeks: 6, registrationNumber: "05098004217KX", consent: true });
  const done = page.getByRole("status");
  await expect(done).toContainText("Merci, votre demande est envoyée");
  await expect(done.getByRole("heading")).toBeFocused();
});

test("the honeypot field is hidden from people, assistive technology and the tab order", async ({ page }) => {
  await page.goto("/devenir-hote");
  const trap = page.getByTestId("lead-honeypot");
  await expect(trap).toHaveAttribute("aria-hidden", "true");
  const input = trap.locator('input[name="website"]');
  await expect(input).toHaveAttribute("tabindex", "-1");
  await expect(input).toHaveAttribute("autocomplete", "off");
  await expect(input).not.toBeInViewport();
  // Not exposed to assistive technology: no textbox named "Site web" in the accessibility tree.
  await expect(page.getByRole("textbox", { name: "Site web" })).toHaveCount(0);
  // And it never causes a horizontal scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
