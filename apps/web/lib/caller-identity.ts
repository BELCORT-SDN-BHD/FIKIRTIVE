import { isIP } from "node:net";

/**
 * #795 — WHO IS BEING COUNTED, and why the answer depends on where this is deployed.
 *
 * Every per-caller gate in this product keys on a value taken out of a request header, and a
 * header is whatever the caller says it is unless something in front of the app overwrote it.
 * Which header that is, and where in it the trustworthy part sits, is a property of the DEPLOYMENT
 * — not something a library can guess. So it is configured, once, in `CALLER_IP_SOURCE`.
 *
 * ── The two failure modes this file exists between ────────────────────────────────────────────
 *
 * TOO LOOSE: read a value the caller controls. `X-Forwarded-For` is a LIST each proxy APPENDS to:
 *
 *     X-Forwarded-For: <what the client claimed>, <what our edge actually saw>
 *
 * Reading the FIRST entry reads the part the client wrote, so an anonymous caller picks their own
 * bucket key — a fresh made-up address each request is a fresh budget each request, and every
 * per-caller cap in the product becomes decorative. Nothing errors; the gates just stop gating.
 *
 * TOO TIGHT: read a header that is not there. Then every caller collapses into one bucket
 * ({@link UNKNOWN_CALLER}) and the whole public internet shares a single hourly budget — five
 * registrations an hour for the ENTIRE product. That is not a conservative default, it is an
 * outage we inflicted on ourselves. r2 shipped exactly this bug: it read `X-Forwarded-For` from
 * the right and deleted the `X-Real-IP` fallback, on a platform that does not send
 * `X-Forwarded-For` at all.
 *
 * ── Railway, our platform, per its own specification ──────────────────────────────────────────
 *
 * https://docs.railway.com/networking/public-networking/specs-and-limits lists the headers its
 * edge sets on every inbound request, verbatim:
 *
 *     X-Real-IP            "for identifying client's remote IP"
 *     X-Forwarded-Proto    "always indicates https"
 *     X-Forwarded-Host     "for identifying the original host header"
 *     X-Railway-Edge  ·  X-Request-Start  ·  X-Railway-Request-Id
 *
 * `X-Forwarded-For` is NOT on that list. On Railway the client's address arrives in `X-Real-IP`
 * and nowhere else, which is why `CALLER_IP_SOURCE=railway` reads that one header and ignores
 * anything else the caller attached.
 *
 * WHAT `railway` ASSUMES, stated out loud: that the edge OVERWRITES `X-Real-IP` rather than
 * passing a client-supplied one through. Railway documents the header as the client's remote IP —
 * a header the platform defines and sets — but does not document the overwrite explicitly. If a
 * future platform only fills it in when absent, this value is caller-chosen again. That is a
 * property of the platform, and the point of naming the deployment shape here is that the
 * assumption is written down and checked when the shape changes, instead of being inherited by
 * accident.
 *
 * ── The other shapes ──────────────────────────────────────────────────────────────────────────
 *
 * `xff:<hops>` is for an edge that appends to `X-Forwarded-For` (nginx, most CDNs, a self-run
 * ingress). Entries are APPENDED, so the caller can only ever add entries on the LEFT: the
 * Nth-from-the-right entry is the one written by our own Nth trusted proxy, and it is unforgeable
 * as long as the hop count matches the deployment. Getting the count wrong fails in a direction
 * you notice — too high reads an address the caller invented (they cannot aim it at somebody
 * else's bucket without sitting behind the same proxies, and "nobody is ever limited" shows up
 * immediately); too low reads a proxy's own constant address, so everybody shares one bucket.
 *
 * `dev` is for a laptop and for CI: there is no proxy, so it takes whichever of the two headers is
 * present and otherwise returns {@link UNKNOWN_CALLER}. It is deliberately NOT a production shape:
 * "believe whichever header showed up" is the loose failure above.
 *
 * IPv6 IS FOLDED TO ITS /64 in every shape. A residential or hosting IPv6 allocation is routinely
 * a /64 or larger, so counting full addresses hands one ordinary subscriber billions of fresh
 * budgets — the same "pick your own key" defect arriving through legitimate addressing rather than
 * a forged header. /64 is the smallest unit routinely assigned to one subscriber and is the same
 * aggregation Better Auth's own limiter applies by default.
 */

/** Railway's edge writes the client address here, and does not send `X-Forwarded-For`. */
const RAILWAY_CLIENT_IP_HEADER = "x-real-ip";
const FORWARDED_FOR_HEADER = "x-forwarded-for";

export type CallerIpSource =
  | { shape: "railway" }
  | { shape: "xff"; hops: number }
  | { shape: "dev" };

/**
 * The deployment shape, from `CALLER_IP_SOURCE`.
 *
 * Unset resolves by environment rather than to one silent default: production is Railway (the
 * platform this product deploys to — see the header note), everything else is `dev`. An
 * unrecognised value THROWS instead of falling back, because a typo that quietly selects a policy
 * is the failure this variable exists to prevent.
 */
export function resolveCallerIpSource(raw: string | undefined = process.env.CALLER_IP_SOURCE): CallerIpSource {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") {
    return process.env.NODE_ENV === "production" ? { shape: "railway" } : { shape: "dev" };
  }
  if (value === "railway") return { shape: "railway" };
  if (value === "dev") return { shape: "dev" };
  const xff = /^xff:(\d+)$/.exec(value);
  if (xff) {
    const hops = Number(xff[1]);
    if (Number.isInteger(hops) && hops >= 1) return { shape: "xff", hops };
  }
  throw new Error(
    `CALLER_IP_SOURCE is "${raw}", which names no deployment shape. Use "railway", "xff:<hops>" (hops ≥ 1), or "dev".`,
  );
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

/** The raw candidate string this deployment shape trusts, before it is parsed as an address. */
function trustedCandidate(requestHeaders: Headers, source: CallerIpSource): string | undefined {
  if (source.shape === "railway") return requestHeaders.get(RAILWAY_CLIENT_IP_HEADER) ?? undefined;

  if (source.shape === "xff") {
    const raw = requestHeaders.get(FORWARDED_FOR_HEADER);
    if (!raw) return undefined;
    const entries = raw.split(",").map((e) => e.trim()).filter((e) => e.length > 0);
    // Count from the right: the caller can prepend entries, never remove the one our edge appended.
    return entries[entries.length - source.hops];
  }

  // dev — no proxy in front, so take whatever a local tool or test attached.
  const real = requestHeaders.get(RAILWAY_CLIENT_IP_HEADER);
  if (real) return real;
  const forwarded = requestHeaders.get(FORWARDED_FOR_HEADER);
  if (!forwarded) return undefined;
  const entries = forwarded.split(",").map((e) => e.trim()).filter((e) => e.length > 0);
  return entries[entries.length - 1];
}

/**
 * The identity every per-caller gate counts. Returns {@link UNKNOWN_CALLER} when the request
 * carries nothing this deployment shape is willing to trust — never a per-request value, which
 * would be a fresh budget for anyone who sends a malformed header.
 */
export function callerKey(requestHeaders: Headers): string {
  const candidate = trustedCandidate(requestHeaders, resolveCallerIpSource());
  if (candidate === undefined) return UNKNOWN_CALLER;

  const address = bareAddress(candidate);
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return UNKNOWN_CALLER;
  const asIPv4 = mappedIPv4(address);
  return asIPv4 ?? foldIPv6ToPrefix64(address);
}
