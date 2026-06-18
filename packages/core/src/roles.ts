/**
 * Pure operator-RBAC (OPT-6 P1b). No prisma, no env — core stays pure (mirrors
 * model-registry.ts). This is the SINGLE source of truth for the section→role
 * matrix; the web guard (requireRole) and the verify script both consume it.
 * Operator-RBAC, NOT tenancy: roles gate WHO on the team may use which admin
 * SECTION over the shared founder data. The env allowlist stays the outer wall.
 */
import { z } from "zod";

/** The 5 fixed roles (spec §3). Ordered most→least privileged for readability;
 *  privilege is decided by the matrix, NOT by array order (no implicit hierarchy
 *  beyond super-admin supersedes all). Adding a 6th role = append here (no migration
 *  — User.role is a plain string column). */
export const ROLES = ["super-admin", "ops", "finance", "moderator", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

/** The 6 admin sections (spec §6 / §3 matrix). */
export const SECTIONS = ["model", "cost", "content", "team", "system", "knowledge"] as const;
export type Section = (typeof SECTIONS)[number];

export type Action = "read" | "mutate";

/** The ONE authoritative section→action→allowed-roles matrix (spec §3 table).
 *  finance/moderator/ops are SIBLING roles, NOT a linear ladder (finance reads cost
 *  but can't mutate model; ops mutates model but can't read cost), so each cell is an
 *  explicit allowed-role SET, not a "minimum role" rank. super-admin is omitted from
 *  the cells and added by roleAllows (it supersedes all — including a read-only
 *  section's empty mutate set). An empty mutate set = read-only section (cost).
 *  Spec §3 prose: viewer reads the operational sections ①⑤⑥ (model/system/knowledge),
 *  NOT cost ② or team ④. The "provider=modal: super-admin only" exception is NOT here
 *  — it's a per-VALUE rule in saveRuntimeConfig, since the matrix keys on section. */
export const SECTION_MATRIX: Record<Section, Record<Action, ReadonlySet<Role>>> = {
  model:     { read: new Set(["viewer", "ops"]), mutate: new Set(["ops"]) },        // ① Model & Provider (provider=modal → super-admin, see saveRuntimeConfig)
  cost:      { read: new Set(["finance"]),       mutate: new Set() },               // ② Cost & usage (read-only section; super-admin via supersede only)
  content:   { read: new Set(["moderator"]),     mutate: new Set(["moderator"]) },  // ③ Content & moderation & audit
  team:      { read: new Set(),                  mutate: new Set() },               // ④ Team & access — super-admin only (via supersede)
  system:    { read: new Set(["viewer", "ops"]), mutate: new Set(["ops"]) },        // ⑤ System & queue health
  knowledge: { read: new Set(["viewer", "ops"]), mutate: new Set(["ops"]) },        // ⑥ Prompt & knowledge
};

/** Deny-by-default capability check, DERIVED from the single SECTION_MATRIX. The only
 *  decision function; requireRole (web) wraps it with the allowlist outer wall + a
 *  denied-attempt audit. super-admin supersedes every cell (including empty/read-only
 *  ones). A garbage role (not in ROLES) always denies. */
export function roleAllows(role: string, section: Section, action: Action): boolean {
  if (!isRole(role)) return false;
  if (role === "super-admin") return true;
  return SECTION_MATRIX[section][action].has(role);
}

export function isRole(x: unknown): x is Role {
  return typeof x === "string" && (ROLES as readonly string[]).includes(x);
}
