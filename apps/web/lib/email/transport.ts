import { envVarConfigured } from "@fikirtive/core/env-contract";

/**
 * Which way out this deployment has for an email — and therefore whether the login page may
 * promise a merchant a sign-in code at all (Founder 2026-09-05 裁决①「按环境提示」).
 *
 * WHY THIS EXISTS AS ITS OWN ANSWER. `RESEND_API_KEY` is optional in the env contract
 * (packages/core/src/env-contract.ts), so a deployment can serve with no mail provider at all.
 * On such a deployment the login page used to say "We sent a temporary login code to …" while
 * the server log said `auth email delivery failed` — the same "what we say ≠ what we do" defect
 * the Google button had before #681, and cured the same way: BOTH halves read ONE fact, on the
 * server, and the page is only allowed to promise what the deployment can do.
 *
 * WHY SAYING IT OUT LOUD IS NOT AN ACCOUNT-EXISTENCE ORACLE (FRONT-A2). This is a DEPLOYMENT-level
 * fact: one env read, the same answer for every address, decided before any address is looked at.
 * It cannot vary with who is asking, so it carries no information about who has an account. A
 * single failed delivery is the opposite — only an address with access is ever handed to the mail
 * provider — which is why that one still stays an operator signal
 * (apps/web/lib/better-auth/signin-code-contract.ts).
 *
 * DELIBERATELY NOT `server-only`: one pure predicate over env, imported by the login server
 * component (which passes the answer down as a prop), by the login server action, and by the
 * transport factory. Same shape and same reasoning as lib/better-auth/social-config.ts. It must
 * never be imported from a client component — a `NEXT_PUBLIC_*` copy would be a second source of
 * truth that can drift out of step with the server that has to honour the press.
 */
export type EmailTransportChoice = "resend" | "stub" | "none";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The transport this process will use for the next send.
 *
 *   resend — a mail provider is configured; real mail goes out.
 *   stub   — no provider, but this is a test/dev environment: the message is written to
 *            `.data/last-magic-link.txt` and logged (lib/email/stub-adapter.ts).
 *   none   — a serving deployment with no provider and no stub. Nothing can be delivered, and
 *            the login page says so instead of claiming a code was sent.
 *
 * `AUTH_EMAIL_TRANSPORT=stub` is the EXPLICIT opt-in the e2e suite uses. It has to be explicit
 * because `next start` — the command the suite runs — sets NODE_ENV to production itself, so
 * "non-production" cannot be derived from NODE_ENV there. The env contract refuses that value on
 * a serving production process (`productionValues`), which is where that fence belongs.
 */
export function emailTransportChoice(env: Env = process.env): EmailTransportChoice {
  if (env.AUTH_EMAIL_TRANSPORT === "stub") return "stub";
  if (envVarConfigured(env, "RESEND_API_KEY")) return "resend";
  return env.NODE_ENV === "production" ? "none" : "stub";
}

/** Can this deployment deliver an auth email at all? The login page's whole question. */
export function emailDeliveryAvailable(env: Env = process.env): boolean {
  return emailTransportChoice(env) !== "none";
}
