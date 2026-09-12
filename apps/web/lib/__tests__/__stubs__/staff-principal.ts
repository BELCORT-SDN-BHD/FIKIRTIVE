import type { StaffPrincipal } from "@fikirtive/db/principal";

/**
 * #1379 (TENANT 切片④) test stub for `auth-guard.staffPrincipal`.
 *
 * `vi.mock("@/lib/auth-guard", factory)` REPLACES the whole module, so every test that mocks
 * `requireRole` must also supply `staffPrincipal` or the entry point under test calls
 * `undefined` (mirrors `resolve-user-principal.ts`'s stub for `resolveUserPrincipal`).
 *
 * Unlike `resolveUserPrincipal`, the real `staffPrincipal` does no DB work at all — it is a pure
 * mapping from a gate + a target tenant to a `StaffIdentity`. This stub is therefore IDENTICAL to
 * the real implementation, kept as its own file (rather than importing the real one, which would
 * re-enter the very module `vi.mock` is replacing) so every mocking test site shares one copy.
 */
export function stubStaffPrincipal(gate: { email: string }, ownerId: string | null): StaffPrincipal {
  return { kind: "staff", actorEmail: gate.email, ownerId };
}
