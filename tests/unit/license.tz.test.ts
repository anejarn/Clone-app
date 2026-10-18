import { describe, expect, it } from "vitest";
import { LICENSE_ALERT_DAYS, licenseBounds, licenseSentence, licenseState, licenseStateNow } from "@/lib/admin/license";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const lic = (expires: string | null, number: string | null = "80-14/2026/001") => ({ licenseNumber: number, licenseExpiresAt: expires ? d(expires) : null });

describe("loi 80-14 authorisation status", () => {
  const today = d("2026-10-20");

  it("is missing without a number or an expiry date", () => {
    expect(licenseState(lic(null), today)).toEqual({ status: "MISSING", daysLeft: null });
    expect(licenseState(lic("2027-06-01", null), today).status).toBe("MISSING");
    expect(licenseState(lic("2027-06-01", ""), today).status).toBe("MISSING");
  });

  it("alerts from 60 days before the expiry, inclusive, and counts the expiry day as valid", () => {
    expect(LICENSE_ALERT_DAYS).toBe(60);
    expect(licenseState(lic("2026-12-20"), today)).toEqual({ status: "VALID", daysLeft: 61 });
    expect(licenseState(lic("2026-12-19"), today)).toEqual({ status: "EXPIRING", daysLeft: 60 });
    expect(licenseState(lic("2026-10-21"), today)).toEqual({ status: "EXPIRING", daysLeft: 1 });
    expect(licenseState(lic("2026-10-20"), today)).toEqual({ status: "EXPIRING", daysLeft: 0 });
    expect(licenseState(lic("2026-10-19"), today)).toEqual({ status: "EXPIRED", daysLeft: -1 });
  });

  it("takes today in Marrakech, not the server's zone: 23:30 UTC on 19 October is already the 20th there", () => {
    const lateEvening = Date.parse("2026-10-19T23:30:00Z");
    // Marrakech (UTC+1): 20 October, so 19 December is exactly 60 days away.
    expect(licenseStateNow(lic("2026-12-19"), lateEvening).status).toBe("EXPIRING");
    expect(licenseStateNow(lic("2026-12-20"), lateEvening).status).toBe("VALID");
    expect(licenseStateNow(lic("2026-10-19"), lateEvening).status).toBe("EXPIRED");
    // Half an hour earlier it is still the 19th in Marrakech: the 19th itself is the expiry day, still valid.
    expect(licenseStateNow(lic("2026-10-19"), Date.parse("2026-10-19T22:30:00Z"))).toEqual({ status: "EXPIRING", daysLeft: 0 });
    expect(licenseStateNow(lic("2026-12-19"), Date.parse("2026-10-19T22:30:00Z"))).toEqual({ status: "VALID", daysLeft: 61 });
  });

  it("gives the database bounds of the same statuses", () => {
    expect(licenseBounds(today)).toEqual({ expiredBefore: d("2026-10-20"), expiringUntil: d("2026-12-19") });
  });

  it("says it in one French sentence, with JJ/MM/AAAA dates", () => {
    expect(licenseSentence(lic("2026-10-19"), licenseState(lic("2026-10-19"), today))).toBe("Autorisation loi 80-14 expirée le 19/10/2026.");
    expect(licenseSentence(lic("2026-11-19"), licenseState(lic("2026-11-19"), today))).toBe(
      "Autorisation loi 80-14 à renouveler : elle expire le 19/11/2026 (dans 30 jours).",
    );
    expect(licenseSentence(lic("2026-10-20"), licenseState(lic("2026-10-20"), today))).toContain("(aujourd'hui)");
    expect(licenseSentence(lic("2027-10-20"), licenseState(lic("2027-10-20"), today))).toBe("Autorisation loi 80-14 valide jusqu'au 20/10/2027.");
    expect(licenseSentence(lic(null), licenseState(lic(null), today))).toMatch(/^Autorisation loi 80-14 manquante/);
  });
});
