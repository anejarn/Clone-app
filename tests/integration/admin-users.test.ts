import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Utilisateurs (Lot 2c) through the real server actions, signed in as each kind of visitor: next/headers is pointed
 * at the test session, next/cache's request-only calls are stubbed. Every row this file creates (users,
 * invitations, audit entries, an organization) is removed at the end.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    has: () => false,
    set: () => {},
    delete: () => {},
  }),
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  updateTag: vi.fn(),
  refresh: vi.fn(),
}));

const actions = await import("@/app/admin/utilisateurs/actions");
const accept = await import("@/app/invitation/[token]/actions");
const { changeUserRole, createInvitation, getOrgUser, listInvitations, listOrgUsers } = await import("@/lib/server/admin/users");
const { viewInvitation } = await import("@/lib/server/invitations");
const { hashInvitationToken, TOKEN_RE } = await import("@/lib/server/admin/invitation-token");
const { checkAccess } = await import("@/lib/server/authz");
const { auth } = await import("@/lib/server/auth");
const { db } = await import("@/lib/server/db");
const { sigmaOrgId } = await import("./helpers");
const { makeMember, signIn, signedInMember, STAFF_PASSWORD } = await import("./staff");

const sigma = await sigmaOrgId();
const TOKEN = `u${Date.now()}`;
const ORIGIN = new Headers({ origin: "http://localhost:3100" });
const NEW_PASSWORD = "motdepasse-invite";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];
let n = 0;
const inviteEmail = (tag = "inv") => `${tag}-${TOKEN}-${++n}@test.sigma.test`;

let admin: { user: { id: string; email: string }; headers: Headers };
const refused = new Map<string, Headers>();

const as = (h: Headers) => {
  ctx.headers = h;
};

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

/** Runs a server action that may redirect; returns its state or the redirect target. */
async function run<T>(fn: () => Promise<T>): Promise<T | { redirect: string }> {
  try {
    return await fn();
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return { redirect: digest.split(";")[2] };
    throw e;
  }
}

async function member(opts: { role: Role; organizationId: string | null; twoFactor?: boolean; name?: string }) {
  const m = await signedInMember(opts);
  createdUsers.push(m.user.id);
  return m;
}

async function orgWithAdmin() {
  const org = await db.organization.create({
    data: { name: `Autre ${TOKEN}`, slug: `users-${TOKEN}-${++n}` },
  });
  createdOrgs.push(org.id);
  return {
    org: org.id,
    admin: await member({
      role: "ADMIN",
      organizationId: org.id,
      twoFactor: true,
    }),
  };
}

/** Invites as the Sigma admin and returns the token from the link. */
async function invite(role: "OWNER" | "AGENT" | "ADMIN", email = inviteEmail(), phone = "") {
  as(admin.headers);
  const state = await actions.inviteUserAction({}, form({ email, role, phone }));
  if (!state.issued) throw new Error(`invite failed: ${JSON.stringify(state)}`);
  const token = state.issued.link.split("/invitation/")[1];
  return { email, token, issued: state.issued };
}

const accessOf = (headers: Headers) =>
  checkAccess(["ADMIN", "AGENT", "OWNER"], {
    headers,
    allowWithoutTwoFactor: true,
  });

beforeAll(async () => {
  admin = await member({
    role: "ADMIN",
    organizationId: sigma,
    twoFactor: true,
    name: `Admin ${TOKEN}`,
  });
  refused.set("anonymous", new Headers());
  refused.set("guest", (await member({ role: "GUEST", organizationId: null })).headers);
  refused.set("owner", (await member({ role: "OWNER", organizationId: sigma })).headers);
  refused.set("agent", (await member({ role: "AGENT", organizationId: sigma, twoFactor: true })).headers);
  refused.set("admin without 2FA", (await member({ role: "ADMIN", organizationId: sigma })).headers);
});

afterAll(async () => {
  const orgs = [sigma, ...createdOrgs];
  const accepted = await db.user.findMany({
    where: { email: { contains: TOKEN } },
    select: { id: true },
  });
  const userIds = [...createdUsers, ...accepted.map((u) => u.id)];
  const invitations = await db.invitation.findMany({
    where: {
      OR: [
        { email: { contains: TOKEN } },
        { organizationId: { in: createdOrgs } },
        { invitedById: { in: userIds } },
        { acceptedById: { in: userIds } },
      ],
    },
    select: { id: true },
  });
  const invIds = invitations.map((i) => i.id);
  await db.auditLog.deleteMany({
    where: {
      organizationId: { in: orgs },
      OR: [{ actorId: { in: userIds } }, { targetId: { in: [...userIds, ...invIds] } }, { organizationId: { in: createdOrgs } }],
    },
  });
  await db.invitation.deleteMany({ where: { id: { in: invIds } } });
  await db.listing.deleteMany({
    where: { organizationId: { in: createdOrgs } },
  });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.organization.deleteMany({ where: { id: { in: createdOrgs } } });
});

describe("only admins of the organization, with double authentification, may manage users", () => {
  it("every action refuses anonymous visitors, guests, owners, agents and admins without 2FA, and changes nothing", async () => {
    const target = await member({
      role: "AGENT",
      organizationId: sigma,
      twoFactor: true,
    });
    const { email: pendingEmail } = await invite("OWNER");
    const inv = await db.invitation.findFirstOrThrow({
      where: { email: pendingEmail },
    });
    const snapshot = async () => ({
      user: await db.user.findUniqueOrThrow({
        where: { id: target.user.id },
        select: { role: true, twoFactorEnabled: true, deactivatedAt: true },
      }),
      sessions: await db.session.count({ where: { userId: target.user.id } }),
      inv: await db.invitation.findUniqueOrThrow({
        where: { id: inv.id },
        select: { tokenHash: true, revokedAt: true },
      }),
      invitations: await db.invitation.count({
        where: { organizationId: sigma },
      }),
      audit: await db.auditLog.count({ where: { organizationId: sigma } }),
    });
    const before = await snapshot();
    for (const [name, headers] of refused) {
      as(headers);
      const results = [
        await actions.inviteUserAction({}, form({ email: inviteEmail("refused"), role: "ADMIN", phone: "" })),
        await actions.resendInvitationAction(inv.id),
        await actions.revokeInvitationAction(inv.id),
        await actions.changeRoleAction(target.user.id, {}, form({ role: "ADMIN" })),
        await actions.resetTwoFactorAction(target.user.id, {}, form({ password: STAFF_PASSWORD, confirm: "on" })),
        await actions.setUserActiveAction(target.user.id, false, {}, form({ confirm: "on" })),
      ];
      const expected =
        name === "anonymous"
          ? "Connectez-vous pour continuer."
          : name === "admin without 2FA"
            ? "Activez la double authentification pour accéder à l'espace équipe."
            : "Accès refusé.";
      for (const r of results) expect(r, name).toEqual({ error: expected });
    }
    expect(await snapshot()).toEqual(before);
  });

  it("an admin of another organization gets 404 on Sigma's users and invitations, and changes nothing", async () => {
    const other = await orgWithAdmin();
    const target = await member({
      role: "AGENT",
      organizationId: sigma,
      twoFactor: true,
    });
    const { email } = await invite("AGENT");
    const inv = await db.invitation.findFirstOrThrow({ where: { email } });
    as(other.admin.headers);
    expect(await actions.changeRoleAction(target.user.id, {}, form({ role: "GUEST" }))).toEqual({ error: "Utilisateur introuvable." });
    expect(await actions.resetTwoFactorAction(target.user.id, {}, form({ password: STAFF_PASSWORD, confirm: "on" }))).toEqual({
      error: "Utilisateur introuvable.",
    });
    expect(await actions.setUserActiveAction(target.user.id, false, {}, form({ confirm: "on" }))).toEqual({ error: "Utilisateur introuvable." });
    expect(await actions.resendInvitationAction(inv.id)).toEqual({
      error: "Invitation introuvable.",
    });
    expect(await actions.revokeInvitationAction(inv.id)).toEqual({
      error: "Invitation introuvable.",
    });
    expect(await actions.changeRoleAction("not an id!", {}, form({ role: "GUEST" }))).toEqual({ error: "Utilisateur introuvable." });

    const t = await db.user.findUniqueOrThrow({
      where: { id: target.user.id },
    });
    expect(t).toMatchObject({
      role: "AGENT",
      twoFactorEnabled: true,
      deactivatedAt: null,
      organizationId: sigma,
    });
    expect(await db.session.count({ where: { userId: target.user.id } })).toBeGreaterThan(0);
    expect(await db.invitation.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ revokedAt: null, tokenHash: inv.tokenHash });

    // Lists and lookups stay within the organization.
    expect(await getOrgUser(other.org, target.user.id)).toBeNull();
    expect((await listOrgUsers(other.org)).map((u) => u.id)).toEqual([other.admin.user.id]);
    expect(await listInvitations(other.org)).toEqual([]);
    expect((await listOrgUsers(sigma)).some((u) => u.id === other.admin.user.id)).toBe(false);
  });
});

describe("inviting", () => {
  it("issues a single link whose token is stored only as a hash, and records it", async () => {
    const email = inviteEmail("Hash").toUpperCase();
    const { token, issued } = await invite("AGENT", email, "06 12 34 56 78");
    expect(token).toMatch(TOKEN_RE);
    expect(issued.link).toBe(`http://localhost:3100/invitation/${token}`);
    expect(issued.whatsapp).toMatch(/^https:\/\/wa\.me\/212612345678\?text=/);
    expect(decodeURIComponent(issued.whatsapp)).toContain(issued.link);
    expect(issued.delivered).toBe(false);
    const row = await db.invitation.findFirstOrThrow({
      where: { email: email.toLowerCase() },
    });
    expect(row).toMatchObject({
      organizationId: sigma,
      role: "AGENT",
      invitedById: admin.user.id,
      tokenHash: hashInvitationToken(token),
      acceptedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { targetId: row.id, action: "invitation.created" },
    });
    expect(audit).toMatchObject({
      organizationId: sigma,
      actorId: admin.user.id,
      targetType: "invitation",
    });
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("refuses a second pending invitation for the same address, a member's address, a guest role and bad input", async () => {
    const { email } = await invite("OWNER");
    as(admin.headers);
    expect((await actions.inviteUserAction({}, form({ email, role: "AGENT", phone: "" }))).error).toMatch(/déjà en attente/);
    const existing = await member({ role: "AGENT", organizationId: sigma });
    const u = await db.user.findUniqueOrThrow({
      where: { id: existing.user.id },
    });
    expect((await actions.inviteUserAction({}, form({ email: u.email, role: "ADMIN", phone: "" }))).error).toMatch(/déjà membre/);
    const bad = await actions.inviteUserAction({}, form({ email: "pas-une-adresse", role: "GUEST", phone: "" }));
    expect(bad.error).toBe("Corrigez les champs signalés.");
    expect(Object.keys(bad.fieldErrors ?? {}).sort()).toEqual(["email", "role"]);
    expect(await db.invitation.count({ where: { email } })).toBe(1);
  });
});

describe("accepting an invitation with a new account", () => {
  it("creates the account with the invited role and the inviter's organization; staff go to 2FA enrollment", async () => {
    const { email, token } = await invite("AGENT");
    expect(await viewInvitation(token)).toMatchObject({
      status: "PENDING",
      email,
      role: "AGENT",
      organizationName: "Sigma",
      accountExists: false,
    });
    as(new Headers(ORIGIN));
    const r = await run(() => accept.acceptWithNewAccountAction(token, {}, form({ name: "Youssef Invité", password: NEW_PASSWORD })));
    expect(r).toEqual({ redirect: "/admin/securite" });
    const u = await db.user.findUniqueOrThrow({ where: { email } });
    expect(u).toMatchObject({
      name: "Youssef Invité",
      role: "AGENT",
      organizationId: sigma,
      emailVerified: true,
      twoFactorEnabled: false,
    });
    expect(await db.invitation.findFirstOrThrow({ where: { email } })).toMatchObject({ acceptedById: u.id });
    expect(
      await db.auditLog.count({
        where: { actorId: u.id, action: "invitation.accepted" },
      }),
    ).toBe(1);

    // Signs in with the chosen password; the back-office then requires double authentification.
    const headers = await signIn(email, { password: NEW_PASSWORD });
    expect(await checkAccess(["AGENT"], { headers })).toEqual({
      ok: false,
      reason: "TWO_FACTOR_REQUIRED",
    });
    expect(await checkAccess(["AGENT"], { headers, allowWithoutTwoFactor: true })).toMatchObject({ ok: true, organizationId: sigma });
    expect((await checkAccess(["ADMIN"], { headers, allowWithoutTwoFactor: true })).ok).toBe(false);

    // The link works once.
    const again = await run(() => accept.acceptWithNewAccountAction(token, {}, form({ name: "Autre", password: NEW_PASSWORD })));
    expect(again).toMatchObject({
      error: "Cette invitation a déjà été utilisée.",
    });
    expect((await viewInvitation(token))?.status).toBe("ACCEPTED");
  });

  it("an owner lands on the invitation page, which then welcomes them", async () => {
    const { email, token } = await invite("OWNER");
    as(new Headers(ORIGIN));
    expect(await run(() => accept.acceptWithNewAccountAction(token, {}, form({ name: "Nouvelle propriétaire", password: NEW_PASSWORD })))).toEqual({
      redirect: `/invitation/${token}`,
    });
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ role: "OWNER", organizationId: sigma });
  });

  it("concurrent accepts of one link: exactly one account", async () => {
    const { email, token } = await invite("OWNER");
    as(new Headers(ORIGIN));
    const results = await Promise.all(
      [1, 2, 3].map((i) => run(() => accept.acceptWithNewAccountAction(token, {}, form({ name: `Course ${i}`, password: NEW_PASSWORD })))),
    );
    expect(results.filter((r) => "redirect" in r)).toHaveLength(1);
    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  it("refuses an unknown, expired, revoked or replaced link, and invalid input, creating nothing", async () => {
    as(new Headers(ORIGIN));
    const ok = { name: "X", password: NEW_PASSWORD };
    expect(await accept.acceptWithNewAccountAction("A".repeat(43), {}, form(ok))).toMatchObject({ error: expect.stringMatching(/introuvable/) });
    expect(await accept.acceptWithNewAccountAction("../../etc", {}, form(ok))).toMatchObject({ error: expect.stringMatching(/introuvable/) });
    expect(await viewInvitation("A".repeat(43))).toBeNull();

    const expired = await invite("AGENT");
    await db.invitation.updateMany({
      where: { email: expired.email },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await viewInvitation(expired.token))?.status).toBe("EXPIRED");
    expect(await accept.acceptWithNewAccountAction(expired.token, {}, form(ok))).toMatchObject({ error: expect.stringMatching(/expiré/) });

    // Resending gives a new link; the old one is gone.
    as(admin.headers);
    const inv = await db.invitation.findFirstOrThrow({
      where: { email: expired.email },
    });
    const resent = await actions.resendInvitationAction(inv.id);
    const fresh = resent.issued!.link.split("/invitation/")[1];
    expect(fresh).not.toBe(expired.token);
    expect(await viewInvitation(expired.token)).toBeNull();
    expect((await viewInvitation(fresh))?.status).toBe("PENDING");

    // Revoked: the link stops working, and can't be resent.
    expect(await actions.revokeInvitationAction(inv.id)).toEqual({
      message: "Invitation révoquée.",
    });
    expect((await viewInvitation(fresh))?.status).toBe("REVOKED");
    expect((await actions.resendInvitationAction(inv.id)).error).toMatch(/révoquée/);
    as(new Headers(ORIGIN));
    expect(await accept.acceptWithNewAccountAction(fresh, {}, form(ok))).toMatchObject({ error: expect.stringMatching(/annulée/) });

    const pending = await invite("AGENT");
    as(new Headers(ORIGIN));
    const bad = await accept.acceptWithNewAccountAction(pending.token, {}, form({ name: "", password: "court" }));
    expect(Object.keys(bad.fieldErrors ?? {}).sort()).toEqual(["name", "password"]);
    expect(
      await db.user.count({
        where: { email: { in: [expired.email, pending.email] } },
      }),
    ).toBe(0);
    expect((await viewInvitation(pending.token))?.status).toBe("PENDING");

    // A revoked or accepted invitation can't be revoked again.
    expect((await db.invitation.findUniqueOrThrow({ where: { id: inv.id } })).revokedAt).not.toBeNull();
  });

  it("refuses to create a second account for an existing e-mail", async () => {
    const guest = await member({ role: "GUEST", organizationId: null });
    const email = (await db.user.findUniqueOrThrow({ where: { id: guest.user.id } })).email;
    const { token } = await invite("OWNER", email);
    expect((await viewInvitation(token))?.accountExists).toBe(true);
    as(new Headers(ORIGIN));
    expect((await accept.acceptWithNewAccountAction(token, {}, form({ name: "Double", password: NEW_PASSWORD }))).error).toMatch(
      /compte existe déjà/,
    );
    expect((await viewInvitation(token))?.status).toBe("PENDING");
  });
});

describe("accepting with an existing account", () => {
  it("a signed-in guest with the invited e-mail becomes a member with the role", async () => {
    const guest = await member({ role: "GUEST", organizationId: null });
    const email = (await db.user.findUniqueOrThrow({ where: { id: guest.user.id } })).email;
    const { token } = await invite("OWNER", email, "+33 6 11 22 33 44");

    as(new Headers(ORIGIN));
    expect(await accept.acceptWithExistingAccountAction(token)).toEqual({
      error: "Connectez-vous pour accepter l'invitation.",
    });
    const stranger = await member({ role: "GUEST", organizationId: null });
    as(stranger.headers);
    expect((await accept.acceptWithExistingAccountAction(token)).error).toMatch(/autre adresse/);
    expect((await viewInvitation(token))?.status).toBe("PENDING");

    as(guest.headers);
    expect(await run(() => accept.acceptWithExistingAccountAction(token))).toEqual({ redirect: `/invitation/${token}` });
    expect(await db.user.findUniqueOrThrow({ where: { id: guest.user.id } })).toMatchObject({
      role: "OWNER",
      organizationId: sigma,
      phone: "+33 6 11 22 33 44",
    });
    expect(await accept.acceptWithExistingAccountAction(token)).toMatchObject({
      error: expect.stringMatching(/déjà été utilisée/),
    });
  });

  it("an account of another organization can't be moved into Sigma", async () => {
    const other = await orgWithAdmin();
    const email = (await db.user.findUniqueOrThrow({ where: { id: other.admin.user.id } })).email;
    const { token } = await invite("AGENT", email);
    as(other.admin.headers);
    expect((await accept.acceptWithExistingAccountAction(token)).error).toMatch(/autre organisation/);
    expect(await db.user.findUniqueOrThrow({ where: { id: other.admin.user.id } })).toMatchObject({ role: "ADMIN", organizationId: other.org });
    expect((await viewInvitation(token))?.status).toBe("PENDING");
  });
});

describe("public sign-up", () => {
  it("never grants a role or an organization, even for an invited e-mail", async () => {
    const { email, token } = await invite("ADMIN");
    await auth.api.signUpEmail({
      body: {
        name: "Malin",
        email,
        password: NEW_PASSWORD,
        role: "ADMIN",
        organizationId: sigma,
      } as never,
      headers: ORIGIN,
    });
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ role: "GUEST", organizationId: null });
    expect((await viewInvitation(token))?.status).toBe("PENDING");
  });
});

describe("changing a role", () => {
  it("applies at once, signs the person out and is recorded", async () => {
    const target = await member({
      role: "AGENT",
      organizationId: sigma,
      twoFactor: true,
    });
    expect((await checkAccess(["AGENT"], { headers: target.headers })).ok).toBe(true);
    as(admin.headers);
    expect(await actions.changeRoleAction(target.user.id, {}, form({ role: "OWNER" }))).toEqual({ message: expect.stringMatching(/Rôle modifié/) });
    expect((await db.user.findUniqueOrThrow({ where: { id: target.user.id } })).role).toBe("OWNER");
    expect(await db.session.count({ where: { userId: target.user.id } })).toBe(0);
    expect(await checkAccess(["AGENT"], { headers: target.headers })).toEqual({
      ok: false,
      reason: "UNAUTHENTICATED",
    });
    expect(
      await db.auditLog.findFirstOrThrow({
        where: { targetId: target.user.id, action: "user.role_changed" },
      }),
    ).toMatchObject({
      actorId: admin.user.id,
      details: { from: "AGENT", to: "OWNER" },
    });
    // A guest of the organization stays listed and can be promoted again.
    expect(await actions.changeRoleAction(target.user.id, {}, form({ role: "GUEST" }))).toMatchObject({ message: expect.any(String) });
    expect((await listOrgUsers(sigma, { role: "GUEST" })).some((u) => u.id === target.user.id)).toBe(true);
    expect(await actions.changeRoleAction(target.user.id, {}, form({ role: "GUEST" }))).toEqual({ message: "Le rôle était déjà celui-ci." });
    expect(await actions.changeRoleAction(target.user.id, {}, form({ role: "ROOT" }))).toEqual({ error: "Rôle inconnu." });
  });

  it("an owner with listings keeps the OWNER role until the listings change owner", async () => {
    const owner = await db.user.findFirstOrThrow({
      where: { organizationId: sigma, role: "OWNER", listings: { some: {} } },
    });
    as(admin.headers);
    const r = await actions.changeRoleAction(owner.id, {}, form({ role: "AGENT" }));
    expect(r.error).toMatch(/Ce propriétaire a \d+ biens? : choisissez d'abord un autre propriétaire/);
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).role).toBe("OWNER");
  });

  it("the last active admin of an organization can't demote themself; with a second admin they can, and are signed out", async () => {
    const other = await orgWithAdmin();
    as(other.admin.headers);
    expect((await actions.changeRoleAction(other.admin.user.id, {}, form({ role: "AGENT" }))).error).toMatch(/dernier associé/);
    // A deactivated admin doesn't count.
    const dormant = await makeMember({
      role: "ADMIN",
      organizationId: other.org,
    });
    createdUsers.push(dormant.id);
    await db.user.update({
      where: { id: dormant.id },
      data: { deactivatedAt: new Date() },
    });
    expect((await actions.changeRoleAction(other.admin.user.id, {}, form({ role: "AGENT" }))).error).toMatch(/dernier associé/);
    expect(await actions.setUserActiveAction(dormant.id, true, {}, form({}))).toEqual({ message: "Compte réactivé." });
    expect(await run(() => actions.changeRoleAction(other.admin.user.id, {}, form({ role: "AGENT" })))).toEqual({ redirect: "/login" });
    expect((await db.user.findUniqueOrThrow({ where: { id: other.admin.user.id } })).role).toBe("AGENT");
    expect(await checkAccess(["ADMIN", "AGENT"], { headers: other.admin.headers })).toEqual({ ok: false, reason: "UNAUTHENTICATED" });
  });

  it("two admins demoting each other at the same time: one succeeds, the organization keeps an admin", async () => {
    const other = await orgWithAdmin();
    const second = await member({
      role: "ADMIN",
      organizationId: other.org,
      twoFactor: true,
    });
    const a = {
      user: {
        ...other.admin.user,
        role: "ADMIN" as const,
        twoFactorEnabled: true,
      },
      organizationId: other.org,
    };
    const b = {
      user: { ...second.user, role: "ADMIN" as const, twoFactorEnabled: true },
      organizationId: other.org,
    };
    const results = await Promise.allSettled([changeUserRole(a, second.user.id, "AGENT"), changeUserRole(b, other.admin.user.id, "AGENT")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.user.count({
        where: { organizationId: other.org, role: "ADMIN" },
      }),
    ).toBe(1);
  });
});

describe("resetting double authentification", () => {
  it("needs the acting admin's password and a confirmation; never on oneself", async () => {
    const target = await member({
      role: "AGENT",
      organizationId: sigma,
      twoFactor: true,
    });
    as(admin.headers);
    expect(await actions.resetTwoFactorAction(target.user.id, {}, form({ password: "pas-le-bon", confirm: "on" }))).toEqual({
      error: "Mot de passe incorrect.",
    });
    expect(await actions.resetTwoFactorAction(target.user.id, {}, form({ password: STAFF_PASSWORD }))).toEqual({
      error: "Cochez la case pour confirmer.",
    });
    expect((await actions.resetTwoFactorAction(admin.user.id, {}, form({ password: STAFF_PASSWORD, confirm: "on" }))).error).toMatch(
      /Sécurité du compte/,
    );
    expect(
      await db.twoFactor.count({
        where: { userId: { in: [target.user.id, admin.user.id] } },
      }),
    ).toBe(2);
    expect(await db.session.count({ where: { userId: target.user.id } })).toBeGreaterThan(0);
  });

  it("removes the secret, signs the person out; their next sign-in asks for a new enrollment", async () => {
    const target = await member({
      role: "AGENT",
      organizationId: sigma,
      twoFactor: true,
    });
    as(admin.headers);
    expect((await actions.resetTwoFactorAction(target.user.id, {}, form({ password: STAFF_PASSWORD, confirm: "on" }))).message).toMatch(
      /réinitialisée/,
    );
    expect(await db.user.findUniqueOrThrow({ where: { id: target.user.id } })).toMatchObject({ twoFactorEnabled: false });
    expect(await db.twoFactor.count({ where: { userId: target.user.id } })).toBe(0);
    expect(await checkAccess(["AGENT"], { headers: target.headers })).toEqual({
      ok: false,
      reason: "UNAUTHENTICATED",
    });
    // Password only now, then enrollment.
    const res = await auth.api.signInEmail({
      body: {
        email: (await db.user.findUniqueOrThrow({ where: { id: target.user.id } })).email,
        password: STAFF_PASSWORD,
      },
      headers: ORIGIN,
    });
    expect("twoFactorRedirect" in res && res.twoFactorRedirect).toBeFalsy();
    const headers = await signIn((await db.user.findUniqueOrThrow({ where: { id: target.user.id } })).email);
    expect(await checkAccess(["AGENT"], { headers })).toEqual({
      ok: false,
      reason: "TWO_FACTOR_REQUIRED",
    });
    expect(
      await db.auditLog.count({
        where: {
          targetId: target.user.id,
          action: "user.two_factor_reset",
          actorId: admin.user.id,
        },
      }),
    ).toBe(1);
    // Nothing left to reset.
    expect((await actions.resetTwoFactorAction(target.user.id, {}, form({ password: STAFF_PASSWORD, confirm: "on" }))).error).toMatch(
      /pas de double authentification/,
    );
  });
});

describe("deactivating an account", () => {
  it("blocks sign-in and revokes the sessions; reactivating gives access back; never on oneself", async () => {
    const target = await member({
      role: "AGENT",
      organizationId: sigma,
      twoFactor: true,
    });
    const email = (await db.user.findUniqueOrThrow({ where: { id: target.user.id } })).email;
    as(admin.headers);
    expect(await actions.setUserActiveAction(target.user.id, false, {}, form({}))).toEqual({ error: "Cochez la case pour confirmer." });
    expect((await actions.setUserActiveAction(admin.user.id, false, {}, form({ confirm: "on" }))).error).toMatch(/propre compte/);
    expect((await actions.setUserActiveAction(target.user.id, false, {}, form({ confirm: "on" }))).message).toMatch(/désactivé/);
    expect((await db.user.findUniqueOrThrow({ where: { id: target.user.id } })).deactivatedAt).not.toBeNull();
    expect(await db.session.count({ where: { userId: target.user.id } })).toBe(0);
    expect(await accessOf(target.headers)).toEqual({
      ok: false,
      reason: "UNAUTHENTICATED",
    });

    const res = await auth.api.signInEmail({
      body: { email, password: STAFF_PASSWORD },
      headers: ORIGIN,
      asResponse: true,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("ACCOUNT_DEACTIVATED");
    expect(await db.session.count({ where: { userId: target.user.id } })).toBe(0);
    // Still listed, nothing deleted.
    expect((await listOrgUsers(sigma)).find((u) => u.id === target.user.id)?.deactivatedAt).not.toBeNull();

    expect(await actions.setUserActiveAction(target.user.id, true, {}, form({}))).toEqual({ message: "Compte réactivé." });
    const headers = await signIn(email);
    expect((await checkAccess(["AGENT"], { headers })).ok).toBe(true);
    const lastSignInAt = (await db.user.findUniqueOrThrow({ where: { id: target.user.id } })).lastSignInAt;
    expect(Date.now() - (lastSignInAt?.getTime() ?? 0)).toBeLessThan(60_000);
    expect(
      await db.auditLog.count({
        where: {
          targetId: target.user.id,
          action: { in: ["user.deactivated", "user.reactivated"] },
        },
      }),
    ).toBe(2);
  });

  it("a deactivated account can't accept an invitation either", async () => {
    const other = await orgWithAdmin();
    const guest = await member({ role: "GUEST", organizationId: null });
    const email = (await db.user.findUniqueOrThrow({ where: { id: guest.user.id } })).email;
    const actor = {
      user: {
        ...other.admin.user,
        role: "ADMIN" as const,
        twoFactorEnabled: true,
      },
      organizationId: other.org,
    };
    const issued = await createInvitation(actor, {
      email,
      role: "OWNER",
      phone: null,
    });
    await db.user.update({
      where: { id: guest.user.id },
      data: { deactivatedAt: new Date() },
    });
    as(guest.headers);
    expect((await accept.acceptWithExistingAccountAction(issued.token)).error).toBeDefined();
    expect(await db.user.findUniqueOrThrow({ where: { id: guest.user.id } })).toMatchObject({ role: "GUEST", organizationId: null });
  });
});
