/**
 * ENGINE-A6 — 长对话摘要与预算闸的**行为测试**（规格 `docs/specs/otto-engine.md` §7.2④ 第四刀）。
 *
 * 验收行的原话：「商家进行长对话（历史超过预算）→ 旧轮被摘要收拢、对话继续；新一轮成本不随
 * 历史无限上涨」。这里跑的是一整条 15 轮的对话，每一轮都走真的 `runOttoTurn` → 真的
 * `withLlmBudget` → 被 mock 的账本，于是「预扣」和「实结」是**账本上真的两个数**，不是估算：
 *
 *  1. 每一轮的历史照入口的做法裁到预算以内（成对感知），被裁掉的旧轮折进滚动摘要；
 *  2. 预扣（`reserveCreditsUpTo` 的 capInternal）逐轮相同 —— 它本来就与历史无关，钉住它是为了
 *     让「有人把历史接进预扣」这类改动当场变红；
 *  3. 实结（`settleCredits` 的 actualInternal）在越过预算之后**停止上涨**：后半段每一轮都
 *     ≤ 刚越过预算那一轮，而同一段对话在没有闸的对照组里是**单调上涨**的。
 *
 * 对照组是这份测试的骨头：只断言「装了闸之后不涨」，一个把模型换成常量用量的改动也能让它变绿。
 */
process.env.OPENAI_AGENTS_DISABLE_TRACING = "1";

import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const reserveCredits = vi.fn();
  const reserveCreditsUpTo = vi.fn();
  const reserveChatTurnWithSearchSlots = vi.fn();
  const settleCredits = vi.fn();
  const refundReservation = vi.fn();
  const assertWithinSpendCap = vi.fn();
  const $transaction = vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({}));
  return {
    reserveCredits,
    reserveCreditsUpTo,
    reserveChatTurnWithSearchSlots,
    settleCredits,
    refundReservation,
    assertWithinSpendCap,
    $transaction,
  };
});

vi.mock("@fikirtive/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/db")>()),
  prisma: { $transaction: mocks.$transaction },
  reserveCredits: mocks.reserveCredits,
  reserveCreditsUpTo: mocks.reserveCreditsUpTo,
  reserveChatTurnWithSearchSlots: mocks.reserveChatTurnWithSearchSlots,
  settleCredits: mocks.settleCredits,
  refundReservation: mocks.refundReservation,
  assertWithinSpendCap: mocks.assertWithinSpendCap,
}));

import { Usage } from "@openai/agents";
import type { AgentInputItem, Model, ModelRequest, ModelResponse, StreamEvent } from "@openai/agents";
import { llmPricesFor, OTTO_CONVERSATION_TURN_MARGIN, OTTO_CONVERSATION_TURN_RESERVE_INTERNAL, type LlmPrices } from "@fikirtive/core";
import { createOttoRuntime, runOttoTurn, type OttoModelRuntime, type OttoRollingSummaryPort } from "./runtime.js";
import { actualCostInternal, mapOttoUsage } from "./meter.js";
import {
  sanitizeHistory,
  trimHistoryToBudget,
  rollingSummaryBlock,
  estimateHistoryTokens,
  estimateTextTokens,
  OTTO_HISTORY_BUDGET_TOKENS,
} from "./run-input.js";
import type { OttoContext } from "./context.js";

const baseCtx: OttoContext = {
  orgId: "org_a6",
  userId: "org_a6",
  projectId: "proj_a6",
  threadId: "thread_a6",
  disabledModels: [],
  sourceGenerationId: null,
};

/** A PAID manifest — the whole point is to read the ledger's two numbers. */
function paidModelRuntime(binding: Model): OttoModelRuntime {
  return Object.freeze({
    binding,
    billableModelId: "claude-sonnet-4-6",
    resolvedModelPolicy: Object.freeze({ primaryModelId: "claude-sonnet-4-6", fallbackModelId: null, failover: "none" as const }),
    mapUsage: mapOttoUsage,
    cacheCapabilities: Object.freeze({ promptCache: false }),
    pricing: () => llmPricesFor("claude-sonnet-4-6"),
  });
}

/** One assistant reply of REPLY_CHARS characters — big enough that a thread grows fast. */
const REPLY_CHARS = 6_000;
const USER_CHARS = 6_000;

/**
 * 判官落修 A6-P0-1 —— 夹具 Model 也要像真 provider 一样**挑剔请求形状**。
 *
 * 上一版这份夹具什么都收，于是「裁剪切在 assistant 上」这件事在 15 轮里每一轮都发生、
 * 每一轮都是绿的。真 provider 不这么宽容：Anthropic 的 Messages API 明写 messages[0] 必须是
 * user（`system` 那一条由 ai-sdk 适配器提到 `system` 参数，不进 messages），所以入口装配出来的
 * `[system?, ...kept, userTurn]` 里，`kept[0]` 就是 `messages[0]`。
 *
 * 拆掉 `trimHistoryToBudget` 里那条「切点必须是 user」的谓词，这个断言当场红 —— 这正是今天
 * 缺的那一次变异。折叠那一次调用喂进去的是一个字符串 prompt，直接放行。
 */
function assertProviderMessageShape(request: ModelRequest): void {
  const input = request.input;
  if (typeof input === "string") return;
  const messages = (input as AgentInputItem[]).filter((i) => (i as { role?: string }).role !== "system");
  const first = messages[0] as { role?: string } | undefined;
  if (first && first.role !== "user") {
    throw new Error(`provider would reject this request: messages[0] must be user, got ${String(first.role)}`);
  }
}

/**
 * A model whose USAGE IS A FUNCTION OF ITS INPUT — the causal chain ENGINE-A6 is about.
 * A constant-usage double would make the plateau a tautology.
 */
function usageTracksInputModel(): Model {
  const answer = "r".repeat(REPLY_CHARS);
  const response = (request: ModelRequest): ModelResponse => {
    const inputTokens = typeof request.input === "string"
      ? estimateTextTokens(request.input)
      : estimateHistoryTokens(request.input as AgentInputItem[]);
    const outputTokens = estimateTextTokens(answer);
    return {
      usage: new Usage({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }),
      output: [
        {
          type: "message" as const,
          role: "assistant" as const,
          status: "completed" as const,
          content: [{ type: "output_text" as const, text: answer }],
        },
      ],
    };
  };
  return {
    async getResponse(request: ModelRequest): Promise<ModelResponse> {
      assertProviderMessageShape(request);
      return response(request);
    },
    async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
      assertProviderMessageShape(request);
      const resp = response(request);
      yield {
        type: "response_done",
        response: { id: "fake-resp", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, output: resp.output },
      } as StreamEvent;
    },
  };
}

type TurnLedger = { holdCap: number; settled: number };

/**
 * Drive `turns` turns of ONE conversation the way the entries do: rehydrated history →
 * sanitize → (optionally) trim to budget → [system, ...kept, userTurn] → runOttoTurn.
 * Returns the ledger numbers per turn.
 */
async function runConversation(opts: { turns: number; gate: boolean }): Promise<TurnLedger[]> {
  const runtime = createOttoRuntime(
    { modelRuntime: paidModelRuntime(usageTracksInputModel()), skills: [] },
    "interactive",
  );
  let history: AgentInputItem[] = [];
  let summary: string | null = null;
  const ledger: TurnLedger[] = [];

  for (let turn = 1; turn <= opts.turns; turn++) {
    mocks.reserveCreditsUpTo.mockClear();
    mocks.settleCredits.mockClear();

    const userTurn = { role: "user", content: `q${turn} ${"u".repeat(USER_CHARS)}` } as unknown as AgentInputItem;
    const summaryBlock = rollingSummaryBlock(summary);
    const sys = ({ role: "system", content: summaryBlock ?? "brand context" }) as unknown as AgentInputItem;

    const clean = sanitizeHistory(history);
    const { kept, dropped } = opts.gate
      ? trimHistoryToBudget(clean)
      : { kept: clean, dropped: [] as AgentInputItem[] };
    const rollingSummary: OttoRollingSummaryPort | undefined =
      dropped.length > 0
        ? { dropped, priorSummary: summary, save: (s) => { summary = s; } }
        : undefined;

    const input = [sys, ...kept, userTurn];
    await runOttoTurn(
      { orgId: "org_a6", refId: `otto-turn:msg_${turn}`, input, rollingSummary },
      baseCtx,
      runtime,
    );

    // The next turn rehydrates what this turn produced — the same round-trip ottoState does
    // (sanitizeHistory drops the system message again on the way back in).
    history = [...input, { role: "assistant", content: "r".repeat(REPLY_CHARS) } as unknown as AgentInputItem];

    ledger.push({
      holdCap: mocks.reserveCreditsUpTo.mock.calls[0]?.[1]?.capInternal ?? -1,
      settled: mocks.settleCredits.mock.calls[0]?.[1]?.actualInternal ?? -1,
    });
  }
  return ledger;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb({}));
  mocks.reserveCredits.mockResolvedValue(undefined);
  mocks.reserveCreditsUpTo.mockResolvedValue(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
  mocks.settleCredits.mockResolvedValue(undefined);
  mocks.refundReservation.mockResolvedValue(undefined);
});

describe("ENGINE-A6 — 长对话：旧轮被摘要收拢，新一轮成本不随历史上涨", () => {
  it("ENGINE-A6: 连续 15 轮之后，预扣逐轮不变、实结越过预算后停止上涨（对照组单调上涨）", async () => {
    const TURNS = 15;
    const gated = await runConversation({ turns: TURNS, gate: true });
    const ungated = await runConversation({ turns: TURNS, gate: false });

    // ── 预扣:与历史无关的一个常数(#543 的 cap)。有人把历史接进预扣,这一行当场红。
    for (const t of gated) expect(t.holdCap).toBe(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);

    // ── 对照组:没有闸,实结**每一轮都比上一轮贵** —— 这就是 ENGINE-A6 要消灭的那件事。
    for (let i = 1; i < TURNS; i++) {
      expect(ungated[i]!.settled).toBeGreaterThan(ungated[i - 1]!.settled);
    }

    // ── 装了闸:头几轮还没超预算,照涨(那是对的);越过之后停住,此后**再也不涨**。
    const plateauFrom = gated.findIndex((t, i) => i > 0 && t.settled <= gated[i - 1]!.settled);
    expect(plateauFrom).toBeGreaterThan(0);
    const plateau = gated[plateauFrom]!.settled;
    for (const t of gated.slice(plateauFrom)) expect(t.settled).toBeLessThanOrEqual(plateau);
    expect(gated[TURNS - 1]!.settled).toBeLessThanOrEqual(plateau);
    // 同一段对话,第 N+1 轮装了闸比没装便宜。
    expect(gated[TURNS - 1]!.settled).toBeLessThan(ungated[TURNS - 1]!.settled);
  }, 60_000);

  it("ENGINE-A6: 被裁掉的旧轮折进摘要并落盘,下一轮回注在新鲜 system 消息上", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: paidModelRuntime(usageTracksInputModel()), skills: [] },
      "interactive",
    );
    const saved: string[] = [];
    const history = Array.from({ length: 12 }, (_, i) =>
      ({ role: i % 2 ? "assistant" : "user", content: `t${i} ${"h".repeat(6_000)}` }) as unknown as AgentInputItem,
    );
    const { kept, dropped } = trimHistoryToBudget(sanitizeHistory(history));
    expect(dropped.length).toBeGreaterThan(0);
    expect(estimateHistoryTokens(kept)).toBeLessThanOrEqual(OTTO_HISTORY_BUDGET_TOKENS);
    // 判官落修 A6-P0-1：裁过的历史必须以 user 打头，否则它就是 provider 的非法 messages[0]。
    expect((kept[0] as { role?: string }).role).toBe("user");

    await runOttoTurn(
      {
        orgId: "org_a6",
        refId: "otto-turn:msg_fold",
        input: [...kept, { role: "user", content: "next" } as unknown as AgentInputItem],
        rollingSummary: { dropped, priorSummary: null, save: (s) => { saved.push(s); } },
      },
      baseCtx,
      runtime,
    );

    expect(saved).toHaveLength(1);
    expect(saved[0]!.length).toBeGreaterThan(0);
    // 回注:摘要随每轮那条新鲜 system 消息前置。
    const block = rollingSummaryBlock(saved[0]!);
    expect(block).toContain(saved[0]!);
  }, 60_000);

  it("ENGINE-A6: 折叠跑在 manifest 声明的 summaryBinding 上,不是主轮那个绑定", async () => {
    // §7.2④「摘要本身是一次便宜的小调用」——「折叠用哪个型号」必须是 manifest 上的一个决定
    // (model.ts 的 OTTO_SUMMARY_MODEL),不是 foldRollingSummary 里写死的一行。这条钉的是那根线。
    const mainCalls: ModelRequest[] = [];
    const summaryCalls: ModelRequest[] = [];
    const recording = (log: ModelRequest[]): Model => {
      const inner = usageTracksInputModel();
      return {
        async getResponse(request: ModelRequest): Promise<ModelResponse> {
          log.push(request);
          return inner.getResponse(request);
        },
        getStreamedResponse: inner.getStreamedResponse.bind(inner),
      };
    };
    const runtime = createOttoRuntime(
      {
        modelRuntime: Object.freeze({
          ...paidModelRuntime(recording(mainCalls)),
          summaryBinding: recording(summaryCalls),
        }),
        skills: [],
      },
      "interactive",
    );
    const history = Array.from({ length: 12 }, (_, i) =>
      ({ role: i % 2 ? "assistant" : "user", content: `t${i} ${"h".repeat(6_000)}` }) as unknown as AgentInputItem,
    );
    const { kept, dropped } = trimHistoryToBudget(sanitizeHistory(history));
    expect(dropped.length).toBeGreaterThan(0);

    await runOttoTurn(
      {
        orgId: "org_a6",
        refId: "otto-turn:msg_summary_binding",
        input: [...kept, { role: "user", content: "next" } as unknown as AgentInputItem],
        rollingSummary: { dropped, priorSummary: null, save: () => {} },
      },
      baseCtx,
      runtime,
    );

    // 折叠那次调用落在 summaryBinding 上,主轮那次落在主绑定上 —— 两边各一次,不串。
    expect(summaryCalls).toHaveLength(1);
    expect(mainCalls).toHaveLength(1);
    expect(summaryCalls[0]!.systemInstructions).toContain("compress the older part of one conversation");
  }, 60_000);

  it("ENGINE-A6: 没有裁掉任何东西的一轮不折叠、不写摘要、不多花一次调用", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: paidModelRuntime(usageTracksInputModel()), skills: [] },
      "interactive",
    );
    const saved: string[] = [];
    const short = [{ role: "user", content: "hi" } as unknown as AgentInputItem];
    const { kept, dropped } = trimHistoryToBudget(sanitizeHistory(short));
    expect(dropped).toEqual([]);

    await runOttoTurn(
      {
        orgId: "org_a6",
        refId: "otto-turn:msg_short",
        input: [...kept, { role: "user", content: "next" } as unknown as AgentInputItem],
        rollingSummary: { dropped, priorSummary: null, save: (s) => { saved.push(s); } },
      },
      baseCtx,
      runtime,
    );
    expect(saved).toEqual([]);
  });

  it("ENGINE-A6: 摘要那次调用不新开钱路 —— 全程只有一次 reserve、一次 settle,同一个 refId", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: paidModelRuntime(usageTracksInputModel()), skills: [] },
      "interactive",
    );
    const history = Array.from({ length: 12 }, (_, i) =>
      ({ role: i % 2 ? "assistant" : "user", content: `t${i} ${"h".repeat(6_000)}` }) as unknown as AgentInputItem,
    );
    const { kept, dropped } = trimHistoryToBudget(sanitizeHistory(history));

    await runOttoTurn(
      {
        orgId: "org_a6",
        refId: "otto-turn:msg_money",
        input: [...kept, { role: "user", content: "next" } as unknown as AgentInputItem],
        rollingSummary: { dropped, priorSummary: null, save: () => {} },
      },
      baseCtx,
      runtime,
    );

    expect(mocks.reserveCreditsUpTo).toHaveBeenCalledTimes(1);
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    expect(mocks.settleCredits).toHaveBeenCalledTimes(1);
    expect(mocks.refundReservation).not.toHaveBeenCalled();
    expect(mocks.reserveCreditsUpTo.mock.calls[0]![1].refId).toBe("otto-turn:msg_money");
    expect(mocks.settleCredits.mock.calls[0]![1].refId).toBe("otto-turn:msg_money");
  }, 60_000);

  it("ENGINE-A6: 摘要那次调用的 token 计入本轮实结（不是白烧的一笔）", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: paidModelRuntime(usageTracksInputModel()), skills: [] },
      "interactive",
    );
    const history = Array.from({ length: 12 }, (_, i) =>
      ({ role: i % 2 ? "assistant" : "user", content: `t${i} ${"h".repeat(6_000)}` }) as unknown as AgentInputItem,
    );
    const { kept, dropped } = trimHistoryToBudget(sanitizeHistory(history));
    const input = [...kept, { role: "user", content: "next" } as unknown as AgentInputItem];

    mocks.settleCredits.mockClear();
    await runOttoTurn(
      { orgId: "org_a6", refId: "otto-turn:with_fold", input, rollingSummary: { dropped, priorSummary: null, save: () => {} } },
      baseCtx,
      runtime,
    );
    const withFold = mocks.settleCredits.mock.calls[0]![1].actualInternal as number;

    mocks.settleCredits.mockClear();
    await runOttoTurn({ orgId: "org_a6", refId: "otto-turn:no_fold", input }, baseCtx, runtime);
    const withoutFold = mocks.settleCredits.mock.calls[0]![1].actualInternal as number;

    expect(withFold).toBeGreaterThan(withoutFold);
  }, 60_000);

  /**
   * Founder 2026-09-05 裁决④ —— 「折叠摘要换 Haiku,按 Haiku 实价计入商家账单」。
   *
   * 这一族用**账本上真的那一个数**判:主腿按 Sonnet 价、折叠腿按 Haiku 价,本轮实结逐分等于
   * 两腿之和。用量是常数(夹具直接给),所以期望值是当场算得出来的一个整数,不是「大于/小于」。
   */
  describe("裁决④ — 折叠腿按 Haiku 实价单独计价", () => {
    const HAIKU = "claude-haiku-4-5-20251001";
    const SONNET = "claude-sonnet-4-6";
    const MAIN_USAGE = { inputTokens: 30_000, outputTokens: 2_000 };
    const FOLD_USAGE = { inputTokens: 24_000, outputTokens: 400 };

    /** 折叠那一次调用与主轮那一次各给一份**固定且不同**的用量,于是两腿各自的钱是可算的。 */
    function fixedUsageModel(): Model {
      const reply = (text: string, u: { inputTokens: number; outputTokens: number }): ModelResponse => ({
        usage: new Usage({ ...u, totalTokens: u.inputTokens + u.outputTokens }),
        output: [
          {
            type: "message" as const,
            role: "assistant" as const,
            status: "completed" as const,
            content: [{ type: "output_text" as const, text }],
          },
        ],
      });
      const isFold = (request: ModelRequest): boolean =>
        String(request.systemInstructions ?? "").startsWith("You compress");
      return {
        async getResponse(request: ModelRequest): Promise<ModelResponse> {
          return isFold(request) ? reply("folded notes", FOLD_USAGE) : reply("answer", MAIN_USAGE);
        },
        async *getStreamedResponse(): AsyncIterable<StreamEvent> {
          yield { type: "response_done", response: { id: "x", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, output: [] } } as StreamEvent;
        },
      };
    }

    /** 生产 manifest 的形状:`pricing` 照**型号 id**查价,折叠腿声明自己的计价型号。 */
    function haikuFoldRuntime(summaryBillableModelId: string | undefined) {
      const binding = fixedUsageModel();
      return createOttoRuntime(
        {
          modelRuntime: Object.freeze({
            binding,
            summaryBinding: binding,
            summaryBillableModelId,
            billableModelId: SONNET,
            resolvedModelPolicy: Object.freeze({ primaryModelId: SONNET, fallbackModelId: null, failover: "none" as const }),
            mapUsage: mapOttoUsage,
            cacheCapabilities: Object.freeze({ promptCache: false }),
            pricing: (id: string) => llmPricesFor(id),
          }) satisfies OttoModelRuntime,
          skills: [],
        },
        "interactive",
      );
    }

    const foldingTurn = (refId: string) => {
      const history = Array.from({ length: 12 }, (_, i) =>
        ({ role: i % 2 ? "assistant" : "user", content: `t${i} ${"h".repeat(6_000)}` }) as unknown as AgentInputItem,
      );
      const { kept, dropped } = trimHistoryToBudget(sanitizeHistory(history));
      return {
        orgId: "org_a6",
        refId,
        input: [...kept, { role: "user", content: "next" } as unknown as AgentInputItem],
        rollingSummary: { dropped, priorSummary: null, save: () => {} },
      };
    };

    const settledOnce = (): number => {
      expect(mocks.settleCredits).toHaveBeenCalledTimes(1);
      return mocks.settleCredits.mock.calls[0]![1].actualInternal as number;
    };

    it("ENGINE-A6: 带折叠的一轮 = 主腿按 Sonnet 价 + 折叠腿按 Haiku 价（变异：折叠腿按 Sonnet 价必红）", async () => {
      const runtime = haikuFoldRuntime(HAIKU);
      mocks.settleCredits.mockClear();
      await runOttoTurn(foldingTurn("otto-turn:haiku_fold"), baseCtx, runtime);
      const settled = settledOnce();

      const margin = OTTO_CONVERSATION_TURN_MARGIN;
      const mainLeg = actualCostInternal(MAIN_USAGE, llmPricesFor(SONNET), margin);
      const foldLegHaiku = actualCostInternal(FOLD_USAGE, llmPricesFor(HAIKU), margin);
      expect(settled).toBe(mainLeg + foldLegHaiku);

      // 变异守卫:把折叠腿按 Sonnet 价收(裁决④之前的行为)是一个**不同的数**,所以上面那一行
      // 不可能对两种实现都绿。
      const foldLegSonnet = actualCostInternal(FOLD_USAGE, llmPricesFor(SONNET), margin);
      expect(foldLegSonnet).toBeGreaterThan(foldLegHaiku);
      expect(settled).not.toBe(mainLeg + foldLegSonnet);
    }, 60_000);

    it("ENGINE-A6: 没有折叠的一轮实结不变 —— 只有主腿那一份（回归）", async () => {
      const runtime = haikuFoldRuntime(HAIKU);
      mocks.settleCredits.mockClear();
      await runOttoTurn(
        {
          orgId: "org_a6",
          refId: "otto-turn:haiku_no_fold",
          input: [{ role: "user", content: "next" } as unknown as AgentInputItem],
        },
        baseCtx,
        runtime,
      );
      expect(settledOnce()).toBe(
        actualCostInternal(MAIN_USAGE, llmPricesFor(SONNET), OTTO_CONVERSATION_TURN_MARGIN),
      );
    }, 60_000);

    it("ENGINE-A6: manifest 不声明折叠计价型号时,折叠腿回落到主型号价（夹具与 CLI 不受影响）", async () => {
      const runtime = haikuFoldRuntime(undefined);
      mocks.settleCredits.mockClear();
      await runOttoTurn(foldingTurn("otto-turn:haiku_fallback"), baseCtx, runtime);
      const margin = OTTO_CONVERSATION_TURN_MARGIN;
      expect(settledOnce()).toBe(
        actualCostInternal(MAIN_USAGE, llmPricesFor(SONNET), margin) +
          actualCostInternal(FOLD_USAGE, llmPricesFor(SONNET), margin),
      );
    }, 60_000);

    /**
     * 判官 P2-1 —— `legPricesOf` 的**登记价地板**从前零测试。
     *
     * manifest 是唯一计价源(PH1-A1),但一份把折叠型号报得**比登记价便宜**的 manifest 不能少收:
     * `meter.ts` 的 `legPricesOf` 逐字段取大者,所以折叠腿仍按登记表那份 Haiku 价结算。
     * 变异实证:把 `legPricesOf` 首行改成 `return leg.prices;`,这条当场红。
     */
    it("ENGINE-A6: manifest 把折叠型号报得比登记价便宜时,折叠腿仍按登记价结算（地板守卫）", async () => {
      const cheap = (id: string): LlmPrices => {
        const registry = llmPricesFor(id);
        if (id !== HAIKU) return registry;
        return {
          inputPerToken: registry.inputPerToken / 4,
          outputPerToken: registry.outputPerToken / 4,
          cachedInputPerToken: registry.cachedInputPerToken / 4,
          cacheWriteInputPerToken: registry.cacheWriteInputPerToken / 4,
        };
      };
      const binding = fixedUsageModel();
      const runtime = createOttoRuntime(
        {
          modelRuntime: Object.freeze({
            binding,
            summaryBinding: binding,
            summaryBillableModelId: HAIKU,
            billableModelId: SONNET,
            resolvedModelPolicy: Object.freeze({ primaryModelId: SONNET, fallbackModelId: null, failover: "none" as const }),
            mapUsage: mapOttoUsage,
            cacheCapabilities: Object.freeze({ promptCache: false }),
            pricing: cheap,
          }) satisfies OttoModelRuntime,
          skills: [],
        },
        "interactive",
      );

      mocks.settleCredits.mockClear();
      await runOttoTurn(foldingTurn("otto-turn:haiku_floor"), baseCtx, runtime);
      const settled = settledOnce();

      const margin = OTTO_CONVERSATION_TURN_MARGIN;
      const mainLeg = actualCostInternal(MAIN_USAGE, llmPricesFor(SONNET), margin);
      const foldAtRegistry = actualCostInternal(FOLD_USAGE, llmPricesFor(HAIKU), margin);
      const foldAtManifest = actualCostInternal(FOLD_USAGE, cheap(HAIKU), margin);

      // 两个数确实不同 —— 否则下面那一行对两种实现都绿,等于没测。
      expect(foldAtManifest).toBeLessThan(foldAtRegistry);
      expect(settled).toBe(mainLeg + foldAtRegistry);
      expect(settled).not.toBe(mainLeg + foldAtManifest);
    }, 60_000);

    it("ENGINE-A6: 折叠腿不新开钱路 —— 同一轮重放,两次都只用同一个幂等键,金额逐分相同", async () => {
      const runtime = haikuFoldRuntime(HAIKU);
      const refId = "otto-turn:haiku_replay";

      mocks.reserveCreditsUpTo.mockClear();
      mocks.settleCredits.mockClear();
      await runOttoTurn(foldingTurn(refId), baseCtx, runtime);
      const first = settledOnce();
      expect(mocks.reserveCreditsUpTo).toHaveBeenCalledTimes(1);
      expect(mocks.reserveCreditsUpTo.mock.calls[0]![1].refId).toBe(refId);
      expect(mocks.settleCredits.mock.calls[0]![1].refId).toBe(refId);

      mocks.reserveCreditsUpTo.mockClear();
      mocks.settleCredits.mockClear();
      await runOttoTurn(foldingTurn(refId), baseCtx, runtime);
      // 重放走的是**同一个** refId:账本侧 `reserve:<refId>` 的唯一约束把第二次变成空操作
      // (那一层的证明在 @fikirtive/db 自己的测试里;这里 prisma 是 mock,能证的是「键没变」)。
      // 折叠腿没有把这一点改掉 —— 它既没有第二次 reserve,也没有第二个 refId。
      expect(mocks.reserveCreditsUpTo).toHaveBeenCalledTimes(1);
      expect(mocks.reserveCreditsUpTo.mock.calls[0]![1].refId).toBe(refId);
      expect(mocks.reserveCredits).not.toHaveBeenCalled();
      expect(settledOnce()).toBe(first);
      expect(mocks.settleCredits.mock.calls[0]![1].refId).toBe(refId);
    }, 60_000);
  });

  it("ENGINE-A6: 摘要调用抛错不拖垮商家这一轮（历史照裁、摘要不变、turn 照常返回）", async () => {
    const exploding: Model = {
      async getResponse(request: ModelRequest): Promise<ModelResponse> {
        // 折叠那一次调用没有工具;主轮的 agent 带的是 ottoInstructions。
        if (String(request.systemInstructions ?? "").startsWith("You compress")) {
          throw new Error("summarizer is down");
        }
        return {
          usage: new Usage({ inputTokens: 10, outputTokens: 10, totalTokens: 20 }),
          output: [
            { type: "message" as const, role: "assistant" as const, status: "completed" as const, content: [{ type: "output_text" as const, text: "ok" }] },
          ],
        };
      },
      async *getStreamedResponse(): AsyncIterable<StreamEvent> {
        yield { type: "response_done", response: { id: "x", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, output: [] } } as StreamEvent;
      },
    };
    const runtime = createOttoRuntime({ modelRuntime: paidModelRuntime(exploding), skills: [] }, "interactive");
    const saved: string[] = [];
    const dropped = [{ role: "user", content: "old turn" } as unknown as AgentInputItem];

    const result = await runOttoTurn(
      {
        orgId: "org_a6",
        refId: "otto-turn:fold_boom",
        input: [{ role: "user", content: "next" } as unknown as AgentInputItem],
        rollingSummary: { dropped, priorSummary: "prior notes", save: (s) => { saved.push(s); } },
      },
      baseCtx,
      runtime,
    );

    expect(result).toBeTruthy();
    expect(saved).toEqual([]); // 摘要保持原样,不写一句假话
    expect(mocks.settleCredits).toHaveBeenCalledTimes(1);
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });
});
