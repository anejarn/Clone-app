/**
 * Countries for nationality, residence and document issuance: ISO 3166-1 alpha-2 codes with their French names, from
 * the runtime's Intl data (no list to maintain by hand). Codes Intl knows that are not countries a document can name
 * (EU, UN, pseudo-regions, deprecated or duplicate codes) are left out, and so is EH: for Morocco the Sahara is
 * Moroccan territory, a person living there resides in Morocco (MA).
 */
const EXCLUDED = new Set(
  "AC AN BU CP CS DD DG DY EA EH EU EZ FX HV IC NH QO RH SU TA TP UK UN VD XA XB YD YU ZR ZZ".split(" "),
);

let cached: { code: string; name: string }[] | undefined;

export function countries(): { code: string; name: string }[] {
  if (cached) return cached;
  const dn = new Intl.DisplayNames(["fr"], { type: "region", fallback: "code" });
  const out: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      if (EXCLUDED.has(code)) continue;
      let name: string | undefined;
      try {
        name = dn.of(code);
      } catch {
        name = undefined;
      }
      if (name && name !== code) out.push({ code, name });
    }
  }
  cached = out.sort((x, y) => x.name.localeCompare(y.name, "fr"));
  return cached;
}

export function isCountryCode(code: unknown): code is string {
  return typeof code === "string" && /^[A-Z]{2}$/.test(code) && countries().some((c) => c.code === code);
}

/** "Maroc" for "MA"; the code itself when unknown; "" for null. */
export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  return countries().find((c) => c.code === code)?.name ?? code;
}
