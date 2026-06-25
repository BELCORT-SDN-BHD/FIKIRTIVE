import "server-only";
import { APIError } from "better-auth/api";
import { prisma } from "@fikirtive/db";
import { isAllowedEmail } from "@/lib/allowlist";

/** Deny-by-default allowlist gate. Throws APIError FORBIDDEN for any non-allowlisted email
 *  (fail-closed: null/undefined/unknown email throws). Used by every Better Auth sign-in path. */
export async function assertAllowedEmail(email: string | null | undefined): Promise<void> {
  if (!(await isAllowedEmail(email))) {
    throw new APIError("FORBIDDEN", { message: "This email isn't on the allowlist." });
  }
}

/** Resolve a ba_user's email by id and assert it's allowlisted. Fail-closed: an unknown
 *  userId yields undefined email → throws. Used by session.create.before (covers repeat sign-ins). */
export async function assertAllowedForUserId(userId: string): Promise<void> {
  const u = await prisma.betterAuthUser.findUnique({ where: { id: userId }, select: { email: true } });
  await assertAllowedEmail(u?.email);
}
