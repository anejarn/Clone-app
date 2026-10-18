import { CONTROL_RE } from "@/lib/server/schemas";
import { ageOn } from "@/lib/tax/engine";
import { isCountryCode } from "./countries";

/**
 * A traveller's fiche (Lot 5: déclaration des voyageurs), pure: the fields, their labels and the validation of the
 * form typed by the team (back-office or the agent's check-in). Every field here is personal data: it is encrypted
 * as a whole before it reaches the database (lib/secrets/identity.ts) and never written to the audit trail.
 *
 * Adults need: nom, prénom, sexe, date de naissance, nationalité, type et numéro de pièce. Minors (under 18 on the day
 * of arrival) may be recorded too, linked to an adult traveller of the same stay (guardianId), with fewer required
 * fields (no document). The other fields are optional: the DGSN format is still to be confirmed (lib/declarations/).
 */

export const MAJORITY_AGE = 18;

export const DOCUMENT_TYPES = ["CIN", "PASSPORT", "RESIDENCE_PERMIT", "OTHER"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  CIN: "CIN marocaine",
  PASSPORT: "Passeport",
  RESIDENCE_PERMIT: "Titre de séjour",
  OTHER: "Autre pièce",
};

export const SEXES = ["M", "F"] as const;
export type Sex = (typeof SEXES)[number];
export const SEX_LABEL: Record<Sex, string> = { M: "Masculin", F: "Féminin" };

export interface TravelerIdentity {
  lastName: string;
  firstName: string;
  sex: Sex;
  /** yyyy-MM-dd. */
  birthDate: string;
  birthPlace: string;
  /** ISO alpha-2. */
  nationality: string;
  documentType: DocumentType | null;
  documentNumber: string;
  documentIssueDate: string | null;
  documentIssueCountry: string | null;
  documentExpiryDate: string | null;
  address: string;
  residenceCountry: string | null;
  profession: string;
  arrivalDate: string;
  departureDate: string;
  /** Provenance (ville ou pays d'où il arrive). */
  comingFrom: string;
  /** Destination après le séjour. */
  goingTo: string;
}

export const TRAVELER_FIELDS = [
  "lastName",
  "firstName",
  "sex",
  "birthDate",
  "birthPlace",
  "nationality",
  "documentType",
  "documentNumber",
  "documentIssueDate",
  "documentIssueCountry",
  "documentExpiryDate",
  "address",
  "residenceCountry",
  "profession",
  "arrivalDate",
  "departureDate",
  "comingFrom",
  "goingTo",
] as const satisfies readonly (keyof TravelerIdentity)[];

export const TRAVELER_LABEL: Record<keyof TravelerIdentity, string> = {
  lastName: "Nom",
  firstName: "Prénom",
  sex: "Sexe",
  birthDate: "Date de naissance",
  birthPlace: "Lieu de naissance",
  nationality: "Nationalité",
  documentType: "Type de pièce",
  documentNumber: "Numéro de la pièce",
  documentIssueDate: "Date de délivrance",
  documentIssueCountry: "Pays de délivrance",
  documentExpiryDate: "Date d'expiration",
  address: "Adresse",
  residenceCountry: "Pays de résidence",
  profession: "Profession",
  arrivalDate: "Date d'arrivée",
  departureDate: "Date de départ",
  comingFrom: "Provenance",
  goingTo: "Destination",
};

export const TRAVELER_LIMITS = { name: 80, place: 120, address: 300, profession: 80, documentNumber: 30, travelersPerBooking: 30, documentsPerTraveler: 4 };

export type TravelerFieldErrors = Partial<Record<keyof TravelerIdentity | "guardianId", string>>;

export type TravelerParse =
  | { ok: true; identity: TravelerIdentity; isMinor: boolean; guardianId: string | null }
  | { ok: false; fieldErrors: TravelerFieldErrors };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_NUMBER_RE = /^[A-Z0-9][A-Z0-9 /-]{1,29}$/;

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Form fields as trimmed strings. */
export function travelerFormValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of [...TRAVELER_FIELDS, "guardianId"]) {
    const v = form.get(k);
    out[k] = typeof v === "string" ? v.trim() : "";
  }
  return out;
}

/**
 * Validates a fiche against its stay (`checkIn`/`checkOut` yyyy-MM-dd). Arrival and departure default to the stay's
 * dates and must lie within them. Under 18 on arrival = minor: a guardian (an adult traveller of the stay) is
 * required, the document optional.
 */
export function parseTravelerForm(values: Record<string, string>, stay: { checkIn: string; checkOut: string }): TravelerParse {
  const e: TravelerFieldErrors = {};
  const v = (k: string) => (values[k] ?? "").trim();
  const textField = (k: keyof TravelerIdentity, max: number, required: boolean): string => {
    const s = v(k).replace(/\s+/g, " ");
    if (CONTROL_RE.test(s)) e[k] = "Caractères non autorisés.";
    else if (s.length > max) e[k] = `${max} caractères au maximum.`;
    else if (required && !s) e[k] = "Obligatoire.";
    return s;
  };
  const dateField = (k: keyof TravelerIdentity, required: boolean): string | null => {
    const s = v(k);
    if (!s) {
      if (required) e[k] = "Obligatoire.";
      return null;
    }
    if (!validDate(s)) {
      e[k] = "Date invalide.";
      return null;
    }
    return s;
  };
  const countryField = (k: keyof TravelerIdentity, required: boolean): string | null => {
    const s = v(k).toUpperCase();
    if (!s) {
      if (required) e[k] = "Obligatoire.";
      return null;
    }
    if (!isCountryCode(s)) {
      e[k] = "Pays inconnu.";
      return null;
    }
    return s;
  };

  const lastName = textField("lastName", TRAVELER_LIMITS.name, true).toUpperCase();
  const firstName = textField("firstName", TRAVELER_LIMITS.name, true);
  const sexRaw = v("sex");
  const sex = (SEXES as readonly string[]).includes(sexRaw) ? (sexRaw as Sex) : null;
  if (!sex) e.sex = "Obligatoire.";
  const birthDate = dateField("birthDate", true);
  const arrivalDate = dateField("arrivalDate", false) ?? stay.checkIn;
  const departureDate = dateField("departureDate", false) ?? stay.checkOut;
  if (!e.arrivalDate && (arrivalDate < stay.checkIn || arrivalDate >= stay.checkOut)) e.arrivalDate = "En dehors des dates du séjour.";
  if (!e.departureDate && (departureDate <= stay.checkIn || departureDate > stay.checkOut)) e.departureDate = "En dehors des dates du séjour.";
  if (!e.arrivalDate && !e.departureDate && departureDate <= arrivalDate) e.departureDate = "Le départ doit suivre l'arrivée.";
  if (birthDate && (birthDate < "1900-01-01" || birthDate > arrivalDate)) e.birthDate = "Date de naissance invalide.";
  const isMinor = birthDate !== null && !e.birthDate && ageOn(birthDate, arrivalDate) < MAJORITY_AGE;

  const nationality = countryField("nationality", true);
  const docRaw = v("documentType");
  const documentType = (DOCUMENT_TYPES as readonly string[]).includes(docRaw) ? (docRaw as DocumentType) : null;
  if (docRaw && !documentType) e.documentType = "Type inconnu.";
  else if (!documentType && !isMinor) e.documentType = "Obligatoire.";
  const documentNumber = v("documentNumber").toUpperCase().replace(/\s+/g, " ");
  if (documentNumber && !DOC_NUMBER_RE.test(documentNumber)) e.documentNumber = "Lettres, chiffres, espaces, « - » ou « / » (30 au maximum).";
  else if (!documentNumber && (documentType || !isMinor)) e.documentNumber = "Obligatoire.";
  const documentIssueDate = dateField("documentIssueDate", false);
  const documentExpiryDate = dateField("documentExpiryDate", false);
  if (documentIssueDate && documentExpiryDate && documentExpiryDate <= documentIssueDate) e.documentExpiryDate = "Doit suivre la date de délivrance.";
  if (documentIssueDate && documentIssueDate > arrivalDate) e.documentIssueDate = "Postérieure à l'arrivée.";
  const documentIssueCountry = countryField("documentIssueCountry", false);
  const residenceCountry = countryField("residenceCountry", false);

  const birthPlace = textField("birthPlace", TRAVELER_LIMITS.place, false);
  const address = textField("address", TRAVELER_LIMITS.address, false);
  const profession = textField("profession", TRAVELER_LIMITS.profession, false);
  const comingFrom = textField("comingFrom", TRAVELER_LIMITS.place, false);
  const goingTo = textField("goingTo", TRAVELER_LIMITS.place, false);

  const guardianRaw = v("guardianId");
  const guardianId = guardianRaw && /^[A-Za-z0-9_-]{1,64}$/.test(guardianRaw) ? guardianRaw : null;
  if (isMinor && !guardianId) e.guardianId = "Choisissez l'adulte qui accompagne ce mineur (enregistrez d'abord un adulte).";

  if (Object.keys(e).length || !sex || !birthDate || !nationality) return { ok: false, fieldErrors: e };
  return {
    ok: true,
    isMinor,
    guardianId: isMinor ? guardianId : null,
    identity: {
      lastName,
      firstName,
      sex,
      birthDate,
      birthPlace,
      nationality,
      documentType,
      documentNumber,
      documentIssueDate,
      documentIssueCountry,
      documentExpiryDate,
      address,
      residenceCountry,
      profession,
      arrivalDate,
      departureDate,
      comingFrom,
      goingTo,
    },
  };
}

/** A decrypted fiche back into form values. */
export function identityToValues(i: TravelerIdentity, guardianId: string | null): Record<string, string> {
  const out: Record<string, string> = { guardianId: guardianId ?? "" };
  for (const k of TRAVELER_FIELDS) out[k] = (i[k] as string | null) ?? "";
  return out;
}

/** "BENALI Amina". */
export function travelerName(i: Pick<TravelerIdentity, "lastName" | "firstName">): string {
  return `${i.lastName} ${i.firstName}`.trim();
}
