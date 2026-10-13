import { describe, expect, it } from "vitest";
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
