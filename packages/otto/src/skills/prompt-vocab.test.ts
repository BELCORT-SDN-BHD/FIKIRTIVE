import { describe, it, expect } from "vitest";
import {
  identityLockClause, identityLockClauseZh, promptRef, CAMERA_MOVES, enOnly,
  majorityScript, isNumericTokenText,
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

describe("identityLockClauseZh (视频路径中文锁)", () => {
  it("empty refs → empty string", () => {
    expect(identityLockClauseZh([])).toBe("");
  });
  it("character lock keeps 同脸/同发型/同体型", () => {
    const out = identityLockClauseZh([{ role: "character", name: "Mia", lock: true }]);
    expect(out).toContain("Mia 与参考图保持同一人");
    expect(out).toContain("同脸、同发型、同体型");
  });
  it("product lock keeps 同形状/同颜色/同标签", () => {
    const out = identityLockClauseZh([{ role: "product", name: "AeroBottle", lock: true }]);
    expect(out).toContain("同形状、同颜色、同标签");
  });
  it("location lock matches the reference environment", () => {
    const out = identityLockClauseZh([{ role: "location", name: "老店面", lock: true }]);
    expect(out).toContain("场景与 老店面 的参考环境保持一致");
  });
  it("brandmark lock keeps the logo unaltered", () => {
    const out = identityLockClauseZh([{ role: "brandmark", name: "AeroCo", lock: true }]);
    expect(out).toContain("AeroCo logo 按参考图原样呈现，不得变形");
  });
  it("lock:false switches to style-only phrasing (只借风格)", () => {
    const out = identityLockClauseZh([{ role: "character", name: "阿澈", lock: false }]);
    expect(out).toContain("画风参考 阿澈");
    expect(out).not.toContain("同脸");
  });
  it("multiple refs joined with '；'", () => {
    const out = identityLockClauseZh([
      { role: "product", name: "A", lock: true },
      { role: "character", name: "B", lock: true },
    ]);
    expect(out).toContain("；");
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

describe("majorityScript (R3 类闭合：cjk/latin/other/none)", () => {
  it("majority-CJK with embedded English industry terms → cjk", () => {
    expect(majorityScript("档口的老板娘掀开蒸笼，镜头随蒸气 dolly in 推进")).toBe("cjk");
  });
  it("plain English prose → latin", () => {
    expect(majorityScript("a young man walks through the door")).toBe("latin");
  });
  it("wholly-Cyrillic prose → other (no longer invisible to both engines)", () => {
    expect(majorityScript("молодой человек идёт по улице")).toBe("other");
  });
  it("wholly-Arabic prose → other", () => {
    expect(majorityScript("رجل شاب يمشي عبر الباب")).toBe("other");
  });
  it("digits and punctuation only → none", () => {
    expect(majorityScript("16:9, 2024!")).toBe("none");
  });
  it("Cyrillic prose with a lone English word stays other (majority rules)", () => {
    expect(majorityScript("молодой человек идёт мимо кафе okay")).toBe("other");
  });
});

describe("isNumericTokenText (纯数字/比例/度量 token 豁免)", () => {
  it("ratio + resolution tokens are numeric-only", () => {
    expect(isNumericTokenText("16:9, 4K")).toBe(true);
    expect(isNumericTokenText("0.5s")).toBe(true);
    expect(isNumericTokenText("50mm")).toBe(true);
  });
  it("prose in any script is not numeric-only", () => {
    expect(isNumericTokenText("close-up")).toBe(false);
    expect(isNumericTokenText("在门口停下")).toBe(false);
    expect(isNumericTokenText("идёт 4K")).toBe(false);
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
