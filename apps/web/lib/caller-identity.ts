import { isIP } from "node:net";

/**
 * #795 r2 — WHO IS BEING COUNTED, and why that is not simply "the first forwarded address".
 *
 * Every per-caller gate in this product keys on a value taken out of a request header, and a
 * header is whatever the caller says it is. `X-Forwarded-For` is a LIST that each proxy APPENDS
 * to, so the entries look like:
 *
 *     X-Forwarded-For: <what the client claimed>, <what our edge actually saw>
 *
 * Reading the FIRST entry — the obvious reading, and the one this file replaces — reads the part
 * the client wrote. An anonymous caller then picks their own bucket key, and every per-caller cap
 * in the product becomes decorative: send a fresh made-up address on each request and every
 * budget is fresh too. Nothing errors; the gates simply stop gating.
 *
 * THE RULE: count from the RIGHT. Entries are appended, so the caller can only ever add entries
 * on the LEFT — the Nth-from-the-right entry is the one written by our own Nth trusted proxy, and
 * it is unforgeable given that the hop count is right. `TRUSTED_PROXY_HOPS` is that count and
 * defaults to 1: exactly one trusted proxy in front of the app (the platform edge), so the last
 * entry is the address that edge observed.
 *
 * GETTING THE HOP COUNT WRONG FAILS SAFE. Too high, and the value is an address the caller
 * invented — but the caller cannot AIM it at somebody else's bucket without also being behind the
 * same proxies, and the misconfiguration shows up immediately as callers never being limited.
 * Too low, and the value is a proxy's own constant address, so everybody shares one bucket: the
 * gate becomes far too strict and is noticed at once. The tighter direction is the safer one to
 * fail in, which is why the default is the conservative end.
 *
 * IPv6 IS FOLDED TO ITS /64. A single residential or hosting IPv6 allocation is routinely a /64
 * or larger, so one caller can have billions of addresses inside their own prefix. Counting the
 * full address means one caller with an ordinary IPv6 line has an unlimited supply of fresh
 * budgets — the same "pick your own key" defect, arriving through legitimate addressing rather
 * than a forged header. /64 is the smallest unit routinely assigned to one subscriber, and it is
 * the same aggregation Better Auth's own limiter applies by default.
 */

/** The header the trusted proxy writes into. Overridable for a deployment whose edge uses another. */
function trustedHeaderName(): string {
  return (process.env.TRUSTED_CLIENT_IP_HEADER ?? "x-forwarded-for").trim().toLowerCase();
}

/** How many trusted proxies sit in front of this app. See the header note: counted from the right. */
function trustedProxyHops(): number {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

/** Every caller we cannot identify shares ONE bucket. Conservative on purpose: an unidentifiable
 *  caller must never be handed a private budget, which is what a per-request fallback would do. */
export const UNKNOWN_CALLER = "unknown-caller";

/** Strip a zone id (`%eth0`), brackets, and a trailing port — shapes proxies do emit. */
function bareAddress(raw: string): string {
  let value = raw.trim();
  if (value.startsWith("[")) {
    // `[2001:db8::1]:443` — the bracketed form is the only one where a port is unambiguous.
    const close = value.indexOf("]");
    if (close > 0) value = value.slice(1, close);
  } else if (isIP(value) === 0 && value.split(":").length === 2) {
    // `1.2.3.4:443` — only treat a single colon as a port, never an IPv6 separator.
    value = value.slice(0, value.lastIndexOf(":"));
  }
  const zone = value.indexOf("%");
  return zone >= 0 ? value.slice(0, zone) : value;
}

/** `::ffff:192.0.2.1` is an IPv4 address wearing an IPv6 costume; count it as the IPv4 it is. */
function mappedIPv4(address: string): string | null {
  const tail = address.slice(address.lastIndexOf(":") + 1);
  return address.includes(".") && isIP(tail) === 4 ? tail : null;
}

/** Expand `::` and pad every group, then keep the first four groups (the /64) and zero the rest. */
export function foldIPv6ToPrefix64(address: string): string {
  const [head, tail] = address.split("::") as [string, string | undefined];
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0"), ...tailGroups];
  const padded = groups.map((g) => (g === "" ? "0000" : g.padStart(4, "0")).toLowerCase());
  while (padded.length < 8) padded.push("0000");
  // /64 = the first four 16-bit groups. Everything below it is one subscriber's to choose.
  return [...padded.slice(0, 4), "0000", "0000", "0000", "0000"].join(":");
}

/**
 * The identity every per-caller gate counts. Returns {@link UNKNOWN_CALLER} when the request
 * carries nothing we are willing to trust — never a per-request value, which would be a fresh
 * budget for anyone who sends a malformed header.
 */
export function callerKey(requestHeaders: Headers): string {
  const raw = requestHeaders.get(trustedHeaderName());
  if (!raw) return UNKNOWN_CALLER;
  const entries = raw.split(",").map((e) => e.trim()).filter((e) => e.length > 0);
  // Count from the right. A caller can prepend entries; it cannot remove the one our edge appended.
  const candidate = entries[entries.length - trustedProxyHops()];
  if (candidate === undefined) return UNKNOWN_CALLER;

  const address = bareAddress(candidate);
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return UNKNOWN_CALLER;
  const asIPv4 = mappedIPv4(address);
  return asIPv4 ?? foldIPv6ToPrefix64(address);
}
