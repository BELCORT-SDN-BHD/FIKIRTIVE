import "server-only";
import type { EmailMessage, EmailPort } from "./types";

/**
 * The stub transport — the deployment's mail "provider" when there is none (Founder 2026-09-05
 * 裁决①「按环境提示」).
 *
 * It is a 1:1 move of the fallback that used to sit inside `createResendEmailPort()`: same file,
 * same console line, same content. What changed is that it is now a NAMED transport chosen by
 * `emailTransportChoice()` (lib/email/transport.ts) rather than an `if` hidden inside the Resend
 * adapter — so "does this deployment have a way to deliver?" is a question with one answer, and
 * the login page can read it.
 *
 * WHO RUNS IT. A developer's machine with no key, and the e2e suite (which opts in explicitly
 * with `AUTH_EMAIL_TRANSPORT=stub`; its fence against carrying a real `RESEND_API_KEY` is
 * untouched — e2e/support/env.ts `OFF_MACHINE_CREDENTIAL_NAMES`). A serving production process
 * never gets here: the env contract refuses `AUTH_EMAIL_TRANSPORT=stub` in production, and
 * without that opt-in a keyless production deployment resolves to "none", not to this.
 *
 * THE FILE'S NAME IS OLDER THAN WHAT IT HOLDS. It is written whatever the credential is — a
 * verification link, a reset link, or (since sign-in moved to one-time codes) six digits. The path
 * is left alone because a dozen local tracer scripts read it by name; renaming it is a tooling
 * change, not part of the auth flow.
 */
export function createStubEmailPort(): EmailPort {
  return {
    async send(message: EmailMessage): Promise<void> {
      const { to, subject } = message;
      const preview = message.devPreview ?? message.text ?? message.html ?? "";

      const { writeFile, mkdir } = await import("node:fs/promises");
      const path = await import("node:path");
      const dir = path.join(process.cwd(), "..", "..", ".data");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "last-magic-link.txt"), preview, "utf8");
      console.log(`[better-auth] ${subject} for ${to}: ${preview}`);
    },
  };
}
