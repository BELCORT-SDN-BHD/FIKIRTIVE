/**
 * reference-budget.test.ts —— FSE-001 的判据层。
 *
 * 这里钉的是**一张挂进来的图在视频计划里扮演什么**,以及那个角色如何改变名额与卡面数字。
 * 真送出去的那一份由 `apps/worker/src/jobs/gen-reference-budget.test.ts` 拿真 `handleGen`
 * 对表;这里只钉纯函数,所以两层加起来才是「说的 = 送的」。
 */
import { describe, it, expect } from "vitest";
import {
  videoAttachmentRole,
  videoAttachedCap,
  conditioningCap,
  referenceBudget,
} from "./reference-budget.js";
import { MAX_VIDEO_IMAGE_PARTS } from "./gen.js";

describe("FSE-001 —— 挂图在视频计划里是首帧还是参考图", () => {
  // 走查那一天的病:商家 @ 官方演员 + 挂商品图,系统把商品图当首帧、把演员清空,于是
  // 产品只好建议先合成一张首帧 —— 而那条路按规格 §5「血统信任」必被视频端拒收。
  // Founder 2026-09-08 裁「合成 first frame 的 idea 可以移除」,正路是两张参考图直接出片。
  it("FSE-001 / CREATE-A9: 演员 + 商品图 ⇒ 参考图(纯文生视频),不是首帧", () => {
    expect(
      videoAttachmentRole({
        attachedImageCount: 1,
        mentionedCharacterCount: 1,
        hasReferenceVideo: false,
      }),
    ).toBe("reference");
  });

  it("FSE-001 / CREATE-A2: 只有一张图、没有演员 ⇒ 首帧(「把这张图动起来」那条路一格不动)", () => {
    expect(
      videoAttachmentRole({
        attachedImageCount: 1,
        mentionedCharacterCount: 0,
        hasReferenceVideo: false,
      }),
    ).toBe("startFrame");
  });

  it("FSE-001 / CREATE-A10: 只有演员、一张挂图都没有 ⇒ 没有挂图角色可言(纯文生视频照旧)", () => {
    expect(
      videoAttachmentRole({
        attachedImageCount: 0,
        mentionedCharacterCount: 1,
        hasReferenceVideo: false,
      }),
    ).toBeNull();
  });

  it("FSE-001 / CREATE-A2: 挂着整段参考片时挂图照旧不上车(既有行为逐字不变)", () => {
    expect(
      videoAttachmentRole({
        attachedImageCount: 2,
        mentionedCharacterCount: 1,
        hasReferenceVideo: true,
      }),
    ).toBeNull();
  });

  // 非角色元素(PRODUCT / LOCATION / BRANDMARK)不构成分岔:分岔的理由是「演员的身份住在
  // 他的参考照里,而参考照只有纯文生视频那一档带得上」。数的因此只有 CHARACTER。
  it("FSE-001 / CREATE-A2: @ 的不是演员时 ⇒ 首帧那一档,行为与从前相同", () => {
    expect(
      videoAttachmentRole({
        attachedImageCount: 1,
        mentionedCharacterCount: 0,
        hasReferenceVideo: false,
      }),
    ).toBe("startFrame");
  });
});

describe("FSE-001 —— 名额:商品图与演员照坐在同一批 image_url 名额里", () => {
  it("FSE-001 / CREATE-A9: 纯文生视频带 2 张挂图 ⇒ 挂图占 2 格,元素照拿剩下的 7 格", () => {
    expect(videoAttachedCap({ attachedImageCount: 2 })).toBe(2);
    expect(conditioningCap({ kind: "video", attachedImageCount: 2 })).toBe(MAX_VIDEO_IMAGE_PARTS - 2);
  });

  // 「演员 + 首帧」这个混合形态本片不打开:名额维持 0,与这条修改之前逐字相同。
  it("FSE-001 / CREATE-A10: 演员 + 首帧 ⇒ 元素照名额仍是 0,挂图名额也是 0(混合形态维持现状)", () => {
    expect(videoAttachedCap({ attachedImageCount: 1, hasVideoStartFrame: true })).toBe(0);
    expect(conditioningCap({ kind: "video", attachedImageCount: 1, hasVideoStartFrame: true })).toBe(0);
    expect(conditioningCap({ kind: "video", attachedImageCount: 1, hasVideoTailFrame: true })).toBe(0);
    expect(conditioningCap({ kind: "video", attachedImageCount: 1, hasReferenceVideo: true })).toBe(0);
  });

  it("FSE-001 / CREATE-A2: 一张挂图都没有的纯文生视频,名额与这条修改之前逐字相同", () => {
    expect(conditioningCap({ kind: "video", attachedImageCount: 0 })).toBe(MAX_VIDEO_IMAGE_PARTS);
    expect(conditioningCap({ kind: "video" })).toBe(MAX_VIDEO_IMAGE_PARTS);
  });

  it("FSE-001 / CREATE-A2: 图片那一支的名额算法一格没动", () => {
    expect(conditioningCap({ kind: "image", attachedImageCount: 0 })).toBe(10);
    expect(conditioningCap({ kind: "image", attachedImageCount: 1 })).toBe(10);
    expect(conditioningCap({ kind: "image", attachedImageCount: 3 })).toBe(8);
  });
});

describe("FSE-001 —— 卡面数字:两件引用都要数进去", () => {
  it("FSE-001 / CREATE-A9: 演员 1 张定妆照 + 1 张商品图 ⇒ 卡上说 2 张,一张都没被截掉", () => {
    expect(
      referenceBudget({
        kind: "video",
        perEntityLiveCounts: [1],
        hasBaseImage: false,
        attachedImageCount: 1,
      }),
    ).toEqual({ used: 2, total: 2, truncated: false });
  });

  it("FSE-001 / CREATE-A10: 挂图把名额填满时,被挤掉的元素照必须在卡面上说出来", () => {
    // 挂 9 张 ⇒ image_url 名额全被商家自己的图占满 ⇒ 元素照一张都上不了车,卡面 truncated。
    expect(
      referenceBudget({
        kind: "video",
        perEntityLiveCounts: [3],
        hasBaseImage: false,
        attachedImageCount: MAX_VIDEO_IMAGE_PARTS,
      }),
    ).toEqual({ used: MAX_VIDEO_IMAGE_PARTS, total: MAX_VIDEO_IMAGE_PARTS + 3, truncated: true });
  });

  it("FSE-001 / CREATE-A2: 带首帧那一档的三个数与这条修改之前逐字相同(挂图不算参考照)", () => {
    expect(
      referenceBudget({
        kind: "video",
        perEntityLiveCounts: [17],
        hasBaseImage: false,
        attachedImageCount: 1,
        hasVideoStartFrame: true,
      }),
    ).toEqual({ used: 0, total: 17, truncated: true });
  });

  it("FSE-001 / CREATE-A2: 纯文生视频、零挂图 —— 既有那一档逐字不变", () => {
    expect(
      referenceBudget({
        kind: "video",
        perEntityLiveCounts: [5, 4],
        hasBaseImage: false,
        attachedImageCount: 0,
      }),
    ).toEqual({ used: 9, total: 9, truncated: false });
  });
});
