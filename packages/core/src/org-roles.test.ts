import { describe, it, expect } from "vitest";
import { ORG_ROLES, isOrgRole } from "./org-roles.js";

describe("ORG_ROLES (per-org membership RBAC — distinct from platform User.role)", () => {
  it("is exactly owner|admin|member", () => {
    expect([...ORG_ROLES]).toEqual(["owner", "admin", "member"]);
  });
  it("isOrgRole accepts valid, rejects others", () => {
    expect(isOrgRole("owner")).toBe(true);
    expect(isOrgRole("admin")).toBe(true);
    expect(isOrgRole("member")).toBe(true);
    expect(isOrgRole("super-admin")).toBe(false); // that's a platform role, not an org role
    expect(isOrgRole(undefined)).toBe(false);
    expect(isOrgRole(null)).toBe(false);
  });
});
