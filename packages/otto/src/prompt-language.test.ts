import { describe, it, expect } from "vitest";
import {
  PROMPT_LANGUAGES, promptLanguageFor, requirePromptLanguage,
  LANGUAGE_LABEL, LANGUAGE_ADVICE, LANGUAGE_REASON, languageAdvice,
} from "./prompt-language.js";

describe("languageAdvice (R4：非阻断信号，不是闸门)", () => {
  it("mismatch → one advisory sentence; match → undefined", () => {
    expect(languageAdvice("zh", ["a young man walks through the door"])).toBe(LANGUAGE_ADVICE.zh);
    expect(languageAdvice("zh", ["门口的男人停下脚步"])).toBeUndefined();
    expect(languageAdvice("en", ["一瓶磨砂玻璃精华液"])).toBe(LANGUAGE_ADVICE.en);
    expect(languageAdvice("en", ["a frosted-glass serum bottle"])).toBeUndefined();
  });
  it("empty / whitespace / undefined-only input → undefined (nothing to advise on)", () => {
    expect(languageAdvice("zh", [])).toBeUndefined();
    expect(languageAdvice("zh", [undefined, "", "   "])).toBeUndefined();
  });
  // 度量/比例 token 不再需要「豁免规则」：判定跑在整段自由文本上，度量夹在正文里改不了
  // 结论；单独一个度量串最坏也只是多一句建议，不是拒绝。
  it("measure tokens never flip the verdict when they ride alongside prose", () => {
    expect(languageAdvice("zh", ["门口的男人停下脚步", "16:9, 4K"])).toBeUndefined();
    expect(languageAdvice("en", ["a frosted-glass serum bottle", "50mm", "16:9, 4K"])).toBeUndefined();
  });
  it("NEVER throws, for any shape of input (emoji, mixed scripts, very long, digit-prefixed)", () => {
    for (const t of ["🎬🎬🎬", "4K 一镜到底 one take", "ドアを通り抜ける", "х".repeat(5000), "|||"]) {
      expect(() => languageAdvice("zh", [t]), t.slice(0, 12)).not.toThrow();
      expect(() => languageAdvice("en", [t]), t.slice(0, 12)).not.toThrow();
    }
  });
  it("advisory wording proposes a rewrite and stays free of provider/model trade names", () => {
    for (const advice of Object.values(LANGUAGE_ADVICE)) {
      expect(advice).toMatch(/consider rewriting/);
      expect(advice).not.toMatch(/(?:seedance|seedream|byteplus|bytedance|jimeng|即梦|\bfal\b)/iu);
    }
  });
});

describe("PROMPT_LANGUAGES (单一权威)", () => {
  it("video → zh, image → en; unknown families have no ruling", () => {
    expect(promptLanguageFor("seedance")).toBe("zh");
    expect(promptLanguageFor("seedream")).toBe("en");
    expect(promptLanguageFor("kling")).toBeUndefined();
  });
  // 调用点的 `?? "zh"` 兜底已撤：兜底是第二个真相源，表改了它不会红。
  it("requirePromptLanguage returns the table's ruling and THROWS for a family the table does not rule on", () => {
    expect(requirePromptLanguage("seedance")).toBe("zh");
    expect(requirePromptLanguage("seedream")).toBe("en");
    expect(() => requirePromptLanguage("kling")).toThrow(/PROMPT_LANGUAGES/);
  });
  it("every entry has a label and a one-line reason for the description to read", () => {
    for (const { language } of PROMPT_LANGUAGES) {
      expect(LANGUAGE_LABEL[language]).toBe(LANGUAGE_LABEL[language].toUpperCase());
      expect(LANGUAGE_REASON[language].length).toBeGreaterThan(0);
    }
  });
});
