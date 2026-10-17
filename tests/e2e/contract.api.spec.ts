import { expect, request as pwRequest, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { stayDays } from "./fixtures";

/** HTTP contract of every API route: status codes, error shape, auth, ownership. */

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const email = () => `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.sigma.test`;

async function err(res: APIResponse, status: number, code?: string) {
  expect(res.status(), await res.text()).toBe(status);
  const body = await res.json();
  expect(body.error.message).toEqual(expect.any(String));
  expect(JSON.stringify(body)).not.toMatch(/\bat \w+ \(|node_modules|prisma\./i);
  if (code) expect(body.error.code).toBe(code);
}

/** A signed-in API client (its own cookie jar). */
async function signedIn(baseURL: string): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const res = await ctx.post("/api/auth/sign-up/email", { data: { name: "Api", email: email(), password: "motdepasse-api" } });
  expect(res.ok()).toBe(true);
  return ctx;
}

test.describe("catalogue", () => {
  test("autosuggest", async ({ request }) => {
    const r = await request.get("/api/autosuggest?q=guel");
    expect(r.ok()).toBe(true);
    expect((await r.json()).places.map((p: { slug: string }) => p.slug)).toEqual(["gueliz"]);
    expect((await (await request.get("/api/autosuggest")).json()).places).toHaveLength(8);
    // Wildcards and absurd lengths are harmless.
    for (const q of ["%", "_", "a".repeat(5000), "'; DROP TABLE places; --"]) {
      expect((await request.get(`/api/autosuggest?q=${encodeURIComponent(q)}`)).status()).toBe(200);
    }
    // Control characters are refused, not searched (Postgres can't take a NUL).
    await err(await request.get("/api/autosuggest?q=ly%00o"), 400, "INVALID_INPUT");
  });

  test("search pagination and validation", async ({ request }) => {
    const p1 = await (await request.get("/api/listings?place=partout")).json();
    expect(p1).toMatchObject({ page: 1, pageCount: Math.ceil(p1.total / 24) });
    expect(p1.items).toHaveLength(24);
    const last = await (await request.get(`/api/listings?place=partout&page=${p1.pageCount}`)).json();
    expect(last.items.length).toBe(p1.total - 24 * (p1.pageCount - 1));
    expect(await (await request.get("/api/listings?place=partout&page=999")).json()).toMatchObject({ page: 999, items: [] });
    expect((await (await request.get("/api/listings?place=partout&page=abc")).json()).page).toBe(1);
    expect((await (await request.get("/api/listings?place=partout&page=0")).json()).page).toBe(1);
    expect((await (await request.get("/api/listings?place=atlantide")).json()).total).toBe(0);
    await err(await request.get(`/api/listings?place=${"x".repeat(200)}`), 400, "INVALID_INPUT");
    await err(await request.get("/api/listings?place=pa%00ris"), 400, "INVALID_INPUT");
  });

  test("detail, availability, quote", async ({ request }) => {
    const d = await (await request.get("/api/listings/1000")).json();
    expect(d).toMatchObject({ id: "1000", place: { slug: "hivernage" } });
    expect(d.amenities.every((a: { id: string; label: string }) => a.id && a.label)).toBe(true);
    await err(await request.get("/api/listings/nope"), 404, "NOT_FOUND");
    // Malformed ids are answered 404 without a query (a NUL byte would make Postgres fail with a 500).
    for (const path of ["", "/quote", "/availability"]) {
      await err(await request.get(`/api/listings/%00${path}`), 404, "NOT_FOUND");
      await err(await request.get(`/api/listings/${"x".repeat(65)}${path}`), 404, "NOT_FOUND");
    }
    // An unknown listing has no calendar: 404, as for its detail.
    await err(await request.get("/api/listings/nope/availability"), 404, "NOT_FOUND");

    expect((await (await request.get("/api/listings/1000/availability")).json()).booked).toEqual(expect.any(Array));
    await err(await request.get(`/api/listings/1000/availability?from=${day(10)}&to=${day(5)}`), 400);
    await err(await request.get("/api/listings/1000/availability?from=2027-02-30"), 400);

    const q = await (await request.get(`/api/listings/1000/quote?checkin=${day(340)}&checkout=${day(343)}&adults=1`)).json();
    expect(q.stayCents + q.cleaningFeeCents + q.serviceFeeCents).toBe(q.totalCents);
    expect(q.serviceFeeCents).toBe(0);
    await err(await request.get(`/api/listings/1000/quote?checkin=${day(340)}&checkout=${day(343)}&adults=40`), 400);
    await err(await request.get(`/api/listings/1000/quote?checkin=${day(343)}&checkout=${day(340)}&adults=1`), 422, "INVALID_DATES");
  });
});

test.describe("bookings", () => {
  test("need a session", async ({ request }) => {
    await err(await request.get("/api/bookings"), 401, "UNAUTHENTICATED");
    await err(await request.post("/api/bookings", { data: {} }), 401);
  });

  test("lifecycle, conflicts and ownership", async ({ baseURL }, testInfo) => {
    const at = stayDays(testInfo, 320);
    const alice = await signedIn(baseURL!);
    const bob = await signedIn(baseURL!);
    const stay = { listingId: "1010", checkIn: at(0), checkOut: at(3), adults: 1 };

    await err(await alice.post("/api/bookings", { data: Buffer.from("{oops"), headers: { "Content-Type": "application/json" } }), 400, "INVALID_JSON");
    await err(await alice.post("/api/bookings", { data: { ...stay, adults: 0 } }), 400, "INVALID_INPUT");
    await err(await alice.post("/api/bookings", { data: stay, headers: { Origin: "https://evil.example" } }), 403, "BAD_ORIGIN");

    const created = await alice.post("/api/bookings", { data: stay });
    expect(created.status()).toBe(201);
    const booking = await created.json();
    expect(booking).toMatchObject({ status: "CONFIRMED", listing: { id: "1010" } });

    await err(await bob.post("/api/bookings", { data: { ...stay, checkIn: at(1) } }), 409, "UNAVAILABLE");
    expect((await (await bob.get("/api/bookings")).json()).bookings).toEqual([]);
    await err(await bob.post(`/api/bookings/${booking.id}/cancel`), 404, "NOT_FOUND");

    expect((await (await alice.post(`/api/bookings/${booking.id}/cancel`)).json()).status).toBe("CANCELLED");
    await err(await alice.post(`/api/bookings/${booking.id}/cancel`), 409, "NOT_CANCELLABLE");
    expect((await bob.post("/api/bookings", { data: stay })).status()).toBe(201);

    // 1012 is the first Hivernage activity in the seed: not bookable by the night.
    await err(await bob.post("/api/bookings", { data: { ...stay, listingId: "1012" } }), 422, "NOT_BOOKABLE");
  });
});

test.describe("wishlist and reviews", () => {
  test("wishlist", async ({ request, baseURL }) => {
    await err(await request.get("/api/wishlist"), 401);
    const u = await signedIn(baseURL!);
    await err(await u.put("/api/wishlist/nope"), 404);
    expect((await u.put("/api/wishlist/1000")).status()).toBe(204);
    expect((await u.put("/api/wishlist/1000")).status()).toBe(204);
    expect((await u.put("/api/wishlist/1001")).status()).toBe(204);
    expect((await (await u.get("/api/wishlist")).json()).ids).toEqual(["1001", "1000"]);
    expect((await u.delete("/api/wishlist/1001")).status()).toBe(204);
    expect((await (await u.post("/api/wishlist", { data: { ids: ["1002", "ghost"] } })).json()).ids).toEqual(["1002", "1000"]);
    await err(await u.post("/api/wishlist", { data: { ids: Array.from({ length: 501 }, (_, i) => String(i)) } }), 400);
  });

  test("reviews need a completed stay", async ({ request, baseURL }) => {
    await err(await request.post("/api/listings/1000/reviews", { data: { rating: 5, body: "Parfait du début à la fin" } }), 401);
    const u = await signedIn(baseURL!);
    await err(await u.post("/api/listings/1000/reviews", { data: { rating: 5, body: "court" } }), 400);
    await err(await u.post("/api/listings/1000/reviews", { data: { rating: 5, body: "Parfait du début à la fin" } }), 403, "NO_STAY");
  });
});

test.describe("input hardening", () => {
  const big = "x".repeat(1_000_000);

  test("request bodies over 64 KB are refused with 413 before parsing, on every route that reads one", async ({ request, baseURL }) => {
    const u = await signedIn(baseURL!);
    await err(await u.post("/api/bookings", { data: { listingId: "1010", checkIn: day(330), checkOut: day(332), adults: 1, pad: big } }), 413, "PAYLOAD_TOO_LARGE");
    await err(await u.post("/api/wishlist", { data: { ids: ["1000"], pad: big } }), 413, "PAYLOAD_TOO_LARGE");
    await err(await u.post("/api/listings/1000/reviews", { data: { rating: 5, body: big } }), 413, "PAYLOAD_TOO_LARGE");
    await err(
      await request.post("/api/auth/sign-up/email", { headers: { Origin: baseURL! }, data: { name: big, email: email(), password: "motdepasse-api" } }),
      413,
      "PAYLOAD_TOO_LARGE",
    );
    // Just under the cap is read and validated as usual.
    expect((await u.post("/api/wishlist", { data: { ids: ["1000"], pad: "x".repeat(60_000) } })).status()).toBe(200);
    expect((await request.post("/api/auth/sign-in/email", { headers: { Origin: baseURL! }, data: { email: email(), password: "wrongwrong" } })).status()).toBe(401);
  });

  test("control characters in text are refused with 400", async ({ request, baseURL }) => {
    const u = await signedIn(baseURL!);
    await err(await u.post("/api/listings/1000/reviews", { data: { rating: 5, body: "Parfait du début\u0000 à la fin" } }), 400, "INVALID_INPUT");
    const res = await request.post("/api/auth/sign-up/email", { headers: { Origin: baseURL! }, data: { name: "Ca\u0000mille", email: email(), password: "motdepasse-api" } });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain("caractères non autorisés");
  });

  test("malformed ids are 404 (or a harmless no-op) on every route that takes one", async ({ baseURL }) => {
    const u = await signedIn(baseURL!);
    await err(await u.put("/api/wishlist/%00"), 404, "NOT_FOUND");
    expect((await u.delete("/api/wishlist/%00")).status()).toBe(204);
    await err(await u.post("/api/bookings/%00/cancel"), 404, "NOT_FOUND");
    await err(await u.post("/api/listings/%00/reviews", { data: { rating: 5, body: "Parfait du début à la fin" } }), 404, "NOT_FOUND");
    // In a body, a malformed id is invalid input.
    await err(await u.post("/api/bookings", { data: { listingId: "10\u000010", checkIn: day(330), checkOut: day(332), adults: 1 } }), 400, "INVALID_INPUT");
    await err(await u.post("/api/wishlist", { data: { ids: ["1000", "a/b"] } }), 400, "INVALID_INPUT");
  });
});

test.describe("auth and transport", () => {
  test("session cookies are HttpOnly, SameSite=Lax, and don't expose the user", async ({ request, baseURL }) => {
    const address = email();
    const res = await request.post("/api/auth/sign-up/email", {
      headers: { Origin: baseURL! },
      data: { name: "Cookie", email: address, password: "motdepasse-api" },
    });
    const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("better-auth.session"));
    expect(cookies.length).toBeGreaterThanOrEqual(2);
    for (const c of cookies) {
      expect(c.value).toMatch(/HttpOnly/i);
      expect(c.value).toMatch(/SameSite=Lax/i);
      const raw = decodeURIComponent(c.value.split(";")[0].split("=").slice(1).join("="));
      const decoded = raw.split(".").map((part) => Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).join(" ");
      expect(`${raw} ${decoded}`).not.toContain(address);
    }
  });

  test("sign-up ignores a role or organization sent by the client", async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
    const res = await ctx.post("/api/auth/sign-up/email", {
      data: { name: "Intrus", email: email(), password: "motdepasse-api", role: "ADMIN", organizationId: "org_sigma" },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const { user } = await (await ctx.get("/api/auth/get-session")).json();
    expect(user).toMatchObject({ role: "GUEST", organizationId: null });
    // Nor can the account promote itself afterwards.
    expect((await ctx.post("/api/auth/update-user", { data: { role: "ADMIN" } })).ok()).toBe(false);
    expect((await (await ctx.get("/api/auth/get-session")).json()).user.role).toBe("GUEST");
    await ctx.dispose();
  });

  test("rejects bad credentials and weak passwords", async ({ request, baseURL }) => {
    const h = { Origin: baseURL! };
    expect((await request.post("/api/auth/sign-in/email", { headers: h, data: { email: email(), password: "wrongwrong" } })).status()).toBe(401);
    expect((await request.post("/api/auth/sign-up/email", { headers: h, data: { name: "W", email: email(), password: "short" } })).status()).toBe(400);
    const dup = email();
    expect((await request.post("/api/auth/sign-up/email", { headers: h, data: { name: "D", email: dup, password: "motdepasse-api" } })).ok()).toBe(true);
    expect((await request.post("/api/auth/sign-up/email", { headers: h, data: { name: "D", email: dup, password: "motdepasse-api" } })).ok()).toBe(false);
  });

  test("security headers on pages and API", async ({ request }) => {
    for (const path of ["/", "/s/hivernage/homes", "/api/autosuggest"]) {
      const h = (await request.get(path)).headers();
      expect(h["x-powered-by"], path).toBeUndefined();
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    }
  });
});
