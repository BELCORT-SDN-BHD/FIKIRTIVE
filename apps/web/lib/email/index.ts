import "server-only";
export type { EmailPort, EmailMessage, EmailErrorKind } from "./types";
export { EmailSendError } from "./types";
export { createResendEmailPort } from "./resend-adapter";
export { createStubEmailPort } from "./stub-adapter";
export { emailDeliveryAvailable, emailTransportChoice } from "./transport";

import { createResendEmailPort } from "./resend-adapter";
import { createStubEmailPort } from "./stub-adapter";
import { emailTransportChoice } from "./transport";
import { EmailSendError } from "./types";
import type { EmailMessage, EmailPort } from "./types";

const resend = createResendEmailPort();
const stub = createStubEmailPort();

/**
 * The active EmailPort. Which transport carries a message is decided PER SEND, by the one
 * predicate the login page also reads (`emailTransportChoice`, lib/email/transport.ts) — so
 * "this deployment can deliver" and "this deployment delivered" can never be two different
 * answers, and a test that changes the environment between sends gets the transport it asked for.
 *
 * "none" means a serving deployment with no mail provider. It throws the same
 * `config_missing` this path has always thrown, so the background sender keeps logging an
 * operator fault; what changed is that the login page no longer promises a code first
 * (Founder 2026-09-05 裁决①「按环境提示」).
 */
export const emailPort: EmailPort = {
  async send(message: EmailMessage): Promise<void> {
    switch (emailTransportChoice()) {
      case "resend":
        return resend.send(message);
      case "stub":
        return stub.send(message);
      case "none":
        throw new EmailSendError("RESEND_API_KEY is not configured.", "config_missing");
    }
  },
};
