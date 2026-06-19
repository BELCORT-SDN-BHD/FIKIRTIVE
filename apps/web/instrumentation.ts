// Next.js server instrumentation. No-op unless SENTRY_DSN is set, so local/dev and
// any environment without a DSN are completely unaffected. (Closed-beta P0 — minimal
// error monitoring before external users arrive.)
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV,
  });
}
