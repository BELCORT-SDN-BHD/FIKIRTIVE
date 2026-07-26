import "server-only";

import { prisma } from "@fikirtive/db";
import { isOrgRole, type OrgRole } from "@fikirtive/core";

/**
 * #465 ②-C — the role-aware admission gate for per-org (merchant-side) capabilities.
 *
 * SCOPE: this module is the guard ENTRY only, pulled ahead of #465 on the Founder's
 * 2026-07-27 approval (#474 item 4) so that #467 (merchant member management) can be built
 * in parallel with #464. It is deliberately NOT applied to any of #465's 46 high-risk call
 * sites — bringing those under the gate stays in #465, behind the Founder-approved list
 * (#287 裁决三).
 *
 * CONTRACT
 *  - Input is the SUCCESS half of `requireOwner()` — never a client-supplied org/role
 *    (BLUEPRINT §6: 身份永远来自 session,永远不信客户端传的 org/owner).
 *  - Output is the caller's own membership in `gate.ownerId`, or `{ error }`.
 *  - DENY BY DEFAULT: every path that cannot positively prove "this session is an active
 *    member of this org holding at least `minRole`" returns `{ error }`. A database failure
 *    REJECTS; it never resolves to a permit.
 *
 * WHY IT TAKES THE GATE INSTEAD OF REPLACING `requireOwner()`
 *  1. `requireOwner()` stays the single session→ownerId authority. Re-implementing it here
 *     would duplicate the personal-org bootstrap, which grants credits — a money path.
 *  2. The auth-guard fence (scripts/verify-auth-guards.mjs) proves coverage only for the
 *     four names it imports from apps/web/lib/auth-guard.ts. A call site that keeps
 *     `const gate = await requireOwner();` therefore stays proven-covered, and this gate
 *     needs no fence change.
 *  3. It composes with #464 ②-B's frozen seam, in which the gate destructure stays OUTSIDE
 *     the principal frame:
 *
 *       const gate = await requireOwner(); if ("error" in gate) return gate;
 *       const seat = await requireOrgRole(gate, "owner"); if ("error" in seat) return seat;
 *       // …frame + body, scoped by gate.ownerId…
 *
 * THE TENANT SCOPE STAYS `gate.ownerId`. This function returns the SEAT (role + membership id)
 * and deliberately does NOT re-emit ownerId/email: the fence traces every Prisma filter back to
 * the trusted resolver PER PROPERTY (#469), so a filter scoped by a value laundered through this
 * function reads as `principal-result-unused` and fails. Measured with a probe action on this
 * branch: FINDING when the filter took its ownerId from this function's result, PASS when it
 * took it from `gate.ownerId`. Narrowing the return type makes the passing form the only form
 * that type-checks. Keeping the scope on the gate is also BLUEPRINT §6: requireOwner is the one
 * session→ownerId authority.
 *
 * NOT IN SCOPE (separate axes, decided per call site — see owner-settings-actions.ts:23 for
 * the impersonation precedent): admin impersonation, platform-staff RBAC (`requireRole`),
 * and spend authorization (which `requireSession` owns, never org role).
 */

/** The success half of `requireOwner()`. Structural on purpose — no import cycle. */
export type OwnerGate = { email: string; ownerId: string };

/** A proven seat in `gate.ownerId` — the role actually held, and the row that holds it. */
export type OrgSeat = { orgRole: OrgRole; membershipId: string };

/** Rank of the ORG_ROLES ladder — LOWER is more privileged (owner > admin > member). */
const ORG_ROLE_RANK: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2 };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Admit the caller only if their ACTIVE membership in `gate.ownerId` holds `minRole` or above.
 *
 * The membership lookup is scoped by `gate.ownerId` AND the session email, so a caller whose
 * only membership lives in another org cannot be admitted here: the row simply does not exist.
 * Suspended/revoked and soft-deleted rows are excluded, matching `requireOwner()` and the four
 * CRM gateways (defense in depth — the same row is re-read, not trusted from the caller).
 */
export async function requireOrgRole(
  gate: OwnerGate,
  minRole: OrgRole,
): Promise<OrgSeat | { error: string }> {
  // No identity → no seat. (Structural check: a JS caller or an `as any` can still get here.)
  if (!isNonEmptyString(gate?.email) || !isNonEmptyString(gate?.ownerId)) {
    return { error: "Not authorized." };
  }
  // An unknown threshold is unsatisfiable, not permissive.
  if (!isOrgRole(minRole)) return { error: "You don't have access to this." };

  const membership = await prisma.membership.findFirst({
    where: { orgId: gate.ownerId, status: "active", deletedAt: null, user: { email: gate.email } },
    select: { id: true, role: true },
  });
  // Not a member of this org (includes the founder-admin path, which holds no Membership row).
  if (!membership) return { error: "You don't have access to this." };
  // A role outside ORG_ROLES grants nothing — an unreadable role is a denied role.
  if (!isOrgRole(membership.role)) return { error: "You don't have access to this." };
  if (ORG_ROLE_RANK[membership.role] > ORG_ROLE_RANK[minRole]) {
    return { error: "You don't have access to this." };
  }

  return { orgRole: membership.role, membershipId: membership.id };
}
