import { expect, test } from "@playwright/test";
import { DEMO_GUIDE_TOKENS } from "../../prisma/fixtures";

/** The guest guide over HTTP: never cached, never indexed, no referrer; unknown links are real 404s. */

test("a guide's HTML is private and never stored, indexed or sent as a referrer", async ({ request }) => {
  for (const path of [`/guide/${DEMO_GUIDE_TOKENS.current}`, `/guide/${DEMO_GUIDE_TOKENS.current}?lang=es`]) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(200);
    const h = r.headers();
    expect(h["cache-control"], path).toContain("no-store");
    expect(h["cache-control"], path).toContain("private");
    expect(h["x-robots-tag"]).toContain("noindex");
    expect(h["referrer-policy"]).toBe("no-referrer");
    const html = await r.text();
    expect(html).toContain('name="robots" content="noindex, nofollow');
    expect(html).toContain('name="referrer" content="no-referrer"');
  }
});

test("unknown, malformed and revoked-looking tokens answer 404 without the guide", async ({ request }) => {
  for (const t of ["z".repeat(43), "short", DEMO_GUIDE_TOKENS.current.slice(0, -1) + "1"]) {
    const r = await request.get(`/guide/${t}`);
    expect(r.status(), t).toBe(404);
    expect(r.headers()["cache-control"]).toContain("no-store");
    const html = await r.text();
    expect(html).not.toContain("data-testid=\"guide-code\"");
  }
  expect((await request.get(`/guide/${"z".repeat(43)}/photos/abc`)).status()).toBe(404);
});
