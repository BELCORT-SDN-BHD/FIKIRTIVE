// Next.js server instrumentation, run once per runtime at server start. Two things live here:
//
//   1. A BOOT CHECK on the caller-identity deployment shape (#795). This runs ALWAYS — the note
//      that used to sit here, "no-op unless SENTRY_DSN is set, so any environment without a DSN
//      is completely unaffected", stopped being true when the check landed, and a misconfigured
//      CALLER_IP_SOURCE now stops the server from starting on purpose.
//   2. Sentry, which really is a no-op without SENTRY_DSN. (Closed-beta P0 — minimal error
//      monitoring before external users arrive.)
export async function register() {
  // #795 r5 — the caller-identity shape is checked HERE, at boot, and not at the first request.
  //
  // `resolveCallerIpSource` throws on a value it does not recognise. Left to the first
  // `callerKey()` call, that throw is a 500 on somebody's login attempt, in production, minutes
  // or hours after the deploy that caused it — and only on the paths that happen to gate. Boot is
  // the honest place: the deploy fails, the log says why, and no merchant sees it.
  //
  // Node runtime only: that is where the gates run, and the module reads `node:net`.
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { assertCallerIpSourceIsDeployable } = await import("@/lib/caller-identity");
    assertCallerIpSourceIsDeployable();
  }

  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV,
  });
}
