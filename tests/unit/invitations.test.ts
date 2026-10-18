import { describe, expect, it } from "vitest";
import {
  acceptSchema,
  INVITATION_DAYS,
  invitationExpiry,
  invitationStatus,
  invitationText,
  inviteSchema,
  roleSchema,
  whatsappNumber,
  whatsappShareLink,
} from "@/lib/admin/users";
import { formatDateTime } from "@/lib/format";
import { createNotifier, NoopNotifier } from "@/lib/notifications";
import { generateInvitationToken, hashInvitationToken, TOKEN_RE, tokenMatches } from "@/lib/server/admin/invitation-token";

describe("invitation tokens", () => {
  it("are 256 random bits in base64url, never twice the same", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateInvitationToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(TOKEN_RE);
      expect(Buffer.from(t, "base64url")).toHaveLength(32);
    }
  });

  it("are stored as a SHA-256 hash that doesn't contain the token", () => {
    const t = generateInvitationToken();
    const h = hashInvitationToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashInvitationToken(t));
    expect(h).not.toContain(t);
    expect(hashInvitationToken(generateInvitationToken())).not.toBe(h);
  });

  it("match only their own hash", () => {
    const t = generateInvitationToken();
    expect(tokenMatches(t, hashInvitationToken(t))).toBe(true);
    expect(tokenMatches(generateInvitationToken(), hashInvitationToken(t))).toBe(false);
    expect(tokenMatches(t, "abc")).toBe(false);
  });

  it("the format check refuses anything else", () => {
    for (const bad of ["", "x", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}/`, `../${"a".repeat(40)}`]) {
      expect(TOKEN_RE.test(bad), bad).toBe(false);
    }
  });
});

describe("invitation status and expiry", () => {
  const now = new Date("2026-10-18T12:00:00Z");

  it(`expires ${INVITATION_DAYS} days after it is issued, to the millisecond`, () => {
    const exp = invitationExpiry(now);
    expect(exp.getTime() - now.getTime()).toBe(7 * 86_400_000);
    const open = { acceptedAt: null, revokedAt: null, expiresAt: exp };
    expect(invitationStatus(open, new Date(exp.getTime() - 1))).toBe("PENDING");
    expect(invitationStatus(open, exp)).toBe("EXPIRED");
    expect(invitationStatus(open, new Date(exp.getTime() + 1))).toBe("EXPIRED");
  });

  it("accepted and revoked are final, whatever the date", () => {
    const past = new Date(now.getTime() - 1000);
    expect(invitationStatus({ acceptedAt: past, revokedAt: null, expiresAt: past }, now)).toBe("ACCEPTED");
    expect(invitationStatus({ acceptedAt: null, revokedAt: past, expiresAt: invitationExpiry(now) }, now)).toBe("REVOKED");
  });
});

describe("WhatsApp share link", () => {
  it("normalizes numbers: international, 00, Moroccan local", () => {
    expect(whatsappNumber("+212 6 12 34 56 78")).toBe("212612345678");
    expect(whatsappNumber("00212612345678")).toBe("212612345678");
    expect(whatsappNumber("06 12 34 56 78")).toBe("212612345678");
    expect(whatsappNumber("07.12.34.56.78")).toBe("212712345678");
    expect(whatsappNumber("+33 6 12 34 56 78")).toBe("33612345678");
    expect(whatsappNumber("")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
    expect(whatsappNumber("12")).toBeNull();
    expect(whatsappNumber("+0612")).toBeNull();
  });

  it("is a wa.me link with the text encoded, with or without a number", () => {
    expect(whatsappShareLink("Bonjour & bienvenue ?", "0612345678")).toBe("https://wa.me/212612345678?text=Bonjour%20%26%20bienvenue%20%3F");
    expect(whatsappShareLink("x")).toBe("https://wa.me/?text=x");
  });

  it("the message names the organization, the role and the link", () => {
    const { subject, text } = invitationText({
      organizationName: "Sigma",
      role: "AGENT",
      link: "https://x.test/invitation/abc",
      inviterName: "Amine",
    });
    expect(subject).toBe("Invitation à rejoindre Sigma");
    expect(text).toContain("Amine vous invite à rejoindre Sigma en tant que agent terrain");
    expect(text).toContain("https://x.test/invitation/abc");
    expect(text).toContain("7 jours");
  });
});

describe("forms", () => {
  it("an invitation needs an e-mail (lower-cased) and a team or owner role, never GUEST", () => {
    expect(
      inviteSchema.parse({
        email: "  Nadia@Example.COM ",
        role: "OWNER",
        phone: "",
      }),
    ).toEqual({ email: "nadia@example.com", role: "OWNER", phone: null });
    expect(inviteSchema.parse({ email: "a@b.ma", role: "ADMIN", phone: "+212 612" }).phone).toBe("+212 612");
    expect(inviteSchema.safeParse({ email: "a@b.ma", role: "GUEST", phone: "" }).success).toBe(false);
    expect(
      inviteSchema.safeParse({
        email: "pas-une-adresse",
        role: "AGENT",
        phone: "",
      }).success,
    ).toBe(false);
    expect(inviteSchema.safeParse({ email: "a@b.ma", role: "AGENT", phone: "abc" }).success).toBe(false);
  });

  it("roles are the four known ones", () => {
    for (const r of ["ADMIN", "AGENT", "OWNER", "GUEST"]) expect(roleSchema.parse(r)).toBe(r);
    expect(roleSchema.safeParse("SUPERADMIN").success).toBe(false);
  });

  it("accepting needs a name without control characters and an 8-128 character password", () => {
    expect(acceptSchema.parse({ name: " Youssef ", password: "12345678" })).toEqual({ name: "Youssef", password: "12345678" });
    expect(acceptSchema.safeParse({ name: "", password: "12345678" }).success).toBe(false);
    expect(acceptSchema.safeParse({ name: "a\u0000b", password: "12345678" }).success).toBe(false);
    expect(acceptSchema.safeParse({ name: "a", password: "1234567" }).success).toBe(false);
    expect(acceptSchema.safeParse({ name: "a", password: "x".repeat(129) }).success).toBe(false);
  });
});

describe("notifications", () => {
  it("send nothing by default (no provider chosen yet), and the console driver never runs in production", async () => {
    const n = createNotifier({});
    expect(n).toBeInstanceOf(NoopNotifier);
    expect(
      await n.send({
        kind: "invitation",
        to: { email: "a@b.ma" },
        subject: "s",
        text: "t",
      }),
    ).toEqual({ delivered: false, channel: null });
    expect(
      createNotifier({
        NOTIFICATIONS_DRIVER: "console",
        NODE_ENV: "development",
      }).name,
    ).toBe("console");
    expect(
      createNotifier({
        NOTIFICATIONS_DRIVER: "console",
        NODE_ENV: "production",
      }).name,
    ).toBe("none");
  });
});

describe("formatDateTime", () => {
  it("is JJ/MM/AAAA à HH:MM in Marrakech time", () => {
    // Africa/Casablanca is UTC+1 except during Ramadan (UTC+0).
    expect(formatDateTime(new Date("2026-10-18T13:05:00Z"))).toBe("18/10/2026 à 14:05");
    expect(formatDateTime(new Date("2026-12-31T23:30:00Z"))).toBe("01/01/2027 à 00:30");
  });
});
