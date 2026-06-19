import { describe, it, expect } from "vitest";
import { ROLES, SECTIONS, SECTION_MATRIX, roleAllows, isRole, type Role, type Section } from "./roles.js";

describe("ROLES / SECTIONS", () => {
  it("has exactly the 5 spec roles", () => {
    expect([...ROLES]).toEqual(["super-admin", "ops", "finance", "moderator", "viewer"]);
  });
  it("has exactly the 7 spec sections (closed-beta P2 adds credits)", () => {
    expect([...SECTIONS]).toEqual(["model", "cost", "content", "team", "system", "knowledge", "credits"]);
  });
});

describe("SECTION_MATRIX completeness", () => {
  it("defines a read + mutate allowed-role set for every section", () => {
    for (const s of SECTIONS) {
      expect(SECTION_MATRIX[s].read).toBeInstanceOf(Set);
      expect(SECTION_MATRIX[s].mutate).toBeInstanceOf(Set);
    }
  });
  it("read-only sections (cost, team) have an empty mutate set", () => {
    expect(SECTION_MATRIX.cost.mutate.size).toBe(0);
    expect(SECTION_MATRIX.team.mutate.size).toBe(0);
  });
});

describe("roleAllows — derives from SECTION_MATRIX, denies by default, super-admin supersedes", () => {
  it("super-admin can do everything (including read-only/empty-set sections)", () => {
    for (const s of SECTIONS) {
      expect(roleAllows("super-admin", s, "read")).toBe(true);
      expect(roleAllows("super-admin", s, "mutate")).toBe(true);
    }
  });
  it("viewer reads operational sections (model/system/knowledge) but NOT cost or team", () => {
    expect(roleAllows("viewer", "model", "read")).toBe(true);
    expect(roleAllows("viewer", "system", "read")).toBe(true);
    expect(roleAllows("viewer", "knowledge", "read")).toBe(true);
    expect(roleAllows("viewer", "cost", "read")).toBe(false);
    expect(roleAllows("viewer", "team", "read")).toBe(false);
  });
  it("viewer can mutate NOTHING", () => {
    for (const s of SECTIONS) expect(roleAllows("viewer", s, "mutate")).toBe(false);
  });
  it("ops mutates model/system/knowledge, NOT cost/content/team — and can't read cost", () => {
    expect(roleAllows("ops", "model", "mutate")).toBe(true);
    expect(roleAllows("ops", "knowledge", "mutate")).toBe(true);
    expect(roleAllows("ops", "system", "mutate")).toBe(true);
    expect(roleAllows("ops", "team", "mutate")).toBe(false);
    expect(roleAllows("ops", "content", "mutate")).toBe(false);
    expect(roleAllows("ops", "cost", "read")).toBe(false); // sibling-role asymmetry: ops ≠ finance
  });
  it("finance reads cost, mutates nothing (cost is read-only)", () => {
    expect(roleAllows("finance", "cost", "read")).toBe(true);
    expect(roleAllows("finance", "cost", "mutate")).toBe(false); // mutate is null for cost
    expect(roleAllows("finance", "model", "mutate")).toBe(false);
  });
  it("finance reads AND mutates credits (grants are a financial action); others denied", () => {
    expect(roleAllows("finance", "credits", "read")).toBe(true);
    expect(roleAllows("finance", "credits", "mutate")).toBe(true);
    expect(roleAllows("super-admin", "credits", "mutate")).toBe(true); // supersede
    for (const r of ["ops", "moderator", "viewer"] as Role[]) {
      expect(roleAllows(r, "credits", "read")).toBe(false);
      expect(roleAllows(r, "credits", "mutate")).toBe(false);
    }
  });
  it("moderator reads + mutates content, nothing else operational-mutate", () => {
    expect(roleAllows("moderator", "content", "read")).toBe(true);
    expect(roleAllows("moderator", "content", "mutate")).toBe(true);
    expect(roleAllows("moderator", "model", "mutate")).toBe(false);
  });
  it("only super-admin touches team", () => {
    expect(roleAllows("super-admin", "team", "mutate")).toBe(true);
    for (const r of ["ops", "finance", "moderator", "viewer"] as Role[]) {
      expect(roleAllows(r, "team", "read")).toBe(false);
      expect(roleAllows(r, "team", "mutate")).toBe(false);
    }
  });
  it("a read-only section (cost) denies mutate to EVERYONE except via null→false", () => {
    for (const r of ROLES) expect(roleAllows(r, "cost", "mutate")).toBe(r === "super-admin" ? true : false);
    // NOTE: super-admin supersedes even a null-mutate section (it can always act); other roles are denied.
  });
  it("isRole rejects garbage", () => {
    expect(isRole("super-admin")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole(undefined as unknown as string)).toBe(false);
  });
});
