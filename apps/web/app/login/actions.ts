"use server";

import { headers } from "next/headers";
import {
  SIGN_IN_CODE_INVALID_EMAIL_MESSAGE,
  SIGN_IN_CODE_SUCCESS_MESSAGE,
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
 * There is deliberately no try/catch and no failure branch left here. Nothing on this path can
 * throw for a reason that varies with the address: the format check is pure string work, and the
 * throttle (#795: now a shared counter in Postgres rather than a per-process Map) is one
 * statement over keys that were normalised before they were hashed — and it swallows its own
 * storage faults into a refusal rather than an exception. Re-introducing a branch — for the
 * throttle, for a delivery fault, for anything the background learns — re-opens the
 * account-existence oracle this ticket closed three times over.
 */
export async function requestSignInCode(input: { email: string }): Promise<SignInCodeRequestResult> {
  const outcome = await acceptSignInCodeRequest({
    email: input.email,
    requestHeaders: await headers(),
  });

  return outcome === "invalid_email"
    ? { status: "error", reason: "invalid_email", message: SIGN_IN_CODE_INVALID_EMAIL_MESSAGE }
    : { status: "success", message: SIGN_IN_CODE_SUCCESS_MESSAGE };
}
