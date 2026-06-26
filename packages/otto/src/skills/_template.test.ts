import { describe, it, expect } from "vitest";
import { templateSkill } from "./_template.js";

describe("_template.ts is a valid, copyable skill", () => {
  it("compiles and derives a sane gate", () => {
    expect(templateSkill.name).toBe("TODO_rename");
    expect(typeof templateSkill.needsApproval).toBe("boolean");
  });
});
