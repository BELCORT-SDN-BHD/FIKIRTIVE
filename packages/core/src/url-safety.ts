/**
 * SSRF guard helpers — validate URLs before server-side fetching.
 * The lexical helpers (parseIPv4, isPrivateIPv4, isBlockedIPv6, assertPublicHttpUrl) are pure: no I/O, no DNS.
 * assertPublicHttpUrlResolved (server-only) additionally resolves DNS and re-checks every
 * resolved IP — closing the DNS-rebinding hole the lexical check alone cannot.
 */
import { lookup } from "node:dns/promises";

/**
 * Parses an IPv4 address string into a [a, b, c, d] tuple, or null if not IPv4.
 */
function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

/**
 * Returns true if the hostname is a private, loopback, or link-local IPv4 address.
 * Blocks: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
 */
function isPrivateIPv4(host: string): boolean {
  const ip = parseIPv4(host);
  if (!ip) return false;
  const [a, b] = ip;
  // 0.0.0.0/8 — "this host" / unspecified (defense-in-depth: 0.0.0.0 is also
  // caught by the literal check in assertPublicHttpUrl)
  if (a === 0) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 172.16.0.0/12 — private (172.16 – 172.31)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local (includes cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Returns true if the hostname (with brackets stripped) is a blocked IPv6 address.
 * Blocks: ::1 (loopback), fc00::/7 (unique-local), fe80::/10 (link-local)
 */
function isBlockedIPv6(host: string): boolean {
  // new URL() keeps square brackets for IPv6 — strip them
  const addr = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;

  // Must look like IPv6 (contains colon)
  if (!addr.includes(":")) return false;

  const lower = addr.toLowerCase();

  // ::1 loopback
  if (lower === "::1") return true;

  // ::ffff:0:0/96 — IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1, ::ffff:169.254.169.254)
  // Node fetch resolves these to the embedded IPv4 address, so we must block private ones.
  if (lower.startsWith("::ffff:")) {
    // The embedded IPv4 can appear as dotted-quad (::ffff:127.0.0.1)
    // or as two colon-hex groups (::ffff:7f00:1 = 127.0.0.1)
    // The simplest safe approach: extract the suffix and try dotted-quad parse.
    // If dotted-quad, run isPrivateIPv4 on it.
    // If hex-groups, convert to dotted-quad and run isPrivateIPv4 on it.
    const suffix = lower.slice("::ffff:".length); // e.g. "127.0.0.1" or "7f00:1"
    if (suffix.includes(".")) {
      // dotted-quad form — run through isPrivateIPv4 and also check localhost/0.0.0.0
      if (suffix === "0.0.0.0" || isPrivateIPv4(suffix)) return true;
    } else {
      // hex-groups form: "7f00:1" → convert to dotted quad "127.0.0.1"
      const hexGroups = suffix.split(":");
      if (hexGroups.length === 2) {
        const hi = parseInt(hexGroups[0]!, 16);
        const lo = parseInt(hexGroups[1]!, 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          if (dotted === "0.0.0.0" || isPrivateIPv4(dotted)) return true;
        }
      }
    }
  }

  // fc00::/7 — unique-local: first byte 0xfc or 0xfd
  // fe80::/10 — link-local: first 10 bits are 1111111010, i.e. fe80–febf
  const firstGroup = lower.split(":")[0];
  if (!firstGroup) return false;

  // Pad to 4 hex digits for comparison
  const hex = firstGroup.padStart(4, "0");
  const firstByte = parseInt(hex.slice(0, 2), 16);
  const secondByte = parseInt(hex.slice(2, 4), 16);

  // fc00::/7 covers fc00::–fdff:: (first byte 0xfc or 0xfd)
  if (firstByte === 0xfc || firstByte === 0xfd) return true;

  // fe80::/10 covers fe80::–febf:: (first byte 0xfe, second byte 0x80–0xbf)
  if (firstByte === 0xfe && secondByte >= 0x80 && secondByte <= 0xbf) return true;

  return false;
}

/**
 * Returns true if the hostname looks like a bare internal name (no dot, not an IP).
 */
function isBareHostname(host: string): boolean {
  // Strip IPv6 brackets before checking
  const h = host.startsWith("[") ? host.slice(1, -1) : host;
  // IPv6 addresses contain colons — not bare hostnames
  if (h.includes(":")) return false;
  // If it's a valid IPv4, it's not a bare hostname
  if (parseIPv4(h)) return false;
  // Bare if no dot
  return !h.includes(".");
}

/**
 * Asserts that `raw` is a safe, public HTTP/HTTPS URL.
 *
 * Throws a human-readable Error if:
 * - The URL cannot be parsed
 * - The protocol is not http: or https:
 * - The hostname resolves to a private/loopback/link-local address
 * - The hostname is bare (no dots, not an IP) — e.g. "internal"
 *
 * Returns the parsed URL object on success.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: "${raw}"`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Only http: and https: URLs are allowed. Got "${url.protocol}"`
    );
  }

  const host = url.hostname.toLowerCase();

  if (host === "localhost" || host === "0.0.0.0") {
    throw new Error(`URL hostname "${host}" is not allowed (loopback/unspecified address)`);
  }

  if (isPrivateIPv4(host)) {
    throw new Error(
      `URL hostname "${host}" is a private or reserved IP address and is not allowed`
    );
  }

  if (isBlockedIPv6(url.hostname)) {
    throw new Error(
      `URL hostname "${url.hostname}" is a private or loopback IPv6 address and is not allowed`
    );
  }

  if (isBareHostname(host)) {
    throw new Error(
      `URL hostname "${host}" looks like an internal service name (no dots). Only public hostnames are allowed.`
    );
  }

  return url;
}

/**
 * Lexical check PLUS DNS resolution: asserts EVERY address `raw`'s hostname resolves to is
 * public. The lexical assertPublicHttpUrl alone is bypassed by a public hostname whose A/AAAA
 * record points at a private IP (DNS rebinding → e.g. cloud metadata 169.254.169.254), because
 * Node's fetch resolves DNS itself. Resolving here and re-checking each IP closes that hole.
 *
 * Residual: a TOCTOU window remains (DNS could change between this check and the actual fetch);
 * pinning the connection to a validated IP (custom undici lookup) would close it fully — a
 * follow-up hardening. Server-only (uses node:dns).
 */
export async function assertPublicHttpUrlResolved(raw: string): Promise<URL> {
  const url = assertPublicHttpUrl(raw); // protocol + literal private-IP + bare-name checks first
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(url.hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve hostname "${url.hostname}"`);
  }
  if (!addrs.length) {
    throw new Error(`Hostname "${url.hostname}" did not resolve to any address`);
  }
  for (const { address, family } of addrs) {
    const a = address.toLowerCase();
    const blocked =
      a === "0.0.0.0" || a === "::1" || (family === 4 ? isPrivateIPv4(a) : isBlockedIPv6(a));
    if (blocked) {
      throw new Error(
        `URL hostname "${url.hostname}" resolves to a private/reserved address and is not allowed`
      );
    }
  }
  return url;
}
