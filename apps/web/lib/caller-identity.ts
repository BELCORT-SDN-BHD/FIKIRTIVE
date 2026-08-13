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
 * WHEN THE HOP COUNT MATCHES THE DEPLOYMENT — that condition is load-bearing, not decorative:
 *
 *   · Too HIGH is the dangerous direction. With `xff:2` behind a single edge, the entry read is
 *     `<client-written>, <client-written>, <edge>` → index 1, which the caller wrote. They do not
 *     merely get an address of their own — they can put ANY valid address there, including a
 *     VICTIM's, and land in that victim's bucket. Spending someone else's budget is a denial of
 *     service aimed at one person, and it is available to anyone who can read this file.
 *     (An earlier revision of this comment claimed a caller "cannot aim it at somebody else's
 *     bucket". That was wrong, and the number below is the only thing standing between the two
 *     readings.)
 *   · Too LOW reads a proxy's own constant address, so everybody shares one bucket: far too
 *     strict, and noticed at once.
 *
 * Neither is a shape to guess at, which is the reason this is configuration and not a default.
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

/**
 * BOOT CHECK (#795 r5) — call this once at server start (`instrumentation.ts`).
 *
 * Two ways a deploy can be wrong about who it is counting, and both are refused here rather than
 * at the first request that happens to gate:
 *
 *   · An unrecognised value. `resolveCallerIpSource` throws; doing it at boot turns "a 500 on
 *     somebody's login, hours later" into "this deploy did not start, and the log says why".
 *   · `dev` IN PRODUCTION. `dev` means "believe whichever of the two headers showed up", which is
 *     precisely the forgeable reading — a caller writes one and picks their own bucket, and every
 *     per-caller cap in the product quietly stops capping. This REFUSES rather than warns: beta is
 *     open registration, these gates are what stands in front of it, and a warning in a deploy log
 *     is not a guard. Naming the real shape is one environment variable.
 */
export function assertCallerIpSourceIsDeployable(): void {
  const source = resolveCallerIpSource(); // throws on an unrecognised value
  if (process.env.NODE_ENV === "production" && source.shape === "dev") {
    throw new Error(
      'CALLER_IP_SOURCE is "dev" in production. "dev" trusts whichever address header arrives, ' +
        "which lets any caller choose their own rate-limit bucket. Set the real deployment shape " +
        '("railway", or "xff:<hops>" for an edge that appends to X-Forwarded-For).',
    );
  }
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
 * THE ONE AUTHORITATIVE ADDRESS for this request, or `null` when this deployment shape cannot
 * identify the caller. Every gate in the product — ours and Better Auth's — counts this value and
 * nothing else.
 */
export function callerAddress(requestHeaders: Headers): string | null {
  const candidate = trustedCandidate(requestHeaders, resolveCallerIpSource());
  if (candidate === undefined) return null;

  const address = bareAddress(candidate);
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return null;
  const asIPv4 = mappedIPv4(address);
  return asIPv4 ?? foldIPv6ToPrefix64(address);
}

/**
 * The identity every per-caller gate counts. Returns {@link UNKNOWN_CALLER} when the request
 * carries nothing this deployment shape is willing to trust — never a per-request value, which
 * would be a fresh budget for anyone who sends a malformed header.
 */
export function callerKey(requestHeaders: Headers): string {
  return callerAddress(requestHeaders) ?? UNKNOWN_CALLER;
}

/**
 * THE PIPE INTO BETTER AUTH (#795 r5).
 *
 * Better Auth resolves its own client address for its built-in burst rules, and its default is
 * `X-Forwarded-For`, first entry (`utils/get-request-ip.mjs`). On this deployment that default is
 * wrong in both directions at once:
 *
 *   · Railway's edge does not send `X-Forwarded-For` — but Next fills one in from the socket
 *     (`base-server.js`: `req.headers['x-forwarded-for'] ??= originalRequest.socket.remoteAddress`),
 *     and that socket is the platform's internal proxy. Every real merchant would land in ONE
 *     bucket and Better Auth's 3-per-10-seconds sign-in rule would refuse the entire product.
 *   · If anything upstream ever did pass a caller-supplied `X-Forwarded-For` through, `??=` keeps
 *     it and the first entry is whatever the caller wrote — the forgeable reading, restored.
 *
 * Better Auth's option takes a list of header NAMES and reads the first value of the first header
 * it finds; there is no hook for "count from the right", so the `xff:<hops>` shape cannot be
 * expressed as a header name. So the deployment shape is resolved ONCE, here, and handed to
 * Better Auth through a header of our own: {@link CALLER_IP_HEADER}. The stamping function
 * DELETES any inbound copy first — otherwise it would be one more header a caller could write.
 *
 * When the caller is unidentifiable the header is left off entirely, and Better Auth's own
 * fallback puts every such request into one shared bucket (`NO_TRUSTED_IP_KEY`) — the same
 * semantics as {@link UNKNOWN_CALLER} on our side, reached by its own code path.
 */
export const CALLER_IP_HEADER = "x-fikirtive-caller-ip";

/** Return a request whose {@link CALLER_IP_HEADER} is ours and only ours. */
export function withCallerIdentityHeader(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(CALLER_IP_HEADER); // never inherit a caller-supplied copy
  const address = callerAddress(request.headers);
  if (address) headers.set(CALLER_IP_HEADER, address);
  return new Request(request, { headers });
}
