import { describe, it, expect } from "vitest";
import { modelFamily, GEN_MODELS } from "@fikirtive/core";
import {
  PROMPT_SKILLS,
  PROMPT_SKILLED_FAMILIES,
  familyHasPromptSkill,
  PROMPT_LANGUAGES,
  promptLanguageFor,
} from "./prompt-skills.js";
import { LANGUAGE_LABEL } from "./prompt-language.js";
import { allSkills } from "./registry.js";

describe("prompt-skilled families (D/E decision 6 — sole prompt authority)", () => {
  it("seedream and seedance are prompt-skilled", () => {
    expect(familyHasPromptSkill("seedream")).toBe(true);
    expect(familyHasPromptSkill("seedance")).toBe(true);
  });

  it("un-skilled families and undefined are NOT prompt-skilled (directive stays fallback)", () => {
    expect(familyHasPromptSkill("kling")).toBe(false);
    expect(familyHasPromptSkill("veo")).toBe(false);
    expect(familyHasPromptSkill(undefined)).toBe(false);
  });

  it("card-level model keys map correctly (seedream + seedance skilled; other video models keep the fallback)", () => {
    // What reaches the spend path is the card's menu key (GEN_MODELS / GEN_VIDEO_MODELS),
    // NOT the provider id — modelFamily() resolves that key to a family.
    for (const m of GEN_MODELS) expect(familyHasPromptSkill(modelFamily(m))).toBe(true); // only "seedream"
    expect(familyHasPromptSkill(modelFamily("seedance-2-fast"))).toBe(true);             // migrated video default
    expect(familyHasPromptSkill(modelFamily("kling"))).toBe(false);                      // un-skilled → directive fallback
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

describe("per-engine prompt language (#437; Blueprint v2.13 — 按实测最优、由 prompt 权威模块决定)", () => {
  it("video family prompts are Chinese; image family prompts are English", () => {
    expect(promptLanguageFor("seedance")).toBe("zh");
    expect(promptLanguageFor("seedream")).toBe("en");
  });
  it("families without a dedicated prompt skill have no language ruling", () => {
    expect(promptLanguageFor("kling")).toBeUndefined();
    expect(promptLanguageFor(undefined)).toBeUndefined();
  });
  it("every prompt-skilled family has exactly one language entry (no silent gaps)", () => {
    const declared = PROMPT_LANGUAGES.map((p) => p.family);
    expect(new Set(declared).size).toBe(declared.length);
    for (const { family } of PROMPT_SKILLS) {
      expect(declared, `missing language ruling for ${family}`).toContain(family);
    }
  });

  // R4：执法搬到写作端 —— 每个 skill 的 description 必须真的从这张表读语言，
  // 且必须明说「没有闸门会替你拦」。description 与权威表脱钩 = 语言无人执法。
  it("each skill's description states its declared language (descriptions read the authority table)", () => {
    for (const { skill, family } of PROMPT_SKILLS) {
      const language = promptLanguageFor(family);
      expect(language, `missing language ruling for ${family}`).toBeDefined();
      expect(skill.description, family).toContain(LANGUAGE_LABEL[language!]);
      // 反面：不得同时宣告另一种语言（避免 description 与权威表漂移）
      const other = language === "zh" ? "en" : "zh";
      expect(skill.description, family).not.toContain(`PROMPT BODY IN ${LANGUAGE_LABEL[other]}`);
    }
  });
  it("each description tells the model nothing rejects a wrong-language body (R4 authoring enforcement)", () => {
    for (const { skill } of PROMPT_SKILLS) {
      expect(skill.description).toContain("NOTHING REJECTS A WRONG-LANGUAGE BODY");
      expect(skill.description).toContain("languageAdvice");
    }
  });
});
