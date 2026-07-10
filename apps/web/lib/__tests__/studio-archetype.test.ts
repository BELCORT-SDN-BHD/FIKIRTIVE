/**
 * [fix gate4/factory M3] 钉住 studio-factory 产品原型分类:品类判断先于价位判断。
 *
 * 回归病根:archetypeOf 旧序先判 priceMyr>=50 → box,一块 RM88 的蛋糕永远错落 gift-box 分支,
 * 吐礼盒预购文案/CTA(而非 celebration centrepiece)。archetypeOf 未导出,故经公开的
 * studioHooks(cta/frame)与 studioStoryboard(provenance)间接钉住三档原型。
 *
 * 说明(诚实标注):本测试文件落在 apps/web/lib/__tests__/ 而非 studio-factory/ 围栏内 ——
 * vitest.config.ts 的 include 仅覆盖 lib/** 与 app/**,围栏内的测试不会被运行。为兑现审查
 * 要求「写个能真跑的小测试」,新增此纯 additive 测试文件(不改任何既有文件)。
 */

import { describe, expect, it } from "vitest";
import { studioHooks, studioStoryboard } from "@/components/northstar/immersive/studio-factory/data";
import type { NsProduct } from "@/components/northstar/_mock";

function product(over: Partial<NsProduct>): NsProduct {
  return {
    id: "t",
    name: "Test bake",
    category: "Pastries",
    priceMyr: 10,
    description: "",
    image: "",
    bestSeller: false,
    ...over,
  };
}

describe("studio-factory archetype classification (M3)", () => {
  it("classifies an RM88 cake as a celebration centrepiece, not a gift box", () => {
    const pandanCake = product({ id: "prod-01", name: "Pandan gula melaka cake", category: "Cakes", priceMyr: 88 });
    const set = studioHooks(pandanCake);
    // centrepiece CTA + frame label — the pre-fix bug produced the box CTA ("Pre-order now").
    expect(set.cta).toBe("Reserve your date");
    expect(set.frame).toContain("celebration centrepiece");
    expect(set.frame).not.toContain("festive gift box");
    // storyboard provenance echoes the same archetype.
    expect(studioStoryboard(pandanCake).provenance).toContain("celebration-centrepiece");
  });

  it("still classifies a Cakes item as centrepiece even below the RM50 line", () => {
    const cheapCake = product({ category: "Cakes", priceMyr: 30 });
    expect(studioHooks(cheapCake).cta).toBe("Reserve your date");
  });

  it("keeps Seasonal (and pricey non-cake) items as a gift box", () => {
    const rayaBox = product({ id: "prod-06", name: "Raya cookie gift box", category: "Seasonal", priceMyr: 68 });
    expect(studioHooks(rayaBox).cta).toBe("Pre-order now");
    expect(studioHooks(rayaBox).frame).toContain("festive gift box");

    const pricyPastry = product({ category: "Pastries", priceMyr: 60 });
    expect(studioHooks(pricyPastry).cta).toBe("Pre-order now");
  });

  it("keeps a cheap everyday single as a grab-and-go", () => {
    const cookie = product({ id: "prod-03", name: "Milo dinosaur cookie", category: "Cookies", priceMyr: 6 });
    expect(studioHooks(cookie).cta).toBe("Order today");
    expect(studioHooks(cookie).frame).toContain("grab-and-go single");
  });
});
