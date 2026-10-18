/**
 * A small RFC 822 / MIME reader for the platforms' booking e-mails (Lot 7b), no dependency: headers (folded lines,
 * RFC 2047 encoded words in UTF-8, ISO-8859-x, Windows-125x…, raw 8-bit UTF-8), multipart bodies (mixed, alternative,
 * related, nested), quoted-printable and base64, every charset the runtime's TextDecoder knows (UTF-8, ISO-8859-1,
 * Windows-1252…; unknown → UTF-8, then Latin-1), HTML turned into text, and messages attached as message/rfc822
 * (Outlook's « forward as attachment »). Lenient: a malformed part is read as text rather than refused. Bounded: at
 * most MAX_PARTS parts and MAX_DEPTH levels, so a crafted message can't make it loop.
 */

export const MAX_PARTS = 200;
export const MAX_DEPTH = 8;

export type Headers = ReadonlyMap<string, readonly string[]>;

export interface MimePart {
  headers: Headers;
  /** Lower case, e.g. "text/plain". */
  contentType: string;
  params: Readonly<Record<string, string>>;
  disposition: string | null;
  filename: string | null;
  /** The body once the transfer encoding is undone (still in its charset). */
  body: Uint8Array;
  parts: MimePart[];
  /** A message/rfc822 part, read as a message. */
  message: ParsedMessage | null;
}

export interface Address {
  name: string | null;
  address: string | null;
}

export interface ParsedMessage {
  headers: Headers;
  subject: string;
  from: Address | null;
  /** The Date header, when it reads as a date. */
  date: Date | null;
  /** Without the angle brackets. */
  messageId: string | null;
  /** The text of the message: its text/plain parts, or its HTML turned into text when it has none. */
  text: string;
  /** Its HTML parts turned into text (empty when none). */
  htmlText: string;
  /** Messages attached as message/rfc822 (forwarded as attachment). */
  attached: ParsedMessage[];
  root: MimePart;
}

// ---------- Bytes and charsets ----------

const latin1 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");
const fromLatin1 = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

const CHARSET_ALIASES: Record<string, string> = { latin1: "iso-8859-1", "iso_8859-1": "iso-8859-1", "iso8859-1": "iso-8859-1", "us-ascii": "utf-8", ascii: "utf-8", utf8: "utf-8", cp1252: "windows-1252", "iso-8859-15": "iso-8859-15", "x-unknown": "utf-8" };

/** Windows-1252's 0x80–0x9F (€, ‚, ƒ, „, …, ’, “, ”, –, —, ™, œ…); the rest of the byte range is Latin-1. */
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

/** Windows-1252 (and ISO-8859-1, which e-mails use as such: WHATWG maps both labels to it), byte by byte. */
function decode1252(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] : String.fromCharCode(b);
  return out;
}

/** Decodes bytes in a charset; an unknown charset falls back to UTF-8, and invalid UTF-8 to Windows-1252. */
export function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
  const cs = (charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
  const name = CHARSET_ALIASES[cs] ?? cs;
  if (name === "windows-1252" || name === "iso-8859-1") return decode1252(bytes);
  if (name !== "utf-8") {
    try {
      return new TextDecoder(name).decode(bytes);
    } catch {
      // Unknown label: try UTF-8 below.
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return decode1252(bytes);
  }
}

// ---------- Transfer encodings ----------

export function decodeBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/[^A-Za-z0-9+/=_-]/g, ""), "base64"));
}

/** Quoted-printable (RFC 2045) on a binary string: soft line breaks, =XX; `header` = the Q encoding (_ = space). */
export function decodeQuotedPrintable(s: string, header = false): Uint8Array {
  let t = s.replace(/=\r?\n/g, "");
  if (header) t = t.replace(/_/g, " ");
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 0x3d && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
      out.push(parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(c & 0xff);
  }
  return new Uint8Array(out);
}

// ---------- Headers ----------

/** RFC 2047 encoded words (=?charset?B|Q?…?=); whitespace between two encoded words is dropped. */
export function decodeEncodedWords(value: string): string {
  const re = /=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g;
  let out = "";
  let last = 0;
  let prevWasWord = false;
  for (let m = re.exec(value); m; m = re.exec(value)) {
    const between = value.slice(last, m.index);
    if (!(prevWasWord && /^\s*$/.test(between))) out += rawHeaderText(between);
    const charset = m[1].split("*")[0];
    const bytes = m[2].toUpperCase() === "B" ? decodeBase64(m[3]) : decodeQuotedPrintable(m[3], true);
    out += decodeCharset(bytes, charset);
    last = m.index + m[0].length;
    prevWasWord = true;
  }
  return out + rawHeaderText(value.slice(last));
}

/** A header's raw bytes (a binary string): UTF-8 when it is valid UTF-8 (common, though not standard), else Latin-1. */
function rawHeaderText(s: string): string {
  if (!/[\x80-\xff]/.test(s)) return s;
  return decodeCharset(fromLatin1(s), "utf-8");
}

function parseHeaderBlock(block: string): Map<string, string[]> {
  const headers = new Map<string, string[]>();
  const lines = block.split(/\r?\n/);
  let current: string | null = null;
  const push = () => {
    if (current === null) return;
    const i = current.indexOf(":");
    if (i > 0) {
      const name = current.slice(0, i).trim().toLowerCase();
      if (/^[!-9;-~]+$/.test(name)) headers.set(name, [...(headers.get(name) ?? []), current.slice(i + 1).trim()]);
    }
    current = null;
  };
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current !== null) current += ` ${line.trim()}`;
    else {
      push();
      current = line;
    }
  }
  push();
  return headers;
}

export function header(h: Headers, name: string): string | null {
  return h.get(name.toLowerCase())?.[0] ?? null;
}

/** "text/html; charset=UTF-8; name*=utf-8''r%C3%A9s.eml" → { value, params } (RFC 2231 extended values too). */
export function parseParams(value: string): { value: string; params: Record<string, string> } {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const i = p.indexOf("=");
    if (i < 0) continue;
    let key = p.slice(0, i).trim().toLowerCase();
    let v = p.slice(i + 1).trim().replace(/^"([\s\S]*)"$/, "$1");
    if (key.endsWith("*")) {
      key = key.slice(0, -1).replace(/\*\d+$/, "");
      const m = /^([^']*)'[^']*'(.*)$/.exec(v);
      if (m) v = decodeCharset(fromLatin1(m[2].replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))), m[1] || "utf-8");
    }
    params[key] = (params[key] ?? "") + v;
  }
  return { value: parts[0].trim().toLowerCase(), params };
}

/** `"Airbnb" <automated@airbnb.com>`, `Name <a@b>`, `a@b (Name)`, `a@b`. */
export function parseAddress(value: string | null): Address | null {
  if (!value) return null;
  const v = decodeEncodedWords(value).trim();
  const angle = /^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(v);
  if (angle) return { name: angle[1].trim().replace(/^"(.*)"$/, "$1").trim() || null, address: angle[2].toLowerCase() };
  const bare = /([^\s<>()"]+@[^\s<>()"]+)/.exec(v);
  if (bare) return { name: /\(([^)]*)\)/.exec(v)?.[1]?.trim() || null, address: bare[1].toLowerCase() };
  return { name: v || null, address: null };
}

/** The domain of an address, lower case ("automated@em.airbnb.com" → "em.airbnb.com"). */
export function domainOf(address: string | null | undefined): string | null {
  const m = /@([a-z0-9.-]+)$/i.exec(address ?? "");
  return m ? m[1].toLowerCase().replace(/\.$/, "") : null;
}

// ---------- HTML ----------

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", euro: "€", pound: "£", yen: "¥", cent: "¢", copy: "©", reg: "®", trade: "™",
  laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„", ndash: "–", mdash: "—", hellip: "…", middot: "·", bull: "•", deg: "°", times: "×",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à", aacute: "á", acirc: "â", auml: "ä", atilde: "ã", aring: "å", ccedil: "ç", iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  oacute: "ó", ograve: "ò", ocirc: "ô", ouml: "ö", otilde: "õ", uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü", ntilde: "ñ", yacute: "ý", szlig: "ß", oelig: "œ", aelig: "æ",
  Eacute: "É", Egrave: "È", Ecirc: "Ê", Agrave: "À", Aacute: "Á", Acirc: "Â", Ccedil: "Ç", Iacute: "Í", Icirc: "Î", Oacute: "Ó", Ocirc: "Ô", Uacute: "Ú", Ucirc: "Û", Ntilde: "Ñ", OElig: "Œ",
  iexcl: "¡", iquest: "¿", ordm: "º", ordf: "ª", shy: "", zwnj: "", zwj: "", thinsp: " ", ensp: " ", emsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Readable text of an HTML e-mail: blocks and table rows on their own lines, cells separated, entities decoded. */
export function htmlToText(html: string): string {
  const t = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|article|header|footer|blockquote|ul|ol)\s*>/gi, "\n")
    .replace(/<(p|div|tr|li|h[1-6]|table|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/(td|th)\s*>/gi, "\n")
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi, (_, href: string) => (/^https?:/i.test(href) ? ` ${href} ` : " "))
    .replace(/<[^>]+>/g, "");
  // Tables and blocks become one line each, without blank lines between them.
  return normalizeText(decodeEntities(t)).replace(/\n{2,}/g, "\n");
}

/** No-break and thin spaces become spaces, zero-width characters go, spaces collapse, at most one blank line. */
export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[      ]/g, " ")
    .replace(/[​-‍⁠﻿­]/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- Parts ----------

function splitHeadBody(s: string): { head: string; body: string } {
  const m = /\r?\n\r?\n/.exec(s);
  if (!m) return { head: s, body: "" };
  return { head: s.slice(0, m.index), body: s.slice(m.index + m[0].length) };
}

interface Budget {
  parts: number;
}

function parsePart(bin: string, depth: number, budget: Budget, defaultType = "text/plain"): MimePart {
  budget.parts += 1;
  const { head, body } = splitHeadBody(bin);
  const headers = parseHeaderBlock(head);
  const ct = parseParams(header(headers, "content-type") ?? defaultType);
  const contentType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(ct.value) ? ct.value : "text/plain";
  const cd = header(headers, "content-disposition");
  const disp = cd ? parseParams(cd) : null;
  const filename = disp?.params.filename ?? ct.params.name ?? null;
  const cte = (header(headers, "content-transfer-encoding") ?? "7bit").trim().toLowerCase();
  const part: MimePart = {
    headers,
    contentType,
    params: ct.params,
    disposition: disp?.value ?? null,
    filename: filename ? decodeEncodedWords(filename) : null,
    body: new Uint8Array(0),
    parts: [],
    message: null,
  };
  if (contentType.startsWith("multipart/") && ct.params.boundary && depth < MAX_DEPTH) {
    const b = ct.params.boundary;
    const childType = contentType === "multipart/digest" ? "message/rfc822" : "text/plain";
    for (const chunk of splitMultipart(body, b)) {
      if (budget.parts >= MAX_PARTS) break;
      part.parts.push(parsePart(chunk, depth + 1, budget, childType));
    }
    return part;
  }
  const decoded = cte === "base64" ? decodeBase64(body) : cte === "quoted-printable" ? decodeQuotedPrintable(body) : fromLatin1(body);
  part.body = decoded;
  if (contentType === "message/rfc822" && depth < MAX_DEPTH && budget.parts < MAX_PARTS) {
    part.message = buildMessage(latin1(decoded), depth + 1, budget);
  }
  return part;
}

function splitMultipart(body: string, boundary: string): string[] {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    const t = line.trimEnd();
    if (t === `--${boundary}--`) {
      if (cur) out.push(cur.join("\r\n"));
      cur = null;
      break;
    }
    if (t === `--${boundary}`) {
      if (cur) out.push(cur.join("\r\n"));
      cur = [];
      continue;
    }
    cur?.push(line);
  }
  if (cur && cur.length) out.push(cur.join("\r\n"));
  return out;
}

function partText(p: MimePart): string {
  return decodeCharset(p.body, p.params.charset);
}

function collect(p: MimePart, acc: { plain: string[]; html: string[]; attached: ParsedMessage[] }) {
  if (p.message) {
    acc.attached.push(p.message);
    return;
  }
  if (p.parts.length) {
    if (p.contentType === "multipart/alternative") {
      // One rendering: the plain one goes to `plain`, the HTML one to `html`.
      for (const c of p.parts) collect(c, acc);
      return;
    }
    for (const c of p.parts) collect(c, acc);
    return;
  }
  const attachment = p.disposition === "attachment";
  if (p.contentType === "text/plain" && !attachment) acc.plain.push(partText(p));
  else if (p.contentType === "text/html" && !attachment) acc.html.push(partText(p));
  else if (attachment && p.filename && /\.eml$/i.test(p.filename) && p.message === null) {
    // Some clients attach a forwarded message as application/octet-stream "….eml".
    acc.attached.push(buildMessage(latin1(p.body), MAX_DEPTH - 1, { parts: MAX_PARTS - 20 }));
  }
}

function buildMessage(bin: string, depth: number, budget: Budget): ParsedMessage {
  const root = parsePart(bin, depth, budget);
  const acc = { plain: [] as string[], html: [] as string[], attached: [] as ParsedMessage[] };
  collect(root, acc);
  const htmlText = normalizeText(acc.html.map(htmlToText).join("\n\n"));
  const plain = normalizeText(acc.plain.join("\n\n"));
  const dateHeader = header(root.headers, "date");
  const date = dateHeader ? new Date(dateHeader.replace(/\s*\([^)]*\)\s*$/, "")) : null;
  const mid = header(root.headers, "message-id");
  return {
    headers: root.headers,
    subject: normalizeText(decodeEncodedWords(header(root.headers, "subject") ?? "")),
    from: parseAddress(header(root.headers, "from")),
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    messageId: mid ? mid.trim().replace(/^<|>$/g, "").trim() || null : null,
    text: plain || htmlText,
    htmlText,
    attached: acc.attached,
    root,
  };
}

/** Reads a raw message (.eml bytes, or a string as received). */
export function parseMessage(raw: Uint8Array | string): ParsedMessage {
  const bin = typeof raw === "string" ? latin1(new TextEncoder().encode(raw)) : latin1(raw);
  return buildMessage(bin.replace(/^﻿/, ""), 0, { parts: 0 });
}
