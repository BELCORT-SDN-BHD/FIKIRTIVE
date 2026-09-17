/**
 * PRODID-A4 —— `@` 菜单一行画哪一张缩略图(规格 `docs/specs/brand-product-identity.md` §5;
 * Founder 2026-09-15 裁决)。
 *
 * 这份文件存在的理由是一条**复核抓到的回归**:把「封面只认钉着的那一张」一刀切到所有行上,
 * 变体行会集体失去缩略图 —— 变体行身上根本没有 `baseAssetId`(封面是身份的),它的图又全是
 * 变体层的,而封面规则明确不把变体图纳入判据。于是 `find(assetId === undefined)` 恒为
 * undefined,每一行变体都变成没有图的空格。
 *
 * 判据住在 `lib/reference-search-model.ts:referenceRowThumbUrl` 一处(`MentionInput` 只负责
 * 先把视频筛掉再调它),所以这里是纯函数单测,不需要 jsdom 把整个 Tiptap 拉起来。
 */
import { describe, it, expect } from "vitest";
import { referenceRowThumbUrl } from "../reference-search-model";

const A = { assetId: "ast_a", url: "/media/a.png" };
const B = { assetId: "ast_b", url: "/media/b.png" };

describe("PRODID-A4 `@` 菜单缩略图", () => {
  it("PRODID-A4 身份行:画钉着的那一张,不是第一张", () => {
    expect(referenceRowThumbUrl({ images: [A, B], baseAssetId: B.assetId })).toBe(B.url);
  });

  it("PRODID-A4 身份行:没钉过 ⇒ 没有图(与 Brand 逐字一致,不拿第一张冒充)", () => {
    // 这一句是「Library 与 Brand 同一张图」在 `@` 菜单这一面的样子。写路已经保证「挂上第一张
    // 即封面」,所以这个状态只剩一种成因:一张基础层参考图都没有。
    expect(referenceRowThumbUrl({ images: [A, B], baseAssetId: null })).toBeNull();
    expect(referenceRowThumbUrl({ images: [A, B] })).toBeNull();
  });

  it("PRODID-A4 身份行:钉着的那张已经不在这几张里 ⇒ 没有图,不静默换成另一张", () => {
    expect(referenceRowThumbUrl({ images: [A, B], baseAssetId: "ast_gone" })).toBeNull();
  });

  it("PRODID-A4 变体行:画它自己的第一张图(复核抓到的回归)", () => {
    // 变体行没有 baseAssetId —— 拿身份那条规则去套就是恒 null,整排变体失去缩略图。
    expect(referenceRowThumbUrl({ images: [A, B], variantId: "evr_1" })).toBe(A.url);
    // 就算带上一个不相干的 baseAssetId(身份的封面),变体行也只认自己的第一张。
    expect(referenceRowThumbUrl({ images: [A, B], baseAssetId: B.assetId, variantId: "evr_1" })).toBe(A.url);
  });

  it("PRODID-A4 变体行一张图都没有 ⇒ 没有图", () => {
    expect(referenceRowThumbUrl({ images: [], variantId: "evr_1" })).toBeNull();
  });

  it("PRODID-A4 身份行一张图都没有 ⇒ 没有图", () => {
    expect(referenceRowThumbUrl({ images: [], baseAssetId: null })).toBeNull();
  });
});
