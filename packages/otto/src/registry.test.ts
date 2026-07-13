import { describe, it, expect } from "vitest";
import { allSkills, skillCatalog } from "./registry.js";
import { otto } from "./otto.js";

describe("registry", () => {
  it("collects all forty-four skills", () => {
    const names = allSkills.map((s) => s.name).sort();
    expect(names).toEqual(["approveScheduledPost", "cancelScheduledPost", "deleteReferenceVariant", "describeRefs", "editScheduledPost", "editStoryboard", "generate", "generateReferences", "importMedia", "ingestProduct", "list-meta-pages", "listPublishTargets", "listScheduledPosts", "lookupProducts", "manageBrandMemory", "manageCanvas", "manageEntities", "manageLibrary", "manageMedia", "manageProjects", "meta-ad-performance", "meta-expert", "meta-insights", "meta-list-objects", "propose", "propose-ad-build", "propose-meta-action", "proposeIdeas", "proposePack", "proposeResearch", "proposeStoryboard", "rememberBrandFact", "renderVideo", "researchWeb", "saveCustomerSegment", "saveOffer", "saveProduct", "schedulePosts", "seedancePrompt", "seedreamPrompt", "setTitle", "sharePostPreview", "suggestPostTimes", "updateBrief"]);
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
  it("catalog carries the requires declaration for each skill", () => {
    const propose = skillCatalog.find((m) => m.name === "propose")!;
    expect(Array.isArray(propose.requires)).toBe(true);
    // 每个 skill 至少有一个空数组（不是 undefined）
    expect(skillCatalog.every((m) => Array.isArray(m.requires))).toBe(true);
  });
});
