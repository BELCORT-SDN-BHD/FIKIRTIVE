"use server";

import { headers } from "next/headers";
import {
  SIGN_IN_CODE_INVALID_EMAIL_MESSAGE,
  SIGN_IN_CODE_SUCCESS_MESSAGE,
  SIGN_IN_CODE_UNAVAILABLE_MESSAGE,
  type SignInCodeRequestResult,
} from "@/lib/better-auth/signin-code-contract";
import { acceptSignInCodeRequest } from "@/lib/better-auth/signin-code-request";
import { emailDeliveryAvailable } from "@/lib/email/transport";

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
 * There is deliberately no try/catch and no failure branch left here. Nothing on this path can
 * throw for a reason that varies with the address: the format check is pure string work, and the
 * throttle (#795: now a shared counter in Postgres rather than a per-process Map) is one
 * statement over keys that were normalised before they were hashed — and it swallows its own
 * storage faults into a refusal rather than an exception. Re-introducing a branch — for the
 * throttle, for a delivery fault, for anything the background learns — re-opens the
 * account-existence oracle this ticket closed three times over.
 *
 * THE ONE BRANCH ABOVE ALL OF THAT (Founder 2026-09-05 裁决①「按环境提示」) is not about the
 * address and never touches it: "does this deployment have any way to send mail" is a single env
 * read (`emailDeliveryAvailable()`), decided before the address is even parsed, with the same
 * answer for every caller. It runs FIRST precisely so it cannot be mistaken for — or grow into —
 * a verdict about who is asking. The login page reads the same predicate and says so on the email
 * step; this is the backstop for a press that arrives anyway (a stale tab, a direct call).
 */
export async function requestSignInCode(input: { email: string }): Promise<SignInCodeRequestResult> {
  if (!emailDeliveryAvailable()) {
    return { status: "error", reason: "unknown", message: SIGN_IN_CODE_UNAVAILABLE_MESSAGE };
  }

  const outcome = await acceptSignInCodeRequest({
    email: input.email,
    requestHeaders: await headers(),
  });

  return outcome === "invalid_email"
    ? { status: "error", reason: "invalid_email", message: SIGN_IN_CODE_INVALID_EMAIL_MESSAGE }
    : { status: "success", message: SIGN_IN_CODE_SUCCESS_MESSAGE };
}
