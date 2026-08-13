"use server";

import { headers } from "next/headers";
import {
  MAGIC_LINK_INVALID_EMAIL_MESSAGE,
  MAGIC_LINK_SUCCESS_MESSAGE,
  type MagicLinkRequestResult,
} from "@/lib/better-auth/magic-link-contract";
import { acceptMagicLinkRequest } from "@/lib/better-auth/magic-link-request";

/**
 * #678 r3 — the login page's door. It is a thin translation of the ONE request path
 * (lib/better-auth/magic-link-request.ts) into this action's result shape, and it must stay thin:
 * every question worth asking about the address — is it on the allowlist, does it have budget
 * left, should a token be minted, can the mail provider be reached — happens on the background
 * side, where its cost cannot be timed from outside.
 *
 * There is deliberately no try/catch and no failure branch left here. Nothing on this path can
 * throw for a reason that varies with the address: the format check is pure string work, and the
 * throttle (#795: now a shared counter in Postgres rather than a per-process Map) is one
 * statement over keys that were normalised before they were hashed — and it swallows its own
 * storage faults into a refusal rather than an exception. Re-introducing a branch — for the
 * throttle, for a delivery fault, for anything the background learns — re-opens the
 * account-existence oracle this ticket closed three times over.
 */
export async function requestMagicLink(input: {
  email: string;
  callbackURL: string;
}): Promise<MagicLinkRequestResult> {
  const outcome = await acceptMagicLinkRequest({
    email: input.email,
    callbackURL: input.callbackURL,
    requestHeaders: await headers(),
  });

  return outcome === "invalid_email"
    ? { status: "error", reason: "invalid_email", message: MAGIC_LINK_INVALID_EMAIL_MESSAGE }
    : { status: "success", message: MAGIC_LINK_SUCCESS_MESSAGE };
}
