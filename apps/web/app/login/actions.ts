"use server";

import { headers } from "next/headers";
import { EmailSendError } from "@/lib/email";
import { auth } from "@/lib/better-auth/server";
import { MagicLinkRateLimitError } from "@/lib/better-auth/sender";
import {
  MAGIC_LINK_DELIVERY_FAILED_MESSAGE,
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
    if (error instanceof MagicLinkRateLimitError) {
      return {
        status: "error",
        reason: "rate_limited",
        message: error.message,
      };
    }
    if (error instanceof EmailSendError) {
      return {
        status: "error",
        reason: "delivery_failed",
        message: MAGIC_LINK_DELIVERY_FAILED_MESSAGE,
      };
    }
    console.error("[better-auth] Magic-link request failed.", error);
    return {
      status: "error",
      reason: "unknown",
      message: MAGIC_LINK_UNKNOWN_FAILED_MESSAGE,
    };
  }
}
