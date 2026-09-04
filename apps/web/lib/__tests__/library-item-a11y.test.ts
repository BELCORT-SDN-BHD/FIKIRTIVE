/**
 * library-item-a11y — Codex staging 审计 **LIB-STG-P2-005**(2026-09-04,FRONT-A14):Library
 * 素材按钮的 accessible name 曾经是整段生成提示词,有时还重复两遍,读屏逐格朗读一整段、
 * 语音控制也没法喊出目标。这里钉住单一源头 `conciseAssetTitle`/`libraryItemAccessibleName`
 * 的截断与去重规则——`CanvasLibraryPicker.tsx` 与 `StuffLibrary.tsx` 两处共用同一份。
 */
import { describe, it, expect } from "vitest";
import { conciseAssetTitle, libraryItemAccessibleName } from "../library-item-a11y";

const LONG_PROMPT =
  "A premium coral-orange insulated tumbler with a ribbed silicone grip and a brushed silver lid, photographed on a marble countertop with soft morning light and a blurred kitchen background";

describe("FRONT-A14: conciseAssetTitle", () => {
  it("FRONT-A14: a long prompt is cut to at most 60 characters, on a word boundary, with an ellipsis", () => {
    const title = conciseAssetTitle(LONG_PROMPT);
    // ← mutation check: a helper that stops truncating (returns the raw prompt) fails this.
    expect(title.length).toBeLessThanOrEqual(61); // 60 chars + the ellipsis character
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toBe(LONG_PROMPT);
    // never cuts mid-word: strip the ellipsis, the remainder must not end where the source
    // string still had a letter immediately following (i.e. it broke on a space).
    const withoutEllipsis = title.slice(0, -1);
    expect(LONG_PROMPT.startsWith(withoutEllipsis)).toBe(true);
    expect(LONG_PROMPT[withoutEllipsis.length]).toBe(" ");
  });

  it("FRONT-A14: a prompt within 60 chars is returned as-is (first sentence, no ellipsis)", () => {
    expect(conciseAssetTitle("A red tumbler")).toBe("A red tumbler");
  });

  it("FRONT-A14: stops at the first sentence even when it is short and more text follows", () => {
    expect(conciseAssetTitle("A red tumbler. Studio lighting, white background.")).toBe(
      "A red tumbler.",
    );
  });

  it("FRONT-A14: a sentence repeated twice (the audit's 'sometimes duplicated' case) collapses to one copy", () => {
    expect(conciseAssetTitle("A red tumbler. A red tumbler.")).toBe("A red tumbler.");
  });

  it("FRONT-A14: the same text repeated twice with no punctuation between also collapses", () => {
    expect(conciseAssetTitle("Xinyi holding the tumbler Xinyi holding the tumbler")).toBe(
      "Xinyi holding the tumbler",
    );
  });

  it("FRONT-A14: two DIFFERENT sentences are not mistaken for a duplicate — only the first sentence is kept (a title, not the whole prompt)", () => {
    expect(conciseAssetTitle("A red tumbler. A blue tumbler.")).toBe("A red tumbler.");
  });

  it("FRONT-A14: a naturally repeated word inside one short, punctuation-free name is not falsely halved", () => {
    // "tumbler" repeats twice, but the two halves of the string are not identical — the
    // whole-string duplicate check must not trigger on a merely-repeated word. Kept under
    // 60 chars so truncation itself stays out of the way of this assertion.
    const text = "A red tumbler beside a smaller tumbler";
    expect(conciseAssetTitle(text)).toBe(text);
  });

  it("FRONT-A14: empty or whitespace-only input gives back an empty string (caller supplies the fallback)", () => {
    expect(conciseAssetTitle("")).toBe("");
    expect(conciseAssetTitle("   ")).toBe("");
  });
});

describe("FRONT-A14: libraryItemAccessibleName", () => {
  it("FRONT-A14: an untitled image falls back to 'Image', never a blank or bare comma", () => {
    expect(libraryItemAccessibleName("", "image")).toBe("Image");
  });

  it("FRONT-A14: an untitled video falls back to 'Video'", () => {
    expect(libraryItemAccessibleName("   ", "video")).toBe("Video");
  });

  it("FRONT-A14: a short name gets the media type appended", () => {
    expect(libraryItemAccessibleName("A red tumbler", "image")).toBe("A red tumbler, image");
  });

  it("FRONT-A14: a long, duplicated prompt ends up short — title + media type only, no raw prompt", () => {
    const name = libraryItemAccessibleName(`${LONG_PROMPT}. ${LONG_PROMPT}.`, "image");
    expect(name.length).toBeLessThan(80); // well under the ~190-char raw prompt
    expect(name.endsWith(", image")).toBe(true);
    expect(name).not.toContain(LONG_PROMPT.slice(0, 100)); // the raw prompt text is gone
  });
});
