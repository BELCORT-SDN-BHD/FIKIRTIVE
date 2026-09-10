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
import { MAX_GEN_ENTITIES, MAX_VIDEO_IMAGE_PARTS } from "./gen.js";

describe("FSE-001 —— 挂图在视频计划里是首帧还是参考图", () => {
  // 走查那一天的病:商家 @ 官方演员 + 挂商品图,系统把商品图当首帧、把演员清空,于是
  // 产品只好建议先合成一张首帧 —— 而那条路按规格 §5「血统信任」必被视频端拒收。
  // Founder 2026-09-08 裁「合成 first frame 的 idea 可以移除」,正路是两张参考图直接出片。
  it("FSE-001 / CREATE-A9: 演员 + 商品图 ⇒ 参考图(纯文生视频),不是首帧", () => {
    expect(
      videoAttachmentRole({
        attachedImageCount: 1,
        mentionedCastCount: 1,
        hasReferenceVideo: false,
      }),
    ).toBe("reference");
  });

  it("FSE-001 / CREATE-A2: 只有一张图、没有演员 ⇒ 首帧(「把这张图动起来」那条路一格不动)", () => {
    expect(
      videoAttachmentRole({
        attachedImageCount: 1,
        mentionedCastCount: 0,
        hasReferenceVideo: false,
      }),
    ).toBe("startFrame");
  });

  it("FSE-001 / CREATE-A10: 只有演员、一张挂图都没有 ⇒ 没有挂图角色可言(纯文生视频照旧)", () => {
    expect(
      videoAttachmentRole({
        attachedImageCount: 0,
        mentionedCastCount: 1,
        hasReferenceVideo: false,
      }),
    ).toBeNull();
  });

  it("FSE-001 / CREATE-A2: 挂着整段参考片时挂图照旧不上车(既有行为逐字不变)", () => {
    expect(
      videoAttachmentRole({
        attachedImageCount: 2,
        mentionedCastCount: 1,
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
        mentionedCastCount: 0,
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

  // ── FSE-001 判官 r1 P2 —— 挂满 9 张商品图时,演员的照片必须还上得了车 ────────────
  //
  // 上一版:挂图先占满 9 个 `image_url` 名额 ⇒ `conditioningCap` 算出 0 ⇒ 演员一张照片
  // 都不上车,而卡上 `approvedEntities` 仍然列着 `Aisyah (person)`。商家批了「Aisyah 拿着
  // 我的杯子」、付了钱,买回来的是一个陌生人拿着杯子。现在每个在场的**元素**先预留
  // 1 格,超出的商品图按既有 truncated 口径在批准前说出来。
  it("FSE-001 / CREATE-A9: 演员 + 挂满 9 张商品图 ⇒ 演员的照片保住 1 格,商品图上 8 张", () => {
    expect(
      referenceBudget({
        kind: "video",
        perEntityLiveCounts: [3],
        hasBaseImage: false,
        attachedImageCount: MAX_VIDEO_IMAGE_PARTS,
        mentionedElementCount: 1,
      }),
    ).toEqual({
      // 1 张演员照 + 8 张商品图 = 9 个名额,一格不多不少。
      used: MAX_VIDEO_IMAGE_PARTS,
      total: MAX_VIDEO_IMAGE_PARTS + 3,
      truncated: true,
    });
    // 名额的两半各自钉死 —— 只钉合计的话,「演员 0 + 商品 9」也能凑出同一个 9。
    expect(
      videoAttachedCap({ attachedImageCount: MAX_VIDEO_IMAGE_PARTS, mentionedElementCount: 1 }),
    ).toBe(MAX_VIDEO_IMAGE_PARTS - 1);
    expect(
      conditioningCap({
        kind: "video",
        attachedImageCount: MAX_VIDEO_IMAGE_PARTS,
        mentionedElementCount: 1,
      }),
    ).toBe(1);
  });

  // 判官 r2 —— 预留基数是「在场元素数」,不是「在场演员数」:发格的 round-robin 按
  // `entityIds` 原序给每个元素发第一张,所以「先 @ 商品元素、再 @ 演员」那一趟里,只按
  // 演员数预留出来的那唯一一格会被排在前面的商品元素拿走,演员仍旧 0 张。两个在场元素
  // ⇒ 留 2 格,与下面 worker 侧那条真 `handleGen` 的反例(gen-reference-budget.test.ts)
  // 是同一个数。
  it("FSE-001 / CREATE-A9: 两个在场元素(演员 + 商品元素或两位演员)+ 挂满 9 张 ⇒ 各预留 1 格,商品图上 7 张", () => {
    expect(
      videoAttachedCap({ attachedImageCount: MAX_VIDEO_IMAGE_PARTS, mentionedElementCount: 2 }),
    ).toBe(MAX_VIDEO_IMAGE_PARTS - 2);
    expect(
      referenceBudget({
        kind: "video",
        perEntityLiveCounts: [1, 1],
        hasBaseImage: false,
        attachedImageCount: MAX_VIDEO_IMAGE_PARTS,
        mentionedElementCount: 2,
      }),
    ).toEqual({
      used: MAX_VIDEO_IMAGE_PARTS,
      total: MAX_VIDEO_IMAGE_PARTS + 2,
      truncated: true,
    });
  });

  it("FSE-001 / CREATE-A10: 没有演员、挂满 9 张 ⇒ 与这条修改之前逐字相同(元素照 0 张,卡面 truncated)", () => {
    // 分岔判据只认 CHARACTER(`videoAttachmentRole`),所以没有演员的那一档一格不动:
    // 挂图占满 9 格、被挤掉的元素照照旧在批准前说出来。
    expect(
      referenceBudget({
        kind: "video",
        perEntityLiveCounts: [3],
        hasBaseImage: false,
        attachedImageCount: MAX_VIDEO_IMAGE_PARTS,
      }),
    ).toEqual({ used: MAX_VIDEO_IMAGE_PARTS, total: MAX_VIDEO_IMAGE_PARTS + 3, truncated: true });
    expect(conditioningCap({ kind: "video", attachedImageCount: MAX_VIDEO_IMAGE_PARTS })).toBe(0);
  });

  it("FSE-001 / CREATE-A2: 演员 + 挂图没占满名额时,预留一格都不吃(既有那一档不变)", () => {
    // 名额够用 ⇒ 挂图一张不少、演员的照片也一张不少,预留只在真的抢名额时才生效。
    expect(videoAttachedCap({ attachedImageCount: 2, mentionedElementCount: 1 })).toBe(2);
    expect(
      referenceBudget({
        kind: "video",
        perEntityLiveCounts: [1],
        hasBaseImage: false,
        attachedImageCount: 1,
        mentionedElementCount: 1,
      }),
    ).toEqual({ used: 2, total: 2, truncated: false });
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

// ---------------------------------------------------------------------------
// creation §5 :162⑤ —— 名额预留背后那条**隐含依赖**,现在有断言钉着
// ---------------------------------------------------------------------------
//
// `videoAttachedCap` 给在场的每一个 @元素先留 1 格(理由见该函数的注释:卡上写了名字、
// 请求里却没有那个人,是这条路最贵的一种病)。这条预留只有在「元素数**恒小于** image_url
// 名额总数」时才留得下东西 —— 元素数的上限是 `MAX_GEN_ENTITIES`(付费 schema 的 `.max()`),
// 名额总数是 `MAX_VIDEO_IMAGE_PARTS`。两个常量住在同一个文件里,却从来没有一行代码说过
// 它们之间有关系:哪天有人把元素上限提到 9,预留会吃光全部名额,商家挂的商品图一张都上
// 不了车,而没有任何一个既有测试会红。
//
// 断言写在测试里(不写模块加载期):两个都是编译期常量,让 core 在生产环境为一次静态比较
// 抛异常没有收益,而 CI 里红一次就够拦住那次改动。
describe("creation §5 :162⑤ —— 元素上限与 image_url 名额的隐含依赖", () => {
  it("creation §5 :162⑤ / CREATE-A10: MAX_GEN_ENTITIES(8) < MAX_VIDEO_IMAGE_PARTS(9) —— 满编元素也留得下至少一格给挂图", () => {
    expect(MAX_GEN_ENTITIES).toBeLessThan(MAX_VIDEO_IMAGE_PARTS);
    // 不等式的行为面:满编 @ 元素时,挂图仍拿得到名额。
    expect(
      videoAttachedCap({ attachedImageCount: 1, mentionedElementCount: MAX_GEN_ENTITIES }),
    ).toBe(MAX_VIDEO_IMAGE_PARTS - MAX_GEN_ENTITIES);
  });
});
