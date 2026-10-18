import { hashPassword, symmetricEncrypt } from "better-auth/crypto";
import type { Role } from "@/lib/generated/prisma/enums";
import { auth } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { TEST_AUTH_SECRET, totpCode } from "../support/totp";

/** Accounts with a role, a password and optionally double authentification, signed in in-process. */

export const STAFF_PASSWORD = "motdepasse-staff";
export const STAFF_TOTP_SECRET = "integration-totp-secret-0123456789";
let hash: Promise<string> | undefined;
let n = 0;

export async function makeMember(opts: { role: Role; organizationId: string | null; twoFactor?: boolean; name?: string }) {
  n += 1;
  const email = `${opts.role.toLowerCase()}-${Date.now()}-${n}@test.sigma.test`;
  const user = await db.user.create({
    data: { name: opts.name ?? `Test ${opts.role}`, email, role: opts.role, organizationId: opts.organizationId, emailVerified: true },
  });
  hash ??= hashPassword(STAFF_PASSWORD);
  await db.account.create({ data: { id: `acc_${user.id}`, accountId: user.id, providerId: "credential", userId: user.id, password: await hash } });
  if (opts.twoFactor) {
    const secret = await symmetricEncrypt({ key: TEST_AUTH_SECRET, data: STAFF_TOTP_SECRET });
    const backupCodes = await symmetricEncrypt({ key: TEST_AUTH_SECRET, data: JSON.stringify(["test0-00001", "test0-00002"]) });
    await db.twoFactor.create({ data: { id: `tf_${user.id}`, userId: user.id, secret, backupCodes, verified: true } });
    await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  }
  return user;
}

/** "name=value" pairs from a response's Set-Cookie headers, merged into `jar`. */
export function mergeCookies(jar: Map<string, string>, res: Response) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    const name = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (value === "" || /max-age=0/i.test(c)) jar.delete(name);
    else jar.set(name, value);
  }
  return jar;
}

export const cookieHeaders = (jar: Map<string, string>) =>
  new Headers({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), origin: "http://localhost:3100" });

/** Signs in with the password, then the TOTP code when the account has double authentification. Returns request headers. */
export async function signIn(email: string, { password = STAFF_PASSWORD, totpSecret = STAFF_TOTP_SECRET } = {}): Promise<Headers> {
  const jar = new Map<string, string>();
  const res = await auth.api.signInEmail({ body: { email, password }, headers: new Headers({ origin: "http://localhost:3100" }), asResponse: true });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  mergeCookies(jar, res);
  const body = await res.json();
  if (body.twoFactorRedirect) {
    const v = await auth.api.verifyTOTP({ body: { code: totpCode(totpSecret) }, headers: cookieHeaders(jar), asResponse: true });
    if (!v.ok) throw new Error(`TOTP failed: ${v.status} ${await v.text()}`);
    mergeCookies(jar, v);
  }
  return cookieHeaders(jar);
}

export async function signedInMember(opts: Parameters<typeof makeMember>[0]) {
  const user = await makeMember(opts);
  return { user, headers: await signIn(user.email) };
}
