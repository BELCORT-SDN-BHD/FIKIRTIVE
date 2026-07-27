import type { UserPrincipal } from "@fikirtive/db/principal";

/**
 * #464 B1 test stub for `auth-guard.resolveUserPrincipal`.
 *
 * `vi.mock("@/lib/auth-guard", factory)` REPLACES the whole module, so every test that mocks
 * `requireOwner` must also supply `resolveUserPrincipal` or the entry point under test calls
 * `undefined`. This stub does no DB work and mirrors the real MEMBERSHIP-MISS shape: the subject
 * and the org are named, the membership-derived fields stay null. Tests that need a resolved
 * membership can build their own principal instead of using this.
 */
export async function stubResolveUserPrincipal(
  gate: { email: string; ownerId: string },
  opts: { impersonating?: boolean } = {},
): Promise<UserPrincipal> {
  return {
    kind: "user",
    subjectUserId: null,
    subjectEmail: gate.email,
    ownerId: gate.ownerId,
    orgRole: null,
    membershipId: null,
    impersonating: opts.impersonating ?? false,
    impersonatedByBaUserId: null,
  };
}
