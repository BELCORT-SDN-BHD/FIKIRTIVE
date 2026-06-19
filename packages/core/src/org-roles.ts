/** Per-ORG membership RBAC (the tenant axis) — DISTINCT from packages/core/src/roles.ts,
 *  which is platform-STAFF RBAC for the internal /admin console. Never merge the two.
 *  A code-side enum (not a PG enum) so adding a role later needs no migration. */
export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export function isOrgRole(x: unknown): x is OrgRole {
  return typeof x === "string" && (ORG_ROLES as readonly string[]).includes(x);
}
