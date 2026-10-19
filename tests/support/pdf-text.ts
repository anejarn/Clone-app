import { inflateSync } from "node:zlib";

/**
 * The text of a PDF drawn by pdf-lib with the standard fonts (lib/finance/statement-pdf.ts), for the tests: every
 * content stream is inflated and the hex strings shown by `Tj` are decoded (WinAnsi ≈ Latin-1 for the characters the
 * statements use). One string per drawn text, in drawing order; not a general PDF parser.
 */
export function pdfTexts(bytes: Uint8Array): string[] {
  const buf = Buffer.from(bytes);
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const start = buf.indexOf("stream", at, "latin1");
    if (start < 0) break;
    // "endstream" also contains "stream": skip it.
    if (buf.subarray(start - 3, start).toString("latin1") === "end") {
      at = start + 6;
      continue;
    }
    let dataStart = start + 6;
    if (buf[dataStart] === 0x0d) dataStart++;
    if (buf[dataStart] === 0x0a) dataStart++;
    const end = buf.indexOf("endstream", dataStart, "latin1");
    if (end < 0) break;
    const dict = buf.subarray(Math.max(0, start - 300), start).toString("latin1");
    const raw = buf.subarray(dataStart, end);
    let content: string;
    try {
      content = (dict.lastIndexOf("/FlateDecode") > dict.lastIndexOf("obj") ? inflateSync(raw) : raw).toString("latin1");
    } catch {
      content = "";
    }
    for (const m of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out.push(Buffer.from(m[1], "hex").toString("latin1"));
    at = end + 9;
  }
  return out;
}

/** All the text of the PDF on one line, no-break spaces as spaces. */
export function pdfText(bytes: Uint8Array): string {
  return pdfTexts(bytes).join(" ").replace(/ /g, " ");
}
