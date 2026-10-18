import { describe, expect, it } from "vitest";
import { decodeCharset, decodeEncodedWords, decodeQuotedPrintable, htmlToText, normalizeText, parseAddress, parseMessage, parseParams, MAX_PARTS } from "@/lib/channels/email/mime";

/** The MIME reader of the booking e-mails (lib/channels/email/mime.ts). */

const latin1 = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("transfer encodings and charsets", () => {
  it("quoted-printable: soft breaks, =XX bytes, UTF-8 and ISO-8859-1", () => {
    expect(text(decodeQuotedPrintable("R=C3=A9servation confirm=\r\n=C3=A9e"))).toBe("Réservation confirmée");
    expect(decodeCharset(decodeQuotedPrintable("Arriv=E9e : ao=FBt"), "ISO-8859-1")).toBe("Arrivée : août");
    expect(text(decodeQuotedPrintable("a_b", true))).toBe("a b");
    // A lone = is kept as such.
    expect(text(decodeQuotedPrintable("x = y =ZZ"))).toBe("x = y =ZZ");
  });

  it("charsets: Latin-1, Windows-1252 (€), unknown labels fall back to UTF-8, invalid UTF-8 to Windows-1252", () => {
    expect(decodeCharset(latin1("D\xe9part"), "iso-8859-1")).toBe("Départ");
    expect(decodeCharset(latin1("\x80 480"), "windows-1252")).toBe("€ 480");
    expect(decodeCharset(new TextEncoder().encode("Llegada 14 de septiembre"), "x-made-up")).toBe("Llegada 14 de septiembre");
    expect(decodeCharset(latin1("caf\xe9"), "utf-8")).toBe("café");
    expect(decodeCharset(new TextEncoder().encode("ok"), '"US-ASCII"')).toBe("ok");
  });

  it("RFC 2047 encoded words, B and Q, several charsets, spaces between words dropped", () => {
    expect(decodeEncodedWords("=?utf-8?B?UsOpc2VydmF0aW9uIGNvbmZpcm3DqWU=?=")).toBe("Réservation confirmée");
    expect(decodeEncodedWords("=?iso-8859-1?Q?Nouvelle_r=E9servation?= !")).toBe("Nouvelle réservation !");
    expect(decodeEncodedWords("=?UTF-8?Q?a?= =?UTF-8?Q?b?= c")).toBe("ab c");
    expect(decodeEncodedWords("Plain subject")).toBe("Plain subject");
  });

  it("parameters (quoted, RFC 2231) and addresses", () => {
    expect(parseParams('multipart/alternative; boundary="b;1"; charset=UTF-8')).toEqual({ value: "multipart/alternative", params: { boundary: "b;1", charset: "UTF-8" } });
    expect(parseParams("attachment; filename*=utf-8''r%C3%A9servation.eml").params.filename).toBe("réservation.eml");
    expect(parseAddress('"Airbnb" <automated@airbnb.com>')).toEqual({ name: "Airbnb", address: "automated@airbnb.com" });
    expect(parseAddress("noreply@booking.com (Booking.com)")).toEqual({ name: "Booking.com", address: "noreply@booking.com" });
    expect(parseAddress("=?utf-8?Q?In=C3=A8s?= <ines@example.test>")).toEqual({ name: "Inès", address: "ines@example.test" });
    expect(parseAddress(null)).toBeNull();
  });
});

describe("HTML to text", () => {
  it("rows and cells on their own lines, entities decoded, styles and scripts dropped, links kept", () => {
    const t = htmlToText(
      '<html><head><style>p{color:red}</style><title>T</title></head><body><script>alert(1)</script><table><tr><td>Arriv&eacute;e</td><td><b>lun. 12&nbsp;juil.</b></td></tr><tr><td>Total</td><td>&euro;612.40 &amp; plus &#8364; &#x20AC;</td></tr></table><p>Voir <a href="https://www.airbnb.fr/rooms/40000001">l\'annonce</a></p><!-- hidden --></body></html>',
    );
    expect(t).toBe("Arrivée\nlun. 12 juil.\nTotal\n€612.40 & plus € €\nVoir https://www.airbnb.fr/rooms/40000001 l'annonce");
  });

  it("normalizes no-break, thin and zero-width spaces", () => {
    expect(normalizeText("4 512,00 MAD​\r\n\r\n\r\n\r\nx")).toBe("4 512,00 MAD\n\nx");
  });
});

describe("messages", () => {
  it("multipart/alternative inside multipart/mixed: plain text, HTML text, headers", () => {
    const m = parseMessage(
      [
        "From: Booking.com <noreply@booking.com>",
        "Subject: =?utf-8?Q?R=C3=A9servation?=",
        "Date: Tue, 21 Sep 2027 09:30:00 +0200",
        "Message-ID: <abc@booking.example>",
        'Content-Type: multipart/mixed; boundary="m"',
        "",
        "--m",
        'Content-Type: multipart/alternative; boundary="a"',
        "",
        "--a",
        "Content-Type: text/plain; charset=iso-8859-1",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Arriv=E9e : ven. 5 nov. 2027",
        "--a",
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("<p>D&eacute;part : lun. 8 nov. 2027</p>").toString("base64"),
        "--a--",
        "--m",
        "Content-Type: image/png; name=x.png",
        "Content-Disposition: attachment; filename=x.png",
        "Content-Transfer-Encoding: base64",
        "",
        "iVBORw0KGgo=",
        "--m--",
        "",
      ].join("\r\n"),
    );
    expect(m.subject).toBe("Réservation");
    expect(m.from).toEqual({ name: "Booking.com", address: "noreply@booking.com" });
    expect(m.messageId).toBe("abc@booking.example");
    expect(m.date?.toISOString()).toBe("2027-09-21T07:30:00.000Z");
    expect(m.text).toBe("Arrivée : ven. 5 nov. 2027");
    expect(m.htmlText).toBe("Départ : lun. 8 nov. 2027");
  });

  it("folded headers, LF-only line ends, raw UTF-8 in a header, HTML-only body", () => {
    const m = parseMessage(Buffer.from("Subject: Nouvelle\n réservation à traiter\nContent-Type: text/html\n\n<div>Bonjour</div>", "utf8"));
    expect(m.subject).toBe("Nouvelle réservation à traiter");
    expect(m.text).toBe("Bonjour");
  });

  it("a message attached as message/rfc822 is read as a message", () => {
    const inner = "From: Agoda <no-reply@agoda.com>\r\nSubject: Cancellation\r\n\r\nBooking ID: 7012345678\r\n";
    const m = parseMessage(`From: a@example.test\r\nContent-Type: multipart/mixed; boundary=z\r\n\r\n--z\r\nContent-Type: text/plain\r\n\r\nSee attached\r\n--z\r\nContent-Type: message/rfc822\r\n\r\n${inner}\r\n--z--\r\n`);
    expect(m.text).toBe("See attached");
    expect(m.attached).toHaveLength(1);
    expect(m.attached[0].from?.address).toBe("no-reply@agoda.com");
    expect(m.attached[0].text).toBe("Booking ID: 7012345678");
  });

  it("is bounded: thousands of parts are cut at MAX_PARTS, deep nesting at MAX_DEPTH", () => {
    const parts = Array.from({ length: 1000 }, (_, i) => `--b\r\nContent-Type: text/plain\r\n\r\npart ${i}`).join("\r\n");
    const m = parseMessage(`Content-Type: multipart/mixed; boundary=b\r\n\r\n${parts}\r\n--b--\r\n`);
    expect(m.root.parts.length).toBeLessThan(MAX_PARTS);
    let nested = "Content-Type: text/plain\r\n\r\ndeep";
    for (let i = 0; i < 50; i++) nested = `Content-Type: message/rfc822\r\n\r\n${nested}`;
    expect(() => parseMessage(nested)).not.toThrow();
  });

  it("a bad date or a missing Message-ID reads as null", () => {
    const m = parseMessage("Date: someday\r\nSubject: x\r\n\r\nbody");
    expect(m.date).toBeNull();
    expect(m.messageId).toBeNull();
  });
});
