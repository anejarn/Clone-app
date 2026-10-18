import { isIP } from "node:net";

/**
 * Checks of the platforms' iCal links before Sigma reads them (Lot 7), against SSRF: a link typed in the back-office
 * must never make the server read an internal address (the database, a cloud metadata service, the local network).
 * - https only, default port, no user:password, at most 2 048 characters;
 * - no host that is, or resolves to, a private, loopback, link-local, carrier-grade NAT, multicast, reserved or
 *   documentation address, IPv4 or IPv6 (IPv4-mapped and NAT64 addresses are checked as the IPv4 inside);
 * - checked again on every redirect and on every address the name resolves to, and the connection goes to the address
 *   that was checked (lib/channels/fetch.ts), so a DNS answer can't change between the check and the connection.
 * Test mode (CHANNELS_ALLOW_PRIVATE_URLS=1, never in production) lifts the address, port and https rules so the test
 * suites can serve feeds from a local server.
 */

export const MAX_URL_LENGTH = 2048;

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4Public(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
  });
}

/** The 8 groups of an IPv6 address (expanded), or null. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  // Embedded IPv4 in the last 32 bits.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const n = v4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (tail === undefined && h.length !== 8) return null;
  const groups = [...h, ...Array(8 - h.length - t.length).fill("0"), ...t].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

function v6Public(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return false;
  const v4of = (a: number, b: number) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Public(v4of(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return false; // deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Public(v4of(g[6], g[7])); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return false; // discard
  if (g[0] === 0x2002) return v4Public(v4of(g[1], g[2])); // 6to4
  return true;
}

/** Whether an IP address (v4 or v6) is a public, routable one. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, "").split("%")[0]);
  if (kind === 4) return v4Public(ip);
  if (kind === 6) return v6Public(ip);
  return false;
}

const BLOCKED_HOST_RE = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i;

export interface UrlOptions {
  /** Test mode: http, any port and private addresses allowed. */
  allowPrivate?: boolean;
}

/** CHANNELS_ALLOW_PRIVATE_URLS=1: the test suites' local feed servers. Never set it on a real server. */
export function allowPrivateFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  return env.CHANNELS_ALLOW_PRIVATE_URLS === "1";
}

export function validateFeedUrl(raw: string, opts: UrlOptions = {}): UrlCheck {
  const s = raw.trim();
  if (!s) return { ok: false, error: "Collez le lien iCal de la plateforme." };
  if (s.length > MAX_URL_LENGTH) return { ok: false, error: "Lien trop long (2 048 caractères au maximum)." };
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return { ok: false, error: "Ce n'est pas un lien valide (il doit commencer par https://)." };
  }
  if (url.protocol !== "https:" && !(opts.allowPrivate && url.protocol === "http:")) return { ok: false, error: "Le lien doit commencer par https://." };
  if (url.username || url.password) return { ok: false, error: "Le lien ne doit pas contenir d'identifiant ni de mot de passe." };
  if (opts.allowPrivate) return { ok: true, url };
  if (url.port && url.port !== "443") return { ok: false, error: "Le lien doit utiliser le port standard (443)." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicAddress(host)) return { ok: false, error: "Ce lien pointe vers une adresse interne : refusé." };
  } else if (BLOCKED_HOST_RE.test(host.replace(/\.$/, "")) || !host.includes(".")) {
    return { ok: false, error: "Ce lien pointe vers une adresse interne : refusé." };
  }
  return { ok: true, url };
}
