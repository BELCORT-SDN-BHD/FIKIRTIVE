import "server-only";

import {
  effectiveOrgRoles,
  orgRolesAllow,
  primaryOrgRole,
  type OrgRole,
} from "@fikirtive/core";
import { prisma as defaultDb } from "@fikirtive/db";

/**
 * C5-M3 (#27 absorbed): a READ-ONLY, owner-scoped team-membership directory + a server-derived
 * self identity, used by the broadcast workbench for name display ("created by …") and
 * role-aware controls. Spec:
 * docs/superpowers/specs/2026-07-21-c5-broadcast-eligibility-physical-contract.md; issue #388.
 *
 * Founder decision (2026-07-21): #27 is absorbed into this ticket as a read-only member
 * directory + self read. The self identity (membershipId + role) is ALWAYS derived on the
 * server from the authenticated principal — the client is never trusted to name who it is or
 * what role it holds. The directory is NOT a mutation surface and grants nothing: the server
 * broadcast actions stay the sole enforcer of the owner-only capability matrix.
 */

type MemberDirectoryDb = typeof defaultDb;
export const MEMBER_DIRECTORY_ERROR_CODES = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  ACTION_DENIED: "ACTION_DENIED",
} as const;

export type MemberDirectoryErrorCode =
  (typeof MEMBER_DIRECTORY_ERROR_CODES)[keyof typeof MEMBER_DIRECTORY_ERROR_CODES];

export class MemberDirectoryError extends Error {
  constructor(public readonly code: MemberDirectoryErrorCode) {
    super(code);
    this.name = "MemberDirectoryError";
  }
}

export type MemberDirectoryPrincipal = { ownerId: string; membershipId: string };

export type MemberDirectoryEntry = {
  membershipId: string;
  displayName: string;
  role: OrgRole;
  roles: OrgRole[];
  isSelf: boolean;
};

export type MemberDirectory = {
  self: { membershipId: string; role: OrgRole; roles: OrgRole[] };
  members: MemberDirectoryEntry[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Never fabricate a name; fall back to the email, then to a short membership label. */
function displayNameFor(user: { name: string | null; email: string | null }, membershipId: string): string {
  if (isNonEmptyString(user.name)) return user.name.trim();
  if (isNonEmptyString(user.email)) return user.email.trim();
  return `Member ${membershipId.slice(0, 6)}`;
}

export function createMemberDirectoryService(options: { db?: MemberDirectoryDb } = {}) {
  const db = options.db ?? defaultDb;

  async function listMemberDirectory(principal: MemberDirectoryPrincipal): Promise<MemberDirectory> {
    if (!isNonEmptyString(principal?.ownerId) || !isNonEmptyString(principal?.membershipId)) {
      throw new MemberDirectoryError("NOT_AUTHORIZED");
    }

    // Defense in depth: verify the caller is an active member of the org before returning the
    // directory (the gateway already resolves this, but a read must fail closed on its own).
    const self = await db.membership.findFirst({
      where: { id: principal.membershipId, orgId: principal.ownerId, status: "active", deletedAt: null },
      select: { id: true, roles: { select: { role: true } } },
    });
    const selfRoles = effectiveOrgRoles(
      (self?.roles ?? []).map((assignment) => assignment.role),
    );
    const selfPrimary = primaryOrgRole(selfRoles);
    if (!self || !selfPrimary || !orgRolesAllow(selfRoles, "members.read")) {
      throw new MemberDirectoryError("ACTION_DENIED");
    }

    const rows = await db.membership.findMany({
      where: { orgId: principal.ownerId, status: "active", deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        roles: { select: { role: true } },
        user: { select: { name: true, email: true } },
      },
    });

    const members: MemberDirectoryEntry[] = rows.flatMap((row) => {
      const roles = effectiveOrgRoles(
        (row.roles ?? []).map((assignment) => assignment.role),
      );
      const role = primaryOrgRole(roles);
      return role
        ? [{
            membershipId: row.id,
            displayName: displayNameFor(row.user, row.id),
            role,
            roles,
            isSelf: row.id === principal.membershipId,
          }]
        : [];
    });

    return {
      self: { membershipId: self.id, role: selfPrimary, roles: selfRoles },
      members,
    };
  }

  return { listMemberDirectory };
}

export const memberDirectoryService = createMemberDirectoryService();
