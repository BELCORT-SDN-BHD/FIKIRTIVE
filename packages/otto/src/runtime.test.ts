/**
 * runtime.test.ts — WO-OTTO-PHASE1 composition seam (engine spec §6.2 / §17 Phase 1).
 *
 * The profile contract matrix at the SHARED RUNNER level plus the manifest
 * single-source proofs:
 *  - PH1-A1: every withLlmBudget parameter (model / paid / maxSteps / prices /
 *    usage mapper) derives from ONE atomic OttoModelRuntime manifest.
 *  - PH1-A2: fresh / stream / approval-resume / worker-verdict all run through the
 *    SAME runOttoTurn + finalizeOttoTurn; a profile only limits tools/steps.
 *  - PH1-A4: worker-verdict = ZERO tools, single step.
 *  - PH1-A5: production composition binds the existing Anthropic model; the runtime
 *    is chosen at composition time, is frozen, and no env/client channel can flip it
 *    to fixture-no-charge.
 *  - §17 Phase 1 Done: a fake provider (fixture manifest, $0) can execute a safe
 *    skill through the shared runner, including the park→approve→resume round-trip.
 */
process.env.OPENAI_AGENTS_DISABLE_TRACING = "1";

import { beforeEach, describe, it, expect, vi } from "vitest";

const meterMocks = vi.hoisted(() => {
  const transaction = vi.fn();
  const reserveCredits = vi.fn();
  const reserveCreditsUpTo = vi.fn();
  const settleCredits = vi.fn();
  const refundReservation = vi.fn();
  return {
    transaction,
    reserveCredits,
    reserveCreditsUpTo,
    settleCredits,
    refundReservation,
    prisma: { $transaction: transaction },
  };
});

vi.mock("@fikirtive/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/db")>()),
  prisma: meterMocks.prisma,
  reserveCredits: meterMocks.reserveCredits,
  reserveCreditsUpTo: meterMocks.reserveCreditsUpTo,
  settleCredits: meterMocks.settleCredits,
  refundReservation: meterMocks.refundReservation,
}));

import { z } from "zod";
import { Agent, RunState, Usage, MaxTurnsExceededError, run as sdkRun } from "@openai/agents";
import type { Model, ModelRequest, ModelResponse, StreamEvent } from "@openai/agents";
import {
  OTTO_MAX_STEPS,
  OTTO_OUTPUT_CAP_TOKENS,
  OTTO_CONVERSATION_TURN_MARGIN,
  OTTO_CONVERSATION_TURN_RESERVE_INTERNAL,
  OTTO_CHAT_MIN_START_INTERNAL,
  llmPricesFor,
  ottoLlmMargin,
  turnBudgetInternal,
  OTTO_CHAT_MAX_SEARCHES_PER_TURN,
  searchChargeInternal,
  searchUnitChargeInternal,
} from "@fikirtive/core";
import {
  createOttoRuntime,
  runOttoTurn,
  finalizeOttoTurn,
  ottoBudgetArgsFor,
  instructionsForTurn,
  type OttoModelRuntime,
  type OttoRuntimeDeps,
} from "./runtime.js";
import { ottoModel, ottoModelRuntime, OTTO_PRIMARY_MODEL, OTTO_FALLBACK_MODEL, OTTO_DEFAULT_MODEL } from "./model.js";
import { otto, ottoInteractiveRuntime, ottoApprovalResumeRuntime } from "./otto.js";
import { actualCostInternal, llmHoldInternal, mapOttoUsage, withLlmBudget } from "./meter.js";
import { defineOttoSkill } from "./skill.js";
import { tryRestoreRunStateWithContext } from "./run-input.js";
import { allSkills } from "./registry.js";
import { assembleOttoInstructions, ottoInstructions } from "./instructions.js";
import type { OttoContext } from "./context.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseCtx: OttoContext = {
  orgId: "org_t",
  userId: "org_t",
  projectId: "proj_t",
  threadId: "thread_t",
  disabledModels: [],
  sourceGenerationId: null,
};

const fakeUsage = () => new Usage({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });

beforeEach(() => {
  vi.clearAllMocks();
  meterMocks.transaction.mockImplementation(async (fn: (tx: Record<string, never>) => Promise<unknown>) => fn({}));
  meterMocks.reserveCredits.mockResolvedValue(undefined);
  // #898: the conversation turn reserves through reserveCreditsUpTo; resolve the hold it took.
  meterMocks.reserveCreditsUpTo.mockResolvedValue(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
  meterMocks.settleCredits.mockResolvedValue(undefined);
  meterMocks.refundReservation.mockResolvedValue(undefined);
});

/** Fixture manifest: declares itself non-billable — the runner derives paid:false from it. */
function fixtureModelRuntime(binding: Model): OttoModelRuntime {
  return Object.freeze({
    binding,
    billableModelId: "fixture-no-charge",
    resolvedModelPolicy: Object.freeze({ primaryModelId: "fixture", fallbackModelId: null, failover: "none" as const }),
    mapUsage: mapOttoUsage,
    cacheCapabilities: Object.freeze({ promptCache: false }),
    // ENGINE-A5:价目查不到即抛,而 "fixture-no-charge" 当然不在价目表里(它是夹具的自我
    // 声明,不是一个型号)。夹具本来就是**独立的测试组合**(见 model.ts 的 manifest 注释),
    // 所以它自带 pricing:一个不花钱的 manifest 仍要交出一份价目形状,给的是 sonnet 档那份。
    // 生产 manifest 照旧是 llmPricesFor 本身(下面 :452 的用例逐字守着这一点)。
    pricing: () => llmPricesFor("claude-sonnet-4-6"),
  });
}

/** Paid fixture: exercises the real reserve/refund/settle wrapper without a network provider. */
function paidFixtureModelRuntime(binding: Model): OttoModelRuntime {
  return Object.freeze({
    ...fixtureModelRuntime(binding),
    billableModelId: "claude-sonnet-4-6",
  });
}

/** Fake model: one tool call on the first step, a final text message on the next. */
function fakeToolCallingModel(toolName: string, args: Record<string, unknown>, finalText: string): Model {
  let calls = 0;
  return {
    async getResponse(_request: ModelRequest): Promise<ModelResponse> {
      calls += 1;
      if (calls === 1) {
        return {
          usage: fakeUsage(),
          output: [
            {
              type: "function_call" as const,
              callId: "call_1",
              name: toolName,
              arguments: JSON.stringify(args),
              status: "completed" as const,
            },
          ],
        };
      }
      return {
        usage: fakeUsage(),
        output: [
          {
            type: "message" as const,
            role: "assistant" as const,
            status: "completed" as const,
            content: [{ type: "output_text" as const, text: finalText }],
          },
        ],
      };
    },
    async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
      const resp = await this.getResponse(request);
      yield {
        type: "response_done",
        response: {
          id: "fake-resp",
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
          output: resp.output,
        },
      } as StreamEvent;
    },
  };
}

/** Fake model that only ever speaks text (worker-verdict / stream legs). */
function fakeTextModel(text: string): Model & { calls: () => number } {
  let calls = 0;
  const message = {
    type: "message" as const,
    role: "assistant" as const,
    status: "completed" as const,
    content: [{ type: "output_text" as const, text }],
  };
  return {
    calls: () => calls,
    async getResponse(_request: ModelRequest): Promise<ModelResponse> {
      calls += 1;
      return { usage: fakeUsage(), output: [message] };
    },
    async *getStreamedResponse(_request: ModelRequest): AsyncIterable<StreamEvent> {
      calls += 1;
      yield { type: "output_text_delta", delta: text } satisfies StreamEvent;
      yield {
        type: "response_done",
        response: {
          id: "fake-resp",
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
          output: [message],
        },
      } satisfies StreamEvent;
    },
  };
}

/** Test-only SAFE skill: free/read, executes against the run context only. */
function makeSafeSkill(log: string[]) {
  return defineOttoSkill({
    name: "echoBrand",
    cost: "free",
    effect: "read",
    reach: "internal",
    description: "Test-only safe read skill.",
    parameters: z.object({ q: z.string() }),
    execute: async (input, runContext) => {
      log.push(`${runContext.context.orgId}:${input.q}`);
      return { ok: true, echoed: input.q };
    },
  });
}

/** Test-only APPROVAL-GATED skill (write+external ⇒ needsApproval). Named after a real
 *  registry approval tool so collectApprovalInterruptions (registry closed set) sees it. */
function makeGatedSkill(log: string[]) {
  return defineOttoSkill({
    name: "approveScheduledPost",
    cost: "free",
    effect: "write",
    reach: "external",
    description: "Test-only gated skill.",
    parameters: z.object({ scheduledPostId: z.string() }),
    execute: async (input, runContext) => {
      log.push(`${runContext.context.orgId}:${input.scheduledPostId}`);
      return { ok: true };
    },
  });
}

// ── Profile matrix: tools/steps only ─────────────────────────────────────────

describe("createOttoRuntime — profile matrix (profiles only limit tools/steps)", () => {
  const deps: OttoRuntimeDeps = {
    modelRuntime: fixtureModelRuntime(fakeTextModel("hi")),
    skills: [makeSafeSkill([])],
  };

  it("interactive: full toolset, OTTO_MAX_STEPS", () => {
    const rt = createOttoRuntime(deps, "interactive");
    expect(rt.profile).toBe("interactive");
    expect(rt.agent.name).toBe("Otto");
    expect(rt.agent.tools.length).toBe(1);
    expect(rt.maxTurns).toBe(OTTO_MAX_STEPS);
  });

  it("approval-resume: full toolset, OTTO_MAX_STEPS (B9 recovery turns load the full set)", () => {
    const rt = createOttoRuntime(deps, "approval-resume");
    expect(rt.agent.tools.length).toBe(1);
    expect(rt.maxTurns).toBe(OTTO_MAX_STEPS);
  });

  it("eval: same tools and budget as the production interactive profile (§13.3)", () => {
    const rt = createOttoRuntime(deps, "eval");
    expect(rt.agent.tools.length).toBe(1);
    expect(rt.maxTurns).toBe(OTTO_MAX_STEPS);
  });

  // #791-4: the tool-less `worker-verdict` profile is gone with the automatic
  // post-generation Review round it existed for. Every remaining profile carries the
  // full toolset at OTTO_MAX_STEPS — which is what the three cases above now pin.

  it("runtimes are frozen — composition-time injection, immutable for the process lifetime", () => {
    const rt = createOttoRuntime(deps, "interactive");
    expect(Object.isFrozen(rt)).toBe(true);
    expect(() => {
      (rt as unknown as { maxTurns: number }).maxTurns = 99;
    }).toThrow(TypeError);
  });
});

// ── MONEY-A10: 聊天搜索的第二条钱腿(规格 §7.4) ──────────────────────────────
//
// 这一组钉的是「腿存在与否的条件」与「hold/settle 的口径」。腿不存在时,args 必须与本改动
// 之前逐字节相同 —— 一个没接搜索的运行时不该因为这次改动多持住一分钱。

describe("ottoBudgetArgsFor — MONEY-A10 搜索腿", () => {
  const slots = (granted = OTTO_CHAT_MAX_SEARCHES_PER_TURN) => ({ granted, taken: 0, succeeded: 0 });
  const req = { orgId: "org_1", refId: "otto-turn:m1", input: "x" as const };

  it("MONEY-A10:没有 context ⇒ 没有搜索腿(与本改动前逐字节相同)", () => {
    const args = ottoBudgetArgsFor(ottoInteractiveRuntime, req);
    expect(args.extraHoldUnits).toBeUndefined();
    expect(args.onExtraUnitsGranted).toBeUndefined();
    expect(args.extraSettleInternal).toBeUndefined();
  });

  it("MONEY-A10:接了 search 但没有槽 ⇒ 没有钱腿(技能那边也会 fail closed 拒绝搜索)", () => {
    const args = ottoBudgetArgsFor(ottoInteractiveRuntime, req, {
      research: { fetchUrl: async () => ({ url: "u", text: "" }), search: async () => ({ results: [] }) },
    });
    expect(args.extraHoldUnits).toBeUndefined();
    expect(args.onExtraUnitsGranted).toBeUndefined();
    expect(args.extraSettleInternal).toBeUndefined();
  });

  it("MONEY-A10:有槽但没接 search ⇒ 没有钱腿(搜不了就不许持钱)", () => {
    const args = ottoBudgetArgsFor(ottoInteractiveRuntime, req, {
      research: { fetchUrl: async () => ({ url: "u", text: "" }), searchSlots: slots() },
    });
    expect(args.extraHoldUnits).toBeUndefined();
    expect(args.onExtraUnitsGranted).toBeUndefined();
    expect(args.extraSettleInternal).toBeUndefined();
  });

  it("MONEY-A10:接了 search + 槽 ⇒ 按格坚实预留(单价+格数),settle 按实际成功次数", () => {
    const s = slots();
    const args = ottoBudgetArgsFor(ottoInteractiveRuntime, req, {
      research: { fetchUrl: async () => ({ url: "u", text: "" }), search: async () => ({ results: [] }), searchSlots: s },
    });
    // 交给账本的是**单价 + 最多几格**,不是一个平铺的总额 —— 判官 P1:平铺的总额会跟 LLM 腿
    // 一起被低余额压掉,而工具照发满额的槽。写死这两个数会在改费率那天变成悄悄的欠收口。
    expect(args.extraHoldUnits).toEqual({
      unitInternal: searchUnitChargeInternal("basic"),
      maxUnits: OTTO_CHAT_MAX_SEARCHES_PER_TURN,
    });
    // 结算是**跑完才读**的闭包:此刻 0 次,搜了 3 次就是 3 次。
    expect(args.extraSettleInternal?.()).toBe(0);
    s.succeeded = 3;
    expect(args.extraSettleInternal?.()).toBe(searchChargeInternal(3));
  });

  it("MONEY-A10:账本发的格数经 onExtraUnitsGranted 落进本轮的槽(低余额 ⇒ 少发)", () => {
    const s = slots(0); // 初值 fail closed
    const args = ottoBudgetArgsFor(ottoInteractiveRuntime, req, {
      research: { fetchUrl: async () => ({ url: "u", text: "" }), search: async () => ({ results: [] }), searchSlots: s },
    });
    args.onExtraUnitsGranted!(2); // 账本说:这一轮只买得起 2 格
    expect(s.granted).toBe(2);
    // 结算永远被那 2 格罩得住 —— 工具最多只放 2 次搜索出去(见 research-web.test.ts)。
    s.succeeded = 2;
    expect(args.extraSettleInternal!()).toBe(2 * searchUnitChargeInternal("basic"));
    expect(args.extraSettleInternal!()).toBeLessThanOrEqual(
      s.granted * args.extraHoldUnits!.unitInternal,
    );
  });

  // ── 复审 P1 的早期预警,钉在生产组合上 ─────────────────────────────────────────────
  //
  // 交给账本的 elasticCap = 这一轮的纯 LLM 腿 = min(worstCase, cap),它随 maxSteps 走:今天两个
  // 聊天 profile 都是 OTTO_MAX_STEPS(=10)⇒ worst 70 ⇒ 弹性腿 40 ≥ 开门额 10;而一步预算只有
  // 7(sonnet, maxSteps=1),**低于开门额**。
  //
  // 低于开门额**不是故障**:账本那边(reserveUpToCore 的 elasticForHold)会把它钳到开门额,
  // 不变量照样成立,聊天照跑 —— 复审②改裁的就是这一条(先前那版是抛错,会让小步数配置整轮炸)。
  // 所以这条断言是**预警**不是防炸线:它一旦红,意味着有人把聊天步数砍到了「弹性腿要靠钳才够
  // 罩住开门额」的档位,那时该复核的是步数预算本身,而不是这条断言。
  it("MONEY-A10 复审 P1:生产聊天组合交给账本的弹性腿 ≥ 开门额(无需钳制,早期预警)", () => {
    for (const rt of [ottoInteractiveRuntime, ottoApprovalResumeRuntime]) {
      const withSearch = ottoBudgetArgsFor(rt, req, {
        research: { fetchUrl: async () => ({ url: "u", text: "" }), search: async () => ({ results: [] }), searchSlots: slots() },
      });
      // 纯 LLM 腿 = 同一份 args 去掉按格腿之后的 hold(meter.ts 交给账本的就是这个数)。
      const llmLeg = llmHoldInternal({ ...withSearch, extraHoldUnits: undefined });
      expect(llmLeg).toBeGreaterThanOrEqual(withSearch.reserveMinInternal!);
    }
  });

  it("MONEY-A10:搜索腿与深研同源同费率(3×),不是第二份价目表", () => {
    expect(searchChargeInternal(1)).toBe(searchUnitChargeInternal("basic"));
    expect(searchChargeInternal(OTTO_CHAT_MAX_SEARCHES_PER_TURN)).toBe(
      OTTO_CHAT_MAX_SEARCHES_PER_TURN * searchUnitChargeInternal("basic"),
    );
  });
});

// ── PH1-A1: budget args single-source ────────────────────────────────────────

describe("ottoBudgetArgsFor — every withLlmBudget parameter derives from the manifest (PH1-A1)", () => {
  it("production interactive: model/paid/maxSteps/prices/usage-mapper all from ottoModelRuntime", () => {
    const args = ottoBudgetArgsFor(ottoInteractiveRuntime, { orgId: "org_1", refId: "otto-turn:m1", input: "x" });
    expect(args.orgId).toBe("org_1");
    expect(args.refId).toBe("otto-turn:m1");
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.paid).toBe(true);
    expect(args.maxSteps).toBe(OTTO_MAX_STEPS);
    expect(args.prices).toBe(llmPricesFor("claude-sonnet-4-6"));
    // Truncation metering: MaxTurnsExceededError carrying state.usage → ACTUAL usage settle,
    // **只在这一轮真的交付了东西时**(ENGINE-A4,⑤段)。这里放一张铸出来的卡 —— 卡是唯一能
    // 从 state 单独读出来的交付(落盘的产物由工具当场记账,见下面那一组用例)。
    const truncated = new MaxTurnsExceededError("max turns");
    (truncated as unknown as { state: unknown }).state = {
      usage: { inputTokens: 7, outputTokens: 3 },
      _generatedItems: [
        { type: "tool_approval_item", rawItem: { type: "function_call", callId: "c1", name: "generate", arguments: "{}", status: "completed" } },
      ],
    };
    expect(args.usageOnError?.(truncated)).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    expect(args.usageOnError?.(new MaxTurnsExceededError("no state"))).toBeNull();
    expect(args.usageOnError?.(new Error("boom"))).toBeNull();
  });

  // ── ENGINE-A4(⑤段 §7.2⑤):截断轮退款的判定,在 budget args 这一层 ──────────────────
  //
  // 这几条钉的是**判词本身**,不是账本(账本那一半在 apps/web 的真库行为测试里)。判词只有
  // 一句话:usageOnError 交回 null ⇒ meter.ts 整笔退款;交回用量 ⇒ 按实结算。
  //
  // 落修轮(判官 P1-A)之后,「写动作成功了没有」不再从 SDK 的 state 上读 —— SDK 对 function
  // tool 的结果一律写 status:"completed",抛错、`{ needMoreInfo }`、`{ ok:false, error }` 三种
  // 失败全躲在那面牌子后面。所以下面的用例**真的把工具调一遍**,走的正是生产那条包装路径。
  describe("ENGINE-A4 — 截断轮:零交付交回 null(整笔退款),有交付照旧按实结算", () => {
    const truncatedWith = (items: unknown[]) => {
      const e = new MaxTurnsExceededError("max turns");
      (e as unknown as { state: unknown }).state = {
        usage: { inputTokens: 7, outputTokens: 3 },
        _generatedItems: items,
      };
      return e;
    };

    /** 一个真的落盘的写技能。 */
    const writeLands = defineOttoSkill({
      name: "rememberBrandFact",
      cost: "free", effect: "write", reach: "internal",
      description: "Test-only write skill that lands.",
      parameters: z.object({ v: z.string() }),
      execute: async () => ({ ok: true, id: "rec_1" }),
    });
    /** 技能自己拒绝(manage-canvas.ts 那一连串 `{ ok:false, error }`)。 */
    const writeRefuses = defineOttoSkill({
      name: "manageCanvas",
      cost: "free", effect: "write", reach: "internal",
      description: "Test-only write skill that refuses.",
      parameters: z.object({ v: z.string() }),
      execute: async () => ({ ok: false, error: "place needs `type` (text | image | video)." }),
    });
    /** `execute` 抛错 —— SDK 的 defaultToolErrorFunction 把它折成一句普通文本当返回值。 */
    const writeThrows = defineOttoSkill({
      name: "saveProduct",
      cost: "free", effect: "write", reach: "internal",
      description: "Test-only write skill that throws.",
      parameters: z.object({ v: z.string() }),
      execute: async () => { throw new Error("upstream said no"); },
    });
    /** `requires` 闸拦下 —— 返回 `{ needMoreInfo }`。 */
    const writeNeedsInfo = defineOttoSkill({
      name: "setTitle",
      cost: "free", effect: "write", reach: "internal",
      description: "Test-only write skill behind a requires gate.",
      parameters: z.object({ title: z.string() }),
      requires: [{ field: "title", question: "What title?" }],
      execute: async () => ({ ok: true }),
    });
    /** 成功的**读** —— 轮子死了商家手里什么都不剩,不算交付。 */
    const readOnly = defineOttoSkill({
      name: "lookupProducts",
      cost: "free", effect: "read", reach: "internal",
      description: "Test-only read skill.",
      parameters: z.object({ v: z.string() }),
      execute: async () => ({ ok: true, products: [] }),
    });
    /** 判官 P2-a:一把 `effect:"write"` 的多动作工具,底下挂着一个纯读动作 —— 生产里
     *  `manageCanvas.view` / `manageLibrary.history` / `manageMedia.list` 就是这个形状,
     *  成功时同样返回 `{ ok:true, … }`,从返回值一层根本分不出来。 */
    const writeWithReadAction = defineOttoSkill({
      name: "manageBoard",
      cost: "free", effect: "write", reach: "internal",
      description: "Test-only multi-action write skill whose `view` only reads.",
      parameters: z.object({ action: z.enum(["view", "place"]), v: z.string().optional() }),
      readOnlyActions: { field: "action", actions: ["view"] },
      execute: async () => ({ ok: true, nodes: [] }),
    });

    const rt = () =>
      createOttoRuntime(
        {
          modelRuntime: paidFixtureModelRuntime(fakeTextModel("hi")),
          skills: [writeLands, writeRefuses, writeThrows, writeNeedsInfo, readOnly, writeWithReadAction],
        },
        "interactive",
      );

    /** 直接调这一轮**组合出来的**那把工具(生产里 SDK 调的就是它),带上这一轮的 ctx。 */
    const callTool = async (
      runtime: ReturnType<typeof createOttoRuntime>,
      name: string,
      args: Record<string, unknown>,
      ctx: OttoContext,
    ): Promise<unknown> => {
      const t = runtime.agent.tools.find((x) => (x as { name?: string }).name === name) as unknown as {
        invoke: (rc: { context: OttoContext }, input: string) => Promise<unknown>;
      };
      return t.invoke({ context: ctx }, JSON.stringify(args));
    };

    /** 每个用例一个**新的 ctx 对象** —— 记账本按 ctx 分账,两轮不串。 */
    const freshCtx = (): OttoContext => ({ ...baseCtx });
    const verdict = (runtime: ReturnType<typeof createOttoRuntime>, ctx: OttoContext | undefined, e: unknown, input: unknown = "x") =>
      ottoBudgetArgsFor(runtime, { orgId: "org_1", refId: "otto-stream:m1", input: input as never }, ctx).usageOnError?.(e);

    it("ENGINE-A4:什么都没交付(只成功搜了几次网)⇒ null ⇒ 整笔退款,搜索腿一并退", async () => {
      const runtime = rt();
      const ctx = freshCtx();
      await callTool(runtime, "lookupProducts", { v: "kopi" }, ctx);
      const onlyReads = truncatedWith([
        { type: "tool_call_item", rawItem: { type: "function_call", callId: "c1", name: "lookupProducts", arguments: "{}", status: "completed" } },
        { type: "tool_call_output_item", rawItem: { type: "function_call_result", callId: "c1", name: "lookupProducts", status: "completed" } },
        { type: "message_output_item", rawItem: { type: "message", role: "assistant", content: [{ type: "output_text", text: "still thinking" }] } },
      ]);
      expect(verdict(runtime, ctx, onlyReads)).toBeNull();
    });

    it("ENGINE-A4:零 item 的截断轮 ⇒ null", () => {
      expect(verdict(rt(), freshCtx(), truncatedWith([]))).toBeNull();
    });

    it("ENGINE-A4:落盘的产物(真的写成了的写动作)⇒ 按实结算,不退", async () => {
      const runtime = rt();
      const ctx = freshCtx();
      const out = await callTool(runtime, "rememberBrandFact", { v: "we sell kopi" }, ctx);
      expect(out).toMatchObject({ ok: true });
      const wrote = truncatedWith([
        { type: "tool_call_output_item", rawItem: { type: "function_call_result", callId: "c1", name: "rememberBrandFact", status: "completed" } },
      ]);
      expect(verdict(runtime, ctx, wrote)).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    });

    it("ENGINE-A4:铸出的卡片(停在审批位上的调用)⇒ 按实结算,不退", () => {
      const carded = truncatedWith([
        { type: "tool_approval_item", rawItem: { type: "function_call", callId: "c1", name: "generate", arguments: "{}", status: "completed" } },
      ]);
      expect(verdict(rt(), freshCtx(), carded)).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    });

    // ── 判官 P1-A:失败的写**在 SDK 的 state 上与成功的写一模一样** ──────────────────
    //
    // 三种失败各一条。每条都先断言 SDK 侧记下来的那一行确实是 status:"completed"(即「照 state
    // 判就会误判成有交付」),再断言判词交回 null。
    const failures: Array<[string, string, Record<string, unknown>]> = [
      ["技能自己拒绝 `{ ok:false, error }`(Otto 拿错参数反复重试的那条死胡同)", "manageCanvas", { v: "x" }],
      ["`execute` 抛错(SDK 把它折成一句普通文本当返回值)", "saveProduct", { v: "x" }],
      ["`requires` 闸拦下 `{ needMoreInfo }`", "setTitle", { title: "   " }],
    ];
    for (const [label, name, args] of failures) {
      it(`ENGINE-A4:失败的写不算交付 —— ${label} ⇒ null`, async () => {
        const runtime = rt();
        const ctx = freshCtx();
        await callTool(runtime, name, args, ctx);
        // SDK 侧这一行长这样:名字在交付名单里,状态是 completed —— 从 state 判必然误判。
        const failedWrite = truncatedWith([
          { type: "tool_call_output_item", rawItem: { type: "function_call_result", callId: "c1", name, status: "completed" } },
        ]);
        expect(runtime.deliveringActionNames.has(name)).toBe(true);
        expect(verdict(runtime, ctx, failedWrite)).toBeNull();
      });
    }

    // ── 判官 P2-a:写技能底下的**纯读动作**不算交付 ──────────────────────────────
    //
    // 六个纯读动作(manageCanvas.view / manageLibrary.history / .detail / manageMedia.list /
    // .load_more / draftWorkflows.validateWorkflowRules)住在 `effect:"write"` 的技能里,成功
    // 时返回 `{ ok:true, … }`,落修前一律被记成一次落盘 —— 于是「只反复看板、列清单直到跑满
    // 步数」的死胡同照收钱,与 ENGINE-A4 正相反。
    it("ENGINE-A4:写技能里的纯读动作 —— 一轮只看板不落盘 ⇒ null ⇒ 整笔退款", async () => {
      const runtime = rt();
      const ctx = freshCtx();
      const out = await callTool(runtime, "manageBoard", { action: "view" }, ctx);
      // 返回值与一次真写逐字同形:判据不可能来自返回值。
      expect(out).toMatchObject({ ok: true });
      expect(runtime.deliveringActionNames.has("manageBoard")).toBe(true);
      const onlyReads = truncatedWith([
        { type: "tool_call_output_item", rawItem: { type: "function_call_result", callId: "c1", name: "manageBoard", status: "completed" } },
      ]);
      expect(verdict(runtime, ctx, onlyReads)).toBeNull();
    });

    it("ENGINE-A4:同一把工具的真写动作照旧算交付 ⇒ 按实结算,不退", async () => {
      const runtime = rt();
      const ctx = freshCtx();
      await callTool(runtime, "manageBoard", { action: "place", v: "a note" }, ctx);
      const wrote = truncatedWith([
        { type: "tool_call_output_item", rawItem: { type: "function_call_result", callId: "c1", name: "manageBoard", status: "completed" } },
      ]);
      expect(verdict(runtime, ctx, wrote)).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    });

    it("ENGINE-A4:一轮里翻了三次看板、最后真写了一笔 ⇒ 仍算交付", async () => {
      const runtime = rt();
      const ctx = freshCtx();
      await callTool(runtime, "manageBoard", { action: "view" }, ctx);
      await callTool(runtime, "manageBoard", { action: "view" }, ctx);
      await callTool(runtime, "manageBoard", { action: "view" }, ctx);
      await callTool(runtime, "manageBoard", { action: "place", v: "a note" }, ctx);
      expect(verdict(runtime, ctx, truncatedWith([]))).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    });

    it("ENGINE-A4:生产里那六个纯读动作,由技能自己声明(runtime 不存第二份名册)", () => {
      const declared = new Map(
        allSkills
          .filter((s) => s.readOnlyActions)
          .map((s) => [s.name, [...s.readOnlyActions!.actions].sort()] as const),
      );
      expect(Object.fromEntries(declared)).toEqual({
        manageCanvas: ["view"],
        manageLibrary: ["detail", "history"],
        manageMedia: ["list", "load_more"],
        draftWorkflows: ["validateWorkflowRules"],
      });
      // 判别键必须真是那把工具的参数(工厂在定义期就会拦,这里再钉一次口径)。
      for (const skill of allSkills) {
        if (!skill.readOnlyActions) continue;
        expect(skill.effect).toBe("write");
        expect(["action", "operation"]).toContain(skill.readOnlyActions.field);
      }
    });

    it("ENGINE-A4:一轮里既有失败的写也有成功的写 ⇒ 有交付,按实结算", async () => {
      const runtime = rt();
      const ctx = freshCtx();
      await callTool(runtime, "manageCanvas", { v: "x" }, ctx);
      await callTool(runtime, "rememberBrandFact", { v: "ok" }, ctx);
      expect(verdict(runtime, ctx, truncatedWith([]))).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    });

    it("ENGINE-A4:两轮不串账 —— 上一轮的落盘不能让这一轮免退", async () => {
      const runtime = rt();
      const first = freshCtx();
      await callTool(runtime, "rememberBrandFact", { v: "ok" }, first);
      const second = freshCtx();
      expect(verdict(runtime, first, truncatedWith([]))).not.toBeNull();
      expect(verdict(runtime, second, truncatedWith([]))).toBeNull();
    });

    // ── 判官 P1-B:恢复轮的起点 ────────────────────────────────────────────────
    //
    // `RunState.fromString` 把上一轮的 `_generatedItems` 整条带回来,里面就有上一轮那张
    // tool_approval_item —— 那张卡的钱早在**别的 refId** 下付过了。从 0 数起的话,ottoApprove
    // 那一门在一步都还没跑的时候就已经「有交付」,ENGINE-A4 在那条钱腿上等于没落地。
    it("ENGINE-A4:恢复轮只数这一轮新长出来的 —— 上一轮那张卡不算这一轮的交付 ⇒ null", () => {
      const carriedOver = [
        { type: "tool_call_item", rawItem: { type: "function_call", callId: "c1", name: "generate", arguments: "{}", status: "completed" } },
        { type: "tool_approval_item", rawItem: { type: "function_call", callId: "c1", name: "generate", arguments: "{}", status: "completed" } },
      ];
      const resumed = { _generatedItems: carriedOver, _context: { context: {} } };
      expect(verdict(rt(), freshCtx(), truncatedWith([...carriedOver]), resumed)).toBeNull();
    });

    // 生产里恢复轮的 RunState 是**就地**长大的:错误身上带回来的和 `request.input` 是同一个
    // 对象。起点必须在**跑之前**折好,否则到判词那一刻起点已经等于终点,这一轮新铸的卡会被
    // 一起抹掉 —— 该收的钱变成退款。
    it("ENGINE-A4:恢复轮的 state 就地长大 —— 起点在跑之前折好,新铸的卡照样算交付", () => {
      const items: unknown[] = [
        { type: "tool_approval_item", rawItem: { type: "function_call", callId: "c1", name: "generate", arguments: "{}", status: "completed" } },
      ];
      const resumed = { _generatedItems: items, _context: { context: {} } };
      // 跑之前建 args(生产里 runOttoTurn 就是这个次序)。
      const usageOnError = ottoBudgetArgsFor(
        rt(),
        { orgId: "org_1", refId: "otto-approve:t:c:a1", input: resumed as never },
        freshCtx(),
      ).usageOnError;
      // 跑到一半:这一轮又铸了一张卡,就地追加进同一个数组。
      items.push({ type: "tool_approval_item", rawItem: { type: "function_call", callId: "c2", name: "renderVideo", arguments: "{}", status: "completed" } });
      const e = new MaxTurnsExceededError("max turns");
      (e as unknown as { state: unknown }).state = { usage: { inputTokens: 7, outputTokens: 3 }, ...resumed };
      expect(usageOnError?.(e)).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    });

    it("ENGINE-A4:恢复轮的 state 就地长大 —— 这一轮什么都没铸 ⇒ 仍是零交付,null", () => {
      const items: unknown[] = [
        { type: "tool_approval_item", rawItem: { type: "function_call", callId: "c1", name: "generate", arguments: "{}", status: "completed" } },
      ];
      const resumed = { _generatedItems: items, _context: { context: {} } };
      const usageOnError = ottoBudgetArgsFor(
        rt(),
        { orgId: "org_1", refId: "otto-approve:t:c:a1", input: resumed as never },
        freshCtx(),
      ).usageOnError;
      items.push({ type: "message_output_item", rawItem: { type: "message", role: "assistant", content: [{ type: "output_text", text: "hmm" }] } });
      const e = new MaxTurnsExceededError("max turns");
      (e as unknown as { state: unknown }).state = { usage: { inputTokens: 7, outputTokens: 3 }, ...resumed };
      expect(usageOnError?.(e)).toBeNull();
    });

    it("ENGINE-A4:恢复轮自己又铸出一张新卡 ⇒ 有交付,按实结算", () => {
      const carriedOver = [
        { type: "tool_approval_item", rawItem: { type: "function_call", callId: "c1", name: "generate", arguments: "{}", status: "completed" } },
      ];
      const resumed = { _generatedItems: carriedOver, _context: { context: {} } };
      const grew = truncatedWith([
        ...carriedOver,
        { type: "tool_approval_item", rawItem: { type: "function_call", callId: "c2", name: "renderVideo", arguments: "{}", status: "completed" } },
      ]);
      expect(verdict(rt(), freshCtx(), grew, resumed)).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    });

    it("ENGINE-A4:包装名单来自注册表的 effect:\"write\",不是第二份手抄名单", () => {
      const write = [...ottoInteractiveRuntime.deliveringActionNames];
      expect(write).toContain("manageCanvas");
      expect(write).toContain("rememberBrandFact");
      expect(write).not.toContain("researchWeb");
      expect(write).not.toContain("lookupProducts");
      // 包装名单必然是动作白名单的子集 —— 两者折自同一份 deps.skills。
      for (const name of write) expect(ottoInteractiveRuntime.actionNames.has(name)).toBe(true);
    });

    it("ENGINE-A4:包装只改记账,模型看到的返回值一个字节都没变", async () => {
      const runtime = rt();
      const ctx = freshCtx();
      expect(await callTool(runtime, "rememberBrandFact", { v: "a" }, ctx)).toEqual({ ok: true, id: "rec_1" });
      expect(await callTool(runtime, "manageCanvas", { v: "a" }, ctx)).toEqual({
        ok: false,
        error: "place needs `type` (text | image | video).",
      });
      expect(await callTool(runtime, "setTitle", { title: " " }, ctx)).toEqual({
        needMoreInfo: [{ field: "title", question: "What title?" }],
      });
      // 抛错那条:SDK 的 defaultToolErrorFunction 折成一句普通文本 —— 不是对象,所以不算落盘。
      expect(await callTool(runtime, "saveProduct", { v: "a" }, ctx)).toContain("upstream said no");
    });
  });

  // ── Founder 的第二次裁决(2026-08-18):对话按用量收费,API 成本 + 5% ──────────────────────
  //
  // 整条规则是 @fikirtive/core 里的一个乘数(OTTO_CONVERSATION_TURN_MARGIN);#543 的冻结上限与
  // #898 的起步门槛都随它一起回到在役。
  it("prices the conversation turn from the chat multiplier, not from the ambient generation margin", () => {
    for (const rt of [ottoInteractiveRuntime, ottoApprovalResumeRuntime]) {
      const args = ottoBudgetArgsFor(rt, { orgId: "org_1", refId: "otto-turn:m1", input: "x" });
      expect(args.margin).toBe(OTTO_CONVERSATION_TURN_MARGIN);
      expect(args.margin).toBe(1.05);
      // Explicitly NOT the env/default markup — that one prices GENERATION, and a shared margin
      // would have quietly re-priced every image and video with this ruling.
      expect(args.margin).not.toBe(ottoLlmMargin());
    }
  });

  it("holds the cost-plus-5% worst case, capped: 70 internal derived, 40 held", () => {
    const args = ottoBudgetArgsFor(ottoInteractiveRuntime, { orgId: "org_1", refId: "otto-turn:m1", input: "x" });
    // The meter's one definition of the hold, asked with the production args.
    expect(llmHoldInternal(args)).toBe(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
    // The number the cap is capping, at the CHAT price…
    expect(turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), OTTO_CONVERSATION_TURN_MARGIN, OTTO_MAX_STEPS)).toBe(70);
    // …and at the generation markup, which this turn deliberately does NOT use.
    // 130 = 2.06× 的生成侧费率(Founder 2026-09-01 研究档裁决;2.0× 时代这里是 120)。
    // 这个数**跟着裁决走**是对的 —— 它就是「聊天档若共用生成费率会持有多少」的锚。
    expect(turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), ottoLlmMargin(), OTTO_MAX_STEPS)).toBe(130);
  });

  it("#543: the conversation turn carries the 40-internal hold cap", () => {
    for (const rt of [ottoInteractiveRuntime, ottoApprovalResumeRuntime]) {
      const args = ottoBudgetArgsFor(rt, { orgId: "o", refId: "otto-turn:m2", input: "x" });
      expect(args.reserveCapInternal).toBe(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
      expect(args.reserveCapInternal).toBe(40);
    }
  });

  it("#898: it also carries the 1-credit entry minimum, so the hold can fit a small balance", () => {
    for (const rt of [ottoInteractiveRuntime, ottoApprovalResumeRuntime]) {
      const args = ottoBudgetArgsFor(rt, { orgId: "o", refId: "otto-turn:m2", input: "x" });
      expect(args.reserveMinInternal).toBe(OTTO_CHAT_MIN_START_INTERNAL);
      expect(args.reserveMinInternal).toBe(10);
      // The pair is what makes 3.9 credits sendable: gate at 10, hold at min(40, 39).
      expect(args.reserveMinInternal).toBeLessThan(args.reserveCapInternal!);
    }
  });

  it("fixture-no-charge manifest → paid:false (the ONLY way to a no-charge run is the manifest itself)", () => {
    const rt = createOttoRuntime(
      { modelRuntime: fixtureModelRuntime(fakeTextModel("x")), skills: [] },
      "eval",
    );
    expect(ottoBudgetArgsFor(rt, { orgId: "o", refId: "r", input: "x" }).paid).toBe(false);
  });
});

// ── PH1-A5: production composition root ──────────────────────────────────────

describe("production composition root (PH1-A5)", () => {
  it("manifest single source: binding/billable/policy/usage-mapper/cache/pricing", () => {
    expect(ottoModelRuntime.binding).toBe(ottoModel);
    expect(ottoModelRuntime.billableModelId).toBe(OTTO_DEFAULT_MODEL);
    expect(ottoModelRuntime.billableModelId).toBe("claude-sonnet-4-6");
    expect(ottoModelRuntime.billableModelId).not.toBe("fixture-no-charge");
    expect(ottoModelRuntime.resolvedModelPolicy.primaryModelId).toBe(OTTO_PRIMARY_MODEL);
    expect(ottoModelRuntime.resolvedModelPolicy.fallbackModelId).toBe(OTTO_FALLBACK_MODEL);
    expect(ottoModelRuntime.resolvedModelPolicy.failover).toBe("same-tier-529-only");
    expect(ottoModelRuntime.mapUsage).toBe(mapOttoUsage);
    expect(ottoModelRuntime.pricing).toBe(llmPricesFor);
    expect(ottoModelRuntime.cacheCapabilities.promptCache).toBe(true);
  });

  it("manifest is frozen: runtime mutation cannot flip the billable model", () => {
    expect(Object.isFrozen(ottoModelRuntime)).toBe(true);
    expect(Object.isFrozen(ottoModelRuntime.resolvedModelPolicy)).toBe(true);
    expect(Object.isFrozen(ottoModelRuntime.cacheCapabilities)).toBe(true);
    expect(() => {
      (ottoModelRuntime as unknown as { billableModelId: string }).billableModelId = "fixture-no-charge";
    }).toThrow(TypeError);
  });

  it("legacy singletons ARE the factory's production instances; production profiles share ONE manifest", () => {
    expect(otto).toBe(ottoInteractiveRuntime.agent);
    expect(ottoInteractiveRuntime.modelRuntime).toBe(ottoModelRuntime);
    expect(ottoApprovalResumeRuntime.modelRuntime).toBe(ottoModelRuntime);
    expect(ottoInteractiveRuntime.agent.tools.length).toBe(allSkills.length);
    expect(ottoApprovalResumeRuntime.agent.tools.length).toBe(allSkills.length);
    expect(ottoInteractiveRuntime.maxTurns).toBe(OTTO_MAX_STEPS);
    expect(ottoApprovalResumeRuntime.maxTurns).toBe(OTTO_MAX_STEPS);
  });

  it("three ambient selector-like env names are not inputs to the explicit composition API", () => {
    const keys = ["OTTO_MODEL_RUNTIME", "OTTO_BILLABLE_MODEL", "OTTO_MODEL"] as const;
    const saved = keys.map((k) => [k, process.env[k]] as const);
    try {
      process.env.OTTO_MODEL_RUNTIME = "fixture-no-charge";
      process.env.OTTO_BILLABLE_MODEL = "fixture-no-charge";
      process.env.OTTO_MODEL = "cli";
      const rt = createOttoRuntime(
        { modelRuntime: ottoModelRuntime, skills: [] },
        "interactive",
      );
      expect(rt.modelRuntime).toBe(ottoModelRuntime);
      expect(rt.modelRuntime.billableModelId).toBe("claude-sonnet-4-6");
      expect(rt.modelRuntime.binding).toBe(ottoModel);
      expect(ottoBudgetArgsFor(rt, { orgId: "o", refId: "r", input: "x" }).paid).toBe(true);
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

// ── Founder 的第二次裁决(2026-08-18):一整轮对话按真实用量收费 ──────────────────────────
//
// 「其实应该看用量,不然之后思考很久或其他的,我们的成本会 cover 不到。」这一组用**真 meter**
// 跑生产的预算参数,钉住那两个数:冻结走 #898 的 balance-aware 路,结算按真实 token 算,
// 而且**用得越多收得越多** —— 那正是这条规则要成立的地方。
describe("runOttoTurn — a conversation turn charges for what it used (Founder 2026-08-18)", () => {
  it("takes the balance-aware hold and settles the ACTUAL token cost", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: paidFixtureModelRuntime(fakeTextModel("here you go")), skills: [] },
      "interactive",
    );

    await runOttoTurn({ orgId: "org_t", refId: "otto-turn:paid-1", input: "hello" }, baseCtx, runtime);

    // #898: a conversation turn holds min(cap, balance) through reserveCreditsUpTo.
    expect(meterMocks.reserveCreditsUpTo).toHaveBeenCalledOnce();
    expect(meterMocks.reserveCreditsUpTo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: "org_t",
        refId: "otto-turn:paid-1",
        capInternal: OTTO_CONVERSATION_TURN_RESERVE_INTERNAL,
        minimumInternal: OTTO_CHAT_MIN_START_INTERNAL,
      }),
    );
    expect(meterMocks.reserveCredits).not.toHaveBeenCalled();
    // The settle is the turn's REAL usage priced at the chat multiplier — the fixture model
    // reports 3 in / 2 out, which at cost + 5% rounds up to 1 internal credit.
    const settled = actualCostInternal(
      { inputTokens: 3, outputTokens: 2 },
      llmPricesFor("claude-sonnet-4-6"),
      OTTO_CONVERSATION_TURN_MARGIN,
    );
    expect(meterMocks.settleCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "org_t", refId: "otto-turn:paid-1", actualInternal: settled }),
    );
    expect(meterMocks.refundReservation).not.toHaveBeenCalled();
  });

  it("costs MORE the more it used — that is the whole point of usage pricing", async () => {
    const args = ottoBudgetArgsFor(ottoInteractiveRuntime, { orgId: "o", refId: "r", input: "x" });
    const charge = (usage: { inputTokens: number; outputTokens: number }) =>
      actualCostInternal(usage, args.prices!, args.margin!);

    const tiny = charge({ inputTokens: 1, outputTokens: 1 });
    const full = charge({ inputTokens: 12_000, outputTokens: 1_500 });
    const huge = charge({ inputTokens: 5_000_000, outputTokens: 900_000 });

    expect(tiny).toBeGreaterThan(0); // 没有免费的一轮 —— 每一轮都至少收回成本
    expect(full).toBeGreaterThan(tiny);
    expect(huge).toBeGreaterThan(full);
    // 「思考很久」那种一轮不可能比成本便宜:收的 ≥ 花的。
    expect(huge).toBeGreaterThanOrEqual(charge({ inputTokens: 5_000_000, outputTokens: 900_000 }));
  });
});

// ── PH1F-A2: stream failure money path + settlement ordering ────────────────

describe("runOttoTurn — real meter stream failure and completion ordering (PH1F-A2)", () => {
  it("an onStream throw refunds the full paid reservation and never success-settles", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: paidFixtureModelRuntime(fakeTextModel("partial")), skills: [] },
      "interactive",
    );

    await expect(runOttoTurn(
      {
        orgId: "org_t",
        refId: "paid:stream-error",
        input: "hello",
        stream: true,
        onStream: async (stream) => {
          for await (const _event of stream) throw new Error("client stream failed");
        },
      },
      baseCtx,
      runtime,
    )).rejects.toThrow("client stream failed");

    // #898: the conversation turn reserves through reserveCreditsUpTo (hold = min(cap, balance)).
    // The claim is unchanged — exactly one reservation, then a full refund.
    expect(meterMocks.reserveCreditsUpTo).toHaveBeenCalledOnce();
    expect(meterMocks.reserveCredits).not.toHaveBeenCalled();
    expect(meterMocks.refundReservation).toHaveBeenCalledOnce();
    expect(meterMocks.refundReservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "org_t", refId: "paid:stream-error" }),
    );
    expect(meterMocks.settleCredits).not.toHaveBeenCalled();
    expect(meterMocks.reserveCreditsUpTo.mock.invocationCallOrder[0]).toBeLessThan(
      meterMocks.refundReservation.mock.invocationCallOrder[0]!,
    );
  });

  it("drains onStream before awaiting completed and reads usage only afterward", async () => {
    const order: string[] = [];
    let markDrainStarted!: () => void;
    let releaseDrain!: () => void;
    const drainStarted = new Promise<void>((resolve) => { markDrainStarted = resolve; });
    const drainGate = new Promise<void>((resolve) => { releaseDrain = resolve; });
    const modelRuntime = Object.freeze({
      ...paidFixtureModelRuntime(fakeTextModel("unused")),
      mapUsage: (usage: Parameters<typeof mapOttoUsage>[0]) => {
        order.push("usage");
        return mapOttoUsage(usage);
      },
    });
    const runtime = createOttoRuntime({ modelRuntime, skills: [] }, "interactive");
    const streamResult = {
      async *[Symbol.asyncIterator]() {
        order.push("drain-start");
        markDrainStarted();
        yield { type: "raw_model_stream_event" };
        await drainGate;
        order.push("drain-complete");
      },
      completed: {
        then(resolve: (value: undefined) => void) {
          order.push("completed");
          resolve(undefined);
        },
      },
      state: {
        toString: () => "ordered-state",
        get usage() {
          return { inputTokens: 3, outputTokens: 2, totalTokens: 5 };
        },
      },
      interruptions: [],
      finalOutput: "done",
    };
    const execution = {
      runAgent: vi.fn(async () => streamResult),
      meter: withLlmBudget,
      maxTurnsExceededError: MaxTurnsExceededError,
    };

    const turn = runOttoTurn(
      {
        orgId: "org_t",
        refId: "fixture:stream-order",
        input: "hello",
        stream: true,
        onStream: async (stream) => {
          for await (const _event of stream) { /* drain */ }
        },
      },
      baseCtx,
      runtime,
      execution as never,
    );

    await drainStarted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const orderBeforeDrainRelease = [...order];
    releaseDrain();
    await turn;

    expect(orderBeforeDrainRelease).toEqual(["drain-start"]);
    expect(order).toEqual(["drain-start", "drain-complete", "completed", "usage"]);
    // Priced with the CHAT multiplier (Founder's second ruling 2026-08-18: cost + 5%), never the
    // generation markup — a shared margin here would silently re-price conversation with images.
    const actualInternal = actualCostInternal(
      { inputTokens: 3, outputTokens: 2 },
      llmPricesFor("claude-sonnet-4-6"),
      OTTO_CONVERSATION_TURN_MARGIN,
    );
    expect(meterMocks.settleCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: "org_t",
        refId: "fixture:stream-order",
        actualInternal,
      }),
    );
  });
});
// ── ENGINE-A7:装出来的说明书**真的送进模型** ─────────────────────────────────
//
// ⑥段唯一的承重接线。判官 r2 的变异实证:把 `execution.runAgent(agent, …)` 改回
// `execution.runAgent(runtime.agent, …)`,全套 otto 测试 1482 passed 一条不红 ——
// 每一轮都退回整柜(正是⑥段要退役的单体行为),而②段档案照样记 `skillFiles: ["_core.md"]`,
// 档案于是声称一份模型根本没拿到的名单,ENGINE-A2 的诚实性当场作废。下面两条断言就是钉子:
// 截下真正交给 SDK 的那个 agent,逐字节比对它的 instructions。
describe("runOttoTurn — ENGINE-A7:交给 SDK 的 agent 带的是这一轮装出来的说明书", () => {
  /** 截下 `runAgent` 收到的第一个参数(真正跑的那个 agent),模型侧一律不碰。 */
  function capturingExecution() {
    const seen: { instructions: unknown; agent: unknown }[] = [];
    return {
      seen,
      execution: {
        runAgent: vi.fn(async (agent: Agent<OttoContext>) => {
          seen.push({ instructions: agent.instructions, agent });
          return {
            state: { usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
            interruptions: [],
            finalOutput: "ok",
          };
        }),
        meter: async (_args: unknown, fn: () => Promise<{ result: unknown }>) => (await fn()).result,
        maxTurnsExceededError: MaxTurnsExceededError,
      },
    };
  }

  const runtime = () =>
    createOttoRuntime({ modelRuntime: fixtureModelRuntime(fakeTextModel("unused")), skills: [] }, "interactive");

  it("ENGINE-A7:新鲜轮 —— agent.instructions 与 assembleOttoInstructions(这轮的话) 逐字节相等", async () => {
    const rt = runtime();
    const { seen, execution } = capturingExecution();

    await runOttoTurn(
      { orgId: "org_t", refId: "fixture:a7-fresh-short", input: "hi" },
      baseCtx,
      rt,
      execution as never,
    );
    await runOttoTurn(
      { orgId: "org_t", refId: "fixture:a7-fresh-poster", input: "make me a poster" },
      baseCtx,
      rt,
      execution as never,
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]!.instructions).toBe(assembleOttoInstructions("hi").text);
    expect(seen[1]!.instructions).toBe(assembleOttoInstructions("make me a poster").text);
    // 而且它**不是**整柜底稿 —— 否则上面两条会被「整柜恰好等于装配结果」蒙混过去。
    expect(seen[0]!.instructions).not.toBe(ottoInstructions);
    expect(seen[1]!.instructions).not.toBe(ottoInstructions);
    // 两轮装的不是同一份:一句话拉进来的柜文不同,说明书就不同(拆柜的意义所在)。
    expect(seen[0]!.instructions).not.toBe(seen[1]!.instructions);
  });

  it("ENGINE-A7:恢复轮 —— agent 就是 runtime 那一个,instructions 是整柜底稿(B9 全量装载)", async () => {
    const rt = runtime();
    const { seen, execution } = capturingExecution();
    // 恢复轮的 input 既不是 string 也不是数组;#566 的守卫只要求它交出同一个 context 对象。
    const resumeInput = { _context: { context: baseCtx } };

    await runOttoTurn(
      { orgId: "org_t", refId: "fixture:a7-resume", input: resumeInput as never },
      baseCtx,
      rt,
      execution as never,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.instructions).toBe(ottoInstructions);
    expect(seen[0]!.agent).toBe(rt.agent); // 整柜相等就不 clone,原样送出去
  });

  /**
   * ENGINE-A7 × ENGINE-A6 —— ④段(#1206)合进主干之后的那条接线:被裁走的旧上下文必须真的走到
   * 装配器手里。变异实证:把 `runOttoTurn` 里的 `instructionsForTurn(request.input, request.rollingSummary)`
   * 改回 `instructionsForTurn(request.input)`,这一条当场红(装出来的说明书里没有那份柜文)。
   */
  it("ENGINE-A7:折叠端口带着的旧上下文真的进了装配器(裁剪之后不缩水)", async () => {
    const rt = runtime();
    const { seen, execution } = capturingExecution();
    const port = {
      dropped: [{ role: "user", content: "help me run a facebook advert" }] as never,
      priorSummary: null,
      save: () => {},
    };

    await runOttoTurn(
      {
        orgId: "org_t",
        refId: "fixture:a7-carried",
        input: [{ role: "user", content: "carry on then" }] as never,
        rollingSummary: port,
      },
      baseCtx,
      rt,
      execution as never,
    );

    // 两次调用:先是④段的折叠(那个 agent 用的是它自己那份摘要指令),再是商家这一轮。
    expect(seen).toHaveLength(2);
    expect((seen[0]!.agent as { name: string }).name).toBe("Otto rolling summary");

    const turnInput = [{ role: "user", content: "carry on then" }] as never;
    const withCarried = instructionsForTurn(turnInput, port);
    const withoutCarried = instructionsForTurn(turnInput);
    // 前提:带与不带确实装出两份不同的说明书,否则下面那句等式没有分辨力。
    expect(withCarried.files).not.toEqual(withoutCarried.files);
    expect(seen[1]!.instructions).toBe(withCarried.text);
  });
});

// ── §17 Phase 1 Done: fake provider through the SHARED runner ────────────────

describe("runOttoTurn — fake provider through the shared runner ($0 fixture)", () => {
  it("fresh interactive: executes a SAFE skill end-to-end and finalizes", async () => {
    const log: string[] = [];
    const deps: OttoRuntimeDeps = {
      modelRuntime: fixtureModelRuntime(fakeToolCallingModel("echoBrand", { q: "brand colors" }, "Echoed!")),
      skills: [makeSafeSkill(log)],
    };
    const rt = createOttoRuntime(deps, "interactive");

    const result = await runOttoTurn(
      { orgId: "org_t", refId: "fixture:fresh", input: "echo the brand colors" },
      baseCtx,
      rt,
    );
    const fin = finalizeOttoTurn(result, rt);

    expect(log).toEqual(["org_t:brand colors"]); // the skill ran, with ctx identity
    expect(fin.interrupted).toBe(false);
    expect(fin.approvals).toEqual([]);
    expect(fin.text).toBe("Echoed!");
    expect(typeof fin.newOttoState).toBe("string");
    expect(fin.newOttoState.length).toBeGreaterThan(0);
  });

  it("stream leg: drains events through onStream, then finalizes from the completed stream", async () => {
    const events: string[] = [];
    const deps: OttoRuntimeDeps = {
      modelRuntime: fixtureModelRuntime(fakeTextModel("hi there")),
      skills: [],
    };
    const rt = createOttoRuntime(deps, "interactive");

    const result = await runOttoTurn(
      {
        orgId: "org_t",
        refId: "fixture:stream",
        input: "hello",
        stream: true,
        onStream: async (r) => {
          for await (const event of r) events.push(event.type);
        },
      },
      baseCtx,
      rt,
    );
    const fin = finalizeOttoTurn(result, rt);

    expect(events).toContain("raw_model_stream_event");
    expect(fin.interrupted).toBe(false);
    expect(fin.text).toBe("hi there");
    expect(fin.newOttoState.length).toBeGreaterThan(0);
  });

  it("approval-resume: parks the gated call, then the serialize→restore→approve→resume round-trip executes EXACTLY the approved tool", async () => {
    const log: string[] = [];
    const deps: OttoRuntimeDeps = {
      modelRuntime: fixtureModelRuntime(
        fakeToolCallingModel("approveScheduledPost", { scheduledPostId: "sp_1" }, "Approved and scheduled!"),
      ),
      skills: [makeGatedSkill(log)],
    };
    const interactive = createOttoRuntime(deps, "interactive");
    const resume = createOttoRuntime(deps, "approval-resume");

    // Turn 1 (fresh): the gated tool parks — NO execution.
    const r1 = await runOttoTurn({ orgId: "org_t", refId: "fixture:park", input: "approve it" }, baseCtx, interactive);
    const fin1 = finalizeOttoTurn(r1, interactive);
    expect(fin1.interrupted).toBe(true);
    expect(fin1.approvals).toEqual([
      { toolName: "approveScheduledPost", ref: "sp_1", args: { scheduledPostId: "sp_1" } },
    ]);
    expect(log).toEqual([]); // parked, not executed

    // The production DB round-trip: serialize, restore against the approval-resume agent, carrying
    // the live context (#566 — a fromString restore would resume with the ports stripped).
    const restored = (await tryRestoreRunStateWithContext(resume.agent, fin1.newOttoState, baseCtx))!;
    const parked = restored.getInterruptions();
    expect(parked.length).toBe(1);
    restored.approve(parked[0]!);

    // Turn 2 (approval-resume): the approved tool executes, then the model closes the turn.
    const r2 = await runOttoTurn({ orgId: "org_t", refId: "fixture:resume", input: restored }, baseCtx, resume);
    const fin2 = finalizeOttoTurn(r2, resume);
    expect(log).toEqual(["org_t:sp_1"]); // executed exactly once
    expect(fin2.interrupted).toBe(false);
    expect(fin2.text).toBe("Approved and scheduled!");
  });

  it("restores an old-construction SDK state against the new production approval agent and resumes", async () => {
    // Exact pre-seam construction shape: standalone Agent, same name/instructions/settings,
    // and the full production tool registry. It is intentionally not built by the new factory.
    const legacyModelRuntime = fixtureModelRuntime(
      fakeToolCallingModel("approveScheduledPost", { scheduledPostId: "sp_legacy" }, "legacy-unused"),
    );
    const legacyAgent = new Agent<OttoContext>({
      name: "Otto",
      instructions: ottoInstructions,
      model: legacyModelRuntime.binding,
      modelSettings: { maxTokens: OTTO_OUTPUT_CAP_TOKENS },
      tools: allSkills.map((skill) => skill.tool),
    });
    const legacyRuntime = Object.freeze({
      profile: "interactive" as const,
      modelRuntime: legacyModelRuntime,
      agent: legacyAgent,
      maxTurns: OTTO_MAX_STEPS,
      // ENGINE-A2: the trace's action whitelist travels with the runtime. This hand-built
      // legacy runtime mirrors createOttoRuntime's derivation from the same skill list.
      actionNames: new Set(allSkills.map((skill) => skill.name)) as ReadonlySet<string>,
      // ENGINE-A4: 同一份名单的写子集,同样照 createOttoRuntime 的推导写一遍。
      deliveringActionNames: new Set(
        allSkills.filter((skill) => skill.effect === "write").map((skill) => skill.name),
      ) as ReadonlySet<string>,
    });
    const parkedResult = await runOttoTurn(
      { orgId: "org_t", refId: "fixture:legacy-park", input: "approve the legacy post" },
      baseCtx,
      legacyRuntime,
    );
    const serialized = finalizeOttoTurn(parkedResult, legacyRuntime).newOttoState;

    const restored = (await tryRestoreRunStateWithContext(ottoApprovalResumeRuntime.agent, serialized, baseCtx))!;
    expect(restored.currentAgent).toBe(ottoApprovalResumeRuntime.agent);
    expect(restored.currentAgent).not.toBe(legacyRuntime.agent);
    const [interruption] = restored.getInterruptions();
    expect(interruption).toBeDefined();
    restored.approve(interruption!);

    // Never touch the network: only the provider edge is stubbed. SDK resume, pending-tool
    // handling, production Agent/tool lookup, shared runner, and finalizer all remain real.
    const provider = ottoApprovalResumeRuntime.modelRuntime.binding;
    const providerSpy = vi.spyOn(provider, "getResponse").mockResolvedValue({
      usage: fakeUsage(),
      output: [{
        type: "message" as const,
        role: "assistant" as const,
        status: "completed" as const,
        content: [{ type: "output_text" as const, text: "Production agent resumed." }],
      }],
    });
    try {
      const resumedResult = await runOttoTurn(
        { orgId: "org_t", refId: "fixture:legacy-resume", input: restored },
        baseCtx,
        ottoApprovalResumeRuntime,
        {
          runAgent: sdkRun,
          meter: async (_args, fn) => (await fn()).result,
          maxTurnsExceededError: MaxTurnsExceededError,
        },
      );
      const finalized = finalizeOttoTurn(resumedResult, ottoApprovalResumeRuntime);
      expect(finalized.interrupted).toBe(false);
      expect(finalized.text).toBe("Production agent resumed.");
      expect(providerSpy).toHaveBeenCalledOnce();
    } finally {
      providerSpy.mockRestore();
    }
  });

  // #791-4: the single-step, tool-less verdict leg is gone with the automatic Review
  // round. A text-only run through the shared finalizer is still covered by the
  // eval-profile legs above.
});

// ── #566: a resumed run must carry the LIVE context (injected ports survive) ──
//
// Production bug (5 weeks, 3 clicks, 0 generations, 0 log lines): the approve path restored the
// parked RunState with RunState.fromString and only THEN built the context. The serialized state is
// JSON, so the restored context had lost every function field, and run() ignores options.context for
// a resumed state — so the rebuilt one was never consulted. `generate` hit its fail-closed
// `if (!ctx.startGen) throw` guard, the SDK folded that throw into the tool's return value, and the
// merchant was told to press the button they had just pressed.
//
// These tests run the REAL SDK serialize→restore→approve→resume cycle (a fake model at the provider
// edge only). No RunState double: a mock is exactly what let CI stay green through this bug.
describe("#566 — resume carries the live context", () => {
  /** Test-only gated skill shaped like the real spend gate: its work is reachable ONLY through an
   *  injected function port, and it runs the same fail-closed guard as
   *  packages/otto/src/skills/generate.ts ("startGen port required"). */
  function makePortGatedSkill(log: string[]) {
    return defineOttoSkill({
      name: "approveScheduledPost", // a registry approval name, so the park is a real gated park
      cost: "free",
      effect: "write",
      reach: "external",
      description: "Test-only gated skill that can only work through an injected port.",
      parameters: z.object({ scheduledPostId: z.string() }),
      execute: async (input, runContext) => {
        const ctx = runContext.context as OttoContext;
        if (!ctx.startGen) throw new Error("startGen port required");
        const port = await ctx.startGen({ id: input.scheduledPostId } as never);
        log.push(`${input.scheduledPostId}:${JSON.stringify(port)}:${ctx.approvalConsent?.expectedUpdatedAt ?? "-"}`);
        return { ok: true };
      },
    });
  }

  /** A live context: the scalars survive JSON, the port does not. */
  function liveCtx(): OttoContext {
    return {
      ...baseCtx,
      startGen: async () => ({ id: "job_1", disposition: "fresh" as const }),
    };
  }

  /** Park the gated call and return the serialized state + the two runtimes, exactly as production
   *  persists it on ChatThread.ottoState. */
  async function parkGatedCall(log: string[]) {
    const deps: OttoRuntimeDeps = {
      modelRuntime: fixtureModelRuntime(
        fakeToolCallingModel("approveScheduledPost", { scheduledPostId: "sp_1" }, "Done!"),
      ),
      skills: [makePortGatedSkill(log)],
    };
    const interactive = createOttoRuntime(deps, "interactive");
    const resume = createOttoRuntime(deps, "approval-resume");
    const parked = await runOttoTurn(
      { orgId: "org_t", refId: "fixture:566-park", input: "do it" },
      liveCtx(),
      interactive,
    );
    const fin = finalizeOttoTurn(parked, interactive);
    expect(fin.interrupted).toBe(true);
    expect(log).toEqual([]);
    return { serialized: fin.newOttoState, resume };
  }

  it("SDK truth: fromString drops the ports and run() IGNORES options.context on a resumed state", async () => {
    const log: string[] = [];
    const { serialized, resume } = await parkGatedCall(log);

    // The exact pre-fix production sequence: restore without a context, then hand the freshly built
    // live context to run() as an option.
    const restored = await RunState.fromString(resume.agent, serialized);
    expect((restored as unknown as { _context: { context: OttoContext } })._context.context.startGen)
      .toBeUndefined(); // JSON kept the scalars, dropped the port
    restored.approve(restored.getInterruptions()[0]!);

    const ctx = liveCtx();
    const resumed = await sdkRun(resume.agent, restored, { context: ctx, maxTurns: OTTO_MAX_STEPS });

    expect(log).toEqual([]); // the port was NEVER reached — this is #566
    // …and the failure is invisible: the throw came back as the tool's own result text.
    expect(resumed.state.toString()).toContain("startGen port required");
  });

  it("tryRestoreRunStateWithContext re-attaches the live ports, so the approved tool reaches them", async () => {
    const log: string[] = [];
    const { serialized, resume } = await parkGatedCall(log);
    const ctx = liveCtx();

    const restored = await tryRestoreRunStateWithContext(resume.agent, serialized, ctx);
    expect(restored).not.toBeNull();
    restored!.approve(restored!.getInterruptions()[0]!);

    const resumed = await runOttoTurn(
      { orgId: "org_t", refId: "fixture:566-resume", input: restored! },
      ctx,
      resume,
    );
    const fin = finalizeOttoTurn(resumed, resume);

    expect(log).toEqual([`sp_1:{"id":"job_1","disposition":"fresh"}:-`]); // port called exactly once
    expect(fin.interrupted).toBe(false);
    expect(fin.text).toBe("Done!");
  });

  it("fields assigned to the context AFTER the restore still reach the tool (late-bound consent)", async () => {
    // ottoApprove can only compute the hash-time consent snapshot and the factory attemptId once it
    // has inspected the restored interruptions, so it assigns them onto the already-restored
    // context. That works only because the state holds the context BY REFERENCE — assert it does.
    const log: string[] = [];
    const { serialized, resume } = await parkGatedCall(log);
    const ctx = liveCtx();

    const restored = (await tryRestoreRunStateWithContext(resume.agent, serialized, ctx))!;
    restored.approve(restored.getInterruptions()[0]!);
    ctx.approvalConsent = { scheduledPostId: "sp_1", expectedUpdatedAt: "2026-07-31T00:00:00.000Z" };

    await runOttoTurn({ orgId: "org_t", refId: "fixture:566-late", input: restored }, ctx, resume);

    expect(log).toEqual([`sp_1:{"id":"job_1","disposition":"fresh"}:2026-07-31T00:00:00.000Z`]);
  });

  /** A BILLABLE resume runtime. The $0 fixture manifest short-circuits withLlmBudget entirely
   *  (`paid:false` ⇒ no reserve, no settle), which would make "reserveCredits was not called" true
   *  no matter what the guard did. Billing must be genuinely reachable for that assertion to mean
   *  anything, so the guard tests below run on a paid manifest and prove reachability first. */
  function paidResumeRuntime(log: string[]) {
    const deps: OttoRuntimeDeps = {
      modelRuntime: paidFixtureModelRuntime(
        fakeToolCallingModel("approveScheduledPost", { scheduledPostId: "sp_1" }, "Done!"),
      ),
      skills: [makePortGatedSkill(log)],
    };
    return createOttoRuntime(deps, "approval-resume");
  }

  it("the shared runner REFUSES a resumed state whose context is not the live one (fail-closed, no reservation)", async () => {
    const log: string[] = [];
    const { serialized } = await parkGatedCall(log);
    const paidResume = paidResumeRuntime(log);
    const restored = await RunState.fromString(paidResume.agent, serialized);
    restored.approve(restored.getInterruptions()[0]!);

    // Control: on this very runtime a fresh run DOES reserve — so the assertion below is real.
    // #898: a conversation turn reserves through reserveCreditsUpTo, so that is the live seam.
    meterMocks.reserveCredits.mockClear();
    meterMocks.reserveCreditsUpTo.mockClear();
    await runOttoTurn({ orgId: "org_t", refId: "fixture:566-control", input: "hi" }, liveCtx(), paidResume);
    expect(meterMocks.reserveCreditsUpTo).toHaveBeenCalled();

    meterMocks.reserveCredits.mockClear();
    meterMocks.reserveCreditsUpTo.mockClear();
    await expect(
      runOttoTurn({ orgId: "org_t", refId: "fixture:566-guard", input: restored }, liveCtx(), paidResume),
    ).rejects.toThrow(/tryRestoreRunStateWithContext/);

    expect(log).toEqual([]);
    // Refused before any spend or model call — neither reserve seam fired.
    expect(meterMocks.reserveCreditsUpTo).not.toHaveBeenCalled();
    expect(meterMocks.reserveCredits).not.toHaveBeenCalled();
  });

  // #566 R2 review: the first version of the guard only compared identity when `_context.context`
  // happened to be readable, so a missing field — an SDK internal reshape, a second incompatible
  // SDK copy, or a test double — waved the run straight through into metering. The classification
  // is now positive: string/array = fresh, anything else = resume and must prove its context.
  it("refuses a resume-shaped input that exposes NO comparable context, instead of waving it into billing", async () => {
    const paidResume = paidResumeRuntime([]);
    meterMocks.reserveCredits.mockClear();
    meterMocks.reserveCreditsUpTo.mockClear();

    const outcomes: string[] = [];
    for (const shapeless of [{}, { _context: null }, { _context: {} }, { _context: { context: undefined } }]) {
      await runOttoTurn(
        { orgId: "org_t", refId: "fixture:566-shapeless", input: shapeless as never },
        liveCtx(),
        paidResume,
      ).then(
        () => outcomes.push("RESOLVED — the runner accepted an unverifiable state"),
        (e: unknown) => outcomes.push(e instanceof Error ? e.message : String(e)),
      );
    }

    // The load-bearing consequence of failing OPEN is that billing is entered at all — assert that
    // first, so a regression reads as a money finding rather than a message mismatch.
    // #898: both reserve seams, so a future route change can't quietly move past this guard.
    expect(meterMocks.reserveCreditsUpTo).not.toHaveBeenCalled();
    expect(meterMocks.reserveCredits).not.toHaveBeenCalled();
    for (const outcome of outcomes) expect(outcome).toMatch(/exposes no comparable RunState context/);
  });

  it("still lets the two fresh-input shapes through untouched (string and item array)", async () => {
    const { resume } = await parkGatedCall([]);
    // A fresh run legitimately has no RunState context — the SDK honours options.context there.
    await expect(
      runOttoTurn({ orgId: "org_t", refId: "fixture:566-fresh-string", input: "hello" }, liveCtx(), resume),
    ).resolves.toBeDefined();
    await expect(
      runOttoTurn(
        { orgId: "org_t", refId: "fixture:566-fresh-array", input: [{ role: "user", content: "hello" }] as never },
        liveCtx(),
        resume,
      ),
    ).resolves.toBeDefined();
  });
});
