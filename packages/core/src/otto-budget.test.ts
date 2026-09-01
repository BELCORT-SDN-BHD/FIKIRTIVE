import { describe, expect, it } from "vitest";
import {
  oneStepFloorInternal,
  turnBudgetInternal,
  OTTO_MAX_STEPS,
  OTTO_CONVERSATION_TURN_MARGIN,
  OTTO_CONVERSATION_TURN_RESERVE_INTERNAL,
  OTTO_CHAT_MIN_START_INTERNAL,
} from "./otto-budget.js";
import { displayCredits, SIGNUP_GRANT_CREDITS } from "./spend.js";
import { llmPricesFor, OTTO_LLM_MARGIN_DEFAULT } from "./llm-prices.js";

describe("oneStepFloorInternal", () => {
  it("floor math, no 10× display/internal error (Sonnet-ish prices, margin=3)", () => {
    // 12000*15e-6 + 1500*75e-6 = 0.2925 USD; *3 = 0.8775; *100 = 87.75; ceil = 88
    expect(oneStepFloorInternal({ inputPerToken: 15e-6, outputPerToken: 75e-6 }, 3)).toBe(88);
  });

  it("Opus-ish prices, margin=3 — proves not hardcoded", () => {
    // 12000*5e-6 + 1500*25e-6 = 0.06 + 0.0375 = 0.0975; *3 = 0.2925; *100 = 29.25; ceil = 30
    expect(oneStepFloorInternal({ inputPerToken: 5e-6, outputPerToken: 25e-6 }, 3)).toBe(30);
  });

  it("margin=1 sanity (no markup)", () => {
    // 12000*5e-6 + 1500*25e-6 = 0.0975; *1 = 0.0975; *100 = 9.75; ceil = 10
    expect(oneStepFloorInternal({ inputPerToken: 5e-6, outputPerToken: 25e-6 }, 1)).toBe(10);
  });
});

describe("turnBudgetInternal", () => {
  it("turn budget = maxSteps * floor (Sonnet-ish prices, margin=3, maxSteps=10)", () => {
    expect(turnBudgetInternal({ inputPerToken: 15e-6, outputPerToken: 75e-6 }, 3, 10)).toBe(880);
  });
});

// Founder 的第二次裁决(2026-08-18,推翻同日的「聊天免费」):按用量收费 —— API 成本 + 5%。
// 原话:「其实应该看用量,不然之后思考很久或其他的,我们的成本会 cover 不到,可能就 api 成本
// +5% 我们赚的钱这样。」整条规则就是这一个乘数。
describe("OTTO_CONVERSATION_TURN_MARGIN (usage pricing: provider cost + 5%)", () => {
  it("is 1.05 — the provider's API cost plus five percent", () => {
    expect(OTTO_CONVERSATION_TURN_MARGIN).toBe(1.05);
    // 高于 1 才谈得上「我们赚的钱」;低于生成那档才谈得上「对话不是赚钱的地方」。
    expect(OTTO_CONVERSATION_TURN_MARGIN).toBeGreaterThan(1);
    expect(OTTO_CONVERSATION_TURN_MARGIN).toBeLessThan(OTTO_LLM_MARGIN_DEFAULT);
  });

  it("covers cost on ANY turn — a long thinking turn can never be sold below what it cost us", () => {
    // 这正是 Founder 反悔的那一条:一轮想很久的对话,成本没有上限。按用量收费之后,
    // 「收的」永远等于「花的」乘以同一个大于 1 的数,所以不可能 cover 不到。
    for (const model of ["claude-sonnet-4-6", "claude-opus-4-8"] as const) {
      const prices = llmPricesFor(model);
      for (const steps of [1, 3, OTTO_MAX_STEPS]) {
        const charged = turnBudgetInternal(prices, OTTO_CONVERSATION_TURN_MARGIN, steps);
        const cost = turnBudgetInternal(prices, 1, steps);
        expect(charged, `${model} × ${steps}`).toBeGreaterThanOrEqual(cost);
      }
    }
  });

  it("prices the live worst-case turn at 70 internal, which #543's ceiling still caps", () => {
    // 满 10 步、每步吃满上下文与输出上限,现役 sonnet 价:70 内部 credits。
    expect(
      turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), OTTO_CONVERSATION_TURN_MARGIN, OTTO_MAX_STEPS),
    ).toBe(70);
    // 冻结上限仍然咬得住(40 < 70)—— 否则 #543 就成了一句空话。
    expect(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL).toBeLessThan(70);
    expect(oneStepFloorInternal(llmPricesFor("claude-sonnet-4-6"), OTTO_CONVERSATION_TURN_MARGIN)).toBe(7);
  });

  it("the measured beta reply: 2.5 credits at the old 2.0 markup becomes 1.4 at cost + 5%", () => {
    // 那条回复真实的供应商成本是 $0.125(25 内部 ÷ 2.0 ÷ CREDITS_PER_USD)。
    // **2.0 是当时那次测量的历史费率,不是今天的常量**(2026-09-01 起 OTTO_LLM_MARGIN_DEFAULT
    // = 2.06)。这里写字面量而不是读常量:一条「beta 期实测到的回复花了多少」是过去的事实,
    // 它不该因为今天改了费率就变成另一个数 —— 读活常量会让这条历史记录悄悄跟着漂。
    const MEASURED_AT_MARKUP = 2.0;
    const rawUsd = 25 / (MEASURED_AT_MARKUP * 100);
    expect(rawUsd).toBeCloseTo(0.125, 6);
    expect(Math.ceil(rawUsd * OTTO_CONVERSATION_TURN_MARGIN * 100)).toBe(14); // 1.4 显示 credits
  });

  it("leaves GENERATION pricing alone — the generation markup is untouched", () => {
    // 两次裁决动的都只是对话。共用一个 margin 会把每一张图、每一条视频一起重新定价。
    // 生成侧费率自己的值归 llm-prices.test.ts 管(2026-09-01 起 2.06,Founder 研究档裁决);
    // 这里要钉的是**两者不是同一个数** —— 聊天的裁决没有顺手把生成重定价。
    expect(OTTO_CONVERSATION_TURN_MARGIN).not.toBe(OTTO_LLM_MARGIN_DEFAULT);
    expect(OTTO_CONVERSATION_TURN_MARGIN).toBeLessThan(OTTO_LLM_MARGIN_DEFAULT);
  });
});

describe("OTTO_CONVERSATION_TURN_RESERVE_INTERNAL (#543 conversation-turn hold cap)", () => {
  it("is 40 internal credits = 4 displayed credits", () => {
    expect(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL).toBe(40);
    expect(displayCredits(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL)).toBe(4);
  });

  it("caps the 120-internal worst case a live conversation turn used to hold", () => {
    // 这一条量的是**过去**:#543 之前,一轮对话按生成侧费率冻结,最坏 120 内部 credits。
    // 那个 120 是在 **2.0× 的历史费率**下算出来的(sonnet 价、OTTO_MAX_STEPS 步),所以这里
    // 写字面量 —— 和上面那条实测记录同一个道理:历史数字不该跟着今天的费率漂
    // (2026-09-01 起生成侧费率 = 2.06,同一算式会给出 130,而 #543 当年面对的是 120)。
    const MARKUP_AT_543 = 2.0;
    const worstCase = turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), MARKUP_AT_543, OTTO_MAX_STEPS);
    expect(worstCase).toBe(120);
    expect(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL).toBeLessThan(worstCase);
    // 上限对**今天**的费率同样咬得住(费率只会更高 ⇒ 最坏值只会更大)。
    expect(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL).toBeLessThan(
      turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), OTTO_LLM_MARGIN_DEFAULT, OTTO_MAX_STEPS),
    );
  });

  it("stays above the measured single-turn peak (33 internal / 3.3 displayed)", () => {
    expect(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL).toBeGreaterThan(33);
  });

  it("leaves the signup grant able to fund more than one conversation turn", () => {
    // #791-3: cite the grant instead of a copy of it — 250 internal / 40 internal hold = 6
    // concurrent-hold turns (at the pre-#543 hold of 120 it was 1). Reading the constant is
    // the point: the hold and the grant can only be judged against each other.
    expect(
      Math.floor(SIGNUP_GRANT_CREDITS / OTTO_CONVERSATION_TURN_RESERVE_INTERNAL),
    ).toBeGreaterThanOrEqual(5);
  });
});

// #898 (Founder 2026-08-13, formal correction to #543) — the hold stopped being the door.
describe("OTTO_CHAT_MIN_START_INTERNAL (#898 chat entry gate)", () => {
  it("is 10 internal credits = 1 displayed credit", () => {
    expect(OTTO_CHAT_MIN_START_INTERNAL).toBe(10);
    expect(displayCredits(OTTO_CHAT_MIN_START_INTERNAL)).toBe(1);
  });

  it("lets a merchant on 3.9 credits start a message — the case #898 was opened for", () => {
    // The old gate was the hold itself, so 39 internal < 40 internal meant "no". The gate is
    // now the minimum, and the hold shrinks to whatever the balance can cover.
    const balance = 39;
    expect(balance).toBeGreaterThanOrEqual(OTTO_CHAT_MIN_START_INTERNAL);
    expect(balance).toBeLessThan(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
    expect(Math.min(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL, balance)).toBe(39);
  });

  it("is a real floor, not zero — a priced turn must not fall through to free chat", () => {
    // reserveCredits no-ops on cost <= 0: a hold that rounded to nothing would meter nothing.
    expect(OTTO_CHAT_MIN_START_INTERNAL).toBeGreaterThan(0);
    expect(Math.min(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL, OTTO_CHAT_MIN_START_INTERNAL)).toBeGreaterThan(0);
  });

  it("never exceeds the hold ceiling — the gate can only be at or below what is held", () => {
    expect(OTTO_CHAT_MIN_START_INTERNAL).toBeLessThanOrEqual(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
  });

  it("bounds the platform's per-message exposure to the measured peak minus the gate", () => {
    // Worst realistic case: a merchant at exactly the gate sends the cold-cache opening
    // message, measured at 33 internal (#536). The clamp absorbs 33 - 10 = 23 internal
    // (2.3 displayed) — bounded, and recorded on the SETTLE row.
    const MEASURED_PEAK_INTERNAL = 33;
    expect(MEASURED_PEAK_INTERNAL - OTTO_CHAT_MIN_START_INTERNAL).toBeLessThanOrEqual(23);
  });
});
