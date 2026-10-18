import { countryName } from "./countries";
import { frDate, toCsv } from "./csv";
import { DOCUMENT_TYPE_LABEL, SEX_LABEL, type TravelerIdentity } from "./traveler-form";

/**
 * Exports for the police declaration of travellers (télé-déclaration DGSN, « fiche de police »), behind one interface
 * so that the official format can be plugged in once known. **The DGSN's exact file format is not public / not
 * confirmed**: the two exporters below produce the usual fields of a fiche individuelle, as a CSV (for a spreadsheet
 * or an import) and as a printable page (one fiche per traveller, to print or save as PDF from the browser). Format à
 * valider avec la DGSN / la préfecture before relying on it.
 *
 * Exports are generated on the fly from decrypted data (lib/server/declarations/exports.ts), never written to disk.
 */

export const FORMAT_WARNING = "Format à valider avec la DGSN / la préfecture : ce fichier reprend les champs usuels de la fiche de police, pas un format officiel confirmé.";

/** One traveller of one stay, decrypted, with the establishment (the home). */
export interface DeclarationRow {
  travelerId: string;
  bookingId: string;
  identity: TravelerIdentity;
  isMinor: boolean;
  /** "BENALI Amina" of the accompanying adult, for a minor. */
  guardianName: string | null;
  declaredAt: string | null;
  establishment: { name: string; address: string; city: string; licenseNumber: string | null };
  /** Platform code or the booking's id. */
  bookingRef: string;
}

export interface DeclarationExporter {
  id: "csv" | "fiches";
  label: string;
  contentType: string;
  extension: string;
  render(rows: readonly DeclarationRow[], meta: { from: string; to: string; organizationName: string; generatedAt: string }): string;
}

export const CSV_HEADER = [
  "N°",
  "Nom",
  "Prénom",
  "Sexe",
  "Date de naissance",
  "Lieu de naissance",
  "Nationalité",
  "Type de pièce",
  "N° de pièce",
  "Date de délivrance",
  "Pays de délivrance",
  "Date d'expiration",
  "Adresse",
  "Pays de résidence",
  "Profession",
  "Date d'arrivée",
  "Date de départ",
  "Provenance",
  "Destination",
  "Mineur",
  "Accompagnant",
  "Établissement",
  "Adresse de l'établissement",
  "Ville",
  "N° d'autorisation (loi 80-14)",
  "Référence du séjour",
  "Déclaré le",
] as const;

export function csvRow(r: DeclarationRow, n: number): (string | number)[] {
  const i = r.identity;
  return [
    n,
    i.lastName,
    i.firstName,
    SEX_LABEL[i.sex],
    frDate(i.birthDate),
    i.birthPlace,
    countryName(i.nationality),
    i.documentType ? DOCUMENT_TYPE_LABEL[i.documentType] : "",
    i.documentNumber,
    frDate(i.documentIssueDate),
    countryName(i.documentIssueCountry),
    frDate(i.documentExpiryDate),
    i.address,
    countryName(i.residenceCountry),
    i.profession,
    frDate(i.arrivalDate),
    frDate(i.departureDate),
    i.comingFrom,
    i.goingTo,
    r.isMinor ? "Oui" : "Non",
    r.guardianName ?? "",
    r.establishment.name,
    r.establishment.address,
    r.establishment.city,
    r.establishment.licenseNumber ?? "",
    r.bookingRef,
    frDate(r.declaredAt),
  ];
}

export const csvExporter: DeclarationExporter = {
  id: "csv",
  label: "Tableau CSV",
  contentType: "text/csv; charset=utf-8",
  extension: "csv",
  render: (rows) => toCsv(CSV_HEADER, rows.map((r, k) => csvRow(r, k + 1))),
};

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** A printable page: one « fiche individuelle » per traveller, page breaks between them. No script, inline styles. */
export const ficheExporter: DeclarationExporter = {
  id: "fiches",
  label: "Fiches individuelles (à imprimer ou enregistrer en PDF)",
  contentType: "text/html; charset=utf-8",
  extension: "html",
  render(rows, meta) {
    const cells = (r: DeclarationRow, n: number) => {
      const values = csvRow(r, n);
      return CSV_HEADER.slice(1)
        .map((label, k) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(String(values[k + 1] ?? ""))}</td></tr>`)
        .join("");
    };
    const fiches = rows
      .map(
        (r, k) =>
          `<section class="fiche"><h2>Fiche individuelle n° ${k + 1} — ${escapeHtml(`${r.identity.lastName} ${r.identity.firstName}`)}</h2><table>${cells(r, k + 1)}</table><p class="sign">Établissement : ${escapeHtml(meta.organizationName)} · fiche générée le ${escapeHtml(meta.generatedAt)}</p></section>`,
      )
      .join("");
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Fiches voyageurs du ${escapeHtml(frDate(meta.from))} au ${escapeHtml(frDate(meta.to))}</title><style>
body{font:14px/1.4 system-ui,sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px}
.warn{border:2px solid #b42318;color:#b42318;padding:8px 12px;margin:12px 0 20px;font-weight:600}
.fiche{border:1px solid #999;padding:12px 16px;margin:0 0 20px;break-inside:avoid;page-break-after:always}.fiche:last-child{page-break-after:auto}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:3px 6px;text-align:left;vertical-align:top}th{width:40%;font-weight:600}
.sign{margin-top:10px;font-size:12px;color:#555}@media print{.warn{border-color:#000;color:#000}body{margin:0}}
</style></head><body><h1>Fiches voyageurs — arrivées du ${escapeHtml(frDate(meta.from))} au ${escapeHtml(frDate(meta.to))}</h1><p>${escapeHtml(meta.organizationName)} · ${rows.length} voyageur(s) · généré le ${escapeHtml(meta.generatedAt)}</p><p class="warn">${escapeHtml(FORMAT_WARNING)}</p>${fiches || "<p>Aucun voyageur pour ces dates.</p>"}</body></html>`;
  },
};

export const EXPORTERS: Record<DeclarationExporter["id"], DeclarationExporter> = { csv: csvExporter, fiches: ficheExporter };
