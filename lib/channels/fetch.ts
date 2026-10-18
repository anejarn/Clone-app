import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import zlib from "node:zlib";
import { isPublicAddress, validateFeedUrl } from "./url";

/**
 * Reads a platform's iCal link (Lot 7), defensively: the URL is checked (lib/channels/url.ts) on every hop, every
 * address the host resolves to must be public and the connection is pinned to the address checked (no DNS
 * rebinding), at most 3 redirects, 15 s in all, 2 MB at most (compressed or not), conditional request with the last
 * ETag / Last-Modified (304 = nothing changed). node:http(s) only, no dependency.
 */

export const FEED_MAX_BYTES = 2 * 1024 * 1024;
export const FEED_TIMEOUT_MS = 15_000;
export const FEED_MAX_REDIRECTS = 3;

export type FetchErrorCode = "INVALID_URL" | "BLOCKED_ADDRESS" | "DNS" | "TIMEOUT" | "TOO_LARGE" | "HTTP_ERROR" | "TOO_MANY_REDIRECTS" | "NETWORK";

export class FeedFetchError extends Error {
  constructor(
    public readonly code: FetchErrorCode,
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "FeedFetchError";
  }
}

export interface FeedRequest {
  url: string;
  etag?: string | null;
  lastModified?: string | null;
}

export type FeedResponse =
  | { notModified: true; status: 304 }
  | { notModified: false; status: number; body: string; etag: string | null; lastModified: string | null };

export interface FetchOptions {
  allowPrivate?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

async function resolvePublic(host: string, allowPrivate: boolean): Promise<{ address: string; family: number }> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    if (!allowPrivate && !isPublicAddress(bare)) throw new FeedFetchError("BLOCKED_ADDRESS", "Adresse interne refusée.");
    return { address: bare, family: isIP(bare) };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dnsLookup(bare, { all: true, verbatim: true });
  } catch {
    throw new FeedFetchError("DNS", `Nom de domaine introuvable (${bare}).`);
  }
  if (!addrs.length) throw new FeedFetchError("DNS", `Nom de domaine introuvable (${bare}).`);
  if (!allowPrivate && addrs.some((a) => !isPublicAddress(a.address))) throw new FeedFetchError("BLOCKED_ADDRESS", "Ce nom de domaine pointe vers une adresse interne : refusé.");
  return addrs[0];
}

function once(req: FeedRequest, url: URL, pinned: { address: string; family: number }, opts: Required<FetchOptions>, signal: AbortSignal) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer | null }>((resolve, reject) => {
    const lookup: LookupFunction = (_host, options, cb) => {
      if (typeof options === "object" && options?.all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pinned]);
      else cb(null, pinned.address, pinned.family);
    };
    const mod = url.protocol === "https:" ? https : http;
    const headers: Record<string, string> = {
      "User-Agent": "Sigma-Calendar-Sync/1.0",
      Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
    };
    if (req.etag) headers["If-None-Match"] = req.etag;
    if (req.lastModified) headers["If-Modified-Since"] = req.lastModified;
    const r = mod.request(url, { method: "GET", headers, lookup, signal }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        resolve({ status, headers: res.headers, body: null });
        return;
      }
      const declared = Number(res.headers["content-length"]);
      if (declared > opts.maxBytes) {
        res.destroy();
        reject(new FeedFetchError("TOO_LARGE", `Fichier trop volumineux (plus de ${opts.maxBytes / 1024 / 1024} Mo).`, status));
        return;
      }
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      let stream: NodeJS.ReadableStream = res;
      const zopts = { maxOutputLength: opts.maxBytes + 1 };
      if (enc === "gzip" || enc === "x-gzip") stream = res.pipe(zlib.createGunzip(zopts));
      else if (enc === "deflate") stream = res.pipe(zlib.createInflate(zopts));
      else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress(zopts));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (c: Buffer) => {
        size += c.length;
        if (size > opts.maxBytes) {
          res.destroy();
          reject(new FeedFetchError("TOO_LARGE", `Fichier trop volumineux (plus de ${opts.maxBytes / 1024 / 1024} Mo).`, status));
          return;
        }
        chunks.push(c);
      });
      stream.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      const onError = (e: Error & { code?: string }) =>
        reject(signal.aborted ? new FeedFetchError("TIMEOUT", `Pas de réponse en ${opts.timeoutMs / 1000} s.`) : e.code === "ERR_BUFFER_TOO_LARGE" ? new FeedFetchError("TOO_LARGE", "Fichier trop volumineux.", status) : new FeedFetchError("NETWORK", "Réponse illisible.", status));
      stream.on("error", onError);
      if (stream !== res) res.on("error", onError);
      res.on("aborted", () => onError(new Error("aborted")));
    });
    r.on("error", (e: Error & { code?: string }) => {
      if (signal.aborted) reject(new FeedFetchError("TIMEOUT", `Pas de réponse en ${opts.timeoutMs / 1000} s.`));
      else reject(e instanceof FeedFetchError ? e : new FeedFetchError("NETWORK", `Connexion impossible (${e.code ?? "erreur réseau"}).`));
    });
    r.end();
  });
}

export async function fetchFeed(req: FeedRequest, options: FetchOptions = {}): Promise<FeedResponse> {
  const opts: Required<FetchOptions> = {
    allowPrivate: options.allowPrivate ?? false,
    timeoutMs: options.timeoutMs ?? FEED_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? FEED_MAX_BYTES,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    let current = req.url;
    for (let hop = 0; ; hop++) {
      const check = validateFeedUrl(current, { allowPrivate: opts.allowPrivate });
      if (!check.ok) throw new FeedFetchError(hop ? "BLOCKED_ADDRESS" : "INVALID_URL", check.error);
      const pinned = await resolvePublic(check.url.hostname, opts.allowPrivate);
      if (controller.signal.aborted) throw new FeedFetchError("TIMEOUT", `Pas de réponse en ${opts.timeoutMs / 1000} s.`);
      const res = await once(hop ? { url: current } : req, check.url, pinned, opts, controller.signal);
      if (res.status === 304) return { notModified: true, status: 304 };
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.location;
        if (!location) throw new FeedFetchError("HTTP_ERROR", `Redirection sans adresse (HTTP ${res.status}).`, res.status);
        if (hop >= FEED_MAX_REDIRECTS) throw new FeedFetchError("TOO_MANY_REDIRECTS", "Trop de redirections.", res.status);
        current = new URL(location, check.url).toString();
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new FeedFetchError("HTTP_ERROR", `La plateforme a répondu HTTP ${res.status}.`, res.status);
      const header = (h: string | string[] | undefined) => (typeof h === "string" && h.length <= 200 ? h : null);
      return {
        notModified: false,
        status: res.status,
        body: new TextDecoder("utf-8").decode(res.body ?? Buffer.alloc(0)),
        etag: header(res.headers.etag),
        lastModified: header(res.headers["last-modified"]),
      };
    }
  } catch (e) {
    if (e instanceof FeedFetchError) throw e;
    if (controller.signal.aborted) throw new FeedFetchError("TIMEOUT", `Pas de réponse en ${opts.timeoutMs / 1000} s.`);
    throw new FeedFetchError("NETWORK", "Connexion impossible.");
  } finally {
    clearTimeout(timer);
  }
}
