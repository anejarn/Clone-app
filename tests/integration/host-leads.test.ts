import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/host-leads/route";
import { HOST_LEAD_MAX_BYTES } from "@/lib/server/host-leads";
import { db } from "@/lib/server/db";

const ORIGIN = "http://localhost:3100";
const lead = (extra: Record<string, unknown> = {}) => ({
  name: "Claire Martin",
  email: `Claire.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@Test.Nidou.fr`,
  phone: "+33 6 12 34 56 78",
  placeSlug: "orcieres-merlette",
  propertyType: "APARTMENT",
  beds: 6,
  openWinterWeeks: 8,
  registrationNumber: "05096 004217 kx",
  message: "Appartement libre hors vacances scolaires.",
  consent: true,
  ...extra,
});
const post = (body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  POST(new Request(`${ORIGIN}/api/host-leads`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

async function error(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(body.error.code).toBe(code);
  return body.error.message as string;
}

describe("POST /api/host-leads", () => {
  it("stores the lead, normalised, and answers 201 { ok: true } without echoing it", async () => {
    const input = lead();
    const res = await post(input);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });

    const row = await db.hostLead.findFirstOrThrow({ where: { email: input.email.toLowerCase() } });
    expect(row).toMatchObject({
      name: "Claire Martin",
      phone: "+33 6 12 34 56 78",
      placeSlug: "orcieres-merlette",
      propertyType: "APARTMENT",
      beds: 6,
      openWinterWeeks: 8,
      registrationNumber: "05096004217KX",
      consent: true,
    });
  });

  it("treats optional fields as optional", async () => {
    const input = lead({ phone: "", registrationNumber: "", message: undefined, placeSlug: "les-orres", propertyType: "STUDIO" });
    expect((await post(input)).status).toBe(201);
    const row = await db.hostLead.findFirstOrThrow({ where: { email: input.email.toLowerCase() } });
    expect(row).toMatchObject({ phone: null, registrationNumber: null, message: null, placeSlug: "les-orres" });
  });

  it("needs consent", async () => {
    await error(await post(lead({ consent: false })), 400, "INVALID_INPUT");
    const { consent: _, ...rest } = lead();
    await error(await post(rest), 400, "INVALID_INPUT");
  });

  it("validates every field with sane limits", async () => {
    for (const bad of [
      { name: "" },
      { name: "x".repeat(101) },
      { email: "pas-un-email" },
      { email: `${"a".repeat(250)}@x.fr` },
      { phone: "appelez-moi" },
      { placeSlug: "paris" },
      { propertyType: "VILLA" },
      { beds: 0 },
      { beds: 2.5 },
      { beds: "6" },
      { openWinterWeeks: 0 },
      { openWinterWeeks: 27 },
      { registrationNumber: "12345" },
      { registrationNumber: "05096004217K1" },
      // A Les Orres number for an Orcières flat.
      { registrationNumber: "05098004217KX" },
      { message: "x".repeat(2001) },
    ]) {
      expect(await error(await post(lead(bad)), 400, "INVALID_INPUT"), JSON.stringify(bad).slice(0, 60)).toEqual(expect.any(String));
    }
  });

  it("refuses unknown keys and control characters (NUL would make Postgres fail)", async () => {
    expect(await error(await post(lead({ padding: "x" })), 400, "INVALID_INPUT")).toMatch(/padding/);
    for (const bad of [{ name: "J\u0000x" }, { message: "a\u0000b" }, { placeSlug: "les-orres\u0000" }, { email: "a\u0000@b.fr" }]) {
      expect(await error(await post(lead(bad)), 400, "INVALID_INPUT"), JSON.stringify(bad)).toEqual(expect.any(String));
    }
    // Line breaks and tabs in the message are fine.
    expect((await post(lead({ message: "Libre en février.\n\tHors vacances aussi." }))).status).toBe(201);
  });

  it("refuses oversized bodies with 413 before parsing them", async () => {
    // Declared size over the cap: refused without reading the body.
    const declared = await POST(
      new Request(`${ORIGIN}/api/host-leads`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json", "content-length": String(HOST_LEAD_MAX_BYTES + 1) },
        body: JSON.stringify(lead()),
      }),
    );
    await error(declared, 413, "PAYLOAD_TOO_LARGE");
    // Streamed without a length: cut off once the cap is passed, even when the JSON is a valid lead.
    const chunk = new TextEncoder().encode(" ".repeat(4096));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        sent += chunk.byteLength;
        if (sent > 50 * 1024 * 1024) ctrl.close();
        else ctrl.enqueue(chunk);
      },
    });
    const streamed = await POST(
      new Request(`${ORIGIN}/api/host-leads`, { method: "POST", headers: { origin: ORIGIN }, body: stream, duplex: "half" } as RequestInit),
    );
    await error(streamed, 413, "PAYLOAD_TOO_LARGE");
    expect(sent).toBeLessThan(1024 * 1024);
    // The longest valid lead still fits.
    expect((await post(lead({ name: "é".repeat(100), message: "é\"\n".repeat(666) }))).status).toBe(201);
  });

  it("refuses cross-site posts and malformed JSON", async () => {
    await error(await post(lead(), { origin: "https://evil.example" }), 403, "BAD_ORIGIN");
    const res = await POST(new Request(`${ORIGIN}/api/host-leads`, { method: "POST", headers: { origin: ORIGIN }, body: "{nope" }));
    await error(res, 400, "INVALID_JSON");
  });
});

describe("POST /api/host-leads spam protection", () => {
  const count = (email: string) => db.hostLead.count({ where: { email: email.toLowerCase() } });

  it("answers a filled honeypot as usual and stores nothing", async () => {
    const input = lead({ website: "https://spam.example" });
    const res = await post(input);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(await count(input.email)).toBe(0);
    // Empty (what the form sends when nobody touched it) is a normal lead.
    const real = lead({ website: "" });
    expect((await post(real)).status).toBe(201);
    expect(await count(real.email)).toBe(1);
  });

  it("answers any filled honeypot as usual, however long and whatever its type", async () => {
    // Validation must not single the field out (no 400 naming it): every filled value gets 201 and no row.
    for (const website of ["x".repeat(5000), 1, true, false, ["https://spam.example"], { url: "https://spam.example" }, "  spam  "]) {
      const input = lead({ website });
      const res = await post(input);
      expect(res.status, JSON.stringify(website).slice(0, 40)).toBe(201);
      expect(await res.json()).toEqual({ ok: true });
      expect(await count(input.email)).toBe(0);
    }
    // Empty, whitespace or null: a person, stored.
    for (const website of ["   ", null]) {
      const real = lead({ website });
      expect((await post(real)).status).toBe(201);
      expect(await count(real.email)).toBe(1);
    }
  });

  it("stores the same email and resort once per 24 hours", async () => {
    const input = lead();
    expect((await post(input)).status).toBe(201);
    const again = await post({ ...input, name: "Claire M.", message: "Relance" });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ ok: true });
    expect(await count(input.email)).toBe(1);
    // Same email, other resort: a different home, stored.
    expect((await post({ ...input, placeSlug: "les-orres", registrationNumber: "05098004217KX" })).status).toBe(201);
    expect(await count(input.email)).toBe(2);

    // Older than 24 hours: stored again.
    const old = lead();
    const { consent: _c, registrationNumber: _r, ...rest } = old;
    await db.hostLead.create({
      data: { ...rest, email: old.email.toLowerCase(), consent: true, createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    expect((await post(old)).status).toBe(201);
    expect(await count(old.email)).toBe(2);
  });

  describe("rate limit", () => {
    afterEach(() => vi.unstubAllEnvs());
    // A fresh documentation-range IPv6 address per call, so tests never share a window.
    let n = Date.now() % 0xffff;
    const ip = () => `2001:db8::${(n++ % 0xffff).toString(16)}:${Math.floor(Math.random() * 0xffff).toString(16)}`;

    it("allows 10 requests per 10 minutes per IP, then answers 429 in French", async () => {
      vi.stubEnv("AUTH_RATE_LIMIT", "on");
      const a = ip();
      for (let i = 0; i < 10; i++) expect((await post(lead(), { origin: ORIGIN, "x-forwarded-for": `${a}, 10.0.0.1` })).status, `request ${i + 1}`).toBe(201);
      const refused = lead();
      const message = await error(await post(refused, { origin: ORIGIN, "x-forwarded-for": `${a}, 10.0.0.2` }), 429, "RATE_LIMITED");
      expect(message).toMatch(/Réessayez/);
      expect(await count(refused.email)).toBe(0);
      // Invalid requests count too.
      await error(await post({}, { origin: ORIGIN, "x-forwarded-for": a }), 429, "RATE_LIMITED");
      // Keyed on the first x-forwarded-for entry: another client is unaffected, even behind the same proxy.
      expect((await post(lead(), { origin: ORIGIN, "x-forwarded-for": `${ip()}, 10.0.0.1` })).status).toBe(201);
    });

    it("falls back to x-real-ip", async () => {
      vi.stubEnv("AUTH_RATE_LIMIT", "on");
      const b = ip();
      for (let i = 0; i < 10; i++) await post({}, { origin: ORIGIN, "x-real-ip": b });
      await error(await post(lead(), { origin: ORIGIN, "x-real-ip": b }), 429, "RATE_LIMITED");
      expect((await post(lead(), { origin: ORIGIN, "x-real-ip": ip() })).status).toBe(201);
    });

    it("is off with AUTH_RATE_LIMIT=off", async () => {
      vi.stubEnv("AUTH_RATE_LIMIT", "off");
      const c = ip();
      for (let i = 0; i < 12; i++) expect((await post(lead(), { origin: ORIGIN, "x-forwarded-for": c })).status).toBe(201);
    });
  });
});
