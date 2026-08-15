/**
 * #775 判官 r3 P1-2 —— 会话侧的生产接线。
 *
 * r3 之前 `decideVideoAction` 的**措辞分支**(三语 / 含糊 / 错配)在生产里一个调用者都没有:
 * 铸卡侧只喂 `prompt`,会话侧全靠 instructions 让模型自选 mode,选错了没有任何一处会发现。
 *
 * 现在铸视频卡之前多一个证人:商家这一轮自己打的那句话。它**不推翻**模型(模型看得见整段
 * 对话,这里只看得见这一句),但两边指向不同的动作时**停下来问** —— 那正是「批 A 做 B」
 * 唯一可能被逮住的时刻,而且这一刻还没花一分钱。
 */
import { describe, it, expect } from "vitest";
import { buildProposeCard, ProposeRefusal } from "./propose.helpers.js";
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

const promptOf = (mode: "edit" | "extend" | "t2v") =>
  assembleSeedance(
    seedancePromptInput.parse({ mode, shots: [{ subject: "the man", action: "walks out and waves" }] }),
  );

const clipCtx = (turnText?: string) =>
  makeCtx({ referenceVideoGenerationId: "gen_vid", ...(turnText === undefined ? {} : { turnText }) });

const card = (prompt: string, ctx: OttoContext) =>
  buildProposeCard({ kind: "video", structuredPrompt: prompt, entityIds: [], variantSel: {} }, ctx, []);

describe("商家的话与模型选的档对不上 ⇒ 停下来问,一张卡都不铸", () => {
  it("判官指定形状:马来语「sambung」(接下去)+ 模型误选严格编辑 ⇒ 不铸那张编辑卡", () => {
    expect(() => card(promptOf("edit"), clipCtx("sambung klip ni lagi sikit"))).toThrow(ProposeRefusal);
  });

  it("反向也一样:商家说「把衣服改成红色」,模型却写了一条续写 ⇒ 同样停下来", () => {
    expect(() => card(promptOf("extend"), clipCtx("把这条片子的衣服改成红色"))).toThrow(ProposeRefusal);
  });

  it("英文同理", () => {
    expect(() => card(promptOf("edit"), clipCtx("keep it going for a few more seconds"))).toThrow(ProposeRefusal);
  });

  it("停下来那句话说得清缺什么 —— 是给商家看的人话,不带引擎名", () => {
    try {
      card(promptOf("edit"), clipCtx("sambung klip ni lagi sikit"));
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ProposeRefusal);
      const m = (e as Error).message;
      expect(m.length).toBeGreaterThan(0);
      expect(m.toLowerCase()).not.toContain("seedance");
      expect(m.toLowerCase()).not.toContain("editclip");
    }
  });

  // #928 判官 r2 P1-1:模型把提示词写成中性的 t2v/guideFromClip 时,原检查挂在
  // 「cardAction 已经是 editClip/extendClip」的条件里,整条被跳过 —— 商家说「sambung」
  // (续写,现在下架)也照样铸出一张普通视频卡,零意图核验。现在对**所有**带参考片的
  // 视频提案先查商家这句话,不管模型把提示词写成了哪一档。
  it("普通(guideFromClip)提示词 + 商家续写意图 + 参考片 ⇒ 拒绝,零铸卡(#928)", () => {
    expect(() => card(promptOf("t2v"), clipCtx("sambung klip ni lagi sikit"))).toThrow(ProposeRefusal);
  });
});

describe("对得上 / 没有意见 ⇒ 照铸,一个字节都不变", () => {
  // #922:「两边都说续写 ⇒ 照铸」在续写下架期间不成立 —— 两边说得再一致,那件事现在
  // 也做不到。这一条改成断言它停在**下架**上(而不是停在对表上),缺口 B 裁决落地、
  // 名单一删,它会跟着红,提醒把「照铸」改回来。
  it("商家说「sambung」+ 模型也选了续写 ⇒ 续写下架期间照样不铸(#922)", () => {
    expect(() => card(promptOf("extend"), clipCtx("sambung klip ni lagi sikit"))).toThrow(ProposeRefusal);
  });

  it("商家说「改成红色」+ 模型也选了编辑 ⇒ 照铸", () => {
    const { cardPayload } = card(promptOf("edit"), clipCtx("tolong ubah baju jadi merah"));
    expect(cardPayload.kind).toBe("video");
  });

  it("商家那句话没有任何信号 ⇒ 没有第二个证人,模型说了算", () => {
    for (const text of ["", "ok", "这个", "here you go"]) {
      expect(() => card(promptOf("edit"), clipCtx(text))).not.toThrow();
    }
  });

  it("没有 turnText(旧调用 / 别的入口)⇒ 一切照旧,不因为少一个可选字段就拒绝", () => {
    expect(() => card(promptOf("edit"), clipCtx(undefined))).not.toThrow();
  });

  it("图片卡完全不受影响", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {} },
      clipCtx("sambung klip ni"),
      [],
    );
    expect(cardPayload.kind).toBe("image");
  });
});

describe("不拿关键词推翻模型 —— 只在**两边都明确且相反**时才停", () => {
  // #922:这一条原本证「含糊 ⇒ 不拦模型」。续写下架之后,同一句话里那半句要的是一件
  // **关着**的事,而关着不是含糊 —— 照实说一句比静默铸一张剪辑卡诚实。剪辑那一族的
  // 「不拿关键词推翻模型」由下面那条(零信号/无 turnText)与上一组照铸的用例继续守着。
  it("商家一句话里既要改又要接 ⇒ 先说「接下去关着」,不静默当成只要改(#922)", () => {
    expect(() => card(promptOf("edit"), clipCtx("change the ending and keep it going"))).toThrow(ProposeRefusal);
  });

  it("只说要改、一个续写信号都没有 ⇒ 照旧不拦模型", () => {
    expect(() => card(promptOf("edit"), clipCtx("tolong ubah baju jadi merah"))).not.toThrow();
  });
});
