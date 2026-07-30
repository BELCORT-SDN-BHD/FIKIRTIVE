import { describe, it, expect } from "vitest";
import { setTitleSkill } from "./set-title.js";
import { updateBriefSkill } from "./update-brief.js";
import { describeRefsSkill } from "./describe-refs.js";
import { proposeSkill } from "./propose.js";
import { generateSkill } from "./generate.js";
import { seedreamPromptSkill } from "./seedream-prompt.js";
import { seedancePromptSkill } from "./seedance-prompt.js";
import { proposeStoryboardSkill } from "./propose-storyboard.js";
import { ingestProductSkill } from "./ingest-product.js";
import { researchWebSkill } from "./research-web.js";
import { readSegmentsSkill } from "./read-segments.js";
import { buildSegmentSkill } from "./build-segment.js";
import { readSpendingSkill } from "./read-spending.js";

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
    expect(seedancePromptSkill.cost).toBe("free");
    expect(seedancePromptSkill.effect).toBe("read");
    expect(seedancePromptSkill.needsApproval).toBe(false);
  });
});

describe("proposeStoryboard gate", () => {
  it("free/write/internal → not gated", () => {
    expect(proposeStoryboardSkill.cost).toBe("free");
    expect(proposeStoryboardSkill.effect).toBe("write");
    expect(proposeStoryboardSkill.needsApproval).toBe(false);
  });
});

describe("external-read skills gate (P1-01)", () => {
  it("ingestProduct: free/read/external → not gated (external READ is never approval-gated)", () => {
    expect(ingestProductSkill.cost).toBe("free");
    expect(ingestProductSkill.effect).toBe("read");
    expect(ingestProductSkill.reach).toBe("external");
    expect(ingestProductSkill.needsApproval).toBe(false);
  });
  it("researchWeb: same shape — the sibling external read stays ungated too", () => {
    expect(researchWebSkill.reach).toBe("external");
    expect(researchWebSkill.needsApproval).toBe(false);
  });
});

describe("CRM Segment skills gate (B0-61/C3)", () => {
  it("readSegments: free/read/internal → not gated", () => {
    expect(readSegmentsSkill.cost).toBe("free");
    expect(readSegmentsSkill.effect).toBe("read");
    expect(readSegmentsSkill.reach).toBe("internal");
    expect(readSegmentsSkill.needsApproval).toBe(false);
  });

  it("buildSegment: free/write/internal → not gated", () => {
    expect(buildSegmentSkill.cost).toBe("free");
    expect(buildSegmentSkill.effect).toBe("write");
    expect(buildSegmentSkill.reach).toBe("internal");
    expect(buildSegmentSkill.needsApproval).toBe(false);
  });
});

describe("spend-visibility skill gate (#555)", () => {
  it("readSpending: free/read/internal → not gated", () => {
    // The 3-field declaration has to describe what execute ACTUALLY does: it calls one
    // ctx.spending.overview() read and writes nothing, so read/internal is honest and the
    // derived gate is false. If this skill ever grew a write (a top-up, an adjustment), the
    // declaration would have to change with it and this assertion would fail first.
    expect(readSpendingSkill.cost).toBe("free");
    expect(readSpendingSkill.effect).toBe("read");
    expect(readSpendingSkill.reach).toBe("internal");
    expect(readSpendingSkill.needsApproval).toBe(false);
  });
});
