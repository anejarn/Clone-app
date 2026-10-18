import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { ADMIN_SECTIONS } from "../../lib/admin/sections";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../prisma/fixtures";
import { totpCode } from "../support/totp";

/** Back-office over HTTP: who gets in, who is turned away, and how. */

async function client(baseURL: string) {
  return pwRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
}

/** Password sign-in, then the TOTP code if asked for. */
async function signedIn(baseURL: string, email: string, password = DEMO_PASSWORD): Promise<APIRequestContext> {
  const ctx = await client(baseURL);
  const res = await ctx.post("/api/auth/sign-in/email", { data: { email, password } });
  expect(res.ok(), await res.text()).toBe(true);
  if ((await res.json()).twoFactorRedirect) {
    const v = await ctx.post("/api/auth/two-factor/verify-totp", { data: { code: totpCode(DEMO_TOTP_SECRET) } });
    expect(v.ok(), await v.text()).toBe(true);
  }
  return ctx;
}

test("anonymous visitors are sent to the login page from every back-office page (307), and get 401 from the API", async ({ request }) => {
  for (const s of ADMIN_SECTIONS) {
    const r = await request.get(s.href, { maxRedirects: 0 });
    expect(r.status(), s.href).toBe(307);
    const to = new URL(r.headers().location, "http://x");
    expect(`${to.pathname}${to.search}`).toBe(`/login?next=${encodeURIComponent(s.href)}`);
  }
  const api = await request.get("/api/admin/dashboard");
  expect(api.status()).toBe(401);
  expect((await api.json()).error.code).toBe("UNAUTHENTICATED");
});

test("guests and owners see a not-found page on every section and get 403 from the API", async ({ baseURL }) => {
  const guest = await client(baseURL!);
  expect((await guest.post("/api/auth/sign-up/email", { data: { name: "Api", email: `adm-${Date.now()}@test.sigma.test`, password: "motdepasse-api" } })).ok()).toBe(true);
  const owner = await signedIn(baseURL!, "hassan.benjelloun@demo.sigma.test");
  for (const ctx of [guest, owner]) {
    for (const s of ADMIN_SECTIONS) {
      const html = await (await ctx.get(s.href)).text();
      expect(html, s.href).toContain("Page introuvable");
      expect(html, s.href).not.toContain("Bonjour");
      expect(html, s.href).not.toContain("Double authentification activée");
    }
    const api = await ctx.get("/api/admin/dashboard");
    expect(api.status()).toBe(403);
    expect((await api.json()).error.code).toBe("FORBIDDEN");
  }
});

test("staff without double authentification get 403 TWO_FACTOR_REQUIRED from the API", async ({ baseURL }) => {
  const felicia = await signedIn(baseURL!, "felicia@demo.sigma.test");
  const api = await felicia.get("/api/admin/dashboard");
  expect(api.status()).toBe(403);
  expect((await api.json()).error.code).toBe("TWO_FACTOR_REQUIRED");
});

test("the password alone opens no session for staff with double authentification", async ({ baseURL }) => {
  const ctx = await client(baseURL!);
  const res = await ctx.post("/api/auth/sign-in/email", { data: { email: "amine@demo.sigma.test", password: DEMO_PASSWORD } });
  expect(await res.json()).toMatchObject({ twoFactorRedirect: true });
  expect(await (await ctx.get("/api/auth/get-session")).json()).toBeNull();
  expect((await ctx.get("/api/admin/dashboard")).status()).toBe(401);
  const wrong = await ctx.post("/api/auth/two-factor/verify-totp", { data: { code: totpCode(DEMO_TOTP_SECRET) === "000000" ? "111111" : "000000" } });
  expect(wrong.status()).toBe(401);
});

test("the demo admin and agent get their organization's counts", async ({ baseURL }) => {
  for (const email of ["amine@demo.sigma.test", "agent1@demo.sigma.test"]) {
    const ctx = await signedIn(baseURL!, email);
    const r = await ctx.get("/api/admin/dashboard");
    expect(r.status(), email).toBe(200);
    const counts = await r.json();
    expect(counts.listings).toBeGreaterThan(0);
    expect(counts.upcomingBookings).toBeGreaterThan(0);
    expect(counts.licensesExpiring).toBeGreaterThan(0);
  }
});
