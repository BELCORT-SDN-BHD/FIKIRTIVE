// Next.js server instrumentation. Runs once when a server instance boots.
//
// Two things happen here, in this order on purpose:
//   1. #797 — the env contract. A production process whose required configuration is missing
//      refuses to serve, instead of serving and failing in odd places later. It goes first:
//      there is no point wiring monitoring for a process that must not run.
//   2. Error monitoring. No-op unless SENTRY_DSN is set, so local/dev and any environment
//      without a DSN are completely unaffected. (Closed-beta P0 — minimal error monitoring
//      before external users arrive.)
import { assertWebEnv } from "@/lib/env-boot";

export async function register() {
  assertWebEnv();

  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV,
  });
}
