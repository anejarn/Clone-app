import { describe, expect, it } from "vitest";
import { checkAccess } from "@/lib/server/authz";
import { auth } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { DEMO_BACKUP_CODES, DEMO_PASSWORD, DEMO_TOTP_SECRET } from "@/prisma/fixtures";
import { base32Decode, totpCode } from "../support/totp";
import { sigmaOrgId } from "./helpers";
import { cookieHeaders, makeMember, mergeCookies, signIn, STAFF_PASSWORD, STAFF_TOTP_SECRET } from "./staff";

const sigma = await sigmaOrgId();
const ORIGIN = new Headers({ origin: "http://localhost:3100" });

async function passwordStep(email: string, password = STAFF_PASSWORD) {
  const res = await auth.api.signInEmail({ body: { email, password }, headers: ORIGIN, asResponse: true });
  const jar = mergeCookies(new Map(), res);
  return { res, body: await res.json(), jar };
}

describe("sign-in with double authentification", () => {
  it("the password alone gives no session, only a code challenge", async () => {
    const u = await makeMember({ role: "ADMIN", organizationId: sigma, twoFactor: true });
    const { body, jar } = await passwordStep(u.email);
    expect(body).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(await auth.api.getSession({ headers: cookieHeaders(jar) })).toBeNull();
    expect(await db.session.count({ where: { userId: u.id } })).toBe(0);
  });

  it("refuses a wrong code, accepts the right one", async () => {
    const u = await makeMember({ role: "AGENT", organizationId: sigma, twoFactor: true });
    const { jar } = await passwordStep(u.email);
    const right = totpCode(STAFF_TOTP_SECRET);
    const wrong = right === "000000" ? "111111" : "000000";
    const bad = await auth.api.verifyTOTP({ body: { code: wrong }, headers: cookieHeaders(jar), asResponse: true });
    expect(bad.status).toBe(401);
    expect((await bad.json()).code).toBe("INVALID_CODE");
    const ok = await auth.api.verifyTOTP({ body: { code: right }, headers: cookieHeaders(jar), asResponse: true });
    expect(ok.status).toBe(200);
    mergeCookies(jar, ok);
    expect(await checkAccess(["AGENT"], { headers: cookieHeaders(jar) })).toMatchObject({ ok: true, organizationId: sigma });
  });

  it("a code without the password step is refused", async () => {
    const res = await auth.api.verifyTOTP({ body: { code: totpCode(STAFF_TOTP_SECRET) }, headers: ORIGIN, asResponse: true });
    expect(res.status).toBe(401);
  });

  it("a backup code works once", async () => {
    const u = await makeMember({ role: "ADMIN", organizationId: sigma, twoFactor: true });
    const first = await passwordStep(u.email);
    const ok = await auth.api.verifyBackupCode({ body: { code: "test0-00001" }, headers: cookieHeaders(first.jar), asResponse: true });
    expect(ok.status).toBe(200);
    const again = await passwordStep(u.email);
    const reused = await auth.api.verifyBackupCode({ body: { code: "test0-00001" }, headers: cookieHeaders(again.jar), asResponse: true });
    expect(reused.status).toBe(401);
  });
});

describe("enrollment", () => {
  it("staff without 2FA may only open the enrollment page; enabling it takes the secret, then a first code", async () => {
    const u = await makeMember({ role: "ADMIN", organizationId: sigma });
    let headers = await signIn(u.email);
    expect(await checkAccess(["ADMIN"], { headers })).toEqual({ ok: false, reason: "TWO_FACTOR_REQUIRED" });
    expect((await checkAccess(["ADMIN"], { headers, allowWithoutTwoFactor: true })).ok).toBe(true);

    // The password is required.
    await expect(auth.api.enableTwoFactor({ body: { password: "pas-le-bon" }, headers })).rejects.toMatchObject({ statusCode: 400 });
    const enabled = await auth.api.enableTwoFactor({ body: { password: STAFF_PASSWORD, issuer: "Sigma", method: "totp" }, headers });
    if (enabled.method !== "totp") throw new Error("expected TOTP");
    expect(enabled.totpURI).toMatch(/^otpauth:\/\/totp\/Sigma:/);
    expect(enabled.backupCodes).toHaveLength(10);
    // Not on until a code is verified, and the secret is stored encrypted.
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).twoFactorEnabled).toBe(false);
    const secret = base32Decode(new URL(enabled.totpURI).searchParams.get("secret")!);
    const row = await db.twoFactor.findUniqueOrThrow({ where: { userId: u.id } });
    expect(row.verified).toBe(false);
    expect(row.secret).not.toContain(Buffer.from(secret).toString());

    const jar = new Map(headers.get("cookie")!.split("; ").map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)] as [string, string]));
    const v = await auth.api.verifyTOTP({ body: { code: totpCode(secret) }, headers, asResponse: true });
    expect(v.status).toBe(200);
    headers = cookieHeaders(mergeCookies(jar, v));
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).twoFactorEnabled).toBe(true);
    expect((await checkAccess(["ADMIN"], { headers })).ok).toBe(true);

    // From now on the password alone isn't enough.
    expect((await passwordStep(u.email)).body.twoFactorRedirect).toBe(true);
  });

  it("a guest can't give themselves a role, an organization or 2FA at sign-up", async () => {
    const email = `signup-${Date.now()}@test.sigma.test`;
    await auth.api.signUpEmail({
      body: { name: "Malin", email, password: "motdepasse-123", role: "ADMIN", organizationId: sigma, twoFactorEnabled: true } as never,
      headers: ORIGIN,
    });
    const u = await db.user.findUniqueOrThrow({ where: { email } });
    expect(u).toMatchObject({ role: "GUEST", organizationId: null, twoFactorEnabled: false });
  });
});

describe("seeded demo accounts", () => {
  it("the demo admin and agent sign in with the documented password and TOTP secret", async () => {
    for (const email of ["amine@demo.sigma.test", "agent1@demo.sigma.test"]) {
      const headers = await signIn(email, { password: DEMO_PASSWORD, totpSecret: DEMO_TOTP_SECRET });
      expect((await checkAccess(["ADMIN", "AGENT"], { headers })).ok, email).toBe(true);
    }
  });

  it("the demo admin's backup codes are the documented ones", async () => {
    const { jar } = await passwordStep("amine@demo.sigma.test", DEMO_PASSWORD);
    const res = await auth.api.verifyBackupCode({ body: { code: DEMO_BACKUP_CODES[9] }, headers: cookieHeaders(jar), asResponse: true });
    expect(res.status).toBe(200);
  });

  it("Felicia (admin) has a password but still has to enroll", async () => {
    const headers = await signIn("felicia@demo.sigma.test", { password: DEMO_PASSWORD });
    expect(await checkAccess(["ADMIN"], { headers })).toEqual({ ok: false, reason: "TWO_FACTOR_REQUIRED" });
  });
});
