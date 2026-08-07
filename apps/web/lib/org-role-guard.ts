import "server-only";

import { prisma } from "@fikirtive/db";
import {
  effectiveOrgRoles,
  isOrgCapability,
  orgRolesAllow,
  type OrgCapability,
  type OrgRole,
} from "@fikirtive/core";

export type OwnerGate = { email: string; ownerId: string };
export type OrgAccess = { orgRoles: OrgRole[]; membershipId: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Prove one concrete capability in the authenticated organization.
 *
 * The tenant continues to come from requireOwner(); this function returns only the
 * membership and its assigned role bundles. Unknown roles grant nothing. During the
 * Membership.role is display-only and never grants access.
 */
export async function requireOrgPermission(
  gate: OwnerGate,
  capability: OrgCapability,
): Promise<OrgAccess | { error: string }> {
  if (!isNonEmptyString(gate?.email) || !isNonEmptyString(gate?.ownerId)) {
    return { error: "Not authorized." };
  }
  if (!isOrgCapability(capability)) {
    return { error: "You don't have access to this." };
  }

  const membership = await prisma.membership.findFirst({
    where: {
      orgId: gate.ownerId,
      status: "active",
      deletedAt: null,
      user: { email: gate.email },
    },
    select: {
      id: true,
      roles: { select: { role: true } },
    },
  });
  if (!membership) return { error: "You don't have access to this." };

  const roles = effectiveOrgRoles(membership.roles.map((assignment) => assignment.role));
  if (!orgRolesAllow(roles, capability)) {
    return { error: "You don't have access to this." };
  }

  return { orgRoles: roles, membershipId: membership.id };
}
