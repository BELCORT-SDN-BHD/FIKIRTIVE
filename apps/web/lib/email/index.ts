import "server-only";
export type { EmailPort, EmailMessage, EmailErrorKind } from "./types";
export { EmailSendError } from "./types";
export { createResendEmailPort } from "./resend-adapter";

import { createResendEmailPort } from "./resend-adapter";

/** The active EmailPort — Resend today; swap the factory here to change transport. */
export const emailPort = createResendEmailPort();

/** FRONT-A12 — whether the ACTIVE transport can deliver at all right now, asked without naming
 *  the vendor. Callers use it to avoid telling a merchant an email is on its way when this
 *  deployment cannot post one to anybody; it says nothing about any particular address. Swap the
 *  factory above and this alias moves with it. */
export { resendPortCanSend as emailTransportReady } from "./resend-adapter";
