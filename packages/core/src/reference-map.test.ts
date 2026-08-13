/**
 * #774 U2 —— 编号句这一层的纯函数契约。
 *
 * 「编号 ↔ 引擎真收到的次序」那条对表在 `apps/worker/src/jobs/gen-reference-budget.test.ts`
 * (跑真的 `handleGen`)。这里只钉这个纯函数自己:同一个元素的第二张不重复定义、
 * 底图占第 1 位、名字有上限、没有槽位就一个字都不加。
 */
import { describe, it, expect } from "vitest";
import { referenceMapLines, withReferenceMap, type ReferenceSlot } from "./reference-budget.js";

type EntitySlot = Extract<ReferenceSlot, { kind: "entity" }>;
const ent = (entityId: string, type: EntitySlot["type"], name: string): ReferenceSlot =>
  ({ kind: "entity", entityId, type, name });

describe("referenceMapLines", () => {
  it("numbers slots 1..N in the order they were given", () => {
    expect(referenceMapLines([
      ent("e1", "CHARACTER", "Mia"),
      ent("e2", "PRODUCT", "the AeroBottle"),
      ent("e3", "LOCATION", "the kopitiam"),
      ent("e4", "BRANDMARK", "AeroCo"),
    ])).toEqual([
      "Define the person in <Image_1> as <Subject_1>: Mia.",
      "Define the product in <Image_2> as <Subject_2>: the AeroBottle.",
      "Define the setting in <Image_3> as <Subject_3>: the kopitiam.",
      "Define the logo in <Image_4> as <Subject_4>: AeroCo.",
    ]);
  });

  it("the edit base takes slot 1, pushing the elements down", () => {
    expect(referenceMapLines([{ kind: "baseImage" }, ent("e1", "PRODUCT", "the AeroBottle")])).toEqual([
      "<Image_1> is the image being edited.",
      "Define the product in <Image_2> as <Subject_2>: the AeroBottle.",
    ]);
  });

  it("a second photo of the same element points back at its own subject, it is not redefined", () => {
    expect(referenceMapLines([
      ent("e1", "CHARACTER", "Mia"),
      ent("e2", "PRODUCT", "the AeroBottle"),
      ent("e1", "CHARACTER", "Mia"),
    ])).toEqual([
      "Define the person in <Image_1> as <Subject_1>: Mia.",
      "Define the product in <Image_2> as <Subject_2>: the AeroBottle.",
      "<Image_3> is another photo of <Subject_1> (Mia).",
    ]);
  });

  it("two elements that share a name stay two subjects — identity is the id, not the name", () => {
    const out = referenceMapLines([ent("e1", "PRODUCT", "Kopi"), ent("e2", "PRODUCT", "Kopi")]);
    expect(out[1]).toBe("Define the product in <Image_2> as <Subject_2>: Kopi.");
    expect(out[1]).not.toContain("another photo");
  });

  it("a very long element name is bounded — the full name still rides in the merchant's own sentences", () => {
    const long = "x".repeat(120);
    const [line] = referenceMapLines([ent("e1", "PRODUCT", long)]);
    expect(line).toBe(`Define the product in <Image_1> as <Subject_1>: ${"x".repeat(60)}.`);
  });

  it("no slots → no lines", () => {
    expect(referenceMapLines([])).toEqual([]);
  });
});

describe("withReferenceMap", () => {
  it("puts the definitions before the merchant's prompt and leaves that prompt untouched", () => {
    expect(withReferenceMap("A hero shot of the bottle.", [{ kind: "baseImage" }, ent("e1", "PRODUCT", "the AeroBottle")]))
      .toBe(
        "<Image_1> is the image being edited. " +
        "Define the product in <Image_2> as <Subject_2>: the AeroBottle.\n" +
        "A hero shot of the bottle.",
      );
  });

  it("no slots → the prompt is returned byte-for-byte", () => {
    const p = "A hero shot of the bottle.";
    expect(withReferenceMap(p, [])).toBe(p);
  });
});
