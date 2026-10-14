import { expect, request as pwRequest, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import pg from "pg";
import { TEST_DATABASE_URL } from "../../playwright.config";
import { buildFixtures } from "../../prisma/fixtures";
import { stayDays } from "./fixtures";

/** HTTP contract of every API route: status codes, error shape, auth, ownership. */

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const email = () => `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.nidou.fr`;

async function err(res: APIResponse, status: number, code?: string) {
  expect(res.status(), await res.text()).toBe(status);
  const body = await res.json();
  expect(body.error.message).toEqual(expect.any(String));
  expect(JSON.stringify(body)).not.toMatch(/\bat \w+ \(|node_modules|prisma\./i);
  if (code) expect(body.error.code).toBe(code);
}

/** Seeded homes with a 3-night minimum stay (the fixtures are deterministic). */
const threeNightHome = buildFixtures().listings.find((l) => l.minNights === 3)!.id;
const HOST_ONLY = ["commissionBps", "commissionCents", "commissionVatCents", "hostPayoutCents", "serviceFeeCents"];

/** A signed-in API client (its own cookie jar). */
async function signedIn(baseURL: string): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const res = await ctx.post("/api/auth/sign-up/email", { data: { name: "Api", email: email(), password: "motdepasse-api" } });
  expect(res.ok()).toBe(true);
  return ctx;
}

test.describe("catalogue", () => {
  test("autosuggest", async ({ request }) => {
    const r = await request.get("/api/autosuggest?q=orc");
    expect(r.ok()).toBe(true);
    expect((await r.json()).places.map((p: { slug: string }) => p.slug)).toEqual(["orcieres-merlette"]);
    // Only the two launch resorts exist.
    expect((await (await request.get("/api/autosuggest")).json()).places).toHaveLength(2);
    expect((await (await request.get("/api/autosuggest?q=paris")).json()).places).toEqual([]);
    // Wildcards and absurd lengths are harmless.
    for (const q of ["%", "_", "a".repeat(5000), "'; DROP TABLE places; --"]) {
      expect((await request.get(`/api/autosuggest?q=${encodeURIComponent(q)}`)).status()).toBe(200);
    }
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
  });

  test("detail, availability, quote", async ({ request }) => {
    const d = await (await request.get("/api/listings/1000")).json();
    expect(d).toMatchObject({ id: "1000", category: "HOME", place: { slug: "orcieres-merlette", inseeCode: "05096" }, minNights: expect.any(Number) });
    expect(d.registrationNumber).toMatch(/^05096\d{6}[A-Z]{2}$/);
    expect(d.liftDistanceM).toEqual(expect.any(Number));
    expect(d.amenities.every((a: { id: string; label: string }) => a.id && a.label)).toBe(true);
    // The owner's commission tier is host-side data.
    expect(d.host).not.toHaveProperty("isFoundingHost");
    await err(await request.get("/api/listings/nope"), 404, "NOT_FOUND");
    // A NUL byte never reaches Postgres (it would be a 500).
    for (const path of ["", "/quote", "/availability", "/calendar.ics"]) {
      await err(await request.get(`/api/listings/%00${path}`), 404, "NOT_FOUND");
    }

    const availability = await (await request.get("/api/listings/1000/availability")).json();
    expect(availability).toMatchObject({ booked: expect.any(Array), minNights: 3 });
    await err(await request.get(`/api/listings/1000/availability?from=${day(10)}&to=${day(5)}`), 400);
    await err(await request.get("/api/listings/1000/availability?from=2027-02-30"), 400);
    await err(await request.get("/api/listings/nope/availability"), 404, "NOT_FOUND");

    const res = await request.get(`/api/listings/1000/quote?checkin=${day(340)}&checkout=${day(343)}&adults=2&children=1`);
    expect(res.ok()).toBe(true);
    const q = await res.json();
    // Guest lines only: no service fee, no commission or payout.
    expect(Object.keys(q).sort()).toEqual(["available", "cleaningFeeCents", "minNights", "nightlyCents", "nights", "stayCents", "totalCents", "touristTaxCents"]);
    expect(q.stayCents + q.cleaningFeeCents + q.touristTaxCents).toBe(q.totalCents);
    expect(q).toMatchObject({ nights: 3, stayCents: q.nightlyCents * 3, minNights: 3 });
    await err(await request.get(`/api/listings/1000/quote?checkin=${day(340)}&checkout=${day(343)}&adults=40`), 400);
    await err(await request.get(`/api/listings/1000/quote?checkin=${day(343)}&checkout=${day(340)}&adults=1`), 422, "INVALID_DATES");
    const short = await request.get(`/api/listings/1000/quote?checkin=${day(340)}&checkout=${day(342)}&adults=1`);
    await err(short, 422, "MIN_NIGHTS");
    expect((await short.json()).error.message).toBe("Ce logement se réserve pour 3 nuits minimum.");
  });

  test("calendar.ics", async ({ request }) => {
    const res = await request.get("/api/listings/1000/calendar.ics");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
    const ics = await res.text();
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const event of ics.split("BEGIN:VEVENT").slice(1)) {
      expect(event).toMatch(/UID:\S+@nidou\.fr\r\n/);
      expect(event).toMatch(/DTSTART;VALUE=DATE:\d{8}\r\nDTEND;VALUE=DATE:\d{8}\r\n/);
      expect(event).toContain("SUMMARY:Réservé (Nidou)");
    }
    expect(ics).not.toMatch(/@demo\.nidou\.fr|ATTENDEE|ORGANIZER/);
    await err(await request.get("/api/listings/nope/calendar.ics"), 404, "NOT_FOUND");
  });
});

test.describe("host leads", () => {
  const lead = () => ({
    name: "Claire",
    email: email(),
    placeSlug: "les-orres",
    propertyType: "CHALET",
    beds: 8,
    openWinterWeeks: 10,
    registrationNumber: "05098004217KX",
    consent: true,
  });

  test("public, same-origin, validated, and never echoed", async ({ request, baseURL }) => {
    const h = { Origin: baseURL! };
    const created = await request.post("/api/host-leads", { headers: h, data: lead() });
    expect(created.status()).toBe(201);
    expect(await created.json()).toEqual({ ok: true });
    // Without an Origin header (non-browser clients) it is accepted too, like other writes.
    expect((await request.post("/api/host-leads", { data: lead() })).status()).toBe(201);

    await err(await request.post("/api/host-leads", { headers: { Origin: "https://evil.example" }, data: lead() }), 403, "BAD_ORIGIN");
    await err(await request.post("/api/host-leads", { headers: h, data: { ...lead(), consent: false } }), 400, "INVALID_INPUT");
    await err(await request.post("/api/host-leads", { headers: h, data: { ...lead(), registrationNumber: "ABC" } }), 400, "INVALID_INPUT");
    await err(await request.post("/api/host-leads", { headers: h, data: { ...lead(), placeSlug: "paris" } }), 400, "INVALID_INPUT");
    await err(await request.post("/api/host-leads", { headers: h, data: { ...lead(), name: "x".repeat(5000) } }), 400, "INVALID_INPUT");
    await err(await request.post("/api/host-leads", { headers: h, data: { ...lead(), name: "J\u0000x" } }), 400, "INVALID_INPUT");
    await err(await request.post("/api/host-leads", { headers: h, data: { ...lead(), padding: "x" } }), 400, "INVALID_INPUT");
    // Oversized bodies are refused before parsing, even when the rest is a valid lead.
    await err(await request.post("/api/host-leads", { headers: h, data: { ...lead(), padding: "x".repeat(1_000_000) } }), 413, "PAYLOAD_TOO_LARGE");
    await err(
      await request.post("/api/host-leads", { headers: { ...h, "Content-Type": "application/json" }, data: Buffer.from("{oops") }),
      400,
      "INVALID_JSON",
    );
    // No way to read leads back.
    expect((await request.get("/api/host-leads")).status()).toBe(405);
  });

  test("a filled honeypot gets the normal answer and stores nothing", async ({ request, baseURL }) => {
    const bot = { ...lead(), website: "https://spam.example" };
    const res = await request.post("/api/host-leads", { headers: { Origin: baseURL! }, data: bot });
    expect(res.status()).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    // Nor does a value the form could never send: validation must not name the field.
    const odd = { ...lead(), website: 1 };
    const oddRes = await request.post("/api/host-leads", { headers: { Origin: baseURL! }, data: odd });
    expect(oddRes.status()).toBe(201);
    expect(await oddRes.json()).toEqual({ ok: true });
    const human = lead();
    expect((await request.post("/api/host-leads", { headers: { Origin: baseURL! }, data: { ...human, website: "" } })).status()).toBe(201);
    const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await db.connect();
    try {
      const rows = async (address: string) => (await db.query("select count(*)::int as n from host_leads where email = $1", [address.toLowerCase()])).rows[0].n;
      expect(await rows(bot.email)).toBe(0);
      expect(await rows(odd.email)).toBe(0);
      expect(await rows(human.email)).toBe(1);
    } finally {
      await db.end();
    }
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
    expect(booking.nightlyCents * 3 + booking.cleaningFeeCents + booking.touristTaxCents).toBe(booking.totalCents);
    for (const key of HOST_ONLY) expect(booking, key).not.toHaveProperty(key);
    for (const b of (await (await alice.get("/api/bookings")).json()).bookings) for (const key of HOST_ONLY) expect(b, key).not.toHaveProperty(key);

    await err(await bob.post("/api/bookings", { data: { ...stay, checkIn: at(1) } }), 409, "UNAVAILABLE");
    expect((await (await bob.get("/api/bookings")).json()).bookings).toEqual([]);
    await err(await bob.post(`/api/bookings/${booking.id}/cancel`), 404, "NOT_FOUND");

    expect((await (await alice.post(`/api/bookings/${booking.id}/cancel`)).json()).status).toBe("CANCELLED");
    await err(await alice.post(`/api/bookings/${booking.id}/cancel`), 409, "NOT_CANCELLABLE");
    expect((await bob.post("/api/bookings", { data: stay })).status()).toBe(201);

    // Some homes take 3 nights minimum. (NOT_BOOKABLE for non-homes is covered by the integration suite:
    // no experiences are seeded any more.)
    await err(await bob.post("/api/bookings", { data: { listingId: threeNightHome, checkIn: at(10), checkOut: at(12), adults: 1 } }), 422, "MIN_NIGHTS");
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

  test("rejects bad credentials and weak passwords", async ({ request, baseURL }) => {
    const h = { Origin: baseURL! };
    expect((await request.post("/api/auth/sign-in/email", { headers: h, data: { email: email(), password: "wrongwrong" } })).status()).toBe(401);
    expect((await request.post("/api/auth/sign-up/email", { headers: h, data: { name: "W", email: email(), password: "short" } })).status()).toBe(400);
    const dup = email();
    expect((await request.post("/api/auth/sign-up/email", { headers: h, data: { name: "D", email: dup, password: "motdepasse-api" } })).ok()).toBe(true);
    expect((await request.post("/api/auth/sign-up/email", { headers: h, data: { name: "D", email: dup, password: "motdepasse-api" } })).ok()).toBe(false);
  });

  test("security headers on pages and API", async ({ request }) => {
    for (const path of ["/", "/s/orcieres-merlette/homes", "/api/autosuggest", "/api/listings/1000/calendar.ics"]) {
      const h = (await request.get(path)).headers();
      expect(h["x-powered-by"], path).toBeUndefined();
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    }
  });
});
