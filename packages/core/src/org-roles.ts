export const ORG_ROLES = ["owner", "admin", "member", "creator", "approver"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_CAPABILITIES = [
  "workspace.read",
  "content.create",
  "content.approve",
  "members.read",
  "members.manage",
  "inbox.read",
  "inbox.reply",
  "inbox.manage",
  "broadcast.read",
  "broadcast.report.read",
  "broadcast.manage",
  "workflow.read",
  "workflow.manage",
] as const;
export type OrgCapability = (typeof ORG_CAPABILITIES)[number];

const allOrgCapabilities = new Set<OrgCapability>(ORG_CAPABILITIES);

/**
 * Organization roles are reusable permission bundles. They are deliberately not a
 * privilege ladder: one membership may hold any number of roles.
 */
export const ORG_ROLE_CAPABILITIES: Record<OrgRole, ReadonlySet<OrgCapability>> = {
  owner: allOrgCapabilities,
  admin: new Set([
    "workspace.read",
    "content.create",
    "content.approve",
    "members.read",
    "members.manage",
    "inbox.read",
    "inbox.reply",
    "inbox.manage",
    "broadcast.read",
  ]),
  member: new Set([
    "workspace.read",
    "content.create",
    "members.read",
    "inbox.read",
    "inbox.reply",
    "broadcast.read",
  ]),
  creator: new Set(["workspace.read", "content.create"]),
  approver: new Set(["workspace.read", "content.approve"]),
};

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

export function isOrgCapability(value: unknown): value is OrgCapability {
  return (
    typeof value === "string" &&
    (ORG_CAPABILITIES as readonly string[]).includes(value)
  );
}

/** Return the valid, distinct assignment rows. No compatibility column grants access. */
export function effectiveOrgRoles(assignments: Iterable<unknown>): OrgRole[] {
  return [...new Set([...assignments].filter(isOrgRole))];
}

/** Stable compatibility value for UI surfaces that still show one primary role. */
export function primaryOrgRole(roles: Iterable<unknown>): OrgRole | null {
  const assigned = new Set(effectiveOrgRoles(roles));
  return ORG_ROLES.find((role) => assigned.has(role)) ?? null;
}

/** Deny by default and combine every valid assigned role. */
export function orgRolesAllow(
  roles: Iterable<string>,
  capability: OrgCapability,
): boolean {
  for (const role of roles) {
    if (isOrgRole(role) && ORG_ROLE_CAPABILITIES[role].has(capability)) return true;
  }
  return false;
}
