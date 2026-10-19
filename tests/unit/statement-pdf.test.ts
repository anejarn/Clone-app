import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { assembleStatement, type StatementInput } from "@/lib/finance/statement";
import { formatAmount, formatStatementMad, mergePdfs, pdfSafe, renderStatementPdf, statementFileName } from "@/lib/finance/statement-pdf";
import { pdfText } from "../support/pdf-text";

/** The statement's PDF (Lot 6b): drawn with pdf-lib, its text read back to check the key figures. */

const base: StatementInput = {
  branding: { name: "Sigma", legalName: "Sigma SARL", legalAddress: "12 rue de la Liberté, Guéliz, Marrakech", ice: "001234567000089", rcNumber: "RC Marrakech 123456", taxIdNumber: "IF 7654321", hasLogo: false, eurRateMicros: 10_850_000 },
  owner: { id: "o1", name: "Hassan Benjelloun" },
  month: "2026-10",
  provisional: false,
  listings: [{ id: "l1", title: "Riad Zitoun", managementType: "MANAGED" }],
  entries: [
    { kind: "BOOKING", account: "PLATFORM_FEE", period: "2026-10", originPeriod: null, amountCents: 15_500, listingId: "l1", bookingId: "b1", expenseId: null, description: "" },
    { kind: "BOOKING", account: "CLEANING_SIGMA", period: "2026-10", originPeriod: null, amountCents: 13_333, listingId: "l1", bookingId: "b1", expenseId: null, description: "" },
    { kind: "BOOKING", account: "COMMISSION", period: "2026-10", originPeriod: null, amountCents: 30_867, listingId: "l1", bookingId: "b1", expenseId: null, description: "" },
    { kind: "BOOKING", account: "OWNER_SHARE", period: "2026-10", originPeriod: null, amountCents: 123_450, listingId: "l1", bookingId: "b1", expenseId: null, description: "" },
    { kind: "EXPENSE", account: "EXPENSE_REBILLED", period: "2026-10", originPeriod: null, amountCents: 34_990, listingId: "l1", bookingId: null, expenseId: "exp_abcdefgh12345678", description: "" },
  ],
  bookings: [{ id: "b1", checkIn: "2026-10-30", checkOut: "2026-11-02", source: "AIRBNB", nights: 3, monthNights: { "2026-10": 2, "2026-11": 1 } }],
  expenses: [{ id: "exp_abcdefgh12345678", date: "2026-10-15", description: "Mitigeur salle de bain", supplier: "Quincaillerie Atlas", hasReceipt: true }],
  previousNetDueCents: 50_000,
  previousPayoutsCents: 0,
  payouts: [],
  projectedRents: [],
};

describe("statement PDF", () => {
  it("prints the header, the stay with its nights in the month, the receipt reference and the totals of the data", async () => {
    const data = assembleStatement(base);
    const pdf = await renderStatementPdf(data, { version: 2, generatedAt: new Date("2026-11-03T10:00:00Z") });
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    const text = pdfText(pdf);
    for (const s of [
      "Sigma SARL",
      "ICE : 001234567000089",
      "RC : RC Marrakech 123456",
      "Propriétaire : Hassan Benjelloun",
      "Période : du 01/10/2026 au 31/10/2026 (octobre 2026)",
      "Édité le 03/11/2026 · version 2",
      "Riad Zitoun",
      "30/10/2026 - 02/11/2026",
      "2/3",
      "Airbnb",
      "1 831,50",
      "1 234,50",
      "DEP-12345678",
      "Net dû pour le mois",
      `${formatAmount(data.summary.netDueCents)} MAD`,
      "Solde des mois précédents",
      "500,00 MAD",
      "Solde à vous verser",
      `${formatAmount(data.summary.balanceCents)} MAD`,
      "EUR, à titre indicatif",
    ]) {
      expect(text, s).toContain(s);
    }
    expect(data.summary.netDueCents).toBe(123_450 - 34_990);
    expect(text).not.toContain("PROVISOIRE");
  });

  it("an open month's preview says « Provisoire » on every page", async () => {
    const many = { ...base, provisional: true, entries: [...base.entries], bookings: [...base.bookings] };
    for (let i = 0; i < 70; i++) {
      many.entries.push({ kind: "BOOKING", account: "OWNER_SHARE", period: "2026-10", originPeriod: null, amountCents: 10_000 + i, listingId: "l1", bookingId: `bx${i}`, expenseId: null, description: "" });
      many.bookings.push({ id: `bx${i}`, checkIn: "2026-10-01", checkOut: "2026-10-02", source: "DIRECT", nights: 1, monthNights: { "2026-10": 1 } });
    }
    const pdf = await renderStatementPdf(assembleStatement(many), { version: null, generatedAt: new Date("2026-10-19T10:00:00Z") });
    const doc = await PDFDocument.load(pdf);
    const pages = doc.getPageCount();
    expect(pages).toBeGreaterThan(1);
    const text = pdfText(pdf);
    expect(text).toContain("Relevé mensuel (provisoire)");
    expect(text.match(/PROVISOIRE/g)?.length).toBe(pages);
    expect(text).toContain(`page ${pages} / ${pages}`);
  });

  it("amounts « 1 234,50 MAD », always two decimals, signed", () => {
    expect(formatStatementMad(123_450)).toBe("1 234,50 MAD");
    expect(formatAmount(0)).toBe("0,00");
    expect(formatAmount(5)).toBe("0,05");
    expect(formatAmount(-100_000_000)).toBe("-1 000 000,00");
    expect(() => formatAmount(1.5)).toThrow(RangeError);
  });

  it("text the standard fonts can't print is replaced, never an error", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(pdfSafe(font, "Élodie Ünal – 1 234 MAD − 5 → ok")).toBe("Élodie Ünal – 1 234 MAD - 5 -> ok");
    expect(pdfSafe(font, "Łukasz")).toBe("Lukasz");
    expect(pdfSafe(font, "حسن")).toBe("???");
    const data = assembleStatement({ ...base, owner: { id: "o1", name: "حسن بنجلون" } });
    await expect(renderStatementPdf(data, { version: 1, generatedAt: new Date() })).resolves.toBeInstanceOf(Uint8Array);
  });

  it("merges several statements into one PDF and names files in ASCII", async () => {
    const a = await renderStatementPdf(assembleStatement(base), { version: 1, generatedAt: new Date() });
    const b = await renderStatementPdf(assembleStatement({ ...base, owner: { id: "o2", name: "Nadia El Fassi" } }), { version: 1, generatedAt: new Date() });
    const merged = await mergePdfs([a, b], "Relevés 10/2026");
    expect((await PDFDocument.load(merged)).getPageCount()).toBe((await PDFDocument.load(a)).getPageCount() + (await PDFDocument.load(b)).getPageCount());
    expect(pdfText(merged)).toContain("Nadia El Fassi");
    expect(statementFileName("2026-10", 2, "Hélène D'Aubigné")).toBe("releve_2026-10_v2_Helene-D-Aubigne.pdf");
    expect(statementFileName("2026-10", null, "حسن")).toBe("releve_2026-10_provisoire_proprietaire.pdf");
  });
});
