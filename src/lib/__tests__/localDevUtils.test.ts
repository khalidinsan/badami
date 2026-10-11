import { describe, it, expect } from "vitest";
import {
  DNS_UNHEALTHY_PREFIX,
  isDnsUnhealthyError,
  parseDnsUnhealthyError,
  siteHttpsUrl,
  siteUrl,
} from "@/lib/localDevUtils";

describe("siteUrl", () => {
  it("elides port 80 (privileged Mode B)", () => {
    expect(siteUrl("foo", "test", 80)).toBe("http://foo.test");
  });

  it("appends the default Mode A port (:8080)", () => {
    expect(siteUrl("foo", "test", 8080)).toBe("http://foo.test:8080");
  });

  it("appends any non-80 port", () => {
    expect(siteUrl("bar", "local", 9090)).toBe("http://bar.local:9090");
    expect(siteUrl("baz", "test", 443)).toBe("http://baz.test:443");
  });

  it("uses the tld verbatim (no dot stripping)", () => {
    // Contract: caller passes "test", not ".test". Guard the shape.
    expect(siteUrl("site", "dev", 8080)).toBe("http://site.dev:8080");
  });

  it("supports multi-segment site names as one host label", () => {
    // Site names are directory names on disk. Whatever the caller passes in
    // becomes the leftmost label of the FQDN.
    expect(siteUrl("api-v2", "test", 8080)).toBe("http://api-v2.test:8080");
  });
});

describe("siteHttpsUrl", () => {
  it("elides port 443 (privileged install)", () => {
    expect(siteHttpsUrl("foo", "test", 443)).toBe("https://foo.test");
  });

  it("appends the default Mode A HTTPS port (:8443)", () => {
    expect(siteHttpsUrl("foo", "test", 8443)).toBe("https://foo.test:8443");
  });

  it("appends any non-443 https port verbatim", () => {
    expect(siteHttpsUrl("bar", "local", 9443)).toBe("https://bar.local:9443");
    // No special treatment of :80 for the https helper — it is the HTTPS one.
    expect(siteHttpsUrl("baz", "test", 80)).toBe("https://baz.test:80");
  });

  it("uses the tld verbatim (no dot stripping)", () => {
    expect(siteHttpsUrl("site", "dev", 8443)).toBe("https://site.dev:8443");
  });
});

describe("parseDnsUnhealthyError", () => {
  it("returns the stripped detail when the prefix matches", () => {
    const detail = parseDnsUnhealthyError(
      `${DNS_UNHEALTHY_PREFIX} DNS probe for *.test failed`,
    );
    expect(detail).toBe("DNS probe for *.test failed");
  });

  it("handles Error objects, not just plain strings", () => {
    const err = new Error(`${DNS_UNHEALTHY_PREFIX} loopback 127.0.0.1 lookup failed`);
    expect(parseDnsUnhealthyError(err)).toBe("loopback 127.0.0.1 lookup failed");
  });

  it("trims leading/trailing whitespace from the detail", () => {
    expect(parseDnsUnhealthyError(`${DNS_UNHEALTHY_PREFIX}   boom   `)).toBe("boom");
  });

  it("returns null for unrelated errors", () => {
    expect(parseDnsUnhealthyError("nginx -t failed")).toBeNull();
    expect(parseDnsUnhealthyError(new Error("site not found"))).toBeNull();
    // Non-string / non-error inputs should not throw.
    expect(parseDnsUnhealthyError(undefined)).toBeNull();
    expect(parseDnsUnhealthyError(null)).toBeNull();
    expect(parseDnsUnhealthyError(42)).toBeNull();
  });

  it("isDnsUnhealthyError agrees with parseDnsUnhealthyError", () => {
    expect(isDnsUnhealthyError(`${DNS_UNHEALTHY_PREFIX} boom`)).toBe(true);
    expect(isDnsUnhealthyError(new Error(`${DNS_UNHEALTHY_PREFIX} x`))).toBe(true);
    expect(isDnsUnhealthyError("plain error")).toBe(false);
    expect(isDnsUnhealthyError(null)).toBe(false);
  });
});
