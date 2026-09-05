import { describe, it, expect } from "vitest";
import { NO_TYPE_SELECTED, canSubmitNewLibraryAsset } from "../add-asset-form";

/**
 * P1-6 —— 「Otto silently attaches a Library photo the merchant never mentioned — and calls a
 * jar a person」的根因:Add-to-Library 表单的 Type 下拉曾经默认选中 REFERENCE_FORMATS[0]
 * ("Avatar / Cast" → CHARACTER),商家没碰过下拉就能把任何图片(包括产品图)存成
 * CHARACTER。这条标签不是装饰 —— 它会原样写进送给引擎的提示词
 * ("Define the person in <Image_1>", packages/core/src/reference-budget.ts
 * SLOT_NOUN.CHARACTER = "person"),就是这句话让引擎的真人脸检测在一张果酱罐照片上误判。
 *
 * 修法:表单不再有默认类型;Add 按钮在商家明确选一个类型之前保持禁用,与
 * createEntity 服务端动作本就有的 `ENTITY_TYPES.has(type)` 校验同一条口径,只是提前到
 * UI 层不许静默提交猜测值。
 */
describe("add-asset-form: honest default (no silent CHARACTER)", () => {
  it("starts with no type selected", () => {
    expect(NO_TYPE_SELECTED).toBe("");
  });

  it("a product photo with no type chosen cannot be submitted — Add stays disabled", () => {
    const ok = canSubmitNewLibraryAsset({
      name: "Pandan kaya jar photo",
      type: NO_TYPE_SELECTED,
      fileCount: 1,
      locked: false,
    });
    expect(ok).toBe(false);
  });

  it("a product photo explicitly typed PRODUCT can be submitted", () => {
    const ok = canSubmitNewLibraryAsset({
      name: "Pandan kaya jar photo",
      type: "PRODUCT",
      fileCount: 1,
      locked: false,
    });
    expect(ok).toBe(true);
  });

  it("an explicit CHARACTER pick still works — the merchant/actor library can say it's a person on purpose", () => {
    const ok = canSubmitNewLibraryAsset({
      name: "Mia",
      type: "CHARACTER",
      fileCount: 1,
      locked: false,
    });
    expect(ok).toBe(true);
  });

  it("still needs a name and at least one file — type alone isn't enough", () => {
    expect(canSubmitNewLibraryAsset({ name: "", type: "PRODUCT", fileCount: 1, locked: false })).toBe(false);
    expect(canSubmitNewLibraryAsset({ name: "  ", type: "PRODUCT", fileCount: 1, locked: false })).toBe(false);
    expect(canSubmitNewLibraryAsset({ name: "Jar", type: "PRODUCT", fileCount: 0, locked: false })).toBe(false);
  });

  it("stays disabled while the form is locked (saving / done / an unconfirmed write), even with everything else filled in", () => {
    expect(canSubmitNewLibraryAsset({ name: "Jar", type: "PRODUCT", fileCount: 1, locked: true })).toBe(false);
  });
});
