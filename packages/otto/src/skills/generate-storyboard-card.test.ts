/**
 * generate-storyboard-card.test.ts —— FC-1:对话里说「直接生成」,分镜卡编号被塞进 generate。
 *
 * 现场(Founder 自己的画布,staging 14bcd038,2026-09-14 05:53–05:54 UTC):两镜
 * STORYBOARD_CARD 出来之后商家说 `can, just do it stragiht away, no need starting image`,
 * Otto 答 `Got it! Let me generate both shots straight away!`,追问卡片时又答
 * `Sorry! Let me call up the generate cards for both shots now.` —— 两轮都调了
 * `generate({cardId: <STORYBOARD_CARD id>})`,停在 SDK 的花费批准项,零 GEN_CARD、零 GenJob。
 * 取证:docs/audits/founder-canvas-2026-09-14/{report.md,backend-report.md,pending-generate-diagnosis.md}。
 *
 * 这个文件钉住两件事:
 *  ① **前提**(改不改都成立):真 SDK 的批准暂停发生在 execute 之前,所以「卡的种类对不对」
 *     在暂停那一刻**没有**被问过 —— 接线层因此拿到一个指向分镜卡的批准项。它同时把那个
 *     中断项的形状(`rawItem.name` / `arguments`)钉下来,apps/web 那一侧的接线用例正是按
 *     这个形状造的替身。
 *  ② **修复**:真到执行那一步时,`generate` 必须**可解释地**拒绝 —— 说清那是分镜卡、以及
 *     该走哪条路,而不是一句与「卡被删了 / 不是你的卡」无法区分的 `Card not found.`。
 *
 * 花费守卫一格不动:这里从头到尾 `ctx.startGen` 零调用。
 */
process.env.OPENAI_AGENTS_DISABLE_TRACING = "1";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Usage } from "@openai/agents";
import { llmPricesFor } from "@fikirtive/core";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: { findFirst: vi.fn(), update: vi.fn() },
    genJob: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@fikirtive/db";
import { generateSkill, executeGenerate } from "./generate.js";
import { createOttoRuntime, runOttoTurn, finalizeOttoTurn } from "../runtime.js";
import { mapOttoUsage } from "../meter.js";
import type { OttoContext } from "../context.js";

const STORYBOARD_CARD_ID = "01M2F7DPAH7VZQYX722SCWK9JX"; // 现场那张两镜分镜卡
const PROMISE_TEXT = "Sorry! Let me call up the generate cards for both shots now.";
const ORG_ID = "org-fc1";

/** 只回一句承诺 + 一次 `generate({cardId})` 的假模型。不打任何供应商。 */
function fakeModel(cardId: string) {
  const message = {
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: PROMISE_TEXT }],
  };
  const call = {
    type: "function_call",
    callId: "fc1-call",
    name: "generate",
    arguments: JSON.stringify({ cardId }),
    status: "completed",
  };
  const usage = new Usage({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
  return {
    async getResponse() {
      return { usage, output: [message, call] };
    },
    async *getStreamedResponse() {
      yield {
        type: "response_done",
        response: { id: "fc1", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }, output: [message, call] },
      };
    },
  };
}

function makeCtx(): OttoContext & { startGen: ReturnType<typeof vi.fn> } {
  return {
    orgId: ORG_ID,
    userId: "user-fc1",
    projectId: "proj-fc1",
    threadId: "thread-fc1",
    disabledModels: [],
    sourceGenerationId: null,
    startGen: vi.fn(),
  } as OttoContext & { startGen: ReturnType<typeof vi.fn> };
}

/** 真 runtime + 真 generateSkill + 真 SDK:跑一轮,停在批准项。 */
async function park(cardId: string) {
  const runtime = createOttoRuntime(
    {
      modelRuntime: {
        binding: fakeModel(cardId) as never,
        billableModelId: "fixture-no-charge",
        resolvedModelPolicy: { primaryModelId: "fixture", fallbackModelId: null, failover: "none" },
        mapUsage: mapOttoUsage,
        cacheCapabilities: { promptCache: false },
        pricing: () => llmPricesFor("claude-sonnet-4-6"),
      },
      skills: [generateSkill],
    },
    "interactive",
  );
  const context = makeCtx();
  const result = await runOttoTurn(
    { orgId: context.orgId, refId: "fc1-run", input: "where is the card?", stream: false },
    context,
    runtime,
  );
  return { result, finalization: finalizeOttoTurn(result, runtime), context };
}

beforeEach(() => {
  vi.mocked(prisma.chatMessage.findFirst).mockReset();
  vi.mocked(prisma.genJob.findFirst).mockReset();
});

describe("FC-1 前提:批准暂停发生在查卡之前", () => {
  it("真 SDK 把 generate 停在批准项 —— 一次 DB 读都没发生,startGen 零调用", async () => {
    const { finalization, context } = await park(STORYBOARD_CARD_ID);

    expect(finalization.interrupted).toBe(true);
    expect(finalization.approvals).toEqual([
      { toolName: "generate", ref: STORYBOARD_CARD_ID, args: { cardId: STORYBOARD_CARD_ID } },
    ]);
    // 现场那句承诺原样进了这一轮的正文 —— 接线层看到的就是它。
    expect(finalization.text).toBe(PROMISE_TEXT);
    // 暂停这一刻**没有**问过卡的种类:零 DB 读。
    expect(prisma.chatMessage.findFirst).not.toHaveBeenCalled();
    expect(context.startGen).not.toHaveBeenCalled();
  });

  it("中断项的形状 = apps/web 接线用例里那个替身的形状(跨包契约)", async () => {
    const { result } = await park(STORYBOARD_CARD_ID);
    const raw = (result.interruptions ?? []) as { rawItem?: { name?: string; arguments?: string } }[];
    expect(raw).toHaveLength(1);
    expect(raw[0]!.rawItem?.name).toBe("generate");
    expect(JSON.parse(raw[0]!.rawItem?.arguments ?? "{}")).toEqual({ cardId: STORYBOARD_CARD_ID });
  });
});

describe("FC-1 修复:执行那一步对分镜卡要说人话", () => {
  it("分镜卡编号进 generate ⇒ 点名它是分镜卡并指出该走的那条路,零 startGen", async () => {
    // 第一次读(限定 kind:"GEN_CARD")读不到;第二次读(限定 kind:"STORYBOARD_CARD")读得到。
    vi.mocked(prisma.chatMessage.findFirst).mockImplementation(((args: unknown) => {
      const where = (args as { where?: { kind?: string } }).where ?? {};
      return Promise.resolve(where.kind === "STORYBOARD_CARD" ? { id: STORYBOARD_CARD_ID } : null);
    }) as never);
    const ctx = makeCtx();

    const out = await executeGenerate({ cardId: STORYBOARD_CARD_ID }, { context: ctx } as never);

    expect(out).toHaveProperty("error");
    const error = (out as { error: string }).error;
    expect(error).not.toBe("Card not found.");
    expect(error).toMatch(/storyboard/i);
    expect(error).toMatch(/prepareStoryboardVideos/);
    expect(ctx.startGen).not.toHaveBeenCalled();
  });

  it("真的不存在的编号照旧是 Card not found.(不许把两种局面说成一件事)", async () => {
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue(null as never);
    const ctx = makeCtx();

    const out = await executeGenerate({ cardId: "no-such-card" }, { context: ctx } as never);

    expect(out).toEqual({ error: "Card not found." });
    expect(ctx.startGen).not.toHaveBeenCalled();
  });
});
