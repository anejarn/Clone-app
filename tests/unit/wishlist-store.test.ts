// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "sigma:wishlist";
/** Where favourites lived before the app was renamed from Nidou. */
const LEGACY_KEY = "nidou:wishlist";

/** Fresh module per test: the store keeps module-level state. */
async function load() {
  vi.resetModules();
  return import("@/lib/wishlist");
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("wishlist store", () => {
  it("signed out: saves to this browser", async () => {
    const { useWishlist, detachAccount } = await load();
    const { result } = renderHook(() => useWishlist());
    act(() => detachAccount());
    await act(() => result.current.toggle("1000"));
    expect(result.current.has("1000")).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(["1000"]);
    await act(() => result.current.toggle("1000"));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("is not ready until the session is known", async () => {
    const { useWishlist, detachAccount } = await load();
    const { result } = renderHook(() => useWishlist());
    expect(result.current.ready).toBe(false);
    act(() => detachAccount());
    expect(result.current.ready).toBe(true);
  });

  it("sign-in merges local favourites into the account and clears the browser copy", async () => {
    localStorage.setItem(KEY, JSON.stringify(["1001"]));
    const fetch = mockFetch(() => Response.json({ ids: ["1001", "1500"] }));
    const { useWishlist, attachAccount } = await load();
    const { result } = renderHook(() => useWishlist());
    await act(() => attachAccount());
    expect(fetch).toHaveBeenCalledWith("/api/wishlist", expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: ["1001"] }) }));
    expect(result.current.ids).toEqual(["1001", "1500"]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("signed in: toggles through the API and rolls back when it fails", async () => {
    let fail = false;
    const fetch = mockFetch((url) => {
      if (url === "/api/wishlist") return Response.json({ ids: [] });
      return new Response(null, { status: fail ? 500 : 204 });
    });
    const { useWishlist, attachAccount } = await load();
    const { result } = renderHook(() => useWishlist());
    await act(() => attachAccount());

    await act(() => result.current.toggle("1002"));
    expect(fetch).toHaveBeenLastCalledWith("/api/wishlist/1002", { method: "PUT" });
    expect(result.current.has("1002")).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull(); // account lists never land in localStorage

    fail = true;
    await act(() => result.current.toggle("1002"));
    expect(fetch).toHaveBeenLastCalledWith("/api/wishlist/1002", { method: "DELETE" });
    await waitFor(() => expect(result.current.has("1002")).toBe(true));
  });

  it("sign-out leaves nothing of the account's list behind", async () => {
    mockFetch(() => Response.json({ ids: ["1003"] }));
    const { useWishlist, attachAccount, detachAccount } = await load();
    const { result } = renderHook(() => useWishlist());
    await act(() => attachAccount());
    expect(result.current.ids).toEqual(["1003"]);
    act(() => detachAccount());
    expect(result.current.ids).toEqual([]);
  });

  it("falls back to the local list if the account can't be reached", async () => {
    localStorage.setItem(KEY, JSON.stringify(["1004"]));
    mockFetch(() => new Response(null, { status: 503 }));
    const { useWishlist, attachAccount } = await load();
    const { result } = renderHook(() => useWishlist());
    await act(() => attachAccount());
    expect(result.current.ids).toEqual(["1004"]);
    expect(result.current.ready).toBe(true);
  });

  it("ignores corrupt localStorage", async () => {
    localStorage.setItem(KEY, "{not json");
    const { useWishlist, detachAccount } = await load();
    const { result } = renderHook(() => useWishlist());
    act(() => detachAccount());
    expect(result.current.ids).toEqual([]);
  });

  it("ignores malformed ids left in this browser", async () => {
    localStorage.setItem(KEY, JSON.stringify(["1000", "a/b", "", 7, "x\u0000"]));
    const { useWishlist, detachAccount } = await load();
    const { result } = renderHook(() => useWishlist());
    act(() => detachAccount());
    expect(result.current.ids).toEqual(["1000"]);
  });

  describe("favourites saved before the rename", () => {
    it("moves them to the new key once and removes the old key", async () => {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(["1005", "1006"]));
      const { useWishlist, detachAccount } = await load();
      const { result } = renderHook(() => useWishlist());
      act(() => detachAccount());
      expect(result.current.ids).toEqual(["1005", "1006"]);
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(["1005", "1006"]);
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

      // A later load finds nothing left to move and keeps the list.
      const again = await load();
      const { result: reloaded } = renderHook(() => again.useWishlist());
      act(() => again.detachAccount());
      expect(reloaded.current.ids).toEqual(["1005", "1006"]);
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    it("are moved even when the session is known before anything reads the list", async () => {
      // WishlistSync (root layout) may call detachAccount before any component subscribes.
      localStorage.setItem(LEGACY_KEY, JSON.stringify(["1008"]));
      const { detachAccount } = await load();
      detachAccount();
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(["1008"]);
    });

    it("are merged into the account at sign-in", async () => {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(["1007"]));
      const fetch = mockFetch(() => Response.json({ ids: ["1007"] }));
      const { attachAccount } = await load();
      await attachAccount();
      expect(fetch).toHaveBeenCalledWith("/api/wishlist", expect.objectContaining({ body: JSON.stringify({ ids: ["1007"] }) }));
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });
});

describe("browser keys", () => {
  it("are Sigma's, from lib/browser-storage", async () => {
    const keys = await import("@/lib/browser-storage");
    expect(keys.WISHLIST_STORAGE_KEY).toBe(KEY);
    expect(keys.LEGACY_WISHLIST_STORAGE_KEY).toBe(LEGACY_KEY);
    expect(keys.CONSENT_COOKIE).toBe("sigma_consent");
  });
});

describe("migrateLegacyWishlist", () => {
  it("copies the old value verbatim when the new key is missing", async () => {
    const { migrateLegacyWishlist } = await import("@/lib/browser-storage");
    localStorage.setItem(LEGACY_KEY, '["1000"]');
    migrateLegacyWishlist(localStorage);
    expect(localStorage.getItem(KEY)).toBe('["1000"]');
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("keeps the new list and adds the old ids when both exist", async () => {
    const { migrateLegacyWishlist } = await import("@/lib/browser-storage");
    localStorage.setItem(KEY, '["1001","1000"]');
    localStorage.setItem(LEGACY_KEY, '["1000","1002"]');
    migrateLegacyWishlist(localStorage);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(["1001", "1000", "1002"]);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("does nothing without the old key", async () => {
    const { migrateLegacyWishlist } = await import("@/lib/browser-storage");
    localStorage.setItem(KEY, '["1001"]');
    migrateLegacyWishlist(localStorage);
    expect(localStorage.getItem(KEY)).toBe('["1001"]');
    expect(localStorage.length).toBe(1);
  });
});
