import { expect, test } from "@playwright/test";

/** The team app's manifest, icons and service worker, over HTTP. */

test("the team app's manifest is served, valid and Sigma's; its icons exist at their sizes", async ({ request }) => {
  const res = await request.get("/equipe.webmanifest");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/manifest+json");
  const m = await res.json();
  expect(m).toMatchObject({
    id: "/admin/ma-journee",
    name: "Sigma Équipe · Ma journée",
    short_name: "Sigma Équipe",
    lang: "fr",
    start_url: "/admin/ma-journee",
    scope: "/admin/",
    display: "standalone",
    theme_color: "#3550a8",
    background_color: "#ffffff",
  });
  expect(m.start_url.startsWith(m.scope)).toBe(true);
  expect(JSON.stringify(m)).not.toMatch(/airbnb|nidou/i);
  // Installable: PNG icons of 192 and 512 pixels, and a maskable one.
  const pngs = m.icons.filter((i: { type: string }) => i.type === "image/png");
  expect(pngs.map((i: { sizes: string }) => i.sizes).sort()).toEqual(["192x192", "512x512", "512x512"]);
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  for (const icon of m.icons as { src: string; sizes: string; type: string }[]) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()["content-type"], icon.src).toContain(icon.type);
    if (icon.type === "image/png") {
      const b = await r.body();
      // PNG signature, then the IHDR width and height.
      expect(b.subarray(1, 4).toString()).toBe("PNG");
      expect(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  }
  expect((await request.get("/icons/apple-touch-icon.png")).status()).toBe(200);
});

test("the service worker is served as JavaScript, never cached, and keeps no other page", async ({ request }) => {
  const res = await request.get("/sw-journee.js");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/javascript");
  expect(res.headers()["cache-control"]).toContain("no-store");
  const src = await res.text();
  expect(src).toContain('const PAGE = "/admin/ma-journee"');
  // Only that page is answered from the cache; the API and photos never are.
  expect(src).not.toMatch(/\/api\/|\/media\//);
});

test("the public site links no manifest (only the team's pages do)", async ({ request }) => {
  const html = await (await request.get("/")).text();
  expect(html).not.toContain('rel="manifest"');
});
