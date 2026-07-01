import { describe, it, expect } from "vitest";
import { setTitleSkill } from "./set-title.js";
import { updateBriefSkill } from "./update-brief.js";
import { describeRefsSkill } from "./describe-refs.js";
import { proposeSkill } from "./propose.js";
import { generateSkill } from "./generate.js";
import { seedreamPromptSkill } from "./seedream-prompt.js";
import { seedancePromptSkill } from "./seedance-prompt.js";

describe("migrated trivial skills carry the right gate", () => {
  it("setTitle: free/write/internal → not gated", () => {
    expect(setTitleSkill.cost).toBe("free");
    expect(setTitleSkill.needsApproval).toBe(false);
  });
  it("updateBrief: free/write/internal → not gated", () => {
    expect(updateBriefSkill.needsApproval).toBe(false);
  });
  it("describeRefs: free/write/internal → not gated (F38: it does prisma.entity.updateMany, so effect is write)", () => {
    // executeDescribeRefs caches descriptions via prisma.entity.updateMany — a write.
    // free + write + internal derives needsApproval=false, so labeling it correctly
    // does not change gating, but a mislabeled read would break the fail-closed audit.
    expect(describeRefsSkill.effect).toBe("write");
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

describe("prompt-mastery skills gate", () => {
  it("seedreamPrompt: free/read/internal → not gated", () => {
    expect(seedreamPromptSkill.cost).toBe("free");
    expect(seedreamPromptSkill.effect).toBe("read");
    expect(seedreamPromptSkill.needsApproval).toBe(false);
  });
  it("seedancePrompt: free/read/internal → not gated", () => {
    expect(seedancePromptSkill.effect).toBe("read");
    expect(seedancePromptSkill.needsApproval).toBe(false);
  });
});
