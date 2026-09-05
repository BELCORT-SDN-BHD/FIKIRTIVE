/**
 * ENGINE-A2 — 每轮调试档案(规格 `docs/specs/otto-engine.md` §7.2②)。
 *
 * 三件事在这里被钉住:
 *  1. **它记得住**:跑完一轮,sink 拿到的是「走了几步 / 调了哪些动作 / 各几次成败」;
 *     跑满步数被截断的那一轮同样有档案(truncated=true)—— 那正是最值得看的一轮。
 *  2. **无明文围栏**:facts 上没有自由文本字段。喂进一个塞满 prompt、消息正文、工具参数的
 *     状态,产出的整份 facts 里一个字都不含它们;不在注册表里的动作名被折成固定字面量,
 *     所以模型自造的名字也没有夹带的余地。
 *  3. **它不承重**:sink 抛错不影响商家的这一轮;预扣被拒的那一轮(模型根本没跑)不落档案。
 */
process.env.OPENAI_AGENTS_DISABLE_TRACING = "1";

import { describe, it, expect, beforeEach, vi } from "vitest";

const meterMocks = vi.hoisted(() => {
  const transaction = vi.fn();
  return {
    transaction,
    reserveCredits: vi.fn(),
    reserveCreditsUpTo: vi.fn(),
    settleCredits: vi.fn(),
    refundReservation: vi.fn(),
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
import { Usage, MaxTurnsExceededError } from "@openai/agents";
import type { Model, ModelRequest, ModelResponse, StreamEvent } from "@openai/agents";
import { OTTO_MAX_STEPS, llmPricesFor } from "@fikirtive/core";
import {
  createOttoRuntime,
  runOttoTurn,
  collectTurnTraceFacts,
  UNREGISTERED_ACTION,
  type OttoModelRuntime,
  type OttoTurnTraceFacts,
  type OttoTurnTracePort,
} from "./runtime.js";
import { mapOttoUsage } from "./meter.js";
import { defineOttoSkill } from "./skill.js";
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
});

/** Fixture manifest: `fixture-no-charge` ⇒ paid:false ⇒ withLlmBudget touches ZERO credits. */
function fixtureModelRuntime(binding: Model): OttoModelRuntime {
  return Object.freeze({
    binding,
    billableModelId: "fixture-no-charge",
    resolvedModelPolicy: Object.freeze({ primaryModelId: "fixture", fallbackModelId: null, failover: "none" as const }),
    mapUsage: mapOttoUsage,
    cacheCapabilities: Object.freeze({ promptCache: false }),
    pricing: llmPricesFor,
  });
}

/** Test-only SAFE skill (free/read/internal ⇒ no approval), named after nothing in the registry
 *  on purpose — the runtime's whitelist comes from the skills it was COMPOSED with. */
function echoSkill(name = "echoBrand") {
  return defineOttoSkill({
    name,
    cost: "free" as const,
    effect: "read" as const,
    reach: "internal" as const,
    description: "Test-only safe read skill.",
    parameters: z.object({ q: z.string() }),
    execute: async (input) => ({ ok: true, echoed: input.q }),
  });
}

/** Calls `toolName` once, then answers with text. */
function toolThenTextModel(toolName: string, args: Record<string, unknown>, finalText: string): Model {
  let calls = 0;
  return {
    async getResponse(_request: ModelRequest): Promise<ModelResponse> {
      calls += 1;
      if (calls === 1) {
        return {
          usage: fakeUsage(),
          output: [
            { type: "function_call" as const, callId: "call_1", name: toolName, arguments: JSON.stringify(args), status: "completed" as const },
          ],
        };
      }
      return {
        usage: fakeUsage(),
        output: [
          { type: "message" as const, role: "assistant" as const, status: "completed" as const, content: [{ type: "output_text" as const, text: finalText }] },
        ],
      };
    },
    async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
      const resp = await this.getResponse(request);
      yield { type: "response_done", response: { id: "fake-resp", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }, output: resp.output } } as StreamEvent;
    },
  };
}

/** Never stops calling the tool → the run burns through maxTurns → MaxTurnsExceededError. */
function alwaysToolCallingModel(toolName: string): Model {
  let n = 0;
  return {
    async getResponse(_request: ModelRequest): Promise<ModelResponse> {
      n += 1;
      return {
        usage: fakeUsage(),
        output: [
          { type: "function_call" as const, callId: `call_${n}`, name: toolName, arguments: JSON.stringify({ q: "again" }), status: "completed" as const },
        ],
      };
    },
    async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
      const resp = await this.getResponse(request);
      yield { type: "response_done", response: { id: "fake-resp", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }, output: resp.output } } as StreamEvent;
    },
  };
}

function recordingPort(): { port: OttoTurnTracePort; seen: OttoTurnTraceFacts[] } {
  const seen: OttoTurnTraceFacts[] = [];
  return {
    seen,
    port: { surface: "action", threadId: "thread_t", sink: (facts) => { seen.push(facts); } },
  };
}

// ── 1. 它记得住 ───────────────────────────────────────────────────────────────

describe("ENGINE-A2 — 跑完一轮就有档案", () => {
  it("ENGINE-A2: 档案记下走了几步、调了哪个动作、成败各几次", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: fixtureModelRuntime(toolThenTextModel("echoBrand", { q: "hi" }, "done")), skills: [echoSkill()] },
      "interactive",
    );
    const { port, seen } = recordingPort();

    await runOttoTurn(
      { orgId: "org_t", refId: "otto-turn:msg_1", input: "hello", trace: port },
      baseCtx,
      runtime,
    );

    expect(seen).toHaveLength(1);
    const facts = seen[0]!;
    expect(facts.refId).toBe("otto-turn:msg_1");
    expect(facts.orgId).toBe("org_t");
    expect(facts.steps).toBeGreaterThan(0);
    expect(facts.truncated).toBe(false);
    expect(facts.toolCalls).toEqual([{ name: "echoBrand", calls: 1, ok: 1, failed: 0 }]);
  });

  it("ENGINE-A2: surface / threadId / modelId 来自入口与冻结的 manifest,不来自模型", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: fixtureModelRuntime(toolThenTextModel("echoBrand", { q: "hi" }, "done")), skills: [echoSkill()] },
      "interactive",
    );
    const { port, seen } = recordingPort();
    await runOttoTurn({ orgId: "org_t", refId: "otto-turn:msg_2", input: "hello", trace: port }, baseCtx, runtime);
    expect(seen[0]!.surface).toBe("action");
    expect(seen[0]!.threadId).toBe("thread_t");
    expect(seen[0]!.modelId).toBe("fixture-no-charge");
  });

  it("ENGINE-A2: 跑满步数被截断的那一轮同样落档案,truncated=true", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: fixtureModelRuntime(alwaysToolCallingModel("echoBrand")), skills: [echoSkill()] },
      "interactive",
    );
    const { port, seen } = recordingPort();

    await expect(
      runOttoTurn({ orgId: "org_t", refId: "otto-turn:msg_trunc", input: "loop", trace: port }, baseCtx, runtime),
    ).rejects.toBeInstanceOf(MaxTurnsExceededError);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.truncated).toBe(true);
    // 「跑满了」而不是一个精确等号:SDK 是先自增再判上限,所以抛错那一刻的计数是
    // maxTurns+1。断言 ≥ maxTurns 记的是这一轮真的烧到了顶,不把 SDK 的内部时序钉死。
    expect(seen[0]!.steps).toBeGreaterThanOrEqual(OTTO_MAX_STEPS);
    expect(seen[0]!.toolCalls[0]!.name).toBe("echoBrand");
    expect(seen[0]!.toolCalls[0]!.calls).toBeGreaterThan(1);
  });

  it("ENGINE-A2: ⑥段之前 skillFiles 恒为空数组(没有文件柜就不假造名单)", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: fixtureModelRuntime(toolThenTextModel("echoBrand", { q: "hi" }, "done")), skills: [echoSkill()] },
      "interactive",
    );
    const { port, seen } = recordingPort();
    await runOttoTurn({ orgId: "org_t", refId: "otto-turn:msg_3", input: "hello", trace: port }, baseCtx, runtime);
    expect(seen[0]!.skillFiles).toEqual([]);
  });
});

// ── 2. 无明文围栏 ─────────────────────────────────────────────────────────────

describe("ENGINE-A2 — 无明文围栏(prompt / 消息正文 / 参数值都进不来)", () => {
  const SECRET = "SECRET-MERCHANT-TEXT-nasi-lemak-promo-30-percent";

  /** 一个塞满了商家内容的 RunState:助手正文、工具参数、工具返回值全是 SECRET。 */
  const dirtyState = {
    _currentTurn: 4,
    _generatedItems: [
      { type: "message_output_item", rawItem: { type: "message", role: "assistant", content: [{ type: "output_text", text: SECRET }] } },
      { type: "reasoning_item", rawItem: { type: "reasoning", content: [{ type: "input_text", text: SECRET }] } },
      { type: "tool_call_item", rawItem: { type: "function_call", callId: "c1", name: "echoBrand", arguments: JSON.stringify({ q: SECRET }), status: "completed" } },
      { type: "tool_call_output_item", rawItem: { type: "function_call_result", callId: "c1", name: "echoBrand", status: "completed", output: { type: "text", text: SECRET } } },
    ],
  };

  const runtimeLike = {
    modelRuntime: { billableModelId: "claude-sonnet-4-6" } as OttoModelRuntime,
    actionNames: new Set(["echoBrand"]) as ReadonlySet<string>,
  };
  const port: OttoTurnTracePort = { surface: "stream", threadId: "thread_t", sink: () => {} };

  it("ENGINE-A2: 整份 facts 序列化之后不含 prompt、消息正文或任何参数值", () => {
    const facts = collectTurnTraceFacts(dirtyState, runtimeLike, port, { orgId: "org_t", refId: "otto-stream:m" }, false);
    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("nasi-lemak");
    // 该在的还在:结构事实一件不少。
    expect(facts.steps).toBe(4);
    expect(facts.toolCalls).toEqual([{ name: "echoBrand", calls: 1, ok: 1, failed: 0 }]);
  });

  it("ENGINE-A2: facts 的每一个字符串字段都出自封闭集,没有一个来自被观察的状态", () => {
    const facts = collectTurnTraceFacts(dirtyState, runtimeLike, port, { orgId: "org_t", refId: "otto-stream:m" }, false);
    const allowed = new Set(["org_t", "otto-stream:m", "thread_t", "stream", "claude-sonnet-4-6", "echoBrand", UNREGISTERED_ACTION]);
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") { strings.push(v); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === "object") { Object.values(v).forEach(walk); }
    };
    walk(facts);
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) expect(allowed.has(s), `unexpected string on the trace: ${s}`).toBe(true);
  });

  it("ENGINE-A2: 不在注册表里的动作名被折成固定字面量,模型自造的名字夹带不进来", () => {
    const smuggled = "leak__" + SECRET;
    const state = {
      _currentTurn: 2,
      _generatedItems: [
        { type: "tool_call_item", rawItem: { type: "function_call", callId: "c9", name: smuggled, arguments: "{}", status: "completed" } },
        { type: "tool_call_output_item", rawItem: { type: "function_call_result", callId: "c9", name: smuggled, status: "incomplete", output: SECRET } },
      ],
    };
    const facts = collectTurnTraceFacts(state, runtimeLike, port, { orgId: "org_t", refId: "otto-stream:m2" }, false);
    expect(facts.toolCalls).toEqual([{ name: UNREGISTERED_ACTION, calls: 1, ok: 0, failed: 1 }]);
    expect(JSON.stringify(facts)).not.toContain(SECRET);
  });

  it("ENGINE-A2: 两个不同的未注册名字折进同一格,不会各自夹带一份自己的字符串", () => {
    const state = {
      _currentTurn: 2,
      _generatedItems: [
        { type: "tool_call_item", rawItem: { type: "function_call", callId: "a", name: "made_up_one", arguments: "{}", status: "completed" } },
        { type: "tool_call_item", rawItem: { type: "function_call", callId: "b", name: "made_up_two", arguments: "{}", status: "completed" } },
      ],
    };
    const facts = collectTurnTraceFacts(state, runtimeLike, port, { orgId: "org_t", refId: "otto-stream:m3" }, false);
    expect(facts.toolCalls).toEqual([{ name: UNREGISTERED_ACTION, calls: 2, ok: 0, failed: 0 }]);
  });

  it("ENGINE-A2: 白名单来自组合这台 runtime 的那份技能表(registry),不是一份手抄名单", () => {
    const runtime = createOttoRuntime(
      { modelRuntime: fixtureModelRuntime(toolThenTextModel("echoBrand", { q: "hi" }, "done")), skills: [echoSkill("echoBrand"), echoSkill("secondAction")] },
      "interactive",
    );
    expect([...runtime.actionNames].sort()).toEqual(["echoBrand", "secondAction"]);
    // 组合进去的名字过得去,没组合进去的被折掉 —— 一个来源,不会「记了却没装」。
    const state = {
      _currentTurn: 1,
      _generatedItems: [
        { type: "tool_call_item", rawItem: { type: "function_call", callId: "a", name: "secondAction", arguments: "{}", status: "completed" } },
        { type: "tool_call_item", rawItem: { type: "function_call", callId: "b", name: "notComposed", arguments: "{}", status: "completed" } },
      ],
    };
    const facts = collectTurnTraceFacts(state, runtime, port, { orgId: "org_t", refId: "otto-stream:m4" }, false);
    expect(facts.toolCalls).toEqual([
      { name: "secondAction", calls: 1, ok: 0, failed: 0 },
      { name: UNREGISTERED_ACTION, calls: 1, ok: 0, failed: 0 },
    ]);
  });
});

// ── 3. 它不承重 ───────────────────────────────────────────────────────────────

describe("ENGINE-A2 — 档案是诊断,永远不承重", () => {
  it("ENGINE-A2: sink 抛错不影响商家的这一轮(回复照常返回)", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: fixtureModelRuntime(toolThenTextModel("echoBrand", { q: "hi" }, "done")), skills: [echoSkill()] },
      "interactive",
    );
    const boom: OttoTurnTracePort = {
      surface: "stream",
      threadId: null,
      sink: () => { throw new Error("db is down"); },
    };
    const result = await runOttoTurn(
      { orgId: "org_t", refId: "otto-stream:msg_boom", input: "hello", trace: boom },
      baseCtx,
      runtime,
    );
    expect(result.state).toBeDefined();
  });

  it("ENGINE-A2: 没接 trace 端口的调用方与本改动之前逐字相同(不读、不写、不落档案)", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: fixtureModelRuntime(toolThenTextModel("echoBrand", { q: "hi" }, "done")), skills: [echoSkill()] },
      "interactive",
    );
    const result = await runOttoTurn({ orgId: "org_t", refId: "otto-turn:msg_noport", input: "hello" }, baseCtx, runtime);
    expect(result.state).toBeDefined();
  });

  it("ENGINE-A2: 预扣被拒的那一轮(模型根本没跑)不落档案", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: fixtureModelRuntime(toolThenTextModel("echoBrand", { q: "hi" }, "done")), skills: [echoSkill()] },
      "interactive",
    );
    const { port, seen } = recordingPort();
    const refused = new Error("InsufficientCredits");
    await expect(
      runOttoTurn(
        { orgId: "org_t", refId: "otto-turn:msg_refused", input: "hello", trace: port },
        baseCtx,
        runtime,
        {
          // 预扣在 fn 之前抛 —— 与 withLlmBudget 不变量 #1 同形:fn 从未被调用。
          meter: (async () => { throw refused; }) as never,
          runAgent: (() => { throw new Error("the model must never run"); }) as never,
        },
      ),
    ).rejects.toBe(refused);
    expect(seen).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 其余六段的 M3 占位(**不是本段的验收**)
//
// M3 闸读的是被引用规格里**全部**的验收编号(scripts/ci/process-gates.sh:308 的
// `git show "$BASE_SHA:$spec" | grep -oE '…-A[0-9]+'`),所以任何一个引用
// docs/specs/otto-engine.md 的产品 PR 都要求 ENGINE-A1–A7 七个编号在测试树里各有落点。
// 闸本身给的办法就是这个:「S4 早期可先 it.todo("<编号> …") 占位」。
//
// 每一条都标着它属于哪一段(§7.1 切段表)。**那一段落地时,由那一段把这里对应的一行删掉**,
// 换成它自己的真测试 —— 占位是欠条,不是覆盖。ENGINE-A1 已有落点
// (packages/core/src/creation-acceptance-map.test.ts),故不在此列。
// ─────────────────────────────────────────────────────────────────────────────

describe("Otto S2 —— 其余各段的验收占位(欠条,不是覆盖)", () => {
  it.todo("ENGINE-A3(§7.2⑦ 画布输入即对话):商家在画布输入框发消息 → 得到 Otto 对话回复,花钱动作仍走卡片确认");
  it.todo("ENGINE-A4(§7.2⑤ 截断轮退款):被截断且零交付的一轮全额退款,消费历史可见退款行");
  it.todo("ENGINE-A5(§7.2① 型号与价目 fail closed):manifest 指到价目表没有的型号 → 拒绝启动并报明原因");
  it.todo("ENGINE-A6(§7.2④ 长对话摘要与预算闸):旧轮被摘要收拢,新一轮成本不随历史无限上涨");
  it.todo("ENGINE-A7(§7.2⑥ 技能文件柜替换单体):拆柜后重跑评测,总分不低于基线");
});
