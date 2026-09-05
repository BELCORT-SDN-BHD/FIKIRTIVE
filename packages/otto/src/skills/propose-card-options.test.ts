/**
 * propose-card-options.test —— 确认卡上那三格（张数／形状／精修）的纯判词。
 *
 * 规格 docs/specs/otto-engine.md，验收 ENGINE-A3（§5 登记 2026-09-05，Founder 裁决
 * 「加进确认卡」）：⑦段之后卡片是唯一的花钱入口，所以「商家批准前可改」这件事
 * 必须在**铸卡与改档同一份口径**上成立。
 *
 * 这一份只钉纯判词（谁改得动、改完卡上是什么、价从哪来）；账本证据在
 * `apps/web/lib/__tests__/otto-card-options-ledger.test.ts`（真库、真 reserve）。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_MODEL,
  PRO_IMAGE_MODEL,
  GEN_IMAGE_MODEL_OPTIONS,
  MAX_GEN_COUNT,
  displayCredits,
  imageAspectHonoured,
  isSellableImageSku,
  pricedGenCredits,
} from "@fikirtive/core";
import { applyCardOptions, cardOptionMenu } from "./propose-card-options.js";
import { buildProposeCard } from "./propose.helpers.js";
import type { OttoContext } from "../context.js";

function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    ...overrides,
  } as OttoContext;
}

function imageCard(extra?: Record<string, unknown>) {
  return buildProposeCard(
    {
      kind: "image" as const,
      structuredPrompt: "a pandan kaya jar on a marble counter",
      entityIds: [],
      variantSel: {},
      ...extra,
    },
    makeCtx(),
    [],
  ).cardPayload;
}

/** 卡面报价的**唯一**参照物：预扣用的那一个函数，按卡上那一档、那个张数现算。 */
function quoteFor(model: string, count: number): number {
  return displayCredits(pricedGenCredits({ kind: "IMAGE", model, count, videoOptions: null }));
}

function okPayload(result: ReturnType<typeof applyCardOptions>) {
  if (!result.ok) throw new Error(`改档被拒:${result.error}`);
  return result.payload;
}

describe("ENGINE-A3 确认卡三格控件 —— 菜单只有服务端这一份", () => {
  it("ENGINE-A3 菜单来自当前那一档:精修档的形状比默认档窄,张数上限同源", () => {
    const menu = cardOptionMenu(DEFAULT_IMAGE_MODEL);
    const proMenu = cardOptionMenu(PRO_IMAGE_MODEL);
    expect(menu).not.toBeNull();
    expect(proMenu).not.toBeNull();
    expect(menu!.maxCount).toBe(MAX_GEN_COUNT);
    if (imageAspectHonoured()) {
      expect(menu!.aspectRatios).toEqual([...GEN_IMAGE_MODEL_OPTIONS[DEFAULT_IMAGE_MODEL].aspectRatios]);
      expect(proMenu!.aspectRatios).toEqual([...GEN_IMAGE_MODEL_OPTIONS[PRO_IMAGE_MODEL].aspectRatios]);
      // pro 的像素上限更低 —— 16:9 / 9:16 收不下,所以菜单必须真的更窄。
      expect(proMenu!.aspectRatios.length).toBeLessThan(menu!.aspectRatios.length);
    }
  });

  it("ENGINE-A3 精修那一格的有无,判据与付费闸同一个函数(没有价就不出现)", () => {
    expect(cardOptionMenu(DEFAULT_IMAGE_MODEL)!.fineDetailAvailable).toBe(isSellableImageSku(PRO_IMAGE_MODEL));
  });

  it("ENGINE-A3 新铸的图片卡自带这份菜单;视频卡一格都不带", () => {
    const image = imageCard();
    expect(image.options).toEqual(cardOptionMenu(image.model));
    const video = buildProposeCard(
      { kind: "video", structuredPrompt: "a slow push-in on the jar", entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    ).cardPayload;
    expect(video.options).toBeUndefined();
  });

  it("ENGINE-A3 菜单外的槽位(历史卡、垃圾值)⇒ 没有菜单,而不是编一份出来", () => {
    expect(cardOptionMenu("not-a-model")).toBeNull();
  });
});

describe("ENGINE-A3 商家在卡上改三格 —— 报价与预扣同源", () => {
  it("ENGINE-A3 改张数:卡上的价 == 单一价目源按新张数算出来的数(不是旧价乘一个系数)", () => {
    const card = imageCard();
    expect(card.params.count).toBe(1);
    const one = card.estimatedCredits;

    const three = okPayload(applyCardOptions(card, { count: 3 }));
    expect(three.params.count).toBe(3);
    expect(three.estimatedCredits).toBe(quoteFor(three.model, 3));
    expect(three.estimatedCredits).toBeGreaterThan(one);
    // 规格条目跟着重算 —— 卡面说的张数与 params 里的张数不可能分家。
    expect(three.specChips).toContain("3 images");
  });

  it("ENGINE-A3 改形状:卡上落的就是他点的那一格,规格条目跟着改口", () => {
    if (!imageAspectHonoured()) return;
    const card = imageCard();
    const menu = GEN_IMAGE_MODEL_OPTIONS[DEFAULT_IMAGE_MODEL].aspectRatios;
    const target = menu.find((a) => a !== card.params.aspectRatio)!;
    const changed = okPayload(applyCardOptions(card, { aspectRatio: target }));
    expect(changed.params.aspectRatio).toBe(target);
    expect(changed.specChips).toContain(target);
  });

  it("ENGINE-A3 勾精修:卡换到精修那一档,价按**那一档**现算(比默认档贵)", () => {
    if (!isSellableImageSku(PRO_IMAGE_MODEL)) return;
    const card = imageCard();
    const fine = okPayload(applyCardOptions(card, { fineDetail: true }));
    expect(fine.model).toBe(PRO_IMAGE_MODEL);
    expect(fine.fineDetail).toBe(true);
    expect(fine.estimatedCredits).toBe(quoteFor(PRO_IMAGE_MODEL, fine.params.count));
    expect(fine.estimatedCredits).toBeGreaterThan(card.estimatedCredits);
    // 菜单跟着这一档换 —— 界面立刻只给得出这一档收得下的形状。
    expect(fine.options).toEqual(cardOptionMenu(PRO_IMAGE_MODEL));
  });

  it("ENGINE-A3 取消精修:那一格真的从卡上消失,价退回默认档", () => {
    if (!isSellableImageSku(PRO_IMAGE_MODEL)) return;
    const fine = okPayload(applyCardOptions(imageCard(), { fineDetail: true }));
    const plain = okPayload(applyCardOptions(fine, { fineDetail: false }));
    expect(plain.model).toBe(DEFAULT_IMAGE_MODEL);
    expect(plain.fineDetail).toBeUndefined();
    expect(plain.estimatedCredits).toBe(quoteFor(DEFAULT_IMAGE_MODEL, plain.params.count));
  });

  it("ENGINE-A3 三格一起改:价仍只出自那一个函数,按卡上最终那一档与张数", () => {
    if (!isSellableImageSku(PRO_IMAGE_MODEL) || !imageAspectHonoured()) return;
    const target = GEN_IMAGE_MODEL_OPTIONS[PRO_IMAGE_MODEL].aspectRatios[1]!;
    const changed = okPayload(applyCardOptions(imageCard(), { count: 2, aspectRatio: target, fineDetail: true }));
    expect(changed.params).toMatchObject({ count: 2, aspectRatio: target });
    expect(changed.estimatedCredits).toBe(quoteFor(PRO_IMAGE_MODEL, 2));
  });

  it("ENGINE-A3 一格没改 ⇒ 卡上的价一格没动(空改动不许悄悄换一个数)", () => {
    const card = imageCard();
    const same = okPayload(applyCardOptions(card, {}));
    expect(same.estimatedCredits).toBe(card.estimatedCredits);
    expect(same.model).toBe(card.model);
    expect(same.params).toEqual(card.params);
  });

  it("ENGINE-A3 张数夹取到菜单上限:0 / 99 都不会变成一个卡上做不到的数", () => {
    const card = imageCard();
    expect(okPayload(applyCardOptions(card, { count: 0 })).params.count).toBe(1);
    expect(okPayload(applyCardOptions(card, { count: 99 })).params.count).toBe(MAX_GEN_COUNT);
  });
});

describe("ENGINE-A3 改不动的那几种 —— 一律如实拒绝,卡一个字节不动", () => {
  it("ENGINE-A3 精修档收不下的形状 ⇒ 拒绝,绝不静默换一格", () => {
    if (!isSellableImageSku(PRO_IMAGE_MODEL) || !imageAspectHonoured()) return;
    const wide = GEN_IMAGE_MODEL_OPTIONS[DEFAULT_IMAGE_MODEL].aspectRatios.find(
      (a) => !GEN_IMAGE_MODEL_OPTIONS[PRO_IMAGE_MODEL].aspectRatios.includes(a),
    )!;
    const card = okPayload(applyCardOptions(imageCard(), { aspectRatio: wide }));
    const refused = applyCardOptions(card, { fineDetail: true });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toContain(wide);
    // 拒绝那句只说能力名词 —— 一个槽位名都不许出现。
    expect(refused.error).not.toContain(PRO_IMAGE_MODEL);
  });

  it("ENGINE-A3 菜单外的形状 ⇒ 拒绝,并列出这一档真做得到的那几格", () => {
    if (!imageAspectHonoured()) return;
    const refused = applyCardOptions(imageCard(), { aspectRatio: "4:5" });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toContain("4:5");
    expect(refused.error).toContain(GEN_IMAGE_MODEL_OPTIONS[DEFAULT_IMAGE_MODEL].aspectRatios[0]!);
  });

  it("ENGINE-A3 视频卡不在这里改 —— 拒绝,而不是把图片那一套硬套上去", () => {
    const video = buildProposeCard(
      { kind: "video", structuredPrompt: "a slow push-in on the jar", entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    ).cardPayload;
    expect(applyCardOptions(video, { count: 2 }).ok).toBe(false);
  });

  it("ENGINE-A3 认不出档位的老卡 ⇒ 拒绝,而不是替它挑一个槽位", () => {
    const card = { ...imageCard(), model: "retired-image-engine" };
    expect(applyCardOptions(card, { count: 2 }).ok).toBe(false);
  });
});
