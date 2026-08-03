import { z } from "zod";

/** Platform staff roles. A user may hold more than one. */
export const ROLES = ["super-admin", "ops", "finance", "moderator", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

export const SECTIONS = [
  "model",
  "cost",
  "content",
  "team",
  "system",
  "knowledge",
  "credits",
  "tenants",
] as const;
export type Section = (typeof SECTIONS)[number];
export type Action = "read" | "mutate";
export type PlatformCapability = `${Section}.${Action}` | "model.self_hosted.mutate";

const allPlatformCapabilities = SECTIONS.flatMap((section) => [
  `${section}.read` as PlatformCapability,
  `${section}.mutate` as PlatformCapability,
]).concat("model.self_hosted.mutate" as PlatformCapability);

/** Roles are permission bundles, not mutually-exclusive identities. */
export const PLATFORM_ROLE_CAPABILITIES: Record<Role, ReadonlySet<PlatformCapability>> = {
  "super-admin": new Set(allPlatformCapabilities),
  ops: new Set([
    "model.read",
    "model.mutate",
    "system.read",
    "system.mutate",
    "knowledge.read",
    "knowledge.mutate",
  ]),
  finance: new Set(["cost.read", "credits.read", "credits.mutate"]),
  moderator: new Set(["content.read", "content.mutate"]),
  viewer: new Set(["model.read", "system.read", "knowledge.read"]),
};

/** Readable projection for the admin UI; executable checks still use capabilities. */
export const SECTION_MATRIX: Record<Section, { read: Role[]; mutate: Role[] }> =
  Object.fromEntries(
    SECTIONS.map((section) => [
      section,
      {
        read: ROLES.filter((role) =>
          PLATFORM_ROLE_CAPABILITIES[role].has(`${section}.read`),
        ),
        mutate: ROLES.filter((role) =>
          PLATFORM_ROLE_CAPABILITIES[role].has(`${section}.mutate`),
        ),
      },
    ]),
  ) as Record<Section, { read: Role[]; mutate: Role[] }>;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function platformCapability(section: Section, action: Action): PlatformCapability {
  return `${section}.${action}`;
}

/** Deny by default. Permissions from every valid assigned role are combined. */
export function rolesAllow(
  roles: Iterable<string>,
  section: Section,
  action: Action,
): boolean {
  return platformRolesAllowCapability(roles, platformCapability(section, action));
}

export function platformRolesAllowCapability(
  roles: Iterable<string>,
  capability: PlatformCapability,
): boolean {
  for (const role of roles) {
    if (isRole(role) && PLATFORM_ROLE_CAPABILITIES[role].has(capability)) return true;
  }
  return false;
}

/** Compatibility for callers that still hold one role value. */
export function roleAllows(role: string, section: Section, action: Action): boolean {
  return rolesAllow([role], section, action);
}

/** Stable compatibility value for session/UI surfaces that can display only one role. */
export function primaryPlatformRole(roles: Iterable<string>): Role {
  const assigned = new Set([...roles].filter(isRole));
  for (const role of ROLES) {
    if (assigned.has(role)) return role;
  }
  return "viewer";
}
