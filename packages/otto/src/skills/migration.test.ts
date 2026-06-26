import { describe, it, expect } from "vitest";
import { setTitleSkill } from "./set-title.js";
import { updateBriefSkill } from "./update-brief.js";
import { describeRefsSkill } from "./describe-refs.js";
import { proposeSkill } from "./propose.js";
import { generateSkill } from "./generate.js";

describe("migrated trivial skills carry the right gate", () => {
  it("setTitle: free/write/internal → not gated", () => {
    expect(setTitleSkill.cost).toBe("free");
    expect(setTitleSkill.needsApproval).toBe(false);
  });
  it("updateBrief: free/write/internal → not gated", () => {
    expect(updateBriefSkill.needsApproval).toBe(false);
  });
  it("describeRefs: free/read/internal → not gated", () => {
    expect(describeRefsSkill.effect).toBe("read");
    expect(describeRefsSkill.needsApproval).toBe(false);
  });
});

describe("propose gate", () => {
  it("free/write/internal → not gated", () => {
    expect(proposeSkill.cost).toBe("free");
    expect(proposeSkill.needsApproval).toBe(false);
  });
});

describe("generate gate (money path)", () => {
  it("spend → gated; needsApproval is literal-derived true", () => {
    expect(generateSkill.cost).toBe("spend");
    expect(generateSkill.needsApproval).toBe(true);
  });
});
