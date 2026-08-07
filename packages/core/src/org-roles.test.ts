import { describe, expect, it } from "vitest";
import {
  ORG_CAPABILITIES,
  ORG_ROLES,
  effectiveOrgRoles,
  isOrgCapability,
  isOrgRole,
  orgRolesAllow,
  primaryOrgRole,
} from "./org-roles.js";

describe("organization permission bundles", () => {
  it("supports focused creator and approver roles alongside legacy bundles", () => {
    expect([...ORG_ROLES]).toEqual(["owner", "admin", "member", "creator", "approver"]);
  });

  it("combines creator and approver without either role denying the other", () => {
    const roles = ["creator", "approver"];
    expect(orgRolesAllow(roles, "content.create")).toBe(true);
    expect(orgRolesAllow(roles, "content.approve")).toBe(true);
    expect(orgRolesAllow(roles, "members.manage")).toBe(false);
  });

  it("does not give a creator approval merely because it can create", () => {
    expect(orgRolesAllow(["creator"], "content.create")).toBe(true);
    expect(orgRolesAllow(["creator"], "content.approve")).toBe(false);
  });

  it("gives owner every declared capability", () => {
    for (const capability of ORG_CAPABILITIES) {
      expect(orgRolesAllow(["owner"], capability)).toBe(true);
    }
  });

  it("denies empty and unknown assignments", () => {
    expect(orgRolesAllow([], "workspace.read")).toBe(false);
    expect(orgRolesAllow(["super-admin"], "workspace.read")).toBe(false);
  });

  it("validates roles and capabilities independently", () => {
    expect(isOrgRole("approver")).toBe(true);
    expect(isOrgRole("super-admin")).toBe(false);
    expect(isOrgCapability("content.approve")).toBe(true);
    expect(isOrgCapability("content.delete")).toBe(false);
  });

  it("uses only valid assignment rows", () => {
    expect(effectiveOrgRoles(["creator", "approver", "creator"])).toEqual([
      "creator",
      "approver",
    ]);
    expect(effectiveOrgRoles([])).toEqual([]);
    expect(effectiveOrgRoles(["unknown"])).toEqual([]);
    expect(primaryOrgRole(["approver", "creator"])).toBe("creator");
  });
});
