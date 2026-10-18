/**
 * Reading values out of a booking e-mail's text (Lot 7b): dates, amounts, guest counts, « Label : value » pairs, in
 * French, English and Spanish, as the platforms write them (« lun. 12 juil. 2027 », « Tue, Aug 3, 2027 », « 14 de
 * septiembre de 2027 », « 12/07/2027 », « 2027-07-12 »; « 1 234,56 MAD », « €1,234.56 », « US$ 300.00 »…). Pure.
 */

// ---------- Dates ----------

const MONTHS: Record<string, number> = {};
const add = (n: number, ...names: string[]) => names.forEach((x) => (MONTHS[x] = n));
add(1, "janvier", "janv", "jan", "january", "enero", "ene");
add(2, "fevrier", "fevr", "fev", "february", "feb", "febrero");
add(3, "mars", "mar", "march", "marzo");
add(4, "avril", "avr", "april", "apr", "abril", "abr");
add(5, "mai", "may", "mayo");
add(6, "juin", "june", "jun", "junio");
add(7, "juillet", "juil", "jul", "july", "julio");
add(8, "aout", "august", "aug", "agosto", "ago");
add(9, "septembre", "sept", "sep", "september", "septiembre", "setiembre", "set");
add(10, "octobre", "oct", "october", "octubre");
add(11, "novembre", "nov", "november", "noviembre");
add(12, "decembre", "dec", "december", "diciembre", "dic");

/** Lower case without accents: "Août" → "aout". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function monthNumber(word: string): number | null {
  return MONTHS[fold(word).replace(/\.$/, "")] ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2200) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * A date without a year ("ven. 12 juil.") is put in the first year where it falls no more than 60 days before the
 * reference (the e-mail's date): booking e-mails speak of stays to come.
 */
function withYear(m: number, d: number, ref: Date): string | null {
  const refDay = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  for (let y = ref.getUTCFullYear() - 1; y <= ref.getUTCFullYear() + 2; y++) {
    const s = iso(y, m, d);
    if (s && Date.parse(`${s}T00:00:00Z`) >= refDay - 60 * 86_400_000) return s;
  }
  return null;
}

const MONTH_WORD = "([A-Za-zÀ-ÿ]{3,10})\\.?";
const DATE_PATTERNS: { re: RegExp; read: (m: RegExpExecArray, ref: Date) => string | null }[] = [
  // 2027-07-12, 2027/07/12
  { re: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/, read: (m) => iso(+m[1], +m[2], +m[3]) },
  // 12/07/2027, 12.07.2027, 12-07-2027 (day first: Morocco, France, Spain; the platforms' FR/ES/UK formats)
  { re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/, read: (m) => iso(+m[3], +m[2], +m[1]) },
  // 12 juil. 2027, 1er août 2027, 14 de septiembre de 2027, 12 July 2027, 3 Aug
  {
    re: new RegExp(`\\b(\\d{1,2})(?:er|st|nd|rd|th|º)?\\.?\\s+(?:de\\s+)?${MONTH_WORD}(?:,?\\s+(?:de\\s+|del\\s+)?(\\d{4}))?`, "i"),
    read: (m, ref) => {
      const month = monthNumber(m[2]);
      if (!month) return null;
      return m[3] ? iso(+m[3], month, +m[1]) : withYear(month, +m[1], ref);
    },
  },
  // Aug 3, 2027 · August 3rd 2027 · Jul 12
  {
    re: new RegExp(`\\b${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "i"),
    read: (m, ref) => {
      const month = monthNumber(m[1]);
      if (!month) return null;
      return m[3] ? iso(+m[3], month, +m[2]) : withYear(month, +m[2], ref);
    },
  },
];

/**
 * The first date in a text, as yyyy-MM-dd; null when there is none. A date with its year wins over one without (« mar.
 * 3 août 2027 »: « mar. 3 » would read as 3 March); « <month> <day> » is not taken when a month name follows the day
 * (« mar. 3 août », « sáb., 17 de julio »: the first word is a weekday).
 */
export function parseDate(text: string, ref: Date = new Date()): string | null {
  let best: { index: number; year: boolean; value: string } | null = null;
  for (const [i, p] of DATE_PATTERNS.entries()) {
    const re = new RegExp(p.re.source, `${p.re.flags.replace("g", "")}g`);
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (i === 3) {
        const next = /^\s*(?:de\s+)?([A-Za-zÀ-ÿ]{3,10})/.exec(text.slice(m.index + m[0].length));
        if (next && monthNumber(next[1])) continue;
      }
      const v = p.read(m, ref);
      if (!v) continue;
      const year = /\d{4}/.test(m[0]);
      if (!best || (year && !best.year) || (year === best.year && m.index < best.index)) best = { index: m.index, year, value: v };
      break;
    }
  }
  return best?.value ?? null;
}

// ---------- Amounts ----------

export interface Money {
  /** Hundredths of the currency (centimes, cents). */
  cents: number;
  /** ISO 4217. */
  currency: string;
}

const CURRENCY_TOKENS: [RegExp, string][] = [
  [/^(?:MAD|DHS?|Dhs?|dirhams?)$/i, "MAD"],
  [/^(?:EUR|€|euros?)$/i, "EUR"],
  [/^(?:US\$|USD|\$)$/i, "USD"],
  [/^(?:GBP|£)$/i, "GBP"],
  [/^(?:CHF)$/i, "CHF"],
  [/^(?:CAD|C\$|CA\$)$/i, "CAD"],
  [/^(?:AED)$/i, "AED"],
  [/^(?:CNY|RMB|CN¥)$/i, "CNY"],
  [/^(?:JPY)$/i, "JPY"],
  [/^(?:KRW|₩)$/i, "KRW"],
];
const CUR = "(US\\$|C\\$|CA\\$|CN¥|MAD|DHS?|Dhs?|dirhams?|EUR|euros?|€|USD|\\$|GBP|£|CHF|CAD|AED|CNY|RMB|JPY|KRW|₩)";
const NUM = "(\\d{1,3}(?:[ \u00a0\u202f.,'’]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
const AMOUNT_RES = [new RegExp(`${CUR}[ \u00a0\u202f]?${NUM}(?![\\d])`, "i"), new RegExp(`(?<![\\d.,])${NUM}[ \u00a0\u202f]?${CUR}(?![A-Za-z])`, "i")];

function currencyOf(token: string): string | null {
  for (const [re, code] of CURRENCY_TOKENS) if (re.test(token.trim())) return code;
  return null;
}

/**
 * "1 234,56" → 123456, "1,234.56" → 123456, "1.234,56" → 123456, "1234.5" → 123450, "1,234" → 123400 (three digits
 * after the only separator: thousands). Null when it isn't a number.
 */
export function parseNumberToCents(raw: string): number | null {
  const s = raw.replace(/[\s'’]/g, "");
  if (!/^\d[\d.,]*\d$|^\d$/.test(s)) return null;
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  let whole = s;
  let frac = "";
  if (dot >= 0 && comma >= 0) {
    const dec = Math.max(dot, comma);
    whole = s.slice(0, dec);
    frac = s.slice(dec + 1);
    if (frac.length > 2 || whole.includes(s[dec])) return null;
  } else if (dot >= 0 || comma >= 0) {
    const sep = dot >= 0 ? "." : ",";
    const groups = s.split(sep);
    if (groups.length === 2 && groups[1].length <= 2) {
      whole = groups[0];
      frac = groups[1];
    } else if (groups.slice(1).every((g) => g.length === 3)) whole = groups.join("");
    else return null;
  }
  whole = whole.replace(/[.,]/g, "");
  if (!/^\d{1,9}$/.test(whole)) return null;
  return Number(whole) * 100 + Number(frac.padEnd(2, "0") || "0");
}

/** The first amount with its currency in a text; null when none. */
export function parseAmount(text: string): Money | null {
  let best: { index: number; money: Money } | null = null;
  for (const [i, re] of AMOUNT_RES.entries()) {
    const m = re.exec(text);
    if (!m) continue;
    const [cur, num] = i === 0 ? [m[1], m[2]] : [m[2], m[1]];
    const currency = currencyOf(cur);
    const cents = parseNumberToCents(num);
    if (currency && cents !== null && cents > 0 && (!best || m.index < best.index)) best = { index: m.index, money: { cents, currency } };
  }
  return best?.money ?? null;
}

// ---------- Guests ----------

export interface GuestCounts {
  adults: number | null;
  children: number | null;
  infants: number | null;
  /** Adults + children when known, else the total written. */
  total: number | null;
}

const num = (re: RegExp, s: string) => {
  const m = re.exec(s);
  return m ? Number(m[1]) : null;
};

export function parseGuests(text: string): GuestCounts {
  const s = fold(text);
  const adults = num(/(\d{1,2})\s*(?:adultes?|adults?|adultos?)\b/, s);
  const children = num(/(\d{1,2})\s*(?:enfants?|children|childs?|kids?|ninos?|ninas?|menores)\b/, s);
  const infants = num(/(\d{1,2})\s*(?:bebes?|infants?|babies|baby)\b/, s);
  const written = num(/(\d{1,2})\s*(?:voyageurs?|guests?|huespedes?|personnes?|personas?|people|persons?|pax|occupants?)\b/, s);
  const total = adults !== null ? adults + (children ?? 0) : written;
  return { adults: adults ?? (written !== null && children === null ? written : null), children, infants, total };
}

// ---------- Labels ----------

/**
 * The value after a label: on the same line ("Arrivée : lun. 12 juil.", "Check-in Tue, Aug 3") or on the next
 * non-empty lines (HTML tables become « label », newline, « value »). `labels` are matched at the start of a line,
 * case- and accent-insensitive. Returns up to `lines` lines of value, joined by a space. `accept`: the value must also
 * pass it (e.g. hold a date), else the next occurrence of a label is tried (« Check-in time » before « Check-in »).
 */
export function valueAfter(text: string, labels: readonly string[], lines = 1, accept?: (value: string) => boolean): string | null {
  const all = text.split("\n");
  const folded = all.map(fold);
  const keys = labels.map(fold);
  for (let i = 0; i < all.length; i++) {
    for (const k of keys) {
      if (!folded[i].startsWith(k)) continue;
      const rest = all[i].slice(k.length);
      // The label must end there (not « Check-in time » for « Check-in » unless followed by the value).
      if (rest && /^[A-Za-zÀ-ÿ]/.test(rest)) continue;
      const same = rest.replace(/^\s*[:：\-–]?\s*/, "").trim();
      const out: string[] = same ? [same] : [];
      for (let j = i + 1; j < all.length && out.length < lines; j++) {
        if (all[j].trim()) out.push(all[j].trim());
        else if (out.length) break;
      }
      const value = out.slice(0, lines).join(" ");
      if (out.length && (!accept || accept(value))) return value;
    }
  }
  return null;
}
