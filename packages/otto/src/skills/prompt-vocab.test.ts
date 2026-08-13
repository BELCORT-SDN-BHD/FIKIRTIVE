import { describe, it, expect } from "vitest";
import {
  identityLockClause, promptRef, CAMERA_MOVES, enOnly,
  sentence, imperativeConstraints, soundNotation, SOUND_MARKS,
  externalizeEmotion, EMOTION_CUES, isPortraitAspect,
  identityLockSentences, referenceAdvice,
} from "./prompt-vocab.js";

describe("identityLockClause", () => {
  it("empty refs → empty string", () => {
    expect(identityLockClause([])).toBe("");
  });
  it("product lock phrasing names the entity", () => {
    const out = identityLockClause([{ role: "product", name: "the AeroBottle", lock: true }]);
    expect(out).toContain("the AeroBottle");
    expect(out).toContain("same shape, color, and label");
  });
  it("character lock preserves face/hair/build", () => {
    const out = identityLockClause([{ role: "character", name: "Mia", lock: true }]);
    expect(out).toContain("same face, hairstyle, and build");
  });
  it("lock:false switches to stylistic-inspiration phrasing", () => {
    const out = identityLockClause([{ role: "location", name: "the loft", lock: false }]);
    expect(out).toContain("draw stylistic inspiration from the loft");
  });
  it("multiple refs joined with '; '", () => {
    const out = identityLockClause([
      { role: "product", name: "A", lock: true },
      { role: "brandmark", name: "B", lock: true },
    ]);
    expect(out).toContain("feature A exactly");
    expect(out).toContain("; ");
    expect(out).toContain("reproduce the B logo");
  });
});

describe("promptRef schema", () => {
  it("defaults lock to true", () => {
    expect(promptRef.parse({ role: "product", name: "X" }).lock).toBe(true);
  });
  it("rejects an unknown role", () => {
    expect(promptRef.safeParse({ role: "vehicle", name: "X" }).success).toBe(false);
  });
});

describe("vocab constants", () => {
  it("camera moves is a non-empty readonly list", () => {
    expect(CAMERA_MOVES.length).toBeGreaterThan(0);
  });
});

describe("enOnly", () => {
  it("strips a trailing Chinese parenthetical gloss", () => {
    expect(enOnly(["dolly in (推镜头)"])).toEqual(["dolly in"]);
  });
  it("leaves entries with no parenthetical unchanged", () => {
    expect(enOnly(["golden hour"])).toEqual(["golden hour"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #774 —— 官方指南对齐的纯构件
// ═══════════════════════════════════════════════════════════════════════════

describe("sentence", () => {
  it("capitalises and terminates", () => {
    expect(sentence("a red apple")).toBe("A red apple.");
  });
  it("leaves existing terminal punctuation alone", () => {
    expect(sentence("Is it ready?")).toBe("Is it ready?");
    expect(sentence("Stop.")).toBe("Stop.");
  });
  it("normalises inner whitespace and trims", () => {
    expect(sentence("  a   red\n apple ")).toBe("A red apple.");
  });
  it("empty in → empty out (so callers can filter it away)", () => {
    expect(sentence("   ")).toBe("");
  });
});

describe("imperativeConstraints", () => {
  it("splits on semicolons and newlines, one command each", () => {
    expect(imperativeConstraints("keep the camera steady; avoid warped hands\nno sudden cuts"))
      .toEqual(["Keep the camera steady.", "Avoid warped hands.", "No sudden cuts."]);
  });
  it("undefined / empty → no lines", () => {
    expect(imperativeConstraints()).toEqual([]);
    expect(imperativeConstraints(" ; \n ")).toEqual([]);
  });
});

describe("soundNotation", () => {
  it("wraps each channel in its official mark", () => {
    expect(soundNotation({ music: "soft piano", sfx: "rain on glass", dialogue: "We open at nine." }))
      .toBe("（soft piano） <rain on glass> {We open at nine.}");
  });
  it("omits empty channels", () => {
    expect(soundNotation({ sfx: "door click" })).toBe("<door click>");
    expect(soundNotation({})).toBe("");
    expect(soundNotation({ music: "   " })).toBe("");
  });
  it("the subtitle mark is defined but never produced", () => {
    expect(SOUND_MARKS.subtitle).toEqual(["【", "】"]);
    expect(soundNotation({ music: "a", sfx: "b", dialogue: "c" })).not.toContain("【");
  });
});

describe("externalizeEmotion", () => {
  it("turns a feeling word into visible body signals", () => {
    expect(externalizeEmotion("Happy")).toBe(EMOTION_CUES.happy);
  });
  it("unknown emotion → null (the caller decides, this never guesses)", () => {
    expect(externalizeEmotion("wistful")).toBeNull();
    expect(externalizeEmotion()).toBeNull();
  });
  it("every cue in the table describes something a camera can see", () => {
    for (const cue of Object.values(EMOTION_CUES)) {
      expect(cue.length).toBeGreaterThan(0);
      expect(cue).toMatch(/mouth|eye|brow|shoulder|jaw|chin|step|stride|hand|finger|head|back|breath|feet|weight|gaze|movements/);
    }
  });
});

describe("isPortraitAspect", () => {
  it("recognises vertical shapes and their plain-word aliases", () => {
    for (const a of ["9:16", "3:4", "4:5", "2:3", "portrait", "Vertical", "9x16", "9 × 16", "9 : 16"]) {
      expect(isPortraitAspect(a)).toBe(true);
    }
  });
  it("rejects everything else, and never guesses", () => {
    for (const a of ["16:9", "1:1", "21:9", "landscape", "square", "adaptive", "tallish", "", undefined, null]) {
      expect(isPortraitAspect(a)).toBe(false);
    }
  });
});

// ── 参考图身份：这一层只锁名字，编号那一层不在这里 ──────────────────────────
//
// #774 r2：编号(`<Image_N>`)由真正装 `inputImageUrls` 的那段代码产出
// （`apps/worker/src/jobs/gen.ts` + `@fikirtive/core` 的 `referenceMapLines`），
// 「编号 ↔ 真实发送次序」的对表在 `apps/worker/src/jobs/gen-reference-budget.test.ts`
// ——那条测试跑的是**真的 `handleGen`**，不是本文件里重建的副本。所以这里只钉一件事：
// 写提示词这一端一个编号都不许写出来。
describe("identityLockSentences", () => {
  it("one sentence per reference, each naming the entity", () => {
    const out = identityLockSentences([
      { role: "character", name: "Mia", lock: true },
      { role: "product", name: "the AeroBottle", lock: true },
    ]);
    expect(out).toEqual([
      "Keep Mia identical to the reference, same face, hairstyle, and build.",
      "Feature the AeroBottle exactly as in the reference, same shape, color, and label.",
    ]);
  });
  it("lock:false keeps the stylistic-inspiration wording", () => {
    expect(identityLockSentences([{ role: "location", name: "the loft", lock: false }]))
      .toEqual(["Draw stylistic inspiration from the loft."]);
  });
  it("empty refs → no sentences", () => {
    expect(identityLockSentences([])).toEqual([]);
  });
  it("NEVER writes an image number — numbering belongs to the code that sends the images", () => {
    const out = identityLockSentences(
      (["character", "product", "location", "brandmark"] as const).map((role) => ({ role, name: "Nasi Lemak Co", lock: true })),
    ).join(" ");
    expect(out).not.toMatch(/Image_\d/);
    expect(out).not.toMatch(/Subject_\d/);
  });
});

describe("referenceAdvice", () => {
  const people = (n: number) => Array.from({ length: n }, (_, k) => ({ role: "character" as const, name: `P${k}`, lock: true }));
  it("says nothing about an ordinary reference set", () => {
    expect(referenceAdvice(people(2))).toEqual([]);
  });
  it("flags more than four faces", () => {
    expect(referenceAdvice(people(5)).join(" ")).toContain("More than four people");
  });
  it("flags an oversized set", () => {
    expect(referenceAdvice(people(6)).join(" ")).toContain("four or five references");
  });
  it("is merchant-readable English with no engine or vendor names", () => {
    const all = referenceAdvice(people(8)).join(" ");
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [/seedream/i, /seedance/i, /byteplus/i, /bytedance/i, /\bfal\b/i]) {
      expect(all).not.toMatch(secret);
    }
  });
});
