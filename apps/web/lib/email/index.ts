import "server-only";
export type { EmailPort, EmailMessage, EmailErrorKind } from "./types";
export { EmailSendError } from "./types";
export { createResendEmailPort } from "./resend-adapter";

import { createResendEmailPort } from "./resend-adapter";

/** The active EmailPort — Resend today; swap the factory here to change transport. */
export const emailPort = createResendEmailPort();
