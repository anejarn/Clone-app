/*
 * Sigma · service worker of « Ma journée » (the field agent's day, usable offline). Registered by
 * components/admin/journee/MyDay.tsx with the scope /admin/ma-journee only, so it controls that page and nothing else.
 *
 * What it keeps, in caches named "sigma-journee-…" (removed at sign-out by lib/offline/clear.ts):
 * - the page /admin/ma-journee itself (network first: the copy is refreshed at every visit online, and served only
 *   when the network is unreachable; dropped when the server sends the visitor away, e.g. signed out);
 * - the app's static files (/_next/static/…: scripts, styles, fonts; their names change with every build) and icons.
 * What it never keeps: any other page, any API answer (the day's data is kept by the page in IndexedDB), any photo.
 * Every other request goes to the network untouched. At sign-out the page sends "forget": caches go, nothing more is
 * kept, and the worker is unregistered (lib/offline/clear.ts).
 */
const VERSION = "v1";
const PAGES = `sigma-journee-pages-${VERSION}`;
const ASSETS = `sigma-journee-assets-${VERSION}`;
const PAGE = "/admin/ma-journee";
const MAX_ASSETS = 300;

const OFFLINE_HTML = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hors connexion · Sigma</title><body style="font-family:system-ui,sans-serif;padding:24px;color:#222">
<h1 style="font-size:22px">Hors connexion</h1><p>Ouvrez « Ma journée » une première fois avec du réseau pour pouvoir l'utiliser hors connexion.</p></body></html>`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("sigma-journee-") && name !== PAGES && name !== ASSETS) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

const isAsset = (url) => url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg" || url.pathname.startsWith("/icons/");

/** Set at sign-out (message "forget"): from then on, nothing is cached or served from the cache. */
let forgotten = false;

self.addEventListener("fetch", (event) => {
  if (forgotten) return;
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === PAGE) {
    event.respondWith(page(request));
  } else if (isAsset(url)) {
    event.respondWith(asset(request));
  }
});

async function page(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.status === 200 && response.type === "basic" && !response.redirected) {
      await cache.put(PAGE, response.clone());
    } else {
      // Signed out (sent to the login page), refused, or an error: never serve the old copy to whoever is here now.
      await cache.delete(PAGE);
    }
    return response;
  } catch {
    const cached = await cache.match(PAGE);
    return cached ?? new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function asset(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.status === 200 && response.type === "basic") await cache.put(request, response.clone());
  return response;
}

/*
 * The page sends { type: "precache", urls } once it is controlled and online: the static files it loaded (fetched
 * before this worker was in charge), so they are there offline.
 */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "forget") {
    forgotten = true;
    event.waitUntil(
      (async () => {
        for (const name of await caches.keys()) if (name.startsWith("sigma-journee-")) await caches.delete(name);
      })(),
    );
    return;
  }
  if (forgotten || data.type !== "precache" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const wanted = new Set(
        data.urls
          .map((u) => {
            try {
              return new URL(u, self.location.origin);
            } catch {
              return null;
            }
          })
          .filter((u) => u && u.origin === self.location.origin && isAsset(u))
          .map((u) => u.href),
      );
      const cache = await caches.open(ASSETS);
      for (const href of wanted) {
        if (!(await cache.match(href))) await cache.add(href).catch(() => {});
      }
      // Files of earlier builds pile up across deployments: past a few hundred, keep only what this page uses now.
      const keys = await cache.keys();
      if (keys.length > MAX_ASSETS) {
        for (const request of keys) {
          if (new URL(request.url).pathname.startsWith("/_next/static/") && !wanted.has(request.url)) await cache.delete(request);
        }
      }
      const pages = await caches.open(PAGES);
      if (!(await pages.match(PAGE))) {
        const response = await fetch(PAGE, { credentials: "same-origin" }).catch(() => null);
        if (response && response.status === 200 && !response.redirected) await pages.put(PAGE, response);
      }
    })(),
  );
});
