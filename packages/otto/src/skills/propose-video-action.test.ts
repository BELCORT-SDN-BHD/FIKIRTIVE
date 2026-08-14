/**
 * #775 判官 r1 P1-1 / P1-2 —— 铸卡这一侧的**生产边界**。
 *
 * r1 的洞:动作是 Otto 手上一个**可以漏传**的可选参数,而能力表的 `needs(shape)` 在生产
 * 路径上一个调用者都没有。于是两件事同时成立:「无 clip + editClip」照样铸出一张普通视频卡,
 * 「有 clip 但漏传 videoAction」照样把 16:9 钉上一张严格编辑的卡。
 *
 * r2 的修法是换判据,不是加校验:动作从**真正会送到引擎的那段提示词**里认出来
 * (`structuredPrompt` 是卡上冻结、批准后原样上路的那一段),形状由服务端自己数。
 * 两者都不经过模型的第二次转述,所以「漏传」这个失败模式在结构上不存在了。
 */
import { describe, it, expect } from "vitest";
import { VIDEO_ASPECT_ADAPTIVE, anchoredActionUnavailableReason } from "@fikirtive/core";
import {
  buildProposeCard,
  proposeInput,
  VideoActionUnavailableError,
  ProposeRefusal,
} from "./propose.helpers.js";
import { assembleSeedance, seedancePromptInput } from "./seedance-prompt.helpers.js";
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
  };
}

const clipCtx = () => makeCtx({ referenceVideoGenerationId: "gen_vid" });

/** 与生产一致:提示词由装配层产出,不是手打的字符串。 */
const editPrompt = () =>
  assembleSeedance(
    seedancePromptInput.parse({
      mode: "edit",
      shots: [{ subject: "the shirt on the man", action: "is deep red instead of white" }],
    }),
  );
const extendPrompt = () =>
  assembleSeedance(
    seedancePromptInput.parse({
      mode: "extend",
      shots: [{ subject: "the man", action: "walks out of the shop and waves" }],
    }),
  );
const plainPrompt = () =>
  assembleSeedance(
    seedancePromptInput.parse({ mode: "t2v", shots: [{ subject: "the jar", action: "turns slowly" }] }),
  );

const card = (prompt: string, ctx: OttoContext, over: Record<string, unknown> = {}) =>
  buildProposeCard({ kind: "video", structuredPrompt: prompt, entityIds: [], variantSel: {}, ...over }, ctx, []);

// ---------------------------------------------------------------------------
// P1-2 —— 形状钉板与提示词同源,漏传这个失败模式不存在了
// ---------------------------------------------------------------------------

/**
 * #922:这一组原本对**剪辑与续写两档**各跑一遍。续写在 beta 期间下架(Founder 裁决
 * 2026-08-14)之后,它铸不出卡了,所以这些「卡上会长什么样」的断言对它不再成立 ——
 * 换成下面 `#922` 那一组「一张卡都不铸」的断言,不是把它删掉。剪辑这一档一个字没动,
 * 循环留着不摊平,好让缺口 B 裁决落地时把 `extendPrompt` 加回名单即可。
 */
describe("剪辑:形状跟着商家那条片子,判据来自那段提示词本身", () => {
  for (const [name, prompt] of [["剪辑", editPrompt]] as const) {
    it(`${name}:商家点了 16:9 也不送 16:9,卡上落 adaptive —— 没有任何一个可以漏传的声明`, () => {
      const { cardPayload } = card(prompt(), clipCtx(), { desiredAspect: "16:9" });
      expect(cardPayload.params.aspectRatio).toBe(VIDEO_ASPECT_ADAPTIVE);
    });

    it(`${name}:换掉的形状必须说出来,不许静默降级`, () => {
      const { cardPayload } = card(prompt(), clipCtx(), { desiredAspect: "16:9" });
      expect(cardPayload.downgraded).toBe(true);
      expect(cardPayload.downgradeNote).toContain("16:9");
    });

    it(`${name}:商家没点形状 → 照样 adaptive,而且不算降级`, () => {
      const { cardPayload } = card(prompt(), clipCtx());
      expect(cardPayload.params.aspectRatio).toBe(VIDEO_ASPECT_ADAPTIVE);
      expect(cardPayload.downgraded).toBe(false);
    });

    it(`${name}:商家在批准之前就读到形状跟着他的片子走(双面里的商家面)`, () => {
      const { cardPayload } = card(prompt(), clipCtx());
      expect(cardPayload.specChips).toContain("Same shape as your reference");
      for (const chip of cardPayload.specChips) expect(chip.toLowerCase()).not.toContain("seedance");
    });

    it(`${name}:钱一格没动 —— 仍是整段参考片那一档的固定价与固定 5 秒`, () => {
      const { cardPayload, shownPriceDisplay } = card(prompt(), clipCtx());
      expect(cardPayload.estimatedCredits).toBe(16);
      expect(shownPriceDisplay).toBe(16);
      expect(cardPayload.params.durationSeconds).toBe(5);
      expect((cardPayload as Record<string, unknown>)["referenceVideoGenerationId"]).toBe("gen_vid");
    });
  }

  it("挂了片子、提示词没有官方开头 ⇒ 确定语义:照着做一条新的,形状照旧是商家选的", () => {
    const { cardPayload } = card(plainPrompt(), clipCtx(), { desiredAspect: "16:9" });
    expect(cardPayload.params.aspectRatio).toBe("16:9");
    expect(cardPayload.downgraded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P1-1 —— 形状撑不起这个动作时,一张卡都不铸(fail closed)
// ---------------------------------------------------------------------------

describe("形状撑不起这个动作 ⇒ 一张卡都不铸", () => {
  it("严格编辑的提示词、手上一条片子都没有 ⇒ 抛拒绝,**不**铸一张普通视频卡", () => {
    expect(() => card(editPrompt(), makeCtx())).toThrow(VideoActionUnavailableError);
  });

  it("续写的提示词、手上一条片子都没有 ⇒ 同样拒绝", () => {
    expect(() => card(extendPrompt(), makeCtx())).toThrow(VideoActionUnavailableError);
  });

  it("挂的是一张图(首帧)而不是片子 ⇒ 剪辑同样不成立", () => {
    expect(() => card(editPrompt(), makeCtx({ sourceGenerationId: "gen_img" }))).toThrow(
      VideoActionUnavailableError,
    );
  });

  it("拒绝是入口接得住的那一类,和「引擎被关掉」同一族 —— 不会变成一个没人接的崩溃", () => {
    try {
      card(editPrompt(), makeCtx());
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ProposeRefusal);
      // 给商家看的那句话:说清缺什么、怎么办;不带引擎名。
      expect((e as Error).message.toLowerCase()).toContain("clip");
      expect((e as Error).message.toLowerCase()).not.toContain("seedance");
    }
  });

  it("图片卡不受影响 —— 这条闸只看视频", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: editPrompt(), entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    );
    expect(cardPayload.kind).toBe("image");
  });
});

// ---------------------------------------------------------------------------
// 契约
// ---------------------------------------------------------------------------

describe("proposeInput 契约", () => {
  it("老调用一个字不用改", () => {
    expect(proposeInput.safeParse({ kind: "video", structuredPrompt: "x" }).success).toBe(true);
  });

  it("没有 videoAction 这个旁路参数了 —— 传了也不会被采信", () => {
    const parsed = proposeInput.parse({ kind: "video", structuredPrompt: "x", videoAction: "editClip" });
    expect((parsed as Record<string, unknown>)["videoAction"]).toBeUndefined();
  });

  it("一条没有官方开头的普通视频卡照旧,一个字节都没变", () => {
    const { cardPayload } = card(plainPrompt(), makeCtx(), { desiredAspect: "9:16" });
    expect(cardPayload.params.aspectRatio).toBe("9:16");
    expect(cardPayload.kind).toBe("video");
  });
});

// ---------------------------------------------------------------------------
// #922 —— 续写在 beta 期间下架:铸卡这一侧一张卡都不铸
// ---------------------------------------------------------------------------

/**
 * Founder 裁决(2026-08-14,部署窗口现场):beta 期间下架续写的两面入口,剪辑保留。
 * 恢复条件是缺口 B(时长/定价)裁决落地 —— 到时候删掉 core 下架名单里那一行,这一组
 * 会跟着红,提醒把上面那些「卡上会长什么样」的断言加回续写。
 *
 * 这一层是**主闸**:Otto 提案与商家手动入口走的都是这一个铸卡器,所以挡在这里 =
 * 两面同时挡住,而且挡在**花钱之前**(拒绝时一张 GEN_CARD 都不落库)。
 */
describe("#922:续写下架 ⇒ 铸卡侧当场拒(剪辑照铸)", () => {
  it("续写的提示词 + 真的挂着片子(形状完全成立)⇒ 仍然一张卡都不铸", () => {
    expect(() => card(extendPrompt(), clipCtx())).toThrow(VideoActionUnavailableError);
  });

  it("同一形状的剪辑照铸 —— 下架的是那一个动作,不是这条路", () => {
    expect(card(editPrompt(), clipCtx()).cardPayload.kind).toBe("video");
  });

  it("拒绝带的是给商家看的那句人话,而且与两面共用同一份(core 的下架名单)", () => {
    try {
      card(extendPrompt(), clipCtx());
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ProposeRefusal);
      expect((e as Error).message).toBe(anchoredActionUnavailableReason("extendClip"));
      expect((e as Error).message.toLowerCase()).not.toContain("seedance");
    }
  });

  it("商家的话指着续写、模型却写了剪辑 ⇒ 也停下来照实说,不静默铸成剪辑卡", () => {
    // #775 判官 r3 P1-2 的第二个证人。续写下架后它不能失效:失效了,商家说「sambung」
    // 而模型写了严格编辑,系统会一声不响地改他的原件。
    expect(() =>
      card(editPrompt(), makeCtx({ referenceVideoGenerationId: "gen_vid", turnText: "sambung klip ni lagi sikit" })),
    ).toThrow(VideoActionUnavailableError);
  });
});
