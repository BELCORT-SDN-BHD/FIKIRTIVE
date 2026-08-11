import { describe, it, expect } from "vitest";
import { MAX_CONDITIONING_IMAGES, MAX_GEN_ENTITIES } from "@fikirtive/core";
import {
  identityLockClause, promptRef, CAMERA_MOVES, enOnly,
  sentence, imperativeConstraints, soundNotation, SOUND_MARKS,
  externalizeEmotion, EMOTION_CUES, isPortraitAspect,
  numberedReferenceClauses, referenceAdvice,
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

// ── 编号与真实发送顺序的对表 ────────────────────────────────────────────────
//
// 这一段是 #774 U2 的承重点：编号错位比不编号更糟，所以「第 k 个 reference 就是
// 第 k 个槽位」这条前提必须自己有测试，而不是靠注释保证。
//
// 下面的 `roundRobinFirstSeats` 是 worker 选片算法的**逐条镜像**
// （`apps/worker/src/jobs/gen.ts:607-618`）：第 0 轮给每个元素各坐一张，坐满
// `MAX_CONDITIONING_IMAGES` 为止。它在这里的唯一作用是证明第 0 轮真的坐得下每个元素 ——
// 那正是编号敢按数组下标走的原因。
function roundRobinFirstSeats(perEntityLiveCounts: number[]): (number | null)[] {
  const seats: number[] = [];
  for (let round = 0; seats.length < MAX_CONDITIONING_IMAGES; round++) {
    let progressed = false;
    for (const [entity, live] of perEntityLiveCounts.entries()) {
      if (round >= live) continue;
      seats.push(entity);
      progressed = true;
      if (seats.length >= MAX_CONDITIONING_IMAGES) break;
    }
    if (!progressed) break;
  }
  return perEntityLiveCounts.map((_, entity) => {
    const at = seats.indexOf(entity);
    return at === -1 ? null : at;
  });
}

describe("numberedReferenceClauses — slots match the order the system really sends", () => {
  it("round 0 seats every entity in order, so entity k is slot k", () => {
    for (const counts of [[1, 1, 1], [3, 1, 2], [1, 5, 1, 1], [2, 2, 2, 2, 2, 2, 2, 2]]) {
      expect(roundRobinFirstSeats(counts)).toEqual(counts.map((_, k) => k));
    }
  });
  it("the entity cap fits inside the conditioning cap — that is why round 0 always seats everyone", () => {
    expect(MAX_GEN_ENTITIES).toBeLessThanOrEqual(MAX_CONDITIONING_IMAGES);
    expect(roundRobinFirstSeats(Array.from({ length: MAX_GEN_ENTITIES }, () => 4)))
      .toEqual(Array.from({ length: MAX_GEN_ENTITIES }, (_, k) => k));
  });
  it("clause numbers follow that same 1-based order", () => {
    const out = numberedReferenceClauses([
      { role: "character", name: "Mia", lock: true },
      { role: "product", name: "the AeroBottle", lock: true },
      { role: "location", name: "the loft", lock: true },
    ]);
    expect(out[0]).toContain("<Image_1> as <Subject_1>");
    expect(out[1]).toContain("<Image_2> as <Subject_2>");
    expect(out[2]).toContain("<Image_3> as <Subject_3>");
  });
  it("a base image takes slot 1 (the worker unshifts it), pushing references to slot 2", () => {
    const out = numberedReferenceClauses([{ role: "product", name: "the AeroBottle", lock: true }], { baseImage: true });
    expect(out[0]).toBe("<Image_1> is the image being edited.");
    expect(out[1]).toContain("<Image_2> as <Subject_2>");
  });
  it("no references → no clauses at all", () => {
    expect(numberedReferenceClauses([])).toEqual([]);
    expect(numberedReferenceClauses([], { baseImage: true })).toEqual(["<Image_1> is the image being edited."]);
  });
  it("every clause carries the entity name too, so a misnumber degrades instead of lying", () => {
    for (const role of ["character", "product", "location", "brandmark"] as const) {
      const [clause] = numberedReferenceClauses([{ role, name: "Nasi Lemak Co", lock: true }]);
      expect(clause).toContain("Nasi Lemak Co");
      expect(clause).toContain("<Image_1>");
    }
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
