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
  parsePlanCardPayload,
  DOWNGRADE_FALLBACK_NOTE,
  PARTIAL_PLAN_NOTE,
  UNREADABLE_PLAN_NOTE,
  type OttoPlanCardPayload,
} from "@/components/otto/OttoPlanCard";
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
  variantSel: true,
  estimatedPriceUsd: true,
  estimatedCredits: true,
  videoStep: true,
  sourceGenerationId: true,
  goal: true,
  referenceVideoGenerationId: true,
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
  variantSel: true,
  estimatedPriceUsd: true,
  estimatedCredits: true,
  videoStep: true,
  sourceGenerationId: true,
  goal: true,
  referenceVideoGenerationId: true,
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
    for (const key of ["videoStep", "sourceGenerationId", "referenceVideoGenerationId", "downgradeNote"]) {
      expect(emitted.has(key)).toBe(true);
    }
    expect([...emitted].filter((k) => !(k in CARD_PAYLOAD_KEYS))).toEqual([]);
  });
});

/** Six real cards straight from the live server builder: plain video, downgraded video,
 *  image ad pack, two-step image, i2v, reference video. */
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
    buildProposeCard({ kind: "video", ...base, desiredDuration: 7, desiredAspect: "1:1" }, ctx, []),
    buildProposeCard({ kind: "image", ...base, count: 3 }, ctx, []),
    buildProposeCard({ kind: "image", ...base, forVideo: true }, ctx, []),
    buildProposeCard({ kind: "video", ...base }, { ...(ctx as object), sourceGenerationId: "gen_img" } as never, []),
    buildProposeCard({ kind: "video", ...base }, { ...(ctx as object), referenceVideoGenerationId: "gen_vid" } as never, []),
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
  model: "seedance-2-fast",
  params: { aspectRatio: "9:16", resolution: "720p", durationSeconds: 5, audio: true, count: 1 },
  reason: "Seedance 2.0 Fast — 9:16, 5s",
  specChips: ["9:16", "5s", "720p"],
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
    // 「说的」不许超出 builder 给的那几条 —— 声音就是被这一条挡住的。
    expect(markup).not.toMatch(/With sound|No sound/);
  });

  it("图片卡:如实报执行层真会产出的尺寸,不承诺任何比例", async () => {
    const { buildProposeCard } = await import("@fikirtive/otto");
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, desiredAspect: "9:16", count: 3 },
      { orgId: "o", userId: "u", projectId: "p", threadId: "t", disabledModels: [], sourceGenerationId: null } as never,
      [],
    );
    const markup = renderCard(cardPayload);
    expect(cardPayload.specChips).toEqual(["2048 × 2048", "3 images"]);
    for (const chip of cardPayload.specChips) expect(markup).toContain(chip);
    // 商家要的 9:16 到不了执行层,所以规格里不许出现任何比例 —— 它只可以出现在
    // 「你要的是 X,实际会是 Y」这句披露里。
    expect(cardPayload.specChips.some((chip) => /\d+\s*:\s*\d+/.test(chip))).toBe(false);
    expect(markup).toContain("You asked for 9:16 — this will be a square 2048 × 2048 image.");
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
    expect(markup).not.toContain("Review cost");
  });

  it("读得出来但没有价格 → 同样不给付费按钮,不许编一个 1 credit 出来", () => {
    const markup = renderCard({ kind: "image", structuredPrompt: "a poster" });
    expect(markup).toContain(UNREADABLE_PLAN_NOTE);
    expect(markup).not.toContain("Review cost");
  });

  it("部分字段畸形 → 卡面显式说明它不完整", () => {
    const markup = renderCard({ ...VIDEO_PAYLOAD, params: "16:9" });
    expect(markup).toContain(PARTIAL_PLAN_NOTE);
    expect(markup).toContain("Review cost");
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

  async function approveThroughTheUi(host: HTMLElement): Promise<void> {
    clickButton(host, "Review cost");
    const confirm = [...host.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Confirm generate"),
    );
    expect(confirm, "confirming must offer a real confirm button").toBeTruthy();
    await act(async () => {
      confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
});

// ---------------------------------------------------------------------------
// 7. 生产接线的删除必须红 —— 面板可见性是父层按待批集合算的
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
