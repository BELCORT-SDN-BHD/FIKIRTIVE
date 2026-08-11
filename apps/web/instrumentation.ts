// Next.js server instrumentation. Runs once when a server instance boots.
//
// Two things happen here, in this order on purpose:
//   1. #797 — the env contract. A production process whose required configuration is missing
//      refuses to serve, instead of serving and failing in odd places later. It goes first:
//      there is no point wiring monitoring for a process that must not run.
//   2. Error monitoring. No-op unless SENTRY_DSN is set, so local/dev and any environment
//      without a DSN are completely unaffected. (Closed-beta P0 — minimal error monitoring
//      before external users arrive.)
//
// The env check is imported dynamically behind a NEXT_RUNTIME check, and both halves of that
// matter. Next builds an EDGE instrumentation bundle as well, where node:crypto does not exist —
// a static import puts the contract module in that bundle and the build reports it. And the
// check itself is a Node-server concern: the edge runtime sees a different slice of the
// environment, so asserting the server contract there would be answering the wrong question.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertWebEnv } = await import("@/lib/env-boot");
    assertWebEnv();
  }

  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV,
  });
}
