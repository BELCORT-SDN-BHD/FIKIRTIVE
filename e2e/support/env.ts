/**
 * Where the resident E2E suite points, and the environment the app under test is handed (#799).
 *
 * ONE PLACE decides both, because the suite and the server it drives have to agree on the
 * database, the origin and the auth secret — a second copy of any of those is a run that signs
 * a session the app cannot read, or seeds a database the app is not looking at.
 */

/** Not 3000: a developer's own `next dev` usually owns that port, and a suite that silently
 *  attaches to whatever is already listening would be testing an unknown build. */
const DEFAULT_PORT = 3399;

export const E2E_PORT = Number(process.env.E2E_PORT ?? DEFAULT_PORT);
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${E2E_PORT}`;

/**
 * The database this suite owns.
 *
 * The suite TRUNCATES every table before it runs, so the name check is not a formality: it is the
 * only thing standing between a mistyped DATABASE_URL and somebody's real data. Same rule and the
 * same shape `scripts/ci/quality.sh` enforces for the unit suites — a name ending in `_test`.
 */
export function e2eDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "e2e: DATABASE_URL is not set. Point it at a throwaway database whose name ends in _test, e.g. postgresql://fikirtive:fikirtive@127.0.0.1:5432/fikirtive_e2e_test",
    );
  }
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `e2e: refusing to run against database "${name}". This suite truncates every table before it starts, so it only ever runs against a database whose name matches ^[a-z0-9_]+_test$.`,
    );
  }
  return url;
}

/** Deliberately fixed and deliberately not a secret: sessions minted here are only ever readable
 *  by the throwaway server this suite starts. */
export const E2E_AUTH_SECRET = "fikirtive-e2e-only-session-secret-not-for-production";

/**
 * Every credential that would let the app under test REACH OFF THIS MACHINE — to spend, to send,
 * or merely to report. NONE of them is set by `appEnv()`, and `global-setup.ts` refuses to start
 * if the ambient environment carries one.
 *
 * WHY THE LIST IS WIDER THAN "CAN SPEND". A resident suite runs unattended every night, so the
 * question is not only "could this bill somebody" but "could this reach anyone at all". Both
 * failures are silent from inside a green run:
 *
 *   · money — BYTEPLUS_API_KEY generates for real; STRIPE_SECRET_KEY reaches the payment
 *     provider; ANTHROPIC_API_KEY bills per token; and TAVILY_API_KEY / BRAVE_SEARCH_API_KEY are
 *     metered web-search transports that are ACTIVELY wired (apps/web/lib/otto-actions.ts,
 *     apps/worker/src/jobs/research.ts pick a provider from whichever of the two keys is present
 *     — so one leaked key is nightly billed traffic).
 *   · reach — RESEND_API_KEY sends real mail to whatever address a fixture happens to hold, and
 *     SENTRY_DSN ships this suite's own deliberate failures to the production error stream, where
 *     they are indistinguishable from a merchant's.
 *
 * With none of them present, `createGenerationProvider()` returns its mock ($0, offline), the
 * research port is left unwired (its own "not configured" answer), Sentry stays a no-op and the
 * Stripe shelf has no key to call — the fence is the ABSENCE of the credential, not a flag
 * somebody has to remember to pass.
 *
 * EVERY NAME HERE MUST BE ONE THE PRODUCT ACTUALLY READS. `packages/core/src/env-contract.ts` is
 * the declared list, and its test fails if apps/ + packages/ read a variable it does not declare —
 * so a name that is absent from the contract is a name no code path can act on. Fencing such a
 * name is worse than useless: it reads as live protection and protects nothing, and the next
 * person to audit this file has to re-derive which entries still have a consumer.
 */
export const OFF_MACHINE_CREDENTIAL_NAMES = [
  "BYTEPLUS_API_KEY",
  "STRIPE_SECRET_KEY",
  "ANTHROPIC_API_KEY",
  "TAVILY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "RESEND_API_KEY",
  "SENTRY_DSN",
] as const;

/** The environment `next start` is given. Everything the app needs, and nothing that can spend. */
export function appEnv(): Record<string, string> {
  return {
    PORT: String(E2E_PORT),
    DATABASE_URL: e2eDatabaseUrl(),
    BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
    BETTER_AUTH_URL: E2E_BASE_URL,
    NEXT_PUBLIC_BETTER_AUTH_URL: E2E_BASE_URL,
    // The wall is ON. Every journey that reaches a product surface has to get through it.
    AUTH_ENABLED: "true",
    // AUTH_ALLOWED_EMAILS is deliberately NOT set. Every journey's merchant gets in through the
    // DB invite row the fixture writes (AllowedEmail), which is the door a real merchant uses —
    // an env allowlist would have been the suite quietly exempting itself from the gate.
    // No production configuration exists on a test runner; the boot contract would refuse to
    // serve. `warn` is the contract's own documented escape hatch (lib/env-boot.ts).
    FIKIRTIVE_ENV_CONTRACT: "warn",
    NEXT_TELEMETRY_DISABLED: "1",
    // GENERATION_PROVIDER is deliberately absent — see OFF_MACHINE_CREDENTIAL_NAMES above.
  };
}
