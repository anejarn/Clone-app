/**
 * Turns a user-supplied `?next=` into a same-origin path, or "/".
 * Resolves it with the URL parser browsers use for navigation, so tricks like `/\evil.com`, `/\t/evil.com`
 * or `//evil.com` (all protocol-relative to a browser) are caught, then rebuilds a path that can't
 * start with `//`.
 */
export function safeRedirectPath(next: string | null | undefined, origin: string): string {
  if (!next) return "/";
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return "/";
  }
  if (url.origin !== new URL(origin).origin) return "/";
  const path = `/${url.pathname.replace(/^[/\\]+/, "")}`;
  return `${path}${url.search}${url.hash}`;
}
