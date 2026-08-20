import { describe, expect, it } from "vitest";
import { humanizeToken, humanizeTokenPhrase } from "../machine-token";

// #1039 — 判官 P3-1 变异实测:把 humanizeToken 的 case 判据(`/[a-z]/.test(separated) ?
// separated : separated.toLowerCase()`)改成无条件 toLowerCase 后,99 tests 零红——文件头自称
// "each is pinned by a test",这条判据实际裸奔。这里直接钉住两个规则各自的分支。
describe("humanizeToken", () => {
  it("keeps a writer's own camelCase word boundary when the token already has lowercase", () => {
    // `edit.addSegment` — the standalone form. Splicing "_", "-", "." to spaces still leaves
    // a lowercase letter, so the case is left alone. Flattening this to "Edit addsegment"
    // destroys the only readable thing about the token.
    expect(humanizeToken("edit.addSegment")).toBe("Edit addSegment");
  });

  it("lowercases a token with no lowercase letter of its own (SCREAMING_SNAKE column values)", () => {
    // `NEEDS_ATTENTION` has no lowercase anywhere, so this is how the column stores it —
    // the caps go, and only the leading letter comes back up for sentence case.
    expect(humanizeToken("NEEDS_ATTENTION")).toBe("Needs attention");
  });

  it("sentence-cases plain lowercase tokens", () => {
    expect(humanizeToken("not_submitted")).toBe("Not submitted");
  });

  it("leaves an empty token empty", () => {
    expect(humanizeToken("")).toBe("");
  });
});

describe("humanizeTokenPhrase", () => {
  it("lowercases unconditionally, even a token with a writer's own camelCase hump", () => {
    // Unlike humanizeToken, this one is for mid-sentence splicing (#834): nothing recognisable
    // as the stored value may survive, so the camel hump in "dnd" case-mixed input goes too.
    // ":" is not a splice separator, so it survives — only the letters are lowered.
    expect(humanizeTokenPhrase("consentStop:dnd_set")).toBe("consentstop:dnd set");
  });

  it("splices separators to spaces and trims", () => {
    expect(humanizeTokenPhrase("super-admin")).toBe("super admin");
    expect(humanizeTokenPhrase("rbac.deny")).toBe("rbac deny");
  });
});
