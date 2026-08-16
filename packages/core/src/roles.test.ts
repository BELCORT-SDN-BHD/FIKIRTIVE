import { describe, expect, it } from "vitest";
import {
  PLATFORM_ROLE_CAPABILITIES,
  ROLES,
  SECTIONS,
  isRole,
  primaryPlatformRole,
  platformRolesAllowCapability,
  roleAllows,
  rolesAllow,
} from "./roles.js";

describe("platform permission bundles", () => {
  it("keeps the existing role and section vocabulary", () => {
    expect([...ROLES]).toEqual(["super-admin", "ops", "finance", "moderator", "viewer"]);
    expect([...SECTIONS]).toEqual([
      "model",
      "cost",
      "content",
      "team",
      "system",
      "knowledge",
      "credits",
      "tenants",
    ]);
  });

  it("combines permissions from multiple sibling roles", () => {
    const roles = ["ops", "finance"];
    expect(rolesAllow(roles, "model", "mutate")).toBe(true);
    expect(rolesAllow(roles, "credits", "mutate")).toBe(true);
    expect(rolesAllow(roles, "content", "mutate")).toBe(false);
  });

  it("denies empty and unknown assignments", () => {
    expect(rolesAllow([], "model", "read")).toBe(false);
    expect(rolesAllow(["root"], "model", "read")).toBe(false);
  });

  it("keeps the single-role compatibility check", () => {
    expect(roleAllows("finance", "cost", "read")).toBe(true);
    expect(roleAllows("finance", "model", "mutate")).toBe(false);
  });

  it("gives super-admin every declared capability", () => {
    expect(PLATFORM_ROLE_CAPABILITIES["super-admin"].size).toBe(SECTIONS.length * 2);
    for (const section of SECTIONS) {
      expect(rolesAllow(["super-admin"], section, "read")).toBe(true);
      expect(rolesAllow(["super-admin"], section, "mutate")).toBe(true);
    }
  });

  it("chooses a stable compatibility role without changing the assignments", () => {
    expect(primaryPlatformRole(["finance", "ops"])).toBe("ops");
    expect(primaryPlatformRole(["unknown"])).toBe("viewer");
  });

  it("recognizes only declared roles", () => {
    expect(isRole("super-admin")).toBe(true);
    expect(isRole("root")).toBe(false);
  });
});
