const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const HEXTET = /^[0-9a-f]{1,4}$/i;

/** Parse an IPv6 literal (no brackets/zone) into 8 numeric hextets, or null. */
function parseIpv6(text: string): number[] | null {
  let s = text;
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!IPV4.test(tail)) return null;
    const o = tail.split(".").map(Number);
    s = `${s.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toParts = (h: string): string[] | null => {
    if (h === "") return [];
    const p = h.split(":");
    return p.every((x) => HEXTET.test(x)) ? p : null;
  };
  const head = toParts(halves[0]);
  const rest = halves.length === 2 ? toParts(halves[1]) : [];
  if (!head || !rest) return null;
  let parts: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    parts = [...head, ...Array<string>(fill).fill("0"), ...rest];
  } else {
    parts = head;
  }
  if (parts.length !== 8) return null;
  return parts.map((p) => parseInt(p, 16));
}

/** Rate-limit identity: IPv4 unchanged; IPv6 -> "<first four hextets>::/64" (lowercase,
 *  zero-expanded, zone id and brackets dropped); IPv4-mapped IPv6 -> the IPv4;
 *  anything unparseable -> returned trimmed as today. */
export function rateLimitClientKey(ip: string): string {
  const raw = typeof ip === "string" ? ip.trim() : "";
  try {
    if (!raw.includes(":")) return raw;
    let s = raw;
    if (s.startsWith("[")) {
      const end = s.indexOf("]");
      if (end < 0) return raw;
      const after = s.slice(end + 1);
      if (after !== "" && !/^:\d{1,5}$/.test(after)) return raw;
      s = s.slice(1, end);
    }
    const zone = s.indexOf("%");
    if (zone >= 0) s = s.slice(0, zone);
    const h = parseIpv6(s);
    if (!h) return raw;
    if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
      return `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
    }
    return `${h
      .slice(0, 4)
      .map((x) => x.toString(16))
      .join(":")}::/64`;
  } catch {
    return raw;
  }
}

/** Same header order as today (first x-forwarded-for hop, x-real-ip, "unknown"),
 *  then rateLimitClientKey. Used only in rate-limit keys (fact 14). */
export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return rateLimitClientKey(first);
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return rateLimitClientKey(realIp);
  return "unknown";
}
