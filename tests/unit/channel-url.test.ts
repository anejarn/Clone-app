import { describe, expect, it } from "vitest";
import { hostMatches, platform } from "@/lib/channels/platforms";
import { allowPrivateFromEnv, isPublicAddress, validateFeedUrl } from "@/lib/channels/url";

/** SSRF protection of the import links (lib/channels/url.ts). */

describe("public addresses", () => {
  it("refuses private, loopback, link-local, CGNAT, multicast, reserved and documentation IPv4", () => {
    for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.2.1", "192.168.1.1", "198.18.0.1", "203.0.113.9", "224.0.0.1", "255.255.255.255"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "41.248.10.10"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("refuses the same in IPv6, IPv4-mapped and NAT64 included", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe", "2002:c0a8:0101::1", "[::1]"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["2606:4700:4700::1111", "2a00:1450:4007:80c::200e", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("not an IP at all", () => {
    expect(isPublicAddress("example.com")).toBe(false);
  });
});

describe("import links", () => {
  const ok = (u: string, allowPrivate = false) => validateFeedUrl(u, { allowPrivate }).ok;

  it("https on the default port, a public host", () => {
    expect(ok("https://www.airbnb.com/calendar/ical/123.ics?s=abc")).toBe(true);
    expect(ok("https://admin.booking.com:443/hotel/hoteladmin/ical.html?t=x")).toBe(true);
  });

  it("refuses http, other ports, credentials, internal names and IPs, garbage", () => {
    for (const u of [
      "http://www.airbnb.com/calendar.ics",
      "https://www.airbnb.com:8443/x.ics",
      "https://user:pass@www.airbnb.com/x.ics",
      "https://localhost/x.ics",
      "https://intranet/x.ics",
      "https://db.internal/x.ics",
      "https://printer.local/x.ics",
      "https://127.0.0.1/x.ics",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/x.ics",
      "https://[::ffff:10.0.0.1]/x.ics",
      "file:///etc/passwd",
      "ftp://example.com/x.ics",
      "not a url",
      "",
      `https://example.com/${"a".repeat(2100)}`,
    ]) {
      expect(ok(u), u).toBe(false);
    }
  });

  it("test mode only: http and local servers", () => {
    expect(ok("http://127.0.0.1:4567/feed.ics", true)).toBe(true);
    expect(ok("https://user:pass@127.0.0.1/feed.ics", true)).toBe(false);
    expect(allowPrivateFromEnv({ CHANNELS_ALLOW_PRIVATE_URLS: "1" })).toBe(true);
    expect(allowPrivateFromEnv({})).toBe(false);
    expect(allowPrivateFromEnv({ CHANNELS_ALLOW_PRIVATE_URLS: "true" })).toBe(false);
  });

  it("platform hosts", () => {
    expect(hostMatches(platform("AIRBNB"), "www.airbnb.fr")).toBe(true);
    expect(hostMatches(platform("AIRBNB"), "admin.booking.com")).toBe(false);
    expect(hostMatches(platform("BOOKING"), "admin.booking.com")).toBe(true);
    expect(hostMatches(platform("BOOKING"), "evilbooking.com")).toBe(false);
    expect(hostMatches(platform("OTHER"), "anything.example")).toBe(true);
  });
});
