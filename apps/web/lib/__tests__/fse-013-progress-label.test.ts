/**
 * FSE-013 —— 进度按**实际发生的工具动作**显示。
 *
 * 现场（2026-09-08 staging 走查，`docs/audits/fullstack-staging-2026-09-08/findings-catalog.md`
 * FSE-013）：商家只请求查 Instagram 的尺寸、明确不要生成；OttoTurnTrace 是 4 步、researchWeb
 * 调用 3 次、没有 GenJob、没有 hold —— 而屏幕上写着「Researching your brand」与「Otto is
 * making it」。两句都不是这一轮发生的事：查的不是他的品牌，做的也不是一张图。
 *
 * 这一组测试喂三种事件序列（只查资料／有生成提交／纯规划），断言步骤标签与面板抬头都从
 * 真的被调用的工具派生。规格：`docs/specs/otto-engine.md` ENGINE-A2（一轮的调试档案要能看到
 * 走了几步、调了哪些工具）；进度是那份事实的商家侧投影，不能与它相反。
 *
 * Display only —— 这里一个字节都不碰预扣／结算／退款。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { stepEventOf, type OttoStepData } from "@/lib/otto-stream-bridge";
import { deriveTraceSteps } from "@/lib/otto-status-helpers";
import { OttoTrace, TRACE_HEADING_BY_KIND, traceHeadingOf } from "@/components/otto/OttoTrace";

/** 一个 tool_called / tool_output 事件，形状与 @openai/agents-core 的 run item 一致。 */
function toolEvent(name: string, phase: "tool_called" | "tool_output", callId: string) {
  return {
    type: "run_item_stream_event" as const,
    name: phase,
    item: {
      type: phase === "tool_called" ? "tool_call_item" : "tool_call_output_item",
      rawItem: { type: "function_call", name, callId },
      ...(phase === "tool_output" ? { output: { ok: true } } : {}),
    },
  };
}

/** 把一串工具名跑成这一轮的 data-step 序列（start→done 成对）。
 *  `openLast` = 最后一个工具只发 start —— 也就是「此刻正在跑的那一步」。 */
function stepsOfCalls(calls: readonly string[], openLast = false): OttoStepData[] {
  const out: OttoStepData[] = [];
  calls.forEach((name, i) => {
    const id = `call_${i + 1}`;
    const phases =
      openLast && i === calls.length - 1
        ? (["tool_called"] as const)
        : (["tool_called", "tool_output"] as const);
    for (const phase of phases) {
      const step = stepEventOf(toolEvent(name, phase, id));
      if (step) out.push(step);
    }
  });
  return out;
}

/** 这一轮跑完（done）之后，面板长什么样。 */
function panelMarkup(calls: readonly string[]): string {
  const steps = deriveTraceSteps(stepsOfCalls(calls), { kind: "done", threadId: "t_1" });
  return renderToStaticMarkup(createElement(OttoTrace, { steps }));
}

describe("FSE-013 · 进度按实际工具动作显示（ENGINE-A2 的商家侧投影）", () => {
  it("FSE-013 / ENGINE-A2 · 只查资料的一轮：说的是在查，不是在做", () => {
    const markup = panelMarkup(["researchWeb", "researchWeb", "researchWeb"]);
    // 走查现场那两句，一句都不许再出现在这种一轮上。
    expect(markup).not.toContain("Otto is making it");
    expect(markup).not.toContain("Researching your brand");
    expect(markup).toContain(TRACE_HEADING_BY_KIND.research);
    expect(markup).toContain("Searching the web");
  });

  it("FSE-013 / ENGINE-A2 · 真提交了生成的一轮：这时候才说 making it", () => {
    const markup = panelMarkup(["researchWeb", "propose", "generate"]);
    expect(markup).toContain(TRACE_HEADING_BY_KIND.making);
    expect(markup).toContain("Making a visual");
  });

  it("FSE-013 / ENGINE-A2 · 纯规划的一轮：说的是在想，不是在做", () => {
    const markup = panelMarkup(["propose"]);
    expect(markup).toContain(TRACE_HEADING_BY_KIND.planning);
    expect(markup).not.toContain("Otto is making it");
  });

  it("FSE-013 / ENGINE-A2 · 抬头跟着**正在跑**的那一步走，而不是跟着顺序占位", () => {
    // 查完资料，此刻正在出片 ⇒ 说出片；反过来（做完了正在查）⇒ 说查。
    const researching = deriveTraceSteps(stepsOfCalls(["generate", "researchWeb"], true), null);
    expect(researching.map((s) => s.status)).toEqual(["done", "active"]);
    expect(traceHeadingOf(researching)).toBe(TRACE_HEADING_BY_KIND.research);

    const making = deriveTraceSteps(stepsOfCalls(["researchWeb", "generate"], true), null);
    expect(making.map((s) => s.status)).toEqual(["done", "active"]);
    expect(traceHeadingOf(making)).toBe(TRACE_HEADING_BY_KIND.making);
  });

  it("FSE-013 / ENGINE-A2 · 步骤类别来自被调用的工具本身（流上就带着，不靠猜文案）", () => {
    expect(stepEventOf(toolEvent("researchWeb", "tool_called", "call_1"))).toEqual({
      id: "call_1",
      label: "Searching the web",
      phase: "start",
      kind: "research",
    });
    expect(stepEventOf(toolEvent("generate", "tool_called", "call_2"))?.kind).toBe("making");
    expect(stepEventOf(toolEvent("propose", "tool_called", "call_3"))?.kind).toBe("planning");
    expect(stepEventOf(toolEvent("manageMedia", "tool_called", "call_4"))?.kind).toBe("working");
    // 不发步骤的内部工具照旧沉默。
    expect(stepEventOf(toolEvent("setTitle", "tool_called", "call_5"))).toBeNull();
  });
});
