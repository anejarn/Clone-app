import { describe, expect, it } from "vitest";
import { canCaptureForTask } from "@/lib/declarations/access";
import { countries, countryName, isCountryCode } from "@/lib/declarations/countries";
import { CSV_BOM, csvAmount, csvCell, frDate, toCsv } from "@/lib/declarations/csv";
import { CSV_HEADER, csvExporter, escapeHtml, ficheExporter, FORMAT_WARNING, type DeclarationRow } from "@/lib/declarations/exporters";
import { declarationQueryString, parseDeclarationQuery } from "@/lib/declarations/filters";
import { DEFAULT_IDENTITY_RETENTION_DAYS, isDueForPurge, purgeCutoff, purgeDate, RETENTION_WARNING } from "@/lib/declarations/retention";
import { parseTravelerForm, type TravelerIdentity } from "@/lib/declarations/traveler-form";

/** Travellers' declaration (Lot 5), pure parts: the fiche's validation, the exports, retention, the agent's rule. */

const identity: TravelerIdentity = {
  lastName: "TESTNOM",
  firstName: "Zoé",
  sex: "F",
  birthDate: "1990-04-05",
  birthPlace: "Ville; fictive",
  nationality: "FR",
  documentType: "PASSPORT",
  documentNumber: "TEST000001",
  documentIssueDate: "2020-01-02",
  documentIssueCountry: "FR",
  documentExpiryDate: "2030-01-02",
  address: '1 rue "Exemple"\nVille',
  residenceCountry: "FR",
  profession: "=SUM(A1)",
  arrivalDate: "2027-03-10",
  departureDate: "2027-03-14",
  comingFrom: "Paris",
  goingTo: "Fès",
};
const row = (over: Partial<DeclarationRow> = {}): DeclarationRow => ({
  travelerId: "t1",
  bookingId: "b1",
  identity,
  isMinor: false,
  guardianName: null,
  declaredAt: null,
  establishment: { name: "Riad Test", address: "Derb 1", city: "Marrakech", licenseNumber: "80-14/TEST" },
  bookingRef: "HMTEST",
  ...over,
});

describe("CSV", () => {
  it("starts with a BOM, separates with « ; », ends lines with CRLF", () => {
    const csv = toCsv(["A", "B"], [["1", "2"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}A;B\r\n1;2\r\n`);
  });

  it("quotes separators, quotes and line breaks, doubling quotes", () => {
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell("l1\nl2")).toBe('"l1\nl2"');
    expect(csvCell("simple")).toBe("simple");
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });

  it("neutralises formulas (CSV injection)", () => {
    for (const s of ["=1+1", "+212", "-2", "@cmd", "\tx"]) expect(csvCell(s).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell("=A1;B1")).toBe(`"'=A1;B1"`);
  });

  it("dates JJ/MM/AAAA and amounts with a decimal comma", () => {
    expect(frDate("2027-03-10")).toBe("10/03/2027");
    expect(frDate("2027-03-10T12:00:00Z")).toBe("10/03/2027");
    expect(frDate(null)).toBe("");
    expect(csvAmount(123_456)).toBe("1234,56");
    expect(csvAmount(5)).toBe("0,05");
  });

  it("the declaration CSV has the fiche's columns, French labels and names, in order", () => {
    const csv = csvExporter.render([row(), row({ travelerId: "t2", isMinor: true, guardianName: "TESTNOM Zoé", declaredAt: "2027-03-11", identity: { ...identity, firstName: "Léo", documentType: null, documentNumber: "" } })], {
      from: "2027-03-01",
      to: "2027-03-31",
      organizationName: "Sigma",
      generatedAt: "x",
    });
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0].split(";")).toEqual([...CSV_HEADER]);
    expect(lines[1]).toContain("1;TESTNOM;Zoé;Féminin;05/04/1990;\"Ville; fictive\";France;Passeport;TEST000001;02/01/2020;France;02/01/2030;");
    expect(lines[1]).toContain(`"1 rue ""Exemple""\nVille"`.split("\n")[0]);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain(";10/03/2027;14/03/2027;Paris;Fès;Non;;Riad Test;Derb 1;Marrakech;80-14/TEST;HMTEST;");
    expect(csv).toContain(";Oui;TESTNOM Zoé;");
    expect(csv).toContain(";11/03/2027\r\n");
    expect(csvExporter.contentType).toBe("text/csv; charset=utf-8");
  });

  it("the printable fiches escape every value and carry the format warning", () => {
    const html = ficheExporter.render([row({ identity: { ...identity, lastName: "<script>alert(1)</script>" } })], { from: "2027-03-01", to: "2027-03-31", organizationName: "Sigma & Co", generatedAt: "now" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Sigma &amp; Co");
    expect(html).toContain(escapeHtml(FORMAT_WARNING));
    expect(html).toContain("Fiche individuelle n° 1");
    expect(html).toContain("01/03/2027");
    expect(ficheExporter.render([], { from: "2027-03-01", to: "2027-03-31", organizationName: "S", generatedAt: "x" })).toContain("Aucun voyageur");
  });
});

describe("the fiche", () => {
  const stay = { checkIn: "2027-03-10", checkOut: "2027-03-14" };
  const adult = { lastName: " testnom ", firstName: "Zoé", sex: "F", birthDate: "1990-04-05", nationality: "fr", documentType: "PASSPORT", documentNumber: "test 000001" };

  it("accepts an adult, normalises, defaults the dates to the stay", () => {
    const r = parseTravelerForm(adult, stay);
    expect(r).toMatchObject({ ok: true, isMinor: false, guardianId: null, identity: { lastName: "TESTNOM", nationality: "FR", documentNumber: "TEST 000001", arrivalDate: "2027-03-10", departureDate: "2027-03-14" } });
  });

  it("requires the adult's essentials", () => {
    const r = parseTravelerForm({}, stay);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors).sort()).toEqual(["birthDate", "documentNumber", "documentType", "firstName", "lastName", "nationality", "sex"].sort());
  });

  it("validates dates, countries and the document number", () => {
    const r = parseTravelerForm({ ...adult, birthDate: "2027-03-11", nationality: "XX", documentNumber: "<>", arrivalDate: "2027-03-14", documentIssueDate: "2028-01-01", documentExpiryDate: "2027-01-01", documentIssueCountry: "EH" }, stay);
    expect(r).toMatchObject({ ok: false, fieldErrors: { nationality: "Pays inconnu.", documentNumber: expect.any(String), arrivalDate: expect.any(String), documentExpiryDate: expect.any(String), documentIssueCountry: "Pays inconnu." } });
    expect(parseTravelerForm({ ...adult, departureDate: "2027-03-15" }, stay)).toMatchObject({ ok: false, fieldErrors: { departureDate: expect.any(String) } });
    expect(parseTravelerForm({ ...adult, birthDate: "1990-02-30" }, stay)).toMatchObject({ ok: false, fieldErrors: { birthDate: "Date invalide." } });
  });

  it("a minor (under 18 on arrival) needs an accompanying adult, not a document", () => {
    const minor = { lastName: "TESTNOM", firstName: "Léo", sex: "M", birthDate: "2009-03-11", nationality: "FR" };
    expect(parseTravelerForm(minor, stay)).toMatchObject({ ok: false, fieldErrors: { guardianId: expect.any(String) } });
    expect(parseTravelerForm({ ...minor, guardianId: "trvabc" }, stay)).toMatchObject({ ok: true, isMinor: true, guardianId: "trvabc", identity: { documentType: null } });
    // 18 on the day of arrival: an adult, the guardian is dropped and the document required.
    expect(parseTravelerForm({ ...minor, birthDate: "2009-03-10", guardianId: "trvabc" }, stay)).toMatchObject({ ok: false, fieldErrors: { documentType: "Obligatoire." } });
  });
});

describe("countries", () => {
  it("lists real countries in French, Morocco included, without non-country codes", () => {
    const all = countries();
    expect(all.length).toBeGreaterThan(200);
    expect(countryName("MA")).toBe("Maroc");
    expect(isCountryCode("MA")).toBe(true);
    for (const c of ["EU", "UN", "ZZ", "EH", "ma", "XX"]) expect(isCountryCode(c)).toBe(false);
    expect(countryName(null)).toBe("");
  });
});

describe("retention", () => {
  it("purges on departure + delay, never before", () => {
    expect(DEFAULT_IDENTITY_RETENTION_DAYS).toBe(365);
    expect(purgeDate("2027-03-14", 365)).toBe("2028-03-13");
    expect(purgeDate("2027-12-31", 1)).toBe("2028-01-01");
    expect(isDueForPurge("2027-03-14", 30, "2027-04-12")).toBe(false);
    expect(isDueForPurge("2027-03-14", 30, "2027-04-13")).toBe(true);
    expect(isDueForPurge("2027-03-14", 30, "2027-05-01")).toBe(true);
    expect(purgeCutoff("2027-04-13", 30)).toBe("2027-03-14");
    expect(() => purgeDate("2027-03-14", 0)).toThrow(RangeError);
  });

  it("warns that the legal delay is to be confirmed", () => {
    expect(RETENTION_WARNING).toContain("à confirmer");
    expect(RETENTION_WARNING).toContain("09-08");
  });
});

describe("filters", () => {
  const today = new Date("2027-03-20T00:00:00Z");
  it("default to the last 7 days, round-trip through the URL", () => {
    const q = parseDeclarationQuery({}, today);
    expect(q.from.toISOString().slice(0, 10)).toBe("2027-03-13");
    expect(q.to.toISOString().slice(0, 10)).toBe("2027-03-20");
    const full = parseDeclarationQuery({ du: "2027-03-01", au: "2027-03-31", bien: "1001", nondeclares: "1", q: " TEST " }, today);
    expect(declarationQueryString(full, { format: "csv" })).toBe("du=2027-03-01&au=2027-03-31&format=csv&bien=1001&nondeclares=1&q=TEST");
    expect(parseDeclarationQuery({ bien: "../x", du: "nope" }, today)).toMatchObject({ undeclaredOnly: false });
    expect(parseDeclarationQuery({ bien: "../x" }, today).listingId).toBeUndefined();
  });
});

describe("who records the fiches from a task", () => {
  const today = new Date("2027-03-10T00:00:00Z");
  const task = { type: "CHECKIN", bookingId: "b1", assigneeId: "agent", scheduledDate: today, status: "TODO" };
  const agent = { role: "AGENT", userId: "agent" };
  it("the agent of a welcome task today or tomorrow, neither done nor cancelled", () => {
    expect(canCaptureForTask(agent, task, today)).toBe(true);
    expect(canCaptureForTask(agent, { ...task, scheduledDate: new Date("2027-03-11T00:00:00Z") }, today)).toBe(true);
    expect(canCaptureForTask(agent, { ...task, scheduledDate: new Date("2027-03-12T00:00:00Z") }, today)).toBe(false);
    expect(canCaptureForTask(agent, { ...task, scheduledDate: new Date("2027-03-09T00:00:00Z") }, today)).toBe(false);
    expect(canCaptureForTask(agent, { ...task, status: "DONE" }, today)).toBe(false);
    expect(canCaptureForTask(agent, { ...task, status: "CANCELLED" }, today)).toBe(false);
    expect(canCaptureForTask(agent, { ...task, assigneeId: "other" }, today)).toBe(false);
    expect(canCaptureForTask(agent, { ...task, type: "CLEANING" }, today)).toBe(false);
    expect(canCaptureForTask(agent, { ...task, bookingId: null }, today)).toBe(false);
    expect(canCaptureForTask({ role: "OWNER", userId: "agent" }, task, today)).toBe(false);
  });
  it("an associé for any welcome task not cancelled", () => {
    const admin = { role: "ADMIN", userId: "a" };
    expect(canCaptureForTask(admin, { ...task, assigneeId: null, status: "DONE", scheduledDate: new Date("2027-01-01T00:00:00Z") }, today)).toBe(true);
    expect(canCaptureForTask(admin, { ...task, status: "CANCELLED" }, today)).toBe(false);
  });
});
