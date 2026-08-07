"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/better-auth/server";
import {
  MAGIC_LINK_INVALID_EMAIL_MESSAGE,
  MAGIC_LINK_SUCCESS_MESSAGE,
  MAGIC_LINK_UNKNOWN_FAILED_MESSAGE,
  normalizeMagicLinkEmail,
  type MagicLinkRequestResult,
} from "@/lib/better-auth/magic-link-contract";
import { sanitizeCallbackURL } from "@/lib/safe-redirect";

export async function requestMagicLink(input: {
  email: string;
  callbackURL: string;
}): Promise<MagicLinkRequestResult> {
  const email = normalizeMagicLinkEmail(input.email);
  if (!email) {
    return {
      status: "error",
      reason: "invalid_email",
      message: MAGIC_LINK_INVALID_EMAIL_MESSAGE,
    };
  }

  try {
    await auth.api.signInMagicLink({
      body: {
        email,
        callbackURL: sanitizeCallbackURL(input.callbackURL),
      },
      headers: await headers(),
    });
    return { status: "success", message: MAGIC_LINK_SUCCESS_MESSAGE };
  } catch (error) {
    // #678 r2 — there is no rate-limit branch and no delivery-failure branch here, on purpose.
    // Neither the per-address cap nor the mail provider is on this path any more: sendMagicLink
    // hands the job to the background and returns, so a capped request, a 429 from the provider
    // and a delivered link all land on the `success` return above with the SAME bytes.
    // Re-introducing a branch for either re-opens the account-existence oracle this ticket
    // closed — the second time round it was the TIMING and the transport outcome, not the copy.
    //
    // What can still reach here is a genuine server fault (database down, Better Auth internal,
    // the per-IP cap), which happens identically for an address with an account and one without.
    console.error("[better-auth] Magic-link request failed.", error);
    return {
      status: "error",
      reason: "unknown",
      message: MAGIC_LINK_UNKNOWN_FAILED_MESSAGE,
    };
  }
}
