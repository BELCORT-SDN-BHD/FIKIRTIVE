import { describe, it, expect } from "vitest";
import { modelFamily, GEN_MODELS } from "@fikirtive/core";
import { PROMPT_SKILLS, PROMPT_SKILLED_FAMILIES, familyHasPromptSkill } from "./prompt-skills.js";
import { allSkills } from "./registry.js";

describe("prompt-skilled families (D/E decision 6 — sole prompt authority)", () => {
  it("seedream and seedance are prompt-skilled", () => {
    expect(familyHasPromptSkill("seedream")).toBe(true);
    expect(familyHasPromptSkill("seedance")).toBe(true);
  });

  it("un-skilled families and undefined are NOT prompt-skilled (directive stays fallback)", () => {
    // #647 T6:那 12 台假引擎下架之后,`ModelFamily` 这个类型里已经没有「无技能家族」
    // 可写了 —— 所以只剩 undefined 这一条真路:模型 id 认不出家族(退役/未知)时,
    // 判据必须回 false,让指令那条后备路继续留着。
    expect(familyHasPromptSkill(undefined)).toBe(false);
  });

  it("card-level model keys map correctly (seedream + seedance skilled; 认不出的 id 保留后备)", () => {
    // What reaches the spend path is the card's menu key (GEN_MODELS / GEN_VIDEO_MODELS),
    // NOT the provider id — modelFamily() resolves that key to a family.
    for (const m of GEN_MODELS) expect(familyHasPromptSkill(modelFamily(m))).toBe(true); // only "seedream"
    expect(familyHasPromptSkill(modelFamily("seedance-2-mini"))).toBe(true);             // the in-service video engine
    expect(familyHasPromptSkill(modelFamily("kling"))).toBe(false);                      // 已下架 → 认不出家族 → 后备
    expect(familyHasPromptSkill(modelFamily("veo3.1-fast"))).toBe(false);
  });

  it("every declared prompt skill is actually registered — no phantom skilled family", () => {
    const registered = new Set(allSkills.map((s) => s.name));
    for (const { skill } of PROMPT_SKILLS) {
      expect(registered.has(skill.name)).toBe(true);
    }
    // the derived set is exactly the declared families
    expect(PROMPT_SKILLED_FAMILIES).toEqual(new Set(PROMPT_SKILLS.map((p) => p.family)));
  });
});
