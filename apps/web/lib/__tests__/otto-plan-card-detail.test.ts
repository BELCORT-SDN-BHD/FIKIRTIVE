// @vitest-environment jsdom
/**
 * otto-plan-card-detail.test.ts — #580 (detail card T1) + #591 (parked-run honesty),
 * reworked for the cross-family review r1 findings.
 *
 * 这一组测试守的是同一条根因:**卡面「说的」必须从执行「做的」同一数据源派生**。
 * 四件事,每件都要求「删掉生产接线就必须红」:
 *  1. 类型不是抄的,是从服务端契约派生的;而且 DTO 边界上有真的运行时解析,
 *     畸形 payload 显式降级,不是静默糊过去。
 *  2. 卡面显示的规格来自真 builder,一路走到卡面渲染值;引擎名全程不出现。
 *  3. 状态代数:终态不转圈;排队不许说成正在制作。
 *  4. 挂起面板由「这条会话还剩哪些卡等批准」驱动,不是模块级全局广播。
 *
 * Display only — nothing here touches the reserve/settle path.
 */
import { act, createElement } from "react";
import fs from "node:fs";
import path from "node:path";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardPayload as ServerCardPayload } from "@fikirtive/otto";

// React refuses act() outside a configured act environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));
const ottoApproveMock = vi.fn();
const coworkGenerateMock = vi.fn();
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: (...args: unknown[]) => ottoApproveMock(...args),
  ottoTurn: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: (...args: unknown[]) => coworkGenerateMock(...args),
  coworkVaryCard: vi.fn(),
  cancelGenJob: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  OttoPlanCard,
  DOWNGRADE_FALLBACK_NOTE,
  PARTIAL_PLAN_NOTE,
  UNREADABLE_PLAN_NOTE,
} from "@/components/otto/OttoPlanCard";
import {
  guaranteedCredits,
  parsePlanCardPayload,
  planCardGate,
  type OttoPlanCardPayload,
} from "@/components/otto/plan-card-contract";
import {
  PackCard,
  PACK_UNPRICED_NOTE,
  PACK_UNPRICED_ROW,
} from "@/components/otto/PackCard";
import { packTotalCredits } from "@/components/otto/pack-credit-math";
import {
  OttoTrace,
  TRACE_STOPPED_TITLE,
  TRACE_WAITING_TITLE,
  TRACE_WAITING_HINT,
} from "@/components/otto/OttoTrace";
import {
  deriveTraceSteps,
  isTerminalRunState,
  runStateOfCard,
  runStateSpins,
  shouldShowTracePanel,
} from "@/lib/otto-status-helpers";
import { outOfCreditsMessage } from "@/lib/credit-format";

// ---------------------------------------------------------------------------
// 1. 类型对齐 —— 卡面类型是从契约派生的,不是抄的
// ---------------------------------------------------------------------------

// `Record<keyof Required<T>, true>` is exhaustive in BOTH directions: a missing key is a
// tsc error, and `satisfies` rejects an extra one. So each map below is provably the
// complete key set of its type at compile time, and comparable as data at run time.
const SERVER_PAYLOAD_KEYS = {
  kind: true,
  model: true,
  params: true,
  reason: true,
  specChips: true,
  downgraded: true,
  downgradeNote: true,
  structuredPrompt: true,
  entityIds: true,
  // #774 判官 r2 P1:引擎认人的那几个名字,在卡上冻结、卡面照实披露。
  approvedEntities: true,
  variantSel: true,
  estimatedPriceUsd: true,
  estimatedCredits: true,
  videoStep: true,
  sourceGenerationId: true,
  goal: true,
  referenceVideoGenerationId: true,
  // Codex QA-CRE-FE9-013:媒体参考的审批回执 —— 卡面逐项列出、缺一件就不许 Generate。
  mediaReferences: true,
} satisfies Record<keyof Required<ServerCardPayload>, true>;

const CARD_PAYLOAD_KEYS = {
  kind: true,
  model: true,
  params: true,
  reason: true,
  specChips: true,
  downgraded: true,
  downgradeNote: true,
  structuredPrompt: true,
  entityIds: true,
  // #774 判官 r2 P1:引擎认人的那几个名字,在卡上冻结、卡面照实披露。
  approvedEntities: true,
  variantSel: true,
  estimatedPriceUsd: true,
  estimatedCredits: true,
  videoStep: true,
  sourceGenerationId: true,
  goal: true,
  referenceVideoGenerationId: true,
  // Codex QA-CRE-FE9-013:媒体参考的审批回执 —— 卡面逐项列出、缺一件就不许 Generate。
  mediaReferences: true,
} satisfies Record<keyof Required<OttoPlanCardPayload>, true>;

describe("#580 P1-1 卡面 payload 类型 = 服务端契约", () => {
  it("declares every field the server sends — no silent dropping", () => {
    const missing = Object.keys(SERVER_PAYLOAD_KEYS).filter((k) => !(k in CARD_PAYLOAD_KEYS));
    expect(missing).toEqual([]);
  });

  it("invents no field the server never sends", () => {
    const extra = Object.keys(CARD_PAYLOAD_KEYS).filter((k) => !(k in SERVER_PAYLOAD_KEYS));
    expect(extra).toEqual([]);
  });

  // The maps above are exhaustive at tsc time. This one runs the REAL server builder
  // and reads the keys it actually emits, so a field added on the server fails here
  // even before anyone looks at the types.
  it("every field the live builder emits is one the card knows about", async () => {
    const emitted = new Set<string>();
    for (const cardPayload of await builtCards()) {
      for (const key of Object.keys(cardPayload)) emitted.add(key);
    }
    // The branch coverage above must actually reach the optional fields, or this
    // assertion would pass by simply never exercising them.
    for (const key of ["videoStep", "sourceGenerationId", "referenceVideoGenerationId", "downgradeNote", "approvedEntities"]) {
      expect(emitted.has(key)).toBe(true);
    }
    expect([...emitted].filter((k) => !(k in CARD_PAYLOAD_KEYS))).toEqual([]);
  });
});

/** Seven real cards straight from the live server builder: plain video, downgraded video,
 *  image ad pack, two-step image, i2v, reference video, and an image that @mentions an
 *  element (#774 —— 只有它会带出 `approvedEntities`,少了它上面那条覆盖断言会空过去)。 */
async function builtCards(): Promise<ServerCardPayload[]> {
  const { buildProposeCard } = await import("@fikirtive/otto");
  const ctx = {
    orgId: "org_1",
    userId: "user_1",
    projectId: "proj_1",
    threadId: "thread_1",
    disabledModels: [],
    sourceGenerationId: null,
  } as never;
  const base = { structuredPrompt: "a bowl of laksa", entityIds: [], variantSel: {} };
  return [
    buildProposeCard({ kind: "video", ...base }, ctx, []),
    // #645 T4：7s / 1:1 现在都真给得了，所以「降级卡」这个夹具必须用引擎真做不到的值
    // （30 秒 / 2:3），否则这张卡不再带 downgradeNote，下面的覆盖断言就空过去了。
    buildProposeCard({ kind: "video", ...base, desiredDuration: 30, desiredAspect: "2:3" }, ctx, []),
    buildProposeCard({ kind: "image", ...base, count: 3 }, ctx, []),
    buildProposeCard({ kind: "image", ...base, forVideo: true }, ctx, []),
    buildProposeCard({ kind: "video", ...base }, { ...(ctx as object), sourceGenerationId: "gen_img" } as never, []),
    buildProposeCard({ kind: "video", ...base }, { ...(ctx as object), referenceVideoGenerationId: "gen_vid" } as never, []),
    buildProposeCard(
      { kind: "image", ...base, entityIds: ["e1"] },
      ctx,
      [{ id: "e1", type: "PRODUCT", name: "the AeroBottle" }],
    ),
  ].map((r) => r.cardPayload);
}

// ---------------------------------------------------------------------------
// 2. 运行时解析 —— 契约怎么变,解析就得跟着;畸形 payload 显式降级
// ---------------------------------------------------------------------------

describe("#580 P1-1 DTO 边界的运行时解析", () => {
  it("真 builder 造出来的每一张卡都能被完整解析,一个字段都不掉", async () => {
    for (const cardPayload of await builtCards()) {
      const parsed = parsePlanCardPayload(cardPayload);
      expect(parsed).not.toBeNull();
      expect(parsed!.malformedFields).toEqual([]);
      // 双向:服务端发出的键全部到得了卡面;卡面也没有凭空多出键。
      expect(Object.keys(parsed!.value).sort()).toEqual(Object.keys(cardPayload).sort());
      for (const [key, value] of Object.entries(cardPayload)) {
        expect(parsed!.value[key as keyof OttoPlanCardPayload]).toEqual(value);
      }
    }
  });

  it("嵌套字段也是真解析的,不是整块 as 过去的", () => {
    const parsed = parsePlanCardPayload({
      kind: "video",
      params: { aspectRatio: "9:16", resolution: "720p", durationSeconds: 5, audio: true, count: 1 },
      videoStep: { estimatedCredits: 12 },
      estimatedCredits: 8,
    });
    expect(parsed!.value.params).toEqual({
      aspectRatio: "9:16",
      resolution: "720p",
      durationSeconds: 5,
      audio: true,
      count: 1,
    });
    expect(parsed!.value.videoStep).toEqual({ estimatedCredits: 12 });
  });

  it("嵌套字段类型不对就丢掉并记账,不许当成读懂了", () => {
    const parsed = parsePlanCardPayload({
      kind: "image",
      estimatedCredits: 4,
      params: "16:9",
      videoStep: { estimatedCredits: "twelve" },
      specChips: ["1024 × 1024", 5],
    });
    expect(parsed!.malformedFields.sort()).toEqual(["params", "specChips", "videoStep"]);
    expect(parsed!.value.params).toBeUndefined();
    expect(parsed!.value.videoStep).toBeUndefined();
    expect(parsed!.value.specChips).toBeUndefined();
  });

  it("根本不是一个 payload 的东西 → 没有可展示的方案", () => {
    expect(parsePlanCardPayload(null)).toBeNull();
    expect(parsePlanCardPayload("card")).toBeNull();
    expect(parsePlanCardPayload([1, 2])).toBeNull();
  });

  it("老卡少几个字段照样能读 —— 向后兼容", () => {
    const parsed = parsePlanCardPayload({ kind: "image", structuredPrompt: "a poster", estimatedPriceUsd: 0.1 });
    expect(parsed!.malformedFields).toEqual([]);
    expect(parsed!.value.kind).toBe("image");
    expect(parsed!.value.specChips).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. 卡面 —— 规格从真 builder 一路走到渲染值
// ---------------------------------------------------------------------------

const ENGINE_WORDS = /seedance|seedream|byteplus|veo|kling|ltx|pixverse|grok imagine|hailuo/i;

/** #896 — the approve control is ONE priced button now ("Generate · 8 credits"), not a
 *  "Review cost" step followed by a "Confirm generate" step. Its presence still means
 *  exactly what it meant before: this card may be paid for. Its ABSENCE is what the
 *  fail-closed assertions below are really about, and that meaning is unchanged. */
const APPROVE_BUTTON = "Generate ·";

function renderCard(payload: unknown, over: { cardState?: "idle" | "working" | "done" | "failed" } = {}): string {
  const markup = renderToStaticMarkup(
    createElement(OttoPlanCard, {
      cardId: "card_1",
      payload,
      entities: [],
      threadId: "thread_1",
      projectId: "proj_1",
      genJobId: over.cardState === "working" ? "job_1" : null,
      cardState: over.cardState ?? "idle",
      pendingApproval: false,
      onApproved: vi.fn(),
      onChangeSomething: vi.fn(),
    }),
  );
  // React escapes apostrophes into entities; the merchant sees the character, so
  // assert against what they read rather than against the wire encoding.
  return markup.replaceAll("&#x27;", "'").replaceAll("&#39;", "'");
}

/** A video card exactly as the server builds it today. */
const VIDEO_PAYLOAD: OttoPlanCardPayload = {
  kind: "video",
  model: "seedance-2-mini",
  params: { aspectRatio: "9:16", resolution: "720p", durationSeconds: 5, audio: true, count: 1 },
  reason: "Seedance 2.0 mini — 9:16, 5s",
  specChips: ["9:16", "5s", "720p", "With sound"],
  downgraded: true,
  downgradeNote: "You asked for 10s — this will be 5s.",
  structuredPrompt: "A steaming bowl of laksa, close up",
  entityIds: [],
  variantSel: {},
  estimatedPriceUsd: 0.39,
  estimatedCredits: 8,
  goal: "an ad to drive weekend footfall",
};

describe("#580 P1-2 卡面显示值 = 真 builder 算出来的有效规格", () => {
  it("视频卡:builder 给几条 chip,卡面就显示哪几条,一条不多一条不少", async () => {
    const { buildProposeCard } = await import("@fikirtive/otto");
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a clip", entityIds: [], variantSel: {} },
      { orgId: "o", userId: "u", projectId: "p", threadId: "t", disabledModels: [], sourceGenerationId: null } as never,
      [],
    );
    const markup = renderCard(cardPayload);
    expect(cardPayload.specChips.length).toBeGreaterThan(0);
    for (const chip of cardPayload.specChips) expect(markup).toContain(chip);
    // 「说的」不许超出 builder 给的那几条。#646 T5 之后声音真的接通了执行层,builder 会给
    // 这一条,卡面也就照实显示 —— 但它没选的那个反面措辞仍然一个字都不许出现。
    const soundChip = cardPayload.params.audio ? "With sound" : "No sound";
    expect(cardPayload.specChips).toContain(soundChip);
    expect(markup).toContain(soundChip);
    expect(markup).not.toMatch(cardPayload.params.audio ? /No sound/ : /With sound/);
  });

  it("图片卡(#643 T2):商家要的形状真会交付,所以卡面照实报那一格的尺寸与比例", async () => {
    const { buildProposeCard } = await import("@fikirtive/otto");
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, desiredAspect: "9:16", count: 3 },
      { orgId: "o", userId: "u", projectId: "p", threadId: "t", disabledModels: [], sourceGenerationId: null } as never,
      [],
    );
    const markup = renderCard(cardPayload);
    expect(cardPayload.specChips).toEqual(["1620 × 2880", "9:16", "3 images"]);
    for (const chip of cardPayload.specChips) expect(markup).toContain(chip);
    // 兑现了就不是降级 —— 卡面不许挂一句无中生有的披露。
    expect(cardPayload.downgraded).toBe(false);
    expect(markup).not.toMatch(/You asked for/);
  });

  // Codex QA-CRE-FE9-014(规格 §5 2026-09-04)—— 上一版这里渲染的是一张写着「1:1」的
  // 付费卡外加一句「You asked for 5:7 — this will be a square…」。那张卡本身就是病:
  // 商家的硬规格被改掉,却仍然请他批准。现在做不到的形状在铸卡前就被拒绝,所以这条
  // 渲染用例改成钉「**没有卡可渲染**」—— 图片降级那句话从此没有生产者。
  it("CREATE-A4 图片卡:引擎给不了的形状 —— 一张卡都不铸,没有可渲染的降级卡", async () => {
    const { buildProposeCard, ProposeRefusal } = await import("@fikirtive/otto");
    expect(() =>
      buildProposeCard(
        { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, desiredAspect: "5:7", count: 3 },
        { orgId: "o", userId: "u", projectId: "p", threadId: "t", disabledModels: [], sourceGenerationId: null } as never,
        [],
      ),
    ).toThrow(ProposeRefusal);
  });

  // ── #774 判官 r2 P1 —— 引擎认人的名字,商家在花钱之前就看得见 ──────────────
  // 「批准前看得见」是这条修复的一半:另一半(worker 只认这一份)在
  // apps/worker/src/jobs/gen-reference-budget.test.ts。两边说的必须是同几个字。
  describe("#774 判官 r2 P1 卡面披露引擎会被告知的那几个名字", () => {
    const withNames = (approvedEntities: unknown) => ({
      kind: "image",
      model: "seedream",
      params: { count: 1, aspectRatio: "1:1" },
      specChips: ["2048 × 2048", "1:1"],
      structuredPrompt: "A hero shot of the bottle",
      entityIds: ["e1", "e2"],
      variantSel: {},
      downgraded: false,
      estimatedPriceUsd: 0.04,
      estimatedCredits: 1,
      reason: "seedream",
      approvedEntities,
    });

    it("卡上逐字写出付费提示词里那几个名字", () => {
      const markup = renderCard(withNames([
        { id: "e1", type: "PRODUCT", name: "the AeroBottle" },
        { id: "e2", type: "CHARACTER", name: "Mia" },
      ]));
      expect(markup).toContain("Reference names sent to the engine: the AeroBottle (product), Mia (person).");
    });

    it("老卡没有这份快照 → 不显示这行(不猜一个)", () => {
      const markup = renderCard(withNames(undefined));
      expect(markup).not.toContain("Reference names sent to the engine");
    });

    it("快照读不懂 → 记进畸形字段,这张卡连批准按钮都没有", () => {
      const gate = planCardGate(withNames([{ id: "e1", type: "NOPE", name: "x" }]));
      expect(gate.malformedFields).toContain("approvedEntities");
      expect(gate.approvable).toBe(false);
      expect(renderCard(withNames([{ id: "e1", type: "NOPE", name: "x" }])))
        .not.toContain("Reference names sent to the engine");
    });

    it("真 builder 造的卡:卡上那行 = 卡上冻结的那一份", async () => {
      const { buildProposeCard } = await import("@fikirtive/otto");
      const { cardPayload } = buildProposeCard(
        { kind: "image", structuredPrompt: "a hero shot", entityIds: ["e1"], variantSel: {} },
        { orgId: "o", userId: "u", projectId: "p", threadId: "t", disabledModels: [], sourceGenerationId: null } as never,
        [{ id: "e1", type: "PRODUCT", name: "the AeroBottle" }],
      );
      expect(cardPayload.approvedEntities).toEqual([{ id: "e1", type: "PRODUCT", name: "the AeroBottle" }]);
      expect(renderCard(cardPayload)).toContain("Reference names sent to the engine: the AeroBottle (product).");
    });
  });

  it("never renders the engine name, even though the payload carries it", () => {
    expect(renderCard(VIDEO_PAYLOAD)).not.toMatch(ENGINE_WORDS);
  });

  it("states the downgrade out loud instead of quietly shipping something smaller", () => {
    expect(renderCard(VIDEO_PAYLOAD)).toContain("You asked for 10s — this will be 5s.");
  });

  it("a downgraded card from before the server note still says something honest", () => {
    const markup = renderCard({ ...VIDEO_PAYLOAD, downgradeNote: undefined });
    expect(markup).toContain(DOWNGRADE_FALLBACK_NOTE);
  });

  it("says nothing about downgrades when the plan honours the request", () => {
    const markup = renderCard({ ...VIDEO_PAYLOAD, downgraded: false, downgradeNote: undefined });
    expect(markup).not.toContain("You asked for");
    expect(markup).not.toContain(DOWNGRADE_FALLBACK_NOTE);
  });

  it("老卡没有 specChips 就不显示规格 —— 宁可不说,不许猜", () => {
    const markup = renderCard({ kind: "video", params: { aspectRatio: "9:16", count: 1 }, estimatedCredits: 8 });
    expect(markup).not.toContain("9:16");
    expect(markup).not.toMatch(ENGINE_WORDS);
  });
});

describe("#580 P1-1 读不懂的方案不许当方案渲染", () => {
  it("payload 根本读不出来 → 明说读不懂,且没有付费按钮", () => {
    const markup = renderCard("not a card");
    expect(markup).toContain(UNREADABLE_PLAN_NOTE);
    expect(markup).not.toContain(APPROVE_BUTTON);
  });

  it("读得出来但没有价格 → 同样不给付费按钮,不许编一个 1 credit 出来", () => {
    const markup = renderCard({ kind: "image", structuredPrompt: "a poster" });
    expect(markup).toContain(UNREADABLE_PLAN_NOTE);
    expect(markup).not.toContain(APPROVE_BUTTON);
  });

  it("部分字段畸形 → 卡面显式说明它不完整,而且不给批准按钮", () => {
    const markup = renderCard({ ...VIDEO_PAYLOAD, params: "16:9" });
    expect(markup).toContain(PARTIAL_PLAN_NOTE);
    // r2 P1-2:读不全的卡不许批准。上一轮这里断言的是「照样出批准按钮」——
    // 那正是把一张自己都承认读不全的卡送去花钱。
    expect(markup).not.toContain(APPROVE_BUTTON);
  });

  it("畸形的规格数组整条丢掉 —— 半条规格比没有规格更危险", () => {
    const markup = renderCard({ ...VIDEO_PAYLOAD, specChips: ["9:16", 5] });
    expect(markup).toContain(PARTIAL_PLAN_NOTE);
    for (const chip of VIDEO_PAYLOAD.specChips!) expect(markup).not.toContain(`>${chip}<`);
  });
});

// ---------------------------------------------------------------------------
// 4. 状态代数 —— 终态不转圈;排队不许说成正在做
// ---------------------------------------------------------------------------

describe("#580 P1-3 状态代数", () => {
  it("终态就是终态,只有真的在跑才允许动画", () => {
    for (const state of ["done", "failed", "stale", "degraded", "data-error"] as const) {
      expect(isTerminalRunState(state)).toBe(true);
      expect(runStateSpins(state)).toBe(false);
    }
    for (const state of ["queued", "waiting"] as const) {
      expect(isTerminalRunState(state)).toBe(false);
      expect(runStateSpins(state)).toBe(false);
    }
    expect(runStateSpins("running")).toBe(true);
  });

  it("卡片只知道任务建立了,不知道它开跑了 —— 所以是 queued", () => {
    expect(runStateOfCard("working")).toBe("queued");
    expect(runStateOfCard("idle")).toBe("waiting");
    expect(runStateOfCard("done")).toBe("done");
    expect(runStateOfCard("failed")).toBe("failed");
  });

  it("已批准但结果没落地时,卡面说排队,绝不说正在制作", () => {
    const markup = renderCard(VIDEO_PAYLOAD, { cardState: "working" });
    expect(markup).toContain("in the queue");
    expect(markup).not.toContain("making this now");
    expect(markup).not.toContain("On it");
  });

  it("一轮以降级 / 被取代 / 出错收尾,没跑完的步骤停下,不再转圈", () => {
    const events = [
      { id: "a", label: "Planning the campaign", phase: "start" as const },
      { id: "a", label: "Planning the campaign", phase: "done" as const },
      { id: "b", label: "Making a visual", phase: "start" as const },
    ];
    const degraded = deriveTraceSteps(events, { kind: "degraded", text: "…" });
    const stale = deriveTraceSteps(events, { kind: "stale", text: "…" });
    const errored = deriveTraceSteps(events, null, { kind: "error", text: "…" });
    for (const steps of [degraded, stale, errored]) {
      expect(steps.map((s) => s.status)).toEqual(["done", "stopped"]);
      expect(steps.some((s) => s.status === "active")).toBe(false);
    }
    const markup = renderToStaticMarkup(createElement(OttoTrace, { steps: degraded }));
    expect(markup).not.toContain('class="otto-trace-spin"');
    expect(markup).not.toContain('class="otto-trace-bar"');
    expect(markup).toContain(TRACE_STOPPED_TITLE);
    expect(markup).not.toContain("Otto is making it");
  });

  it("排队中的一轮(还没有任何结论信号)照旧显示在跑", () => {
    const steps = deriveTraceSteps([{ id: "a", label: "Making a visual", phase: "start" }], null);
    expect(steps.map((s) => s.status)).toEqual(["active"]);
  });
});

// ---------------------------------------------------------------------------
// 5. #591 / P1-4 —— 挂起面板:该出现时出现,该退场时由「还剩谁等批准」说了算
// ---------------------------------------------------------------------------

describe("#591 the trace panel while the run is parked on approval", () => {
  const parked = [
    { label: "Planning the campaign", status: "done" as const },
    { label: "Making a visual", status: "waiting" as const },
  ];

  it("does not claim Otto is making it", () => {
    const markup = renderToStaticMarkup(createElement(OttoTrace, { steps: parked }));
    expect(markup).not.toContain("Otto is making it");
    expect(markup).toContain(TRACE_WAITING_TITLE);
  });

  it("does not show a step counter that implies work is under way", () => {
    const markup = renderToStaticMarkup(createElement(OttoTrace, { steps: parked }));
    expect(markup).not.toContain("step 1 of");
    expect(markup).not.toContain("step 2 of");
    expect(markup).toContain("waiting for you");
  });

  it("does not animate a progress bar for a step that is not running", () => {
    const markup = renderToStaticMarkup(createElement(OttoTrace, { steps: parked }));
    expect(markup).not.toContain('class="otto-trace-bar"');
    expect(markup).not.toContain('class="otto-trace-spin"');
  });

  it("points the merchant at the button that actually starts it", () => {
    const markup = renderToStaticMarkup(createElement(OttoTrace, { steps: parked }));
    expect(markup).toContain(TRACE_WAITING_HINT);
    expect(markup).toContain("Needs your OK");
  });

  it("a genuinely running turn is untouched — it still reads as in progress", () => {
    const markup = renderToStaticMarkup(
      createElement(OttoTrace, {
        steps: [
          { label: "Planning the campaign", status: "done" as const },
          { label: "Making a visual", status: "active" as const },
        ],
      }),
    );
    expect(markup).toContain("Otto is making it");
    expect(markup).toContain("step 2 of 2");
    expect(markup).not.toContain(TRACE_WAITING_HINT);
  });

  // The other half of the honesty: the panel must not keep asking for a click that
  // already happened. 判定权在「这条会话还剩哪些卡等批准」,不在任何全局广播 ——
  // 所以别的会话、别的卡的成功都动不了它。
  it("还有卡在等批准 → 面板留着", () => {
    expect(shouldShowTracePanel({ steps: parked, pendingCardIds: new Set(["card_1"]) })).toBe(true);
  });

  it("这条会话已经没有卡在等批准 → 面板退场,让位给卡自己的状态", () => {
    expect(shouldShowTracePanel({ steps: parked, pendingCardIds: new Set() })).toBe(false);
  });

  it("正在跑的面板不受待批集合影响 —— 没有全局开关能把它关掉", () => {
    const running = [{ label: "Making a visual", status: "active" as const }];
    expect(shouldShowTracePanel({ steps: running, pendingCardIds: new Set() })).toBe(true);
    expect(shouldShowTracePanel({ steps: running, pendingCardIds: new Set(["other_card"]) })).toBe(true);
  });

  it("没有步骤就没有面板", () => {
    expect(shouldShowTracePanel({ steps: [], pendingCardIds: new Set(["card_1"]) })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. 真点卡 —— 生产接线本身必须被测到(复审 r1 P2)
// ---------------------------------------------------------------------------

describe("#580 P1-4 点真卡:批准回调必须带确切 card id 与服务端结果", () => {
  const roots: Array<[ReturnType<typeof createRoot>, HTMLElement]> = [];
  afterEach(() => {
    for (const [root, host] of roots.splice(0)) {
      act(() => root.unmount());
      host.remove();
    }
    ottoApproveMock.mockReset();
    coworkGenerateMock.mockReset();
  });

  function mountCard(props: { pendingApproval: boolean; onApproved: (o: unknown) => void }): HTMLElement {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push([root, host]);
    act(() => {
      root.render(
        createElement(OttoPlanCard, {
          cardId: "card_1",
          payload: VIDEO_PAYLOAD,
          entities: [],
          threadId: "thread_1",
          projectId: "proj_1",
          cardState: "idle" as const,
          pendingApproval: props.pendingApproval,
          onApproved: props.onApproved,
          onChangeSomething: vi.fn(),
        }),
      );
    });
    return host;
  }

  function clickButton(host: HTMLElement, text: string): void {
    const button = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
    expect(button, `the card must render a "${text}" button for this seam to mean anything`).toBeTruthy();
    act(() => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  /** #896 — ONE press. The button carries the price, so pressing it IS the approval:
   *  this single click is what must reach the metered server action, and nothing may
   *  spend without it. (Before, the same guarantee was spread over two clicks, the first
   *  of which only re-displayed the price already printed on it.) */
  async function approveThroughTheUi(host: HTMLElement): Promise<void> {
    const approve = [...host.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(APPROVE_BUTTON),
    );
    expect(approve, "the card must offer one priced approve button").toBeTruthy();
    // 「点击 = 批准」:这一下之前,付费动作一次都不许被调用。
    expect(coworkGenerateMock).not.toHaveBeenCalled();
    expect(ottoApproveMock).not.toHaveBeenCalled();
    await act(async () => {
      approve!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("刚提议的卡:走 coworkGenerate,回调带这张卡的 id,chained 为 null", async () => {
    coworkGenerateMock.mockResolvedValue({ ok: true });
    const onApproved = vi.fn();
    const host = mountCard({ pendingApproval: false, onApproved });
    await approveThroughTheUi(host);

    expect(coworkGenerateMock).toHaveBeenCalledTimes(1);
    expect(ottoApproveMock).not.toHaveBeenCalled();
    expect(onApproved).toHaveBeenCalledWith({ cardId: "card_1", chained: null });
  });

  it("挂起的卡:走 ottoApprove,再次挂起时把服务端的完整待批集合原样带上去", async () => {
    ottoApproveMock.mockResolvedValue({
      status: "needs_approval",
      pendingCardIds: ["card_2", "card_3"],
      fallbackReply: "One more to confirm.",
      narrationMessageId: "msg_9",
    });
    const onApproved = vi.fn();
    const host = mountCard({ pendingApproval: true, onApproved });
    await approveThroughTheUi(host);

    expect(ottoApproveMock).toHaveBeenCalledWith({ threadId: "thread_1", cardId: "card_1" });
    expect(coworkGenerateMock).not.toHaveBeenCalled();
    expect(onApproved).toHaveBeenCalledWith({
      cardId: "card_1",
      chained: {
        pendingCardIds: ["card_2", "card_3"],
        fallbackReply: "One more to confirm.",
        narrationMessageId: "msg_9",
      },
    });
    // 服务端的收据是原样显示的,不是本地编的英文。
    expect(host.textContent).toContain("One more to confirm.");
  });

  it("服务端报错就不回调 —— 没成功的事不许当成功", async () => {
    coworkGenerateMock.mockResolvedValue({ error: "Not enough credits." });
    const onApproved = vi.fn();
    const host = mountCard({ pendingApproval: false, onApproved });
    await approveThroughTheUi(host);

    expect(onApproved).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Not enough credits.");
  });

  // -------------------------------------------------------------------------
  // #979 —— 「钱不够」不许是一条死路(beta 录像 10:32:商家撞在这句话上停了 40 秒)
  //
  // 与 #707 三张卡同一个病,只是这一张当时没被数进去:句子告诉商家去 Billing,
  // 而卡上没有任何东西能点。他已经决定要付钱了,产品却让他自己去找路。
  // -------------------------------------------------------------------------
  it("#979 钱不够时,卡上有一条真的能点去 Billing 的路", async () => {
    coworkGenerateMock.mockResolvedValue({
      error: outOfCreditsMessage(22),
    });
    const host = mountCard({ pendingApproval: false, onApproved: vi.fn() });
    await approveThroughTheUi(host);

    const alert = host.querySelector('[role="alert"]');
    expect(alert, "短余额提示根本没显示").toBeTruthy();
    // 服务端算出的那个数字照旧原样说出来 —— 拒绝不许藏起它是拿什么判的。
    expect(alert!.textContent).toContain("this needs 22 credits");
    const link = alert!.querySelector<HTMLAnchorElement>('a[href="/billing"]');
    expect(link, "叫商家去充值,却没给他路").toBeTruthy();
    expect(link!.textContent?.trim()).toBe("Top up in Billing");
    // 而且句子只说一遍 —— 链接是把结尾那句换掉,不是在后面再补一句。
    expect(alert!.textContent!.match(/Top up in Billing/g)).toHaveLength(1);
  });

  it("#979 别的错误不许凭空长出一个充值链接", async () => {
    coworkGenerateMock.mockResolvedValue({ error: "Project not found." });
    const host = mountCard({ pendingApproval: false, onApproved: vi.fn() });
    await approveThroughTheUi(host);

    const alert = host.querySelector('[role="alert"]');
    expect(alert!.textContent).toContain("Project not found.");
    expect(alert!.querySelector('a[href="/billing"]'), "钱没问题的错误挂了一条充值路").toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. 生产接线的删除必须红 —— 面板可见性是父层按待批集合算的
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 8. 价格担保门(复审 r2 P1)—— 一个谓词,渲染与批准共用
//
// 根因:卡面「显示多少钱」和 approve「准不准花钱」原本各判各的,中间还垫了一层
// USD→credits 的猜算。于是一张只有记账用 USD、没有真实 credits 的老卡,会被猜出一个
// 数字、配上批准按钮送去花钱。这一节把两处收敛成 guaranteedCredits 一个谓词:
// 担保不了的价格 = 没有价格 = 不许批准。
// ---------------------------------------------------------------------------

describe("#580 r2 P1-1 价格担保谓词", () => {
  it("只有安全整数且为正的 credits 才算担保得住", () => {
    expect(guaranteedCredits({ estimatedCredits: 8 })).toBe(8);
    expect(guaranteedCredits({ estimatedCredits: 1 })).toBe(1);
  });

  it("0 / 负数 / 小数 / 越界整数 / 缺失,一律不算价格", () => {
    expect(guaranteedCredits({ estimatedCredits: 0 })).toBeNull();
    expect(guaranteedCredits({ estimatedCredits: -3 })).toBeNull();
    expect(guaranteedCredits({ estimatedCredits: 2.5 })).toBeNull();
    expect(guaranteedCredits({ estimatedCredits: Number.MAX_SAFE_INTEGER + 2 })).toBeNull();
    expect(guaranteedCredits({})).toBeNull();
  });

  it("USD 估价永远换不出 credits —— 猜算回退已经删除", () => {
    // 0.39 USD 曾被猜成 ceil(0.39/0.1) = 4 credits。记账用的引擎成本不是商家的报价。
    expect(guaranteedCredits({ estimatedPriceUsd: 0.39 })).toBeNull();
    expect(guaranteedCredits({ estimatedPriceUsd: 100 })).toBeNull();
  });
});

describe("#580 r2 P1-1 渲染门与批准门是同一道门", () => {
  it("只有 USD、没有 credits 的老卡:不猜价,也不给批准按钮", () => {
    const markup = renderCard({ ...VIDEO_PAYLOAD, estimatedCredits: undefined });
    expect(markup).toContain(UNREADABLE_PLAN_NOTE);
    expect(markup).not.toContain(APPROVE_BUTTON);
    expect(markup).not.toContain("4 credits");
  });

  for (const bad of [0, -3, 2.5, Number.MAX_SAFE_INTEGER + 2]) {
    it(`estimatedCredits=${bad} 不是可担保价格 → 当读不懂处理`, () => {
      const markup = renderCard({ ...VIDEO_PAYLOAD, estimatedCredits: bad });
      expect(markup).toContain(UNREADABLE_PLAN_NOTE);
      expect(markup).not.toContain(APPROVE_BUTTON);
    });
  }

  it("价格担保得住 → 照旧显示这一个数字并给批准按钮", () => {
    const markup = renderCard(VIDEO_PAYLOAD);
    // #896:价就写在批准按钮上,一击到位 —— 不再有一颗只把同一个数再念一遍的中间键。
    expect(markup).toContain("Generate · 8 credits");
    expect(markup).not.toContain("Review cost");
    expect(markup).not.toContain("Confirm generate");
  });

  it("两步计划的第二步价格同样受门管 —— 担保不住就不承诺", () => {
    const twoStep = { ...VIDEO_PAYLOAD, kind: "image" as const, videoStep: { estimatedCredits: 12 } };
    expect(renderCard(twoStep)).toContain("Two-step plan");
    // 第二步的估价担保不住,就不许把它说成一个具体数字。
    const broken = renderCard({ ...twoStep, videoStep: { estimatedCredits: 0 } });
    expect(broken).not.toContain("Two-step plan");
    expect(broken).not.toContain("Then the video");
  });
});

describe("#580 r2 P1-2 畸形字段 = 不许批准", () => {
  it("畸形卡照旧显式披露,但批准按钮整条不存在", () => {
    const markup = renderCard({ ...VIDEO_PAYLOAD, params: "16:9" });
    expect(markup).toContain(PARTIAL_PLAN_NOTE);
    expect(markup).not.toContain(APPROVE_BUTTON);
  });

  it("畸形卡上点得到的每一个按钮都不会启动花费", async () => {
    coworkGenerateMock.mockResolvedValue({ ok: true });
    ottoApproveMock.mockResolvedValue({ ok: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        createElement(OttoPlanCard, {
          cardId: "card_1",
          payload: { ...VIDEO_PAYLOAD, params: "16:9" },
          entities: [],
          threadId: "thread_1",
          projectId: "proj_1",
          cardState: "idle" as const,
          pendingApproval: true,
          onApproved: vi.fn(),
          onChangeSomething: vi.fn(),
        }),
      );
    });
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(coworkGenerateMock).not.toHaveBeenCalled();
    expect(ottoApproveMock).not.toHaveBeenCalled();
    act(() => root.unmount());
    host.remove();
    coworkGenerateMock.mockReset();
    ottoApproveMock.mockReset();
  });
});

// ---------------------------------------------------------------------------
// 9. PackCard 归队(复审 r2 P1-3)—— 整包与单卡走同一道门
// ---------------------------------------------------------------------------

describe("#580 r2 P1-3 PackCard 与单卡共用契约与价格门", () => {
  function renderPack(payloads: unknown[]): string {
    return renderToStaticMarkup(
      createElement(PackCard, {
        packTitle: "Three posters",
        cards: payloads.map((payload, i) => ({
          cardId: `card_${i}`,
          payload,
          threadId: "thread_1",
          genJobId: null,
          cardState: "idle" as const,
          pendingApproval: false,
        })),
        balanceUsd: 100,
        onApproved: vi.fn(),
      }),
    ).replaceAll("&#x27;", "'").replaceAll("&#39;", "'");
  }

  /** #996(W2-9):金额现在包在 `<CardMoney>` 里(窄面板下不许被断行),所以「Total 10 credits」
   *  在 HTML 字符串里被一个标签断开了。商家读到的还是同一句 —— 断言就断言他读到的那一份。 */
  function visibleText(markup: string): string {
    return markup.replace(/<[^>]*>/g, "");
  }

  const PRICED = { kind: "image", structuredPrompt: "a poster", estimatedCredits: 4 };

  it("每张卡都有可担保价格 → 正常出总价与 Make all", () => {
    const markup = renderPack([PRICED, { ...PRICED, estimatedCredits: 6 }]);
    expect(visibleText(markup)).toContain("Total 10 credits");
    // #896:整包也是一击 —— 数量与总价都在按钮上,后面没有第二块确认屏。
    expect(markup).toContain("Make all (2 · 10 credits)");
    expect(markup).not.toContain("Confirm — make all");
  });

  it("包里混进一张只有 USD 的卡 → 总价与 Make all 一起消失", () => {
    const markup = renderPack([PRICED, { kind: "image", estimatedPriceUsd: 0.39 }]);
    expect(markup).not.toContain("Make all");
    expect(markup).not.toContain("Total");
    expect(markup).toContain(PACK_UNPRICED_NOTE);
  });

  it("包里混进一张畸形卡 → 同样不给整包批准", () => {
    const markup = renderPack([PRICED, { ...PRICED, params: "16:9" }]);
    expect(markup).not.toContain("Make all");
    expect(markup).toContain(PACK_UNPRICED_NOTE);
  });

  it("单卡行不许猜价 —— 担保不住就直说价格不明", () => {
    const markup = renderPack([PRICED, { kind: "image", estimatedPriceUsd: 0.39 }]);
    // 有价的那一行照旧报价,只有一次 —— 0.39 USD 不许被算成第二个「4 credits」。
    expect(markup.match(/4 credits/g)).toHaveLength(1);
    expect(markup).toContain(PACK_UNPRICED_ROW);
  });

  it("整包的门与单卡的门是同一个 —— 两边判定必然一致", () => {
    for (const payload of [
      PRICED,
      { kind: "image", estimatedPriceUsd: 0.39 },
      { ...PRICED, params: "16:9" },
      { ...PRICED, estimatedCredits: 0 },
      "not a card",
    ]) {
      const gate = planCardGate(payload);
      expect(packTotalCredits([{ payload }])).toBe(gate.approvable ? gate.credits : null);
    }
  });
});

// ---------------------------------------------------------------------------
// 9b. PackCard 半跑完的那一包(#896 r2 P1)—— 价签 / 余额门 / 执行目标同一组卡
//
// 「Make all」只会启动**还没跑**的卡,可是总价、余额门与那句提示以前都按**全部**卡算。
// 一张已经跑过、一张还没跑,各 5 credits:按钮写着「Make all (1 · 10 credits)」却只启动
// 5 —— 数量说的是剩余、价说的是全包,同一颗按钮上两个口径。更贵的一半是余额门:钱包里
// 有 5 credits 的商家,明明付得起剩下那一张,却被一个虚高的 10 挡在门外。
// ---------------------------------------------------------------------------

describe("#896 r2 P1 PackCard 的价签跟着它真正会跑的那组卡走", () => {
  const PRICED_5 = { kind: "image", structuredPrompt: "a poster", estimatedCredits: 5 };

  function renderStates(
    states: ("idle" | "done" | "working" | "failed" | "cancelled")[],
    balanceUsd = 100,
    payloads?: unknown[],
  ): string {
    return renderToStaticMarkup(
      createElement(PackCard, {
        packTitle: "Raya set",
        cards: states.map((cardState, i) => ({
          cardId: `card_${i}`,
          payload: payloads?.[i] ?? PRICED_5,
          threadId: "thread_1",
          genJobId: null,
          cardState,
          pendingApproval: false,
        })),
        balanceUsd,
        onApproved: vi.fn(),
      }),
    ).replaceAll("&#x27;", "'").replaceAll("&#39;", "'");
  }

  it("一张已跑一张待跑 → 按钮上的价是剩下那一张的价,不是整包的", () => {
    const markup = renderStates(["done", "idle"]);
    expect(markup).toContain("Make all (1 · 5 credits)");
    expect(markup, "把已经付过钱的那张又算进了价签").not.toContain("10 credits");
    // #996:金额包进了 `<CardMoney>`,所以这一句要在去标签之后读(商家读到的那一份)。
    expect(markup.replace(/<[^>]*>/g, "")).toContain("Total 5 credits");
  });

  it("余额门也按剩下那一组判 —— 付得起的批准不再被虚高的总价挡住", () => {
    // 钱包里 5 credits($0.50)。剩下要跑的只有一张,5 credits ⇒ 付得起。
    const markup = renderStates(["done", "idle"], 0.5);
    expect(markup, "把付得起的批准挡在了一个不会发生的总价后面").not.toContain("Not enough credits");
    expect(markup).toContain("Make all (1 · 5 credits)");
  });

  it("全都跑过了 ⇒ 没有价签也没有整包按钮,只剩收条", () => {
    const markup = renderStates(["done", "done"]);
    expect(markup).not.toContain("Make all");
    expect(markup).not.toContain("Total");
    expect(markup).toContain("All 2");
  });

  it("报不出价的那张已经跑完 ⇒ 不再拖累剩下那张的整包批准", () => {
    const markup = renderStates(["done", "idle"], 100, [
      { kind: "image", estimatedPriceUsd: 0.39 }, // 只有记账用的 USD:担保不住的价
      PRICED_5,
    ]);
    expect(markup).toContain("Make all (1 · 5 credits)");
    expect(markup).not.toContain(PACK_UNPRICED_NOTE);
  });

  it("还没跑的那张报不出价 ⇒ 整包批准照旧收起(这道门没有被放松)", () => {
    const markup = renderStates(["done", "idle"], 100, [
      PRICED_5,
      { kind: "image", estimatedPriceUsd: 0.39 },
    ]);
    expect(markup).not.toContain("Make all");
    expect(markup).toContain(PACK_UNPRICED_NOTE);
  });
});

// ---------------------------------------------------------------------------
// 10. 生产接线 —— 挂起面板判定
// ---------------------------------------------------------------------------

describe("#580 P1-4 挂起面板的判定确实接在 OttoChatStream 上", () => {
  // 与 otto-card-seams.test.ts 同一套 idiom:纯函数测得再多,也证明不了组件真的调了它。
  // 这条断言的唯一作用是:谁把这段接线删了或换回全局广播,这里立刻红。
  const src = fs.readFileSync(
    path.join(process.cwd(), "components/otto/OttoChatStream.tsx"),
    "utf8",
  );

  it("面板可见性由 shouldShowTracePanel + 本会话的待批集合决定", () => {
    expect(src).toMatch(
      /shouldShowTracePanel\(\{\s*steps:\s*traceSteps,\s*pendingCardIds:\s*pendingApprovalCardIds\s*\}\)/,
    );
  });

  it("步骤列表把流错误也喂进去,终态才停得下来", () => {
    expect(src).toMatch(/deriveTraceSteps\(\s*stepEvents,\s*liveStatus,/);
  });

  it("模块级的批准广播已经彻底移除", () => {
    const traceSrc = fs.readFileSync(path.join(process.cwd(), "components/otto/OttoTrace.tsx"), "utf8");
    expect(traceSrc).not.toContain("notifyPlanApproved");
    expect(traceSrc).not.toContain("goAheadListeners");
    expect(src).not.toContain("notifyPlanApproved");
  });

  it("通用批准卡把它自己的 card id 交回给父层的待批集合", () => {
    expect(src).toMatch(/onResolved=\{\(\{\s*cardId:[^}]*pendingCardIds\s*\}\)\s*=>\s*\{[\s\S]*?nextPendingApprovalCardIds/);
  });
});
