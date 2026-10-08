import { describe, expect, test } from "bun:test";
import { clientIpFromRequest, rateLimitClientKey } from "./client-ip";

const req = (headers: Record<string, string>) => new Request("https://example.test/", { headers });

describe("rateLimitClientKey", () => {
  test("two IPv6 in same /64 share bucket", () => {
    expect(rateLimitClientKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(rateLimitClientKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
  });
  test("different /64s stay apart", () => {
    expect(rateLimitClientKey("2001:db8:1:2::1")).not.toBe(rateLimitClientKey("2001:db8:1:3::1"));
  });
  test("compressed forms share a bucket", () => {
    expect(rateLimitClientKey("2001:db8::1")).toBe(rateLimitClientKey("2001:db8:0:0::2"));
  });
  test("case does not matter", () => {
    expect(rateLimitClientKey("2001:DB8:ABCD:1::1")).toBe("2001:db8:abcd:1::/64");
  });
  test("IPv4 is unchanged", () => {
    expect(rateLimitClientKey("203.0.113.7")).toBe("203.0.113.7");
  });
  test("compressed, bracketed, zoned and mapped forms normalise", () => {
    expect(rateLimitClientKey("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitClientKey("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(rateLimitClientKey("[2001:db8::1]:443")).toBe("2001:db8:0:0::/64");
    expect(rateLimitClientKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateLimitClientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitClientKey("::FFFF:203.0.113.5")).toBe("203.0.113.5");
    expect(rateLimitClientKey("::ffff:cb00:7105")).toBe("203.0.113.5");
  });
  test("embedded IPv4 tail in other IPv6 still buckets by /64", () => {
    expect(rateLimitClientKey("2001:db8::203.0.113.7")).toBe("2001:db8:0:0::/64");
  });
  test("unparseable input falls back as today and never throws", () => {
    for (const bad of [
      "not-an-ip",
      "1:2:3",
      "2001:db8::1::2",
      "12345::1",
      "gggg::1",
      "[::1",
      "1.2.3.4:80",
      "",
      "::ffff:999.1.1.1",
    ]) {
      expect(() => rateLimitClientKey(bad)).not.toThrow();
      expect(rateLimitClientKey(bad)).toBe(bad);
    }
    expect(rateLimitClientKey("  not-an-ip ")).toBe("not-an-ip");
  });
});

describe("clientIpFromRequest", () => {
  test("IPv4 header handling is unchanged", () => {
    expect(clientIpFromRequest(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
    expect(clientIpFromRequest(req({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });
  test("first x-forwarded-for hop wins and is bucketed", () => {
    expect(clientIpFromRequest(req({ "x-forwarded-for": "2001:db8:1:2::9, 10.0.0.1" }))).toBe(
      "2001:db8:1:2::/64",
    );
    expect(clientIpFromRequest(req({ "x-real-ip": "2001:db8:1:2::9" }))).toBe("2001:db8:1:2::/64");
  });
  test("unparseable input falls back as today", () => {
    expect(clientIpFromRequest(req({}))).toBe("unknown");
    expect(clientIpFromRequest(req({ "x-real-ip": "not-an-ip" }))).toBe("not-an-ip");
  });
});
