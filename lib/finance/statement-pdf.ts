import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { SOURCE_LABEL } from "../admin/booking-sources";
import type { BookingSource } from "../generated/prisma/enums";
import { monthShort, monthWindow } from "./months";
import type { ExpenseLine, ListingSection, SimpleLine, StatementData, StayLine } from "./statement";

/**
 * The PDF of an owner's statement (Lot 6b), drawn with pdf-lib (pure JavaScript, no browser): A4, French, the
 * standard Helvetica fonts (WinAnsi: Latin text; a character they can't print is replaced, see pdfSafe — an
 * Arabic-script name would need an embedded font, not done in V1). Amounts « 1 234,50 MAD » (always two decimals),
 * dates JJ/MM/AAAA. An open month's preview carries a « PROVISOIRE » watermark on every page. Pure: the same data
 * gives the same pages (the PDF's own creation date aside).
 */

export interface StatementPdfOptions {
  version: number | null;
  generatedAt: Date;
  logo?: { bytes: Uint8Array; type: "image/png" | "image/jpeg" } | null;
}

/** 123456 → "1 234,56" (plain spaces between thousands, comma, two decimals, "-" for negatives). */
export function formatAmount(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`not an amount of centimes: ${cents}`);
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${cents < 0 ? "-" : ""}${whole},${String(abs % 100).padStart(2, "0")}`;
}

/** 123456 → "1 234,56 MAD". */
export const formatStatementMad = (cents: number) => `${formatAmount(cents)} MAD`;

/** "2026-10-31" → "31/10/2026". */
export const isoToFr = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

const FR_DATE = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", day: "2-digit", month: "2-digit", year: "numeric" });

const REPLACE: Record<string, string> = { "\u202f": " ", "\u00a0": " ", "\u2212": "-", "\u2192": "->", "\u2248": "~", "\u2066": "", "\u2067": "", "\u2068": "", "\u2069": "", "\u200e": "", "\u200f": "", Ł: "L", ł: "l", Đ: "D", đ: "d", ı: "i" };

/** Text the standard fonts can print: known substitutions, then accents dropped, then "?" for what is left. */
export function pdfSafe(font: PDFFont, text: string, cache = new Map<string, string>()): string {
  let out = "";
  for (const ch of text) {
    let r = cache.get(ch);
    if (r === undefined) {
      r = REPLACE[ch] ?? ch;
      if (r && !canEncode(font, r)) {
        const plain = r.normalize("NFD").replace(/[̀-ͯ]/g, "");
        r = plain && canEncode(font, plain) ? plain : "?";
      }
      cache.set(ch, r);
    }
    out += r;
  }
  return out;
}

function canEncode(font: PDFFont, s: string): boolean {
  try {
    font.encodeText(s);
    return true;
  } catch {
    return false;
  }
}

const A4: [number, number] = [595.28, 841.89];
const M = 40;
const W = A4[0] - 2 * M;
const INK = rgb(0.13, 0.13, 0.13);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.85, 0.85, 0.85);
const BRAND = rgb(0.2, 0.33, 0.8);

interface Col {
  w: number;
  align?: "right";
}

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  private cache = new Map<string, string>();
  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - M;
  }
  ensure(h: number) {
    if (this.y - h < M + 24) this.newPage();
  }
  safe(t: string, f: PDFFont = this.font) {
    return pdfSafe(f, t, f === this.font ? this.cache : new Map());
  }
  fit(t: string, size: number, w: number, f: PDFFont = this.font): string {
    let s = this.safe(t, f);
    if (f.widthOfTextAtSize(s, size) <= w) return s;
    while (s.length > 1 && f.widthOfTextAtSize(`${s}...`, size) > w) s = s.slice(0, -1);
    return `${s.trimEnd()}...`;
  }
  text(t: string, x: number, size = 9, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; w?: number; align?: "right" } = {}) {
    const f = opts.bold ? this.bold : this.font;
    const s = opts.w ? this.fit(t, size, opts.w, f) : this.safe(t, f);
    const dx = opts.align === "right" && opts.w ? opts.w - f.widthOfTextAtSize(s, size) : 0;
    this.page.drawText(s, { x: x + dx, y: this.y, size, font: f, color: opts.color ?? INK });
  }
  line(t: string, size = 9, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
    this.ensure(size + 4);
    this.y -= size + (opts.gap ?? 4);
    this.text(t, M, size, { ...opts, w: W });
  }
  rule(color = LINE) {
    this.page.drawLine({ start: { x: M, y: this.y - 3 }, end: { x: M + W, y: this.y - 3 }, thickness: 0.5, color });
  }
  row(cols: Col[], cells: string[], size = 7.5, bold = false, color = INK) {
    this.ensure(size + 6);
    this.y -= size + 5;
    let x = M;
    cols.forEach((c, i) => {
      this.text(cells[i] ?? "", x + 2, size, { bold, color, w: c.w - 4, align: c.align });
      x += c.w;
    });
  }
}

const STAY_COLS: Col[] = [{ w: 128 }, { w: 36, align: "right" }, { w: 62 }, { w: 58, align: "right" }, { w: 58, align: "right" }, { w: 50, align: "right" }, { w: 58, align: "right" }, { w: 65, align: "right" }];
const EXPENSE_COLS: Col[] = [{ w: 52 }, { w: 213 }, { w: 80 }, { w: 85, align: "right" }, { w: 85, align: "right" }];
const SIMPLE_COLS: Col[] = [{ w: 430 }, { w: 85, align: "right" }];

const sourceLabel = (s: string) => SOURCE_LABEL[s as BookingSource] ?? s;
const adj = (m: string | null) => (m ? ` (ajust. ${monthShort(m)})` : "");

function stayCells(s: StayLine): string[] {
  return [
    `${isoToFr(s.checkIn)} - ${isoToFr(s.checkOut)}${adj(s.adjustmentOf)}`,
    s.adjustmentOf ? "-" : s.nightsInMonth === s.nights ? String(s.nights) : `${s.nightsInMonth}/${s.nights}`,
    sourceLabel(s.source),
    formatAmount(s.grossCents),
    formatAmount(s.platformFeeCents),
    formatAmount(s.cleaningCents),
    formatAmount(s.commissionCents),
    formatAmount(s.ownerShareCents),
  ];
}

const EFFECT_LABEL: Record<ExpenseLine["effect"], string> = { REBILLED: "refacturée", ADVANCE: "avancée par vous, remboursée", OWNER_PAID: "payée par vous (information)" };

function section(w: Writer, s: ListingSection) {
  w.ensure(60);
  w.y -= 10;
  w.line(s.title, 11, { bold: true });
  w.line(s.managementType === "SUBLEASE" ? "Sous-location" : "Mandat de gestion", 8, { color: MUTED, gap: 3 });
  if (s.managementType === "SUBLEASE" && !s.stays.length) {
    w.line("Séjours : sans objet (sous-location : les séjours sont le revenu de Sigma, vous percevez le loyer convenu).", 8, { color: MUTED });
  }
  if (s.stays.length) {
    w.y -= 4;
    w.row(STAY_COLS, ["Séjour", "Nuits", "Source", "Brut", "Frais plat.", "Ménage", "Commission", "Part propriétaire"], 7.5, true, MUTED);
    w.rule();
    for (const st of s.stays) w.row(STAY_COLS, stayCells(st));
    w.rule();
    const t = s.totals;
    w.row(STAY_COLS, ["Total des séjours", String(t.nights), "", formatAmount(t.grossCents), formatAmount(t.platformFeeCents), formatAmount(t.cleaningCents), formatAmount(t.commissionCents), formatAmount(t.ownerShareCents)], 7.5, true);
  } else if (s.managementType === "MANAGED") {
    w.line("Aucun séjour ce mois-ci.", 8, { color: MUTED });
  }
  if (s.expenses.length) {
    w.y -= 6;
    w.row(EXPENSE_COLS, ["Date", "Dépense", "Justificatif", "Montant", "Effet sur le net"], 7.5, true, MUTED);
    w.rule();
    for (const e of s.expenses) {
      w.row(EXPENSE_COLS, [
        isoToFr(e.date),
        `${e.reversal ? "Contre-passation : " : ""}${e.description}${e.supplier ? ` (${e.supplier})` : ""} - ${EFFECT_LABEL[e.effect]}${adj(e.adjustmentOf)}`,
        e.receiptRef ?? "sans justificatif",
        formatAmount(e.amountCents),
        formatAmount(e.netEffectCents),
      ]);
    }
  }
  const simple = (title: string, lines: SimpleLine[]) => {
    if (!lines.length) return;
    w.y -= 6;
    w.row(SIMPLE_COLS, [title, "Montant"], 7.5, true, MUTED);
    w.rule();
    for (const l of lines) w.row(SIMPLE_COLS, [`${l.description}${adj(l.adjustmentOf)}${l.projected ? " - prévu" : ""}`, formatAmount(l.amountCents)]);
  };
  simple("Loyer de sous-location", s.rents);
  simple("Ajustements", s.adjustments);
  w.y -= 4;
  w.row(SIMPLE_COLS, [`Net dû pour ce bien${s.totals.projectedRentCents ? " (hors loyer prévu)" : ""}`, formatStatementMad(s.totals.netDueCents)], 8.5, true);
}

export async function renderStatementPdf(data: StatementData, opts: StatementPdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ref = `${data.branding.legalName || data.branding.name} · Relevé ${monthShort(data.month)} · ${data.owner.name}`;
  doc.setTitle(`Relevé mensuel ${monthShort(data.month)} - ${data.owner.name}`);
  doc.setAuthor(data.branding.legalName || data.branding.name);
  doc.setSubject("Relevé mensuel de gestion locative");
  doc.setCreator("Sigma");
  doc.setProducer("Sigma (pdf-lib)");
  doc.setLanguage("fr-FR");
  doc.setCreationDate(opts.generatedAt);
  doc.setModificationDate(opts.generatedAt);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);
  const b = data.branding;

  // Header: logo, organization (left), statement and owner (right).
  let logo: PDFImage | null = null;
  if (opts.logo) {
    try {
      logo = opts.logo.type === "image/png" ? await doc.embedPng(opts.logo.bytes) : await doc.embedJpg(opts.logo.bytes);
    } catch {
      logo = null;
    }
  }
  const top = w.y;
  if (logo) {
    const s = logo.scaleToFit(120, 44);
    w.page.drawImage(logo, { x: M, y: top - s.height, width: s.width, height: s.height });
    w.y = top - s.height - 4;
  } else {
    w.y = top - 14;
    w.text(b.legalName || b.name, M, 14, { bold: true, color: BRAND, w: 260 });
    w.y -= 4;
  }
  const orgLines = [logo ? b.legalName || b.name : "", b.legalAddress, b.ice && `ICE : ${b.ice}`, b.rcNumber && `RC : ${b.rcNumber}`, b.taxIdNumber && `IF : ${b.taxIdNumber}`].filter(Boolean);
  for (const l of orgLines) {
    w.y -= 10;
    w.text(l, M, 8, { color: MUTED, w: 260 });
  }
  const leftBottom = w.y;
  w.y = top - 12;
  const RX = M + 280;
  const RW = W - 280;
  w.text(`Relevé mensuel${data.provisional ? " (provisoire)" : ""}`, RX, 13, { bold: true, w: RW, align: "right" });
  const { from, to } = monthWindow(data.month);
  const last = new Date(`${to}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() - 1);
  const right = [
    `Propriétaire : ${data.owner.name}`,
    `Période : du ${isoToFr(from)} au ${isoToFr(last.toISOString().slice(0, 10))} (${data.monthLabel})`,
    `Édité le ${FR_DATE.format(opts.generatedAt)}${opts.version ? ` · version ${opts.version}` : ""}`,
  ];
  for (const l of right) {
    w.y -= 12;
    w.text(l, RX, 8.5, { w: RW, align: "right" });
  }
  w.y = Math.min(leftBottom, w.y) - 10;
  w.rule(INK);
  w.y -= 4;
  w.line("Montants en dirhams (MAD), au centime. Brut = ce que paie le voyageur, ménage compris, taxe de séjour exclue (collectée pour la commune).", 7.5, { color: MUTED });
  w.line("Part propriétaire = brut - frais de plateforme - ménage gardé par Sigma - commission Sigma.", 7.5, { color: MUTED, gap: 2 });
  w.line("Séjour à cheval sur deux mois : « nuits du mois / nuits du séjour », montants au prorata des nuits.", 7.5, { color: MUTED, gap: 2 });

  if (!data.listings.length) {
    w.y -= 10;
    w.line("Aucune opération ce mois-ci.", 9, { color: MUTED });
  }
  for (const s of data.listings) section(w, s);

  // Summary.
  const sm = data.summary;
  w.ensure(170);
  w.y -= 16;
  w.line("Récapitulatif du mois", 11, { bold: true });
  w.y -= 2;
  const sumRows: [string, number, boolean?][] = [
    ["Part propriétaire des séjours", sm.ownerRevenueCents],
    ["Dépenses (refacturées - avances remboursées)", sm.expensesNetCents],
    ["Loyers de sous-location", sm.rentCents],
    ["Ajustements", sm.adjustmentsCents],
    ["Net dû pour le mois", sm.netDueCents, true],
  ];
  if (sm.projectedRentCents) sumRows.push(["Loyer de sous-location prévu à la clôture", sm.projectedRentCents]);
  sumRows.push(["Solde des mois précédents", sm.previousBalanceCents], ["Virements effectués ce mois-ci", -sm.payoutsCents], ["Solde à vous verser", sm.balanceCents, true]);
  for (const [label, cents, strong] of sumRows) {
    if (strong) w.rule();
    w.row(SIMPLE_COLS, [label, formatStatementMad(cents)], 9, !!strong);
  }
  if (sm.balanceEurCents !== null && b.eurRateMicros) {
    w.line(`Soit environ ${formatAmount(sm.balanceEurCents)} EUR, à titre indicatif (1 EUR = ${(b.eurRateMicros / 1_000_000).toFixed(4).replace(".", ",")} MAD). Le virement est fait en dirhams.`, 7.5, { color: MUTED });
  }

  w.ensure(60);
  w.y -= 12;
  w.line("Paiement", 10, { bold: true });
  w.line(
    sm.balanceCents > 0
      ? "Sigma vous verse le solde par virement bancaire, sur le compte que vous lui avez communiqué, après la clôture du mois."
      : sm.balanceCents < 0
        ? "Le solde est en faveur de Sigma : il sera déduit de vos prochains relevés."
        : "Rien à verser pour ce mois.",
    8.5,
  );
  for (const p of data.payouts) {
    w.line(`${p.reversal ? "Annulation du virement" : "Virement effectué"} le ${isoToFr(p.paidOn)}, réf. ${p.reference} (relevé ${monthShort(p.forMonth)}) : ${formatStatementMad(p.amountCents)}`, 8.5);
  }

  // Watermark and footer on every page.
  const n = w.pages.length;
  w.pages.forEach((p, i) => {
    if (data.provisional) {
      p.drawText("PROVISOIRE", { x: 120, y: 260, size: 90, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(40) });
    }
    const foot = pdfSafe(font, `${ref} · page ${i + 1} / ${n}`);
    p.drawText(foot.length > 140 ? `${foot.slice(0, 137)}...` : foot, { x: M, y: M - 10, size: 7, font, color: MUTED });
  });
  return doc.save({ useObjectStreams: false });
}

/** Several PDFs as one (« Télécharger tous les relevés du mois »). */
export async function mergePdfs(files: Uint8Array[], title: string): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setLanguage("fr-FR");
  for (const f of files) {
    const src = await PDFDocument.load(f);
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  return out.save({ useObjectStreams: false });
}

/** The download name of a statement: releve_2026-10_v2_Hassan-Benjelloun.pdf (releve_…_provisoire_… for a preview). */
export const statementFileName = (month: string, version: number | null, ownerName: string) =>
  `releve_${month}${version ? `_v${version}` : "_provisoire"}_${ownerName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "proprietaire"}.pdf`;

