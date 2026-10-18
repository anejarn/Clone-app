import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as dashboardApi } from "@/app/api/admin/dashboard/route";
import { ADMIN_SECTIONS, navFor, TWO_FACTOR_SETUP_PATH, type AdminPath } from "@/lib/admin/sections";
import type { Role } from "@/lib/generated/prisma/enums";
import { dashboardCounts } from "@/lib/server/admin/dashboard";
import { checkAccess, requireAdminAction, requireAdminApi, requireAdminPage } from "@/lib/server/authz";
import { db } from "@/lib/server/db";
import { sigmaOrgId } from "./helpers";
import { signedInMember } from "./staff";

const sigma = await sigmaOrgId();

/** What a Next.js redirect()/notFound() threw, or "ok". */
async function pageOutcome(href: AdminPath, headers: Headers): Promise<string> {
  try {
    await requireAdminPage(href, { headers });
    return "ok";
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? e);
    if (digest.startsWith("NEXT_REDIRECT")) return `redirect ${digest.split(";")[2]}`;
    if (digest.includes(";404")) return "404";
    throw e;
  }
}

async function apiOutcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    const { status, code } = e as { status?: number; code?: string };
    if (!status) throw e;
    return `${status} ${code}`;
  }
}

type Persona = { name: string; role?: Role; org?: "sigma" | "other"; twoFactor?: boolean };
const PERSONAS: Persona[] = [
  { name: "anonymous" },
  { name: "guest", role: "GUEST" },
  { name: "owner", role: "OWNER", org: "sigma" },
  { name: "agent without 2FA", role: "AGENT", org: "sigma" },
  { name: "agent", role: "AGENT", org: "sigma", twoFactor: true },
  { name: "admin without 2FA", role: "ADMIN", org: "sigma" },
  { name: "admin", role: "ADMIN", org: "sigma", twoFactor: true },
];

/** Expected result for a persona on a section, from the section's roles. */
function expected(p: Persona, href: AdminPath, roles: readonly Role[]): { page: string; api: string } {
  if (!p.role) return { page: `redirect /login?next=${encodeURIComponent(href)}`, api: "401 UNAUTHENTICATED" };
  if (!roles.includes(p.role)) return { page: "404", api: "403 FORBIDDEN" };
  if (!p.twoFactor && href !== TWO_FACTOR_SETUP_PATH) return { page: `redirect ${TWO_FACTOR_SETUP_PATH}`, api: "403 TWO_FACTOR_REQUIRED" };
  return { page: "ok", api: "ok" };
}

const headersOf = new Map<string, Headers>();
let otherOrg: string;

beforeAll(async () => {
  otherOrg = (await db.organization.create({ data: { name: "Autre conciergerie", slug: `authz-${Date.now()}` } })).id;
  for (const p of PERSONAS) {
    if (!p.role) {
      headersOf.set(p.name, new Headers());
      continue;
    }
    const organizationId = p.role === "GUEST" ? null : p.org === "other" ? otherOrg : sigma;
    headersOf.set(p.name, (await signedInMember({ role: p.role, organizationId, twoFactor: p.twoFactor })).headers);
  }
});

// The other organization's rows (listing, owner, admin) go with it, so files that check the seeded data
// (organizations.test.ts: nothing outside Sigma) pass whatever order the files run in.
afterAll(async () => {
  await db.listing.deleteMany({ where: { organizationId: otherOrg } });
  await db.user.deleteMany({ where: { organizationId: otherOrg } });
  await db.organization.delete({ where: { id: otherOrg } });
});

describe("every back-office section, for every kind of visitor", () => {
  for (const section of ADMIN_SECTIONS) {
    for (const p of PERSONAS) {
      it(`${section.href} · ${p.name}`, async () => {
        const headers = headersOf.get(p.name)!;
        const want = expected(p, section.href, section.roles);
        expect(await pageOutcome(section.href, headers)).toBe(want.page);
        // Server actions and API handlers of the section answer the same way, as errors.
        const api = section.href === TWO_FACTOR_SETUP_PATH ? null : want.api;
        if (api) {
          expect(await apiOutcome(() => requireAdminAction(section.href, { headers }))).toBe(api);
          expect(await apiOutcome(() => requireAdminApi(new Request("http://localhost:3100/api/admin/x", { headers }), section.href))).toBe(api);
        }
      });
    }
  }

  it("agents see only the day-to-day sections; admins see them all", () => {
    expect(navFor("AGENT").map((s) => s.href)).toEqual(["/admin", "/admin/reservations", "/admin/calendrier", "/admin/mes-taches", "/admin/ma-journee", "/admin/pannes"]);
    expect(navFor("ADMIN").map((s) => s.href)).toEqual([
      "/admin",
      "/admin/biens",
      "/admin/reservations",
      "/admin/calendrier",
      "/admin/operations",
      "/admin/mes-taches",
      "/admin/ma-journee",
      "/admin/pannes",
      "/admin/prix",
      "/admin/utilisateurs",
    ]);
  });
});

describe("GET /api/admin/dashboard", () => {
  const call = (headers: Headers) => dashboardApi(new Request("http://localhost:3100/api/admin/dashboard", { headers }));

  it("refuses anonymous (401), guests, owners (403) and staff without 2FA (403)", async () => {
    expect((await call(headersOf.get("anonymous")!)).status).toBe(401);
    for (const p of ["guest", "owner"]) {
      const r = await call(headersOf.get(p)!);
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe("FORBIDDEN");
    }
    for (const p of ["agent without 2FA", "admin without 2FA"]) {
      expect((await (await call(headersOf.get(p)!)).json()).error.code).toBe("TWO_FACTOR_REQUIRED");
    }
  });

  it("answers the caller's organization counts, not cached", async () => {
    const r = await call(headersOf.get("admin")!);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(await r.json()).toEqual(await dashboardCounts(sigma));
    expect((await call(headersOf.get("agent")!)).status).toBe(200);
  });
});

describe("organizations stay apart", () => {
  it("an admin of another organization gets their own organization, and none of Sigma's data", async () => {
    const { headers } = await signedInMember({ role: "ADMIN", organizationId: otherOrg, twoFactor: true });
    const access = await checkAccess(["ADMIN"], { headers });
    expect(access).toMatchObject({ ok: true, organizationId: otherOrg });
    const counts = await (await dashboardApi(new Request("http://localhost:3100/api/admin/dashboard", { headers }))).json();
    expect(counts).toEqual({ listings: 0, upcomingBookings: 0, licensesExpiring: 0, licensesPending: 0, tasksToday: 0, tasksUnassigned: 0, ticketsOpen: 0, ticketsUrgent: 0 });
    const own = await dashboardCounts(sigma);
    expect(own.listings).toBeGreaterThan(0);
    expect(own.upcomingBookings).toBeGreaterThan(0);
  });

  it("Sigma's dashboard ignores another organization's listings and bookings", async () => {
    const before = await dashboardCounts(sigma);
    const owner = await db.user.create({ data: { name: "P", email: `p-${Date.now()}@test.sigma.test`, role: "OWNER", organizationId: otherOrg } });
    const place = await db.place.findFirstOrThrow();
    const soon = new Date(Date.now() + 5 * 86_400_000);
    await db.listing.create({
      data: {
        title: "Autre bien",
        description: "x",
        organizationId: otherOrg,
        placeId: place.id,
        ownerId: owner.id,
        address: "x",
        lat: 0,
        lng: 0,
        maxGuests: 2,
        priceCents: 100,
        licenseExpiresAt: soon,
      },
    });
    expect(await dashboardCounts(sigma)).toEqual(before);
    expect((await dashboardCounts(otherOrg)).listings).toBe(1);
    expect((await dashboardCounts(otherOrg)).licensesExpiring).toBe(1);
  });
});

describe("access follows the database, not the session", () => {
  it("a demoted admin loses access with the same session; a re-promoted one gets it back", async () => {
    const { user, headers } = await signedInMember({ role: "ADMIN", organizationId: sigma, twoFactor: true });
    expect((await checkAccess(["ADMIN"], { headers })).ok).toBe(true);
    await db.user.update({ where: { id: user.id }, data: { role: "OWNER" } });
    expect(await checkAccess(["ADMIN"], { headers })).toEqual({ ok: false, reason: "FORBIDDEN" });
    await db.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    expect((await checkAccess(["ADMIN"], { headers })).ok).toBe(true);
  });

  it("turning 2FA off (in the database) sends staff back to enrollment", async () => {
    const { user, headers } = await signedInMember({ role: "AGENT", organizationId: sigma, twoFactor: true });
    await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } });
    expect(await checkAccess(["AGENT"], { headers })).toEqual({ ok: false, reason: "TWO_FACTOR_REQUIRED" });
  });

  it("a deleted session is refused at once", async () => {
    const { user, headers } = await signedInMember({ role: "ADMIN", organizationId: sigma, twoFactor: true });
    await db.session.deleteMany({ where: { userId: user.id } });
    expect(await checkAccess(["ADMIN"], { headers })).toEqual({ ok: false, reason: "UNAUTHENTICATED" });
  });
});

describe("every back-office file is guarded", () => {
  const root = join(__dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

  it("each /admin page calls requireAdminPage with its section's path, and every section has a page", () => {
    const pages = walk(join(root, "app/admin")).filter((f) => f.endsWith("page.tsx"));
    const hrefs = ADMIN_SECTIONS.map((s) => s.href);
    const sections = pages.map((f) => {
      const path = `/${relative(join(root, "app"), f).replace(/\/?page\.tsx$/, "")}`;
      // A sub-page (/admin/biens/[id]) takes the roles of the section it belongs to, never those of the dashboard.
      const section = hrefs.filter((h) => path === h || (h !== "/admin" && path.startsWith(`${h}/`))).sort((a, b) => b.length - a.length)[0];
      expect(section, `${path} belongs to no section`).toBeDefined();
      expect(readFileSync(f, "utf8"), path).toContain(`requireAdminPage("${section}")`);
      return section;
    });
    expect([...new Set(sections)].sort()).toEqual([...hrefs].sort());
  });

  it("each /api/admin route and /admin action file checks access", () => {
    const api = walk(join(root, "app/api/admin")).filter((f) => f.endsWith("route.ts"));
    expect(api.length).toBeGreaterThan(0);
    for (const f of api) expect(readFileSync(f, "utf8"), f).toMatch(/requireAdminApi\(request, "\/admin[^"]*"\)|requireRoleApi\(request,/);
    const actions = walk(join(root, "app/admin")).filter((f) => /\.tsx?$/.test(f) && /^["']use server["']/m.test(readFileSync(f, "utf8")));
    for (const f of actions) {
      const src = readFileSync(f, "utf8");
      const exported = src.match(/export async function/g)?.length ?? 0;
      const guarded = src.match(/await requireAdminAction\(|await requireRoleAction\(/g)?.length ?? 0;
      expect(guarded, f).toBeGreaterThanOrEqual(exported);
    }
  });
});
