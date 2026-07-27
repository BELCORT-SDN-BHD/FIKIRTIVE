import { describe, it, expect } from "vitest";
import {
  VIDEO_VARIANT_AXES,
  IMAGE_VARIANT_AXES,
  checkVariantSet,
  promptSimilarity,
  variantCountFor,
  deriveAssetChecklist,
  ASSET_WHY,
  MISSING_ASSET_WARNING,
  FAMILY_REQUIRED_ROLES,
} from "./variant-policy.js";

describe("variant axes", () => {
  it("video = composition/mood/motion; image = composition/mood/style", () => {
    expect(VIDEO_VARIANT_AXES).toEqual(["composition", "mood", "motion"]);
    expect(IMAGE_VARIANT_AXES).toEqual(["composition", "mood", "style"]);
  });
});

describe("checkVariantSet — 2-3 variants, meaningfully different axes", () => {
  const v = (axis: "composition" | "mood" | "motion" | "style", prompt: string) => ({ axis, note: "n", prompt });

  it("accepts 3 video variants on three different axes", () => {
    const res = checkVariantSet("video", [
      v("composition", "extreme wide, 俯拍平铺开场, 档口全景, fixed, 清晨自然光"),
      v("mood", "close-up, 夜市暖黄换清晨冷白, 老板娘舀酱, dolly in, 冷色温清晨光"),
      v("motion", "medium, 老板娘舀酱, one continuous take 贯穿全场, 快节奏"),
    ]);
    expect(res.ok).toBe(true);
    expect(res.problems).toEqual([]);
  });
  it("accepts 2 variants (edit-type / pinned direction)", () => {
    const res = checkVariantSet("image", [
      v("mood", "a batik scarf, warm golden hour side light, rich amber tones"),
      v("composition", "a batik scarf, top-down flat lay, loose grid, negative space upper third"),
    ]);
    expect(res.ok).toBe(true);
  });
  it("rejects 1 variant and 4 variants", () => {
    expect(checkVariantSet("video", [v("mood", "a")]).ok).toBe(false);
    expect(
      checkVariantSet("image", [v("mood", "aaaa"), v("composition", "bbbb"), v("style", "cccc"), v("style", "dddd")]).ok,
    ).toBe(false);
  });
  it("rejects duplicate leading axes", () => {
    const res = checkVariantSet("video", [
      v("mood", "夜市暖黄灯光, 烟火气十足的档口"),
      v("mood", "清晨冷白光, 干净利落的档口"),
    ]);
    expect(res.ok).toBe(false);
    expect(res.problems.join(" ")).toContain("same leading axis");
  });
  it("rejects a motion axis on the image path and a style axis on the video path", () => {
    expect(checkVariantSet("image", [v("motion", "aaaa"), v("mood", "bbbb")]).ok).toBe(false);
    expect(checkVariantSet("video", [v("style", "aaaa"), v("mood", "bbbb")]).ok).toBe(false);
  });
  it("rejects synonym-level rewrites (同义词替换不算变体)", () => {
    const res = checkVariantSet("video", [
      v("motion", "medium, 老板娘舀起参巴酱, 缓缓推近, 清晨侧光, 烟火气"),
      v("mood", "medium, 老板娘舀起参巴酱, 慢慢推进, 清晨侧光, 烟火气"),
    ]);
    expect(res.ok).toBe(false);
    expect(res.problems.join(" ")).toContain("synonym level");
  });
});

describe("promptSimilarity", () => {
  it("identical → 1, unrelated → low", () => {
    expect(promptSimilarity("abc def", "abc def")).toBe(1);
    expect(promptSimilarity("golden hour rooftop", "水墨风格的奇幻森林")).toBeLessThan(0.2);
  });
});

describe("variantCountFor", () => {
  it("2 when direction pinned, edit-type, or educational", () => {
    expect(variantCountFor({ family: "ecommerce", directionPinned: true })).toBe(2);
    expect(variantCountFor({ family: "generalCreative", editType: true })).toBe(2);
    expect(variantCountFor({ family: "educational" })).toBe(2);
  });
  it("3 otherwise (open brief), never more", () => {
    expect(variantCountFor({ family: "generalCreative" })).toBe(3);
    expect(variantCountFor({ family: "ecommerce" })).toBe(3);
  });
});

describe("deriveAssetChecklist", () => {
  it("each item carries role + name + plain-language why + lock + readiness", () => {
    const items = deriveAssetChecklist("ecommerce", [
      { role: "product", name: "辣椒酱经典装", ready: true },
      { role: "brandmark", name: "AeroCo", ready: false },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ role: "product", name: "辣椒酱经典装", lock: true, ready: true, why: ASSET_WHY.product });
    expect(items[0]?.howToSupply).toBeUndefined();
    expect(items[1]?.ready).toBe(false);
    expect(items[1]?.howToSupply).toContain("elements page");
  });
  it("family default: ecommerce without a product ref adds a missing product item", () => {
    const items = deriveAssetChecklist("ecommerce", []);
    expect(items.some((i) => i.role === "product" && i.ready === false && i.howToSupply)).toBe(true);
  });
  it("dialogue drama requires a character; general creative requires nothing (不主动索要)", () => {
    expect(deriveAssetChecklist("dialogueDrama", []).some((i) => i.role === "character")).toBe(true);
    expect(deriveAssetChecklist("generalCreative", [])).toEqual([]);
    expect(FAMILY_REQUIRED_ROLES.generalCreative).toEqual([]);
  });
  it("lock:false (style borrow) is preserved on the item", () => {
    const items = deriveAssetChecklist("fantasyAnimation", [
      { role: "character", name: "阿澈", ready: true },
      { role: "location", name: "画风参考图", ready: true, lock: false },
    ]);
    expect(items.find((i) => i.name === "画风参考图")?.lock).toBe(false);
  });
  it("fail-honest degradation message is plain and mentions the consequence", () => {
    expect(MISSING_ASSET_WARNING).toMatch(/only look similar/);
  });
});
