import { describe, it, expect } from "vitest";
import {
  VARIANT_AXES,
  checkVariantSet,
  type VariantAxis,
} from "./variant-policy.js";

describe("变体政策 —— 提醒,不拦截", () => {
  const a = (axis: VariantAxis, prompt: string) => ({ axis, prompt });

  it("方向真的不同 → 一句话都不用说", () => {
    expect(
      checkVariantSet([
        a("composition", "A close-up of the jar on a marble counter."),
        a("mood", "The jar on a warm family table at dusk."),
      ]),
    ).toEqual([]);
  });

  it("两个方向撞在同一条轴上 → 提醒商家它们会读起来像同一个想法", () => {
    const notes = checkVariantSet([
      a("mood", "A warm, homely take."),
      a("mood", "A cosy, homely take."),
    ]);
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/mood/);
  });

  it("两条提示词逐字相同 → 那不是两个方向,是同一个东西给了两次", () => {
    const notes = checkVariantSet([a("composition", "Same words."), a("mood", "Same words.")]);
    expect(notes.some((n) => /same/i.test(n))).toBe(true);
  });

  it("只给一个方向 → 不啰嗦", () => {
    expect(checkVariantSet([a("mood", "One idea.")])).toEqual([]);
  });

  it("没标轴的条目照过,不因为少一个可选字段就报警", () => {
    expect(checkVariantSet([{ prompt: "One." }, { prompt: "Two." }])).toEqual([]);
  });

  it("永远只回提醒,永远不抛、不拒绝(政策不是硬拦截)", () => {
    expect(() => checkVariantSet([])).not.toThrow();
    expect(checkVariantSet([])).toEqual([]);
    const many = Array.from({ length: 8 }, (_, i) => a("mood", `Idea ${i}.`));
    expect(Array.isArray(checkVariantSet(many))).toBe(true);
  });
});

describe("变体轴", () => {
  it("轴表不为空、无重复", () => {
    expect(VARIANT_AXES.length).toBeGreaterThan(1);
    expect(new Set(VARIANT_AXES).size).toBe(VARIANT_AXES.length);
  });
});
