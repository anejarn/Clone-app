/**
 * Everything Nidou keeps in the browser, as listed on the help page (/aide#cookies). Adding a cookie or a
 * storage key means adding it there too; tests/e2e/help.spec.ts checks the list against a real session.
 */

/** Remembers that the cookie notice was dismissed. Any value counts. */
export const CONSENT_COOKIE = "nidou_consent";
export const CONSENT_MAX_AGE_DAYS = 180;

/** Favourites saved while signed out (lib/wishlist.ts); emptied once merged into an account at sign-in. */
export const WISHLIST_STORAGE_KEY = "nidou:wishlist";

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
