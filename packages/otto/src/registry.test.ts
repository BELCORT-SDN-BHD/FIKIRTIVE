import { describe, it, expect } from "vitest";
import { allSkills, skillCatalog } from "./registry.js";
import { otto } from "./otto.js";

describe("registry", () => {
  it("collects all five skills", () => {
    const names = allSkills.map((s) => s.name).sort();
    expect(names).toEqual(["describeRefs", "generate", "propose", "setTitle", "updateBrief"]);
  });
  it("every registered skill carries a built SDK tool", () => {
    expect(allSkills.every((s) => s.tool != null)).toBe(true);
  });
  it("otto constructs from the registry without throwing", () => {
    // Importing otto.js (which builds the Agent from allSkills.map(s => s.tool)) must succeed.
    expect(otto).toBeDefined();
    expect(otto.name).toBe("Otto");
  });
  it("catalog exposes the gate metadata for each skill", () => {
    const gen = skillCatalog.find((m) => m.name === "generate")!;
    expect(gen.needsApproval).toBe(true);
    expect(gen.cost).toBe("spend");
  });
});
