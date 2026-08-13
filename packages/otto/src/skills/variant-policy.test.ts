import { describe, it, expect } from "vitest";
import { MAX_GEN_COUNT } from "@fikirtive/core";
import {
  VARIANT_AXES,
  DEFAULT_VARIANT_COUNT,
  variantCountFor,
  checkVariantSet,
  type VariantAxis,
} from "./variant-policy.js";

describe("变体数量 —— 卡面真做得到的那个数,不是我们希望的那个数", () => {
  it("视频永远只有一条 —— 铸卡那一侧就是这么写的", () => {
    expect(variantCountFor("video")).toBe(1);
    expect(variantCountFor("video", 4)).toBe(1);
  });

  it("图片:没说就给默认几个方向,说了就按他说的,超出菜单就收进菜单", () => {
    expect(variantCountFor("image")).toBe(DEFAULT_VARIANT_COUNT);
    expect(variantCountFor("image", 2)).toBe(2);
    expect(variantCountFor("image", 99)).toBe(MAX_GEN_COUNT);
    expect(variantCountFor("image", 0)).toBe(1);
    expect(variantCountFor("image", -3)).toBe(1);
    expect(variantCountFor("image", 2.7)).toBe(2);
  });

  it("默认数落在菜单里", () => {
    expect(DEFAULT_VARIANT_COUNT).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_VARIANT_COUNT).toBeLessThanOrEqual(MAX_GEN_COUNT);
  });
});

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
