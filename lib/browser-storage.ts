/**
 * Everything Sigma keeps in the browser, as listed on the help page (/aide#cookies). Adding a cookie or a
 * storage key means adding it there too; tests/e2e/help.spec.ts checks the list against a real session.
 */

/** Remembers that the cookie notice was dismissed. Any value counts. */
export const CONSENT_COOKIE = "sigma_consent";
export const CONSENT_MAX_AGE_DAYS = 180;

/** Favourites saved while signed out (lib/wishlist.ts); emptied once merged into an account at sign-in. */
export const WISHLIST_STORAGE_KEY = "sigma:wishlist";

/** The same favourites under the name the app had before it was renamed Sigma (14 October 2026). */
export const LEGACY_WISHLIST_STORAGE_KEY = "nidou:wishlist";

/**
 * Moves favourites saved under the pre-rename key to WISHLIST_STORAGE_KEY, then removes the old key, so
 * nothing saved before the rename is lost. A no-op once the old key is gone. If both keys exist (another tab
 * already saved under the new one), the new list is kept and the old ids are added after it.
 */
export function migrateLegacyWishlist(storage: Storage) {
  const legacy = storage.getItem(LEGACY_WISHLIST_STORAGE_KEY);
  if (legacy === null) return;
  const current = storage.getItem(WISHLIST_STORAGE_KEY);
  if (current === null) storage.setItem(WISHLIST_STORAGE_KEY, legacy);
  else {
    const merged = [...new Set([...idList(current), ...idList(legacy)])];
    if (merged.length) storage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(merged));
  }
  storage.removeItem(LEGACY_WISHLIST_STORAGE_KEY);
}

function idList(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Better Auth's cookies (default names; "__Secure-" is prepended over HTTPS) and their lifetimes, which
 * lib/server/auth.ts configures from these values.
 */
export const AUTH_SESSION_COOKIE = "better-auth.session_token";
export const AUTH_SESSION_CACHE_COOKIE = "better-auth.session_data";
export const SESSION_DAYS = 30;
export const SESSION_CACHE_MINUTES = 5;

/**
 * Written by the Better Auth client on sign-out ({ event, data: { trigger }, clientId, timestamp }) so other open
 * tabs notice; Better Auth never removes it (node_modules/better-auth/dist/client/broadcast-channel.mjs).
 */
export const AUTH_BROADCAST_STORAGE_KEY = "better-auth.message";
