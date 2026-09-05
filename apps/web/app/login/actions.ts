"use server";

import { headers } from "next/headers";
import {
  SIGN_IN_CODE_INVALID_EMAIL_MESSAGE,
  SIGN_IN_CODE_SUCCESS_MESSAGE,
  SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE,
  type SignInCodeRequestResult,
} from "@/lib/better-auth/signin-code-contract";
import { acceptSignInCodeRequest } from "@/lib/better-auth/signin-code-request";

/**
 * #678 r3 — the login page's door. It is a thin translation of the ONE request path
 * (lib/better-auth/signin-code-request.ts) into this action's result shape, and it must stay thin:
 * every question worth asking about the address — is it on the allowlist, does it have budget
 * left, should a code be minted, can the mail provider be reached — happens on the background
 * side, where its cost cannot be timed from outside.
 *
 * It is also the ONLY public way to ask for a code: Better Auth's own
 * `/email-otp/send-verification-otp` is in `disabledPaths` (lib/better-auth/server.ts), so there
 * is no second entrance with a different set of gates on it.
 *
 * There is deliberately no try/catch here. Nothing on this path can throw for a reason that varies
 * with the address: the format check is pure string work, and the throttle (#795: now a shared
 * counter in Postgres rather than a per-process Map) is one statement over keys that were
 * normalised before they were hashed — and it swallows its own storage faults into a refusal
 * rather than an exception. Re-introducing a branch for the throttle, for a per-send delivery
 * fault, or for anything else the background learns ABOUT THIS ADDRESS re-opens the
 * account-existence oracle this ticket closed three times over.
 *
 * FRONT-A12 — the one branch that is not of that family. `no_email_transport` says this
 * deployment has no mail transport configured at all, so no code can reach ANY address; the
 * request path decides it from configuration before it looks at the address (see the ①′ comment
 * in signin-code-request.ts). It lands on the reason the contract already has for "a genuine
 * server fault that lands the same way for every address" — `unknown` — with the sentence the
 * page already shows for it, so this adds no new answer to the vocabulary and no new copy: it
 * only stops the page saying "check your email" when the email was never going anywhere.
 */
export async function requestSignInCode(input: { email: string }): Promise<SignInCodeRequestResult> {
  const outcome = await acceptSignInCodeRequest({
    email: input.email,
    requestHeaders: await headers(),
  });

  if (outcome === "invalid_email") {
    return { status: "error", reason: "invalid_email", message: SIGN_IN_CODE_INVALID_EMAIL_MESSAGE };
  }
  if (outcome === "no_email_transport") {
    return { status: "error", reason: "unknown", message: SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE };
  }
  return { status: "success", message: SIGN_IN_CODE_SUCCESS_MESSAGE };
}
