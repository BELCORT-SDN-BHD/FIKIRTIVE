/**
 * ENGINE-A6 · 成对感知裁剪器的穷举单测（规格 docs/specs/otto-engine.md §7.2④ 第一刀）。
 *
 * 规格点名的四个边角在这里逐个有真身：拆对、空历史、只有一对、超长单条。
 * 它们全部是纯函数测试——不碰库、不碰模型、不碰钱。
 */
import { describe, it, expect } from "vitest";
import {
  trimHistoryToBudget,
  estimateHistoryTokens,
  estimateTextTokens,
  rollingSummaryBlock,
  OTTO_HISTORY_BUDGET_TOKENS,
} from "./run-input.js";
import type { AgentInputItem } from "@openai/agents";

/** One assistant/user text turn of roughly `chars` characters. */
const say = (role: "user" | "assistant", chars: number, tag = "x"): AgentInputItem =>
  ({ role, content: tag.repeat(chars) }) as unknown as AgentInputItem;

/** A tool call and its result, as the SDK stores them in a rehydrated history. */
const call = (callId: string, chars = 40): AgentInputItem =>
  ({ type: "function_call", callId, name: "proposeGeneration", arguments: "a".repeat(chars) }) as unknown as AgentInputItem;
const result = (callId: string, chars = 40): AgentInputItem =>
  ({ type: "function_call_result", callId, name: "proposeGeneration", status: "completed", output: "b".repeat(chars) }) as unknown as AgentInputItem;

/** Every callId that still has a call but no result, or a result but no call. */
function orphanCallIds(items: readonly AgentInputItem[]): string[] {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const item of items) {
    const it = item as { type?: string; callId?: string };
    if (typeof it.callId !== "string") continue;
    if (it.type === "function_call") calls.add(it.callId);
    if (it.type === "function_call_result") results.add(it.callId);
  }
  return [...new Set([...calls, ...results])].filter((id) => !(calls.has(id) && results.has(id)));
}

describe("estimateTextTokens", () => {
  it("counts latin at ~4 chars/token", () => {
    expect(estimateTextTokens("a".repeat(400))).toBe(100);
  });

  it("counts CJK at ~2 tokens/char — an 8× difference the latin-only ratio would hide", () => {
    expect(estimateTextTokens("字".repeat(100))).toBe(200);
  });

  it("empty text is zero", () => {
    expect(estimateTextTokens("")).toBe(0);
  });
});

describe("ENGINE-A6 · trimHistoryToBudget — 成对感知裁剪器", () => {
  it("空历史 → 什么都不裁", () => {
    const out = trimHistoryToBudget([], 100);
    expect(out.kept).toEqual([]);
    expect(out.dropped).toEqual([]);
  });

  it("已经在预算内 → 原样返回，零裁剪", () => {
    const history = [say("user", 40), say("assistant", 40)];
    const out = trimHistoryToBudget(history, OTTO_HISTORY_BUDGET_TOKENS);
    expect(out.dropped).toEqual([]);
    expect(out.kept).toEqual(history);
  });

  it("超预算 → 从最旧一端裁，保留的是后缀", () => {
    const history = [say("user", 400, "1"), say("assistant", 400, "2"), say("user", 400, "3")];
    const budget = estimateHistoryTokens(history.slice(1));
    const out = trimHistoryToBudget(history, budget);
    expect(out.dropped).toEqual([history[0]]);
    expect(out.kept).toEqual(history.slice(1));
    expect(estimateHistoryTokens(out.kept)).toBeLessThanOrEqual(budget);
  });

  it("拆对：一刀正好落在 tool_call 与 tool_result 之间时，整对一起走（永不留孤儿）", () => {
    // 预算刚好容得下「result + 尾巴」——朴素切法会把 result 留下、call 裁掉。
    const history = [call("c1", 400), result("c1", 400), say("assistant", 40, "z")];
    const budget = estimateHistoryTokens(history.slice(1));
    const out = trimHistoryToBudget(history, budget);
    expect(orphanCallIds(out.kept)).toEqual([]);
    expect(orphanCallIds(out.dropped)).toEqual([]);
    // 那一对整个被裁掉，因为留下 result 就等于留下半对。
    expect(out.dropped).toEqual([history[0], history[1]]);
    expect(out.kept).toEqual([history[2]]);
  });

  it("拆对：call 与 result 之间夹着别的项，整段仍是一个不可切的块", () => {
    const history = [
      say("user", 40, "a"),
      call("c1", 200),
      say("assistant", 200, "m"), // 夹在对中间
      result("c1", 200),
      say("assistant", 40, "t"),
    ];
    const budget = estimateHistoryTokens([history[4]!]);
    const out = trimHistoryToBudget(history, budget);
    expect(orphanCallIds(out.kept)).toEqual([]);
    expect(out.kept).toEqual([history[4]]);
  });

  it("只有一对且它超预算 → 整对被裁掉（kept 为空，绝不留半对）", () => {
    const history = [call("c1", 4000), result("c1", 4000)];
    const out = trimHistoryToBudget(history, 10);
    expect(out.kept).toEqual([]);
    expect(out.dropped).toEqual(history);
    expect(orphanCallIds(out.dropped)).toEqual([]);
  });

  it("只有一对且它在预算内 → 原样保留", () => {
    const history = [call("c1", 40), result("c1", 40)];
    const out = trimHistoryToBudget(history, OTTO_HISTORY_BUDGET_TOKENS);
    expect(out.kept).toEqual(history);
    expect(out.dropped).toEqual([]);
  });

  it("超长单条 → 它自己被裁掉，后面的轮还留着", () => {
    const history = [say("user", 200_000, "L"), say("assistant", 40, "s")];
    const out = trimHistoryToBudget(history, 100);
    expect(out.dropped).toEqual([history[0]]);
    expect(out.kept).toEqual([history[1]]);
  });

  it("超长单条且它是唯一一条 → 整个历史被裁掉，交给摘要（不返回超预算的 kept）", () => {
    const history = [say("user", 200_000, "L")];
    const out = trimHistoryToBudget(history, 100);
    expect(out.kept).toEqual([]);
    expect(out.dropped).toEqual(history);
  });

  it("坏预算（0 / 负数 / NaN）→ 什么都不裁：fail closed 的方向是保住商家的对话", () => {
    const history = [say("user", 4000), say("assistant", 4000)];
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = trimHistoryToBudget(history, bad);
      expect(out.kept).toEqual(history);
      expect(out.dropped).toEqual([]);
    }
  });

  it("裁完的历史必然在预算以内（除非预算连一条都装不下，那时 kept 为空）", () => {
    const history = [
      say("user", 3000, "1"),
      call("c1", 1000),
      result("c1", 1000),
      say("assistant", 3000, "2"),
      call("c2", 1000),
      result("c2", 1000),
      say("user", 3000, "3"),
    ];
    for (const budget of [50, 500, 1000, 2000, 4000]) {
      const out = trimHistoryToBudget(history, budget);
      expect(orphanCallIds(out.kept)).toEqual([]);
      if (out.kept.length > 0) expect(estimateHistoryTokens(out.kept)).toBeLessThanOrEqual(budget);
      expect([...out.dropped, ...out.kept]).toEqual(history);
    }
  });
});

describe("ENGINE-A6 · rollingSummaryBlock — 回注块", () => {
  it("空 / 空白 / null 一律没有块（调用方无需分支）", () => {
    expect(rollingSummaryBlock(null)).toBeNull();
    expect(rollingSummaryBlock(undefined)).toBeNull();
    expect(rollingSummaryBlock("   ")).toBeNull();
  });

  it("有摘要 → 带标签的一块，原文逐字在内", () => {
    const block = rollingSummaryBlock("merchant sells kopi; wants Raya promo");
    expect(block).toContain("merchant sells kopi; wants Raya promo");
    expect(block).toContain("folded into this summary");
  });
});
