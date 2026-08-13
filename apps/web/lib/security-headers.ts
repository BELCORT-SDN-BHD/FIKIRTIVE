/**
 * #795 — the security response headers, as a plain value.
 *
 * WHAT WAS WRONG. `next.config.ts` declared no `headers()` at all, so every page this product
 * serves went out with none of the four headers a browser needs in order to refuse the four
 * cheapest attacks on it. The one that matters most here is FRAMING: every destructive and every
 * paid action in this product is ONE CLICK behind a session — approve a campaign, confirm a
 * generation, delete a container. An attacker's page that loads fikirtive in a transparent
 * iframe over its own button gets the merchant's own authenticated click, and clickjacking needs
 * no XSS, no token and no bug on our side to work. It only needs us to be frameable.
 *
 * WHY IT IS A CONFIG VALUE AND NOT AN INLINE OBJECT. `next.config.ts` cannot be imported from
 * vitest (it pulls Next's own types/runtime), so an inline `headers()` there is a promise nobody
 * can check. Here it is a function over a plain argument, so the fence below is a real test:
 * a future edit that drops `frame-ancestors` fails CI instead of silently un-protecting a
 * one-click product.
 */

export type SecurityHeader = { key: string; value: string };
export type SecurityHeaderRule = { source: string; headers: SecurityHeader[] };

/**
 * The CSP we ENFORCE today. Deliberately one directive.
 *
 * `frame-ancestors` is the only CSP directive that cannot break a page's own content — it
 * governs who may embed us, nothing else — so it can go straight to enforcing with no
 * observation period. Everything else (script-src, style-src…) can white-screen the app if a
 * single source is missed, which is why it rides in the report-only policy below instead.
 *
 * Note: `frame-ancestors` is IGNORED in a report-only policy (CSP spec §6.1), so it would be
 * pure decoration there. That is exactly why the two policies are split rather than one policy
 * shipped twice.
 */
export const CSP_ENFORCED = "frame-ancestors 'none'";

/**
 * The CSP we are AIMING at, shipped report-only so it can be measured before it is enforced.
 *
 * Report-only changes nothing a visitor experiences: the browser evaluates the policy, blocks
 * nothing, and reports violations to the page's console. That is the point — this is how we find
 * out what the real page actually loads before a mistake here becomes a white screen.
 *
 * WHAT IS DELIBERATELY LOOSE, AND WHY:
 *   · `'unsafe-inline'` on script-src — Next's own bootstrap/flight payload is inline. Removing
 *     it needs per-request nonces threaded through the App Router, which is its own ticket.
 *   · `'unsafe-inline'` on style-src — Tailwind v4 and every animated component write inline
 *     style attributes.
 *   · `img-src`/`media-src https:` — merchant media is served from presigned object-storage URLs
 *     whose host is not fixed at build time.
 * Tightening any of these is a follow-up with a violation report in hand, not a guess made here.
 *
 * NOT SHIPPED: a `report-uri`/`report-to` collector. There is nowhere to send reports yet
 * (browser error reporting is #793's subject). Without it the violations still show up in the
 * console of any authenticated walkthrough, which is what this stage needs.
 */
export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
].join("; ");

/** Two years, subdomains included. Only ever sent in production — see `securityHeaderRules`. */
export const HSTS = "max-age=63072000; includeSubDomains";

/**
 * The media proxy sets its OWN `Referrer-Policy: no-referrer`, which is stricter than the
 * site-wide value below. Excluding that prefix here keeps the strict value the only one on that
 * response: a site-wide rule must never be the thing that loosens a route's own choice.
 *
 * Same negative-lookahead form the auth proxy matcher already uses (apps/web/proxy.ts).
 */
export const REFERRER_POLICY_SOURCE = "/((?!api/media/pub/).*)";

export function securityHeaderRules(opts: { production: boolean }): SecurityHeaderRule[] {
  const everywhere: SecurityHeader[] = [
    // Clickjacking, twice over: the modern directive plus the legacy header, because
    // `X-Frame-Options` is still what some embedded/older webviews obey.
    { key: "Content-Security-Policy", value: CSP_ENFORCED },
    { key: "X-Frame-Options", value: "DENY" },
    // Stop a browser from guessing that a JSON/asset response is really HTML or a script —
    // the sniffing step is what turns an uploaded file into a stored XSS.
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Measure before enforcing (see CSP_REPORT_ONLY).
    { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
  ];

  if (opts.production) {
    // HSTS is a COMMITMENT the browser remembers: once sent, that host is https-only for two
    // years. Sending it from a local http dev server is harmless (browsers ignore HSTS over
    // http) but sending it from a local https harness would pin `localhost` for everyone on the
    // machine, so it stays production-only. `preload` is deliberately NOT claimed: submitting to
    // the preload list is close to irreversible and is the Founder's call, not a code change.
    everywhere.push({ key: "Strict-Transport-Security", value: HSTS });
  }

  return [
    { source: "/:path*", headers: everywhere },
    {
      source: REFERRER_POLICY_SOURCE,
      headers: [
        // Send the origin cross-site, the full URL same-site. Our URLs carry ids (project,
        // campaign, thread) that no third-party site has any business reading off a referrer.
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
  ];
}
