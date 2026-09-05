// @vitest-environment jsdom
/**
 * CREATE-A1 —— Otto↔画布接缝：确认卡在看得见的地方、进度是真的、正文是人话。
 *
 * 触发：2026-09-04 staging 走查（`scratchpad/creation-friction-audit.html`）P0-3 / P0-4 / P1-1，
 * 全部落在 `docs/specs/creation-engine.md` §2 的 CREATE-A1 那一行（「画布路径的判定落在
 * Otto 确认卡片上」）。
 *
 * 这里驱动的是真的 `OttoTurnCard` 与真的纯函数。钱只有一个把手（`plan-approval`），
 * 所以这个文件里的任何一条断言都花不出一个 credit、够不着任何供应商。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runPlanApproval: vi.fn(), coworkVaryCard: vi.fn() }));
vi.mock("@/components/otto/plan-approval", () => ({ runPlanApproval: mocks.runPlanApproval }));
// OttoResult(判官二轮复核 P2-2)只挡住它那两个有副作用的依赖 —— 花钱的 "Make another"
// 动作与全局余额播报,两样都够不着这个文件要证的东西(视频首帧片段)。
vi.mock("@/lib/cowork-actions", () => ({ coworkVaryCard: mocks.coworkVaryCard }));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: vi.fn() }));

const {
  activeStepLabel,
  canvasProgressDetail,
  canvasTurnStatus,
  canvasTurnText,
  currentTurnStartIndex,
  latestAssistantSayable,
  latestTurnTerminal,
  STILL_WORKING_AFTER_SECONDS,
} = await import("@/lib/otto-canvas-turn");
const { STILL_WORKING_NOTE } = await import("@/lib/progress-format");
const { TURN_NARRATION } = await import("@/lib/otto-turn-narration");
const { videoFirstFrameSrc } = await import("@/lib/video-first-frame");
const { OttoTurnCard, CANVAS_TURN_EMPTY_TEXT } = await import("@/components/otto/OttoTurnCard");
const { OttoResult } = await import("@/components/otto/OttoResult");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const baseStatus = {
  isBusy: false,
  hasAssistantText: false,
  liveStatus: null,
  steps: [] as const,
  workingCardCount: 0,
  pendingConfirmCount: 0,
};

/** 一张真的、报得出价的 GEN_CARD payload（服务端写的那份形状）。 */
const plan = (overrides: Record<string, unknown> = {}) => ({
  kind: "image",
  structuredPrompt: "a pandan kaya jar on a warm morning kitchen counter",
  estimatedCredits: 1,
  specChips: ["1:1", "Brand and product photo"],
  params: { count: 1, aspectRatio: "1:1" },
  ...overrides,
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node); });
  return container;
}

beforeEach(() => {
  mocks.runPlanApproval.mockReset();
  mocks.runPlanApproval.mockResolvedValue({ ok: true, chained: null });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("CREATE-A1 · 确认卡在始终可见的 Otto 卡片里（走查 P0-3）", () => {
  it("CREATE-A1 · 有卡等确认时，可见卡里就有价格与 Generate 按钮", () => {
    const el = render(
      <OttoTurnCard
        status={canvasTurnStatus({ ...baseStatus, pendingConfirmCount: 1 })}
        text="Here's the plan."
        streaming={false}
        confirmCards={[{ cardId: "card-1", threadId: "thr-1", payload: plan(), pendingApproval: true }]}
        onApproved={() => {}}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    const confirm = el.querySelector('[aria-label="Generation confirmation"]');
    expect(confirm).not.toBeNull();
    // 走查里 Otto 说「你会在上面看到两张卡」而上面什么都没有 —— 现在那句话指的东西就在这里。
    expect(el.textContent).toContain("Generate · 1 credit");
    expect(el.textContent).toContain("1 image");
    // 规格行逐字来自卡自己的 specChips（走查 P1-2：卡说的才算数，不是聊天气泡里的说法）。
    expect(el.textContent).toContain("1:1 · Brand and product photo");
    // 状态词跟着一起说实话。
    expect(el.textContent).toContain("Needs confirmation");
  });

  it("CREATE-A1 · 按下 Generate 走的是共用的那一份批准动作，不是第二条钱路", async () => {
    const approved = vi.fn();
    const el = render(
      <OttoTurnCard
        status={canvasTurnStatus({ ...baseStatus, pendingConfirmCount: 1 })}
        text={null}
        streaming={false}
        confirmCards={[{ cardId: "card-9", threadId: "thr-7", payload: plan(), pendingApproval: true }]}
        onApproved={approved}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    const generate = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Generate ·"));
    expect(generate).toBeDefined();
    await act(async () => { generate!.click(); });

    // 同一个身份、同一条分支判据 —— 与抽屉里那张 OttoPlanCard 逐字相同的入参。
    expect(mocks.runPlanApproval).toHaveBeenCalledTimes(1);
    expect(mocks.runPlanApproval.mock.calls[0][0]).toMatchObject({
      threadId: "thr-7",
      cardId: "card-9",
      pendingApproval: true,
    });
    expect(approved).toHaveBeenCalledWith({ cardId: "card-9", chained: null });
  });

  it("CREATE-A1 · 报不出价的卡在可见卡里不给按钮（与抽屉里同一个门）", () => {
    const el = render(
      <OttoTurnCard
        status={canvasTurnStatus({ ...baseStatus, pendingConfirmCount: 1 })}
        text={null}
        streaming={false}
        confirmCards={[{
          cardId: "card-x",
          threadId: "thr-1",
          // 服务端从没给这张卡报过价：前端也不许替它报一个，更不许配一颗批准按钮。
          payload: plan({ estimatedCredits: undefined }),
          pendingApproval: true,
        }]}
        onApproved={() => {}}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    expect(el.querySelector('[aria-label="Generation confirmation"]')).toBeNull();
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes("Generate"))).toBe(false);
  });
});

describe("CREATE-A1 · 可见卡只放这一轮的确认位（走查 P1-2 的堆叠面）", () => {
  it("CREATE-A1 · 这一轮从最后一条商家发言之后算起", () => {
    const messages = [
      { role: "user" },      // 0 上一轮
      { role: "assistant" }, // 1 上一轮的卡
      { role: "user" },      // 2 这一轮
      { role: "assistant" }, // 3
    ];
    expect(currentTurnStartIndex(messages)).toBe(3);
    // 商家一句话都还没说（前门第一条自动发出之前）：整条对话就是这一轮。
    expect(currentTurnStartIndex([{ role: "assistant" }])).toBe(0);
    expect(currentTurnStartIndex([])).toBe(0);
  });

  it("CREATE-A1 · 更早几轮没按的卡不堆进这张 280px 的卡", () => {
    // Otto 重建方案时会再生一对新卡，旧的那一对没人标成过时（走查 P1-2）。四张几乎一样的
    // 卡堆在确认位上，商家会在一叠里挑一个付钱。旧的仍在对话抽屉里，照旧可以批准。
    const messages = [
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
      { role: "assistant" },
      { role: "assistant" },
    ];
    const start = currentTurnStartIndex(messages);
    const idleIndexes = [1, 3, 4];
    expect(idleIndexes.filter((i) => i >= start)).toEqual([3, 4]);
  });
});

describe("CREATE-A1 · 卡上说的是真进度（走查 P0-4）", () => {
  it("CREATE-A1 · 在飞时显示正在跑的那一步，而不是一句写死的话", () => {
    const detail = canvasProgressDetail({
      ...baseStatus,
      isBusy: true,
      steps: [
        { label: "Researching your brand", status: "done" },
        { label: "Planning the campaign", status: "active" },
      ],
    });
    expect(detail).toBe("Planning the campaign");
    expect(activeStepLabel([{ label: "Making a visual", status: "active" }])).toBe("Making a visual");
  });

  it("CREATE-A1 · 还没有任何步骤时退回已有的那三句叙述，不新写文案", () => {
    expect(canvasProgressDetail({ ...baseStatus, isBusy: true })).toBe(TURN_NARRATION["calling-model"]);
    expect(
      canvasProgressDetail({ ...baseStatus, isBusy: true, liveStatus: { kind: "planning", text: "…" } }),
    ).toBe(TURN_NARRATION.planning);
  });

  it("CREATE-A1 · 状态词随阶段变：等确认 → 生成中 → 就绪", () => {
    expect(canvasTurnStatus({ ...baseStatus, pendingConfirmCount: 2 }).label).toBe("Needs confirmation");
    expect(canvasTurnStatus({ ...baseStatus, workingCardCount: 1 }).label).toBe("Generating");
    expect(canvasTurnStatus({ ...baseStatus, isBusy: true }).label).toBe("Working");
    expect(canvasTurnStatus(baseStatus).label).toBe("Ready");
    // 钱已经花出去的那一件事排在最前 —— 它比「这一轮还在写字」更该被说出来。
    expect(canvasTurnStatus({ ...baseStatus, isBusy: true, workingCardCount: 1 }).label).toBe("Generating");
  });

  it("CREATE-A1 · 只有真的在跑才转圈，等确认时不转", () => {
    expect(canvasTurnStatus({ ...baseStatus, workingCardCount: 1 }).busy).toBe(true);
    expect(canvasTurnStatus({ ...baseStatus, isBusy: true }).busy).toBe(true);
    expect(canvasTurnStatus({ ...baseStatus, pendingConfirmCount: 1 }).busy).toBe(false);
  });

  it("CREATE-A1 · 30 秒屏幕没变就明说还在做，而不是同一句话冻在那里", () => {
    const fresh = canvasTurnStatus({ ...baseStatus, isBusy: true, secondsSinceProgress: 5 });
    expect(fresh.detail).toBe(TURN_NARRATION["calling-model"]);
    const stalled = canvasTurnStatus({
      ...baseStatus,
      isBusy: true,
      secondsSinceProgress: STILL_WORKING_AFTER_SECONDS,
    });
    expect(stalled.detail).toContain(STILL_WORKING_NOTE);
    const stalledGen = canvasTurnStatus({
      ...baseStatus,
      workingCardCount: 1,
      secondsSinceProgress: STILL_WORKING_AFTER_SECONDS + 10,
    });
    expect(stalledGen.detail).toBe(STILL_WORKING_NOTE);
  });

  it("CREATE-A1 · 进度句渲染在卡上，并且是给读屏软件报的", () => {
    const el = render(
      <OttoTurnCard
        status={canvasTurnStatus({
          ...baseStatus,
          isBusy: true,
          steps: [{ label: "Crafting the image prompt", status: "active" }],
        })}
        text={null}
        streaming={false}
        confirmCards={[]}
        onApproved={() => {}}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    const status = el.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Crafting the image prompt");
    expect(status?.getAttribute("aria-live")).toBe("polite");
  });
});

describe("CREATE-A1 · 卡上的正文是人话（走查 P1-1）", () => {
  it("CREATE-A1 · 内部占位串（🖼 result / 📋 plan card）永远不当正文", () => {
    const messages = [
      { role: "assistant", metadata: { kind: "TEXT" }, parts: [{ type: "text", text: "Both cards are ready." }] },
      { role: "assistant", metadata: { kind: "GEN_CARD" }, parts: [{ type: "text", text: "📋 plan card" }] },
      { role: "assistant", metadata: { kind: "GEN_RESULT" }, parts: [{ type: "text", text: "🖼 result" }] },
    ];
    expect(latestAssistantSayable(messages)).toBe("Both cards are ready.");
  });

  it("CREATE-A1 · 实时流下来的那一条（还没落库、没有 kind）算正文", () => {
    const messages = [
      { role: "user", metadata: { kind: "TEXT" }, parts: [{ type: "text", text: "make it 1080p" }] },
      { role: "assistant", parts: [{ type: "text", text: "Working on it" }] },
    ];
    expect(latestAssistantSayable(messages)).toBe("Working on it");
  });

  it("CREATE-A1 · Markdown 渲染成正常文本，星号不出现在屏幕上", () => {
    const el = render(
      <OttoTurnCard
        status={canvasTurnStatus(baseStatus)}
        text="You'll see **two cards** above"
        streaming={false}
        confirmCards={[]}
        onApproved={() => {}}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    expect(el.textContent).toContain("two cards");
    expect(el.textContent).not.toContain("**");
    expect(el.querySelector("strong")?.textContent).toBe("two cards");
  });

  it("CREATE-A1 · 一句话都没有时给引导句，不是空白", () => {
    const el = render(
      <OttoTurnCard
        status={canvasTurnStatus(baseStatus)}
        text={null}
        streaming={false}
        confirmCards={[]}
        onApproved={() => {}}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    expect(el.textContent).toContain(CANVAS_TURN_EMPTY_TEXT);
  });
});

describe("CREATE-A1 · 一页只有一个 Otto 入口，素材库筛选行够得到（走查 P1-8）", () => {
  it("CREATE-A1 · 创作前厅与画布都不再挂第二个 Otto 面板", async () => {
    const { ottoPanelMountsOn } = await import("@/components/otto/panel/panel-surface");
    const { CREATE_NAV_HREF, CANVAS_HREF } = await import("@fikirtive/core/navigation");
    // 这两面自己都带着一只 Otto 输入框。别的商家面一个都没动（这条钉的是挂不挂，不是默认
    // 开合本身——那条口径后来改过一次，Founder 2026-09-04 裁决收起为默认，取代 Q3-A，
    // 见 `panel-state.ts` 的 `defaultOttoPanelState`，本票不重复）。
    expect(ottoPanelMountsOn(CREATE_NAV_HREF)).toBe(false);
    expect(ottoPanelMountsOn(CANVAS_HREF)).toBe(false);
    expect(ottoPanelMountsOn("/library")).toBe(true);
    expect(ottoPanelMountsOn("/brand")).toBe(true);
  });

  it("CREATE-A1 · 素材库筛选行允许收缩，滚动条才接得上手", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../components/otto/stuff/StuffLibrary.tsx"),
      "utf8",
    );
    // `overflow-x-auto` 单独存在是没用的：flex 子项默认 `min-width: auto`，不许它缩到内容
    // 以下，于是右边被压掉、滚动永远不触发，最后一颗筛选片被裁掉半个词（Otto 面板停靠时
    // 少掉的正是那点宽度）。两个类必须在**同一只盒子**上。
    const row = src.match(/className="[^"]*overflow-x-auto[^"]*"/)?.[0] ?? "";
    expect(row, "the filter row must keep its overflow-x-auto").not.toBe("");
    expect(row, "the filter row must also carry min-w-0, or overflow-x-auto never engages").toContain("min-w-0");
  });
});

describe("CREATE-A1 · 新做好的视频显示首帧而不是黑砖（走查 P1-7）", () => {
  it("CREATE-A1 · 媒体地址带上首帧片段，且不碰服务器收得到的那一半", () => {
    expect(videoFirstFrameSrc("https://cdn.example/clip.mp4?sig=abc")).toBe(
      "https://cdn.example/clip.mp4?sig=abc#t=0.001",
    );
    // 片段在 `#` 之后，浏览器从不把它发出去 —— 签名与 query 逐字不变。
    expect(videoFirstFrameSrc("https://cdn.example/c.mp4?sig=abc").split("#")[0]).toBe(
      "https://cdn.example/c.mp4?sig=abc",
    );
  });

  it("CREATE-A1 · 已经带片段的地址原样返回，不覆盖别人说过的话", () => {
    expect(videoFirstFrameSrc("https://cdn.example/c.mp4#t=2")).toBe("https://cdn.example/c.mp4#t=2");
    expect(videoFirstFrameSrc(undefined)).toBeUndefined();
    expect(videoFirstFrameSrc("")).toBe("");
  });

  // P2-2(判官二轮复核 2026-09-04):画布节点已经修了(上面两条),但对话抽屉里同一条片子
  // 用的是另一个组件 —— `OttoResult.tsx` 的 `preload="none"` 且没有片段,浏览器在按下播放
  // 之前画的还是黑。同一个 `videoFirstFrameSrc` + `preload="metadata"` 补上去。
  it("CREATE-A1 · 对话卡里刚做好的视频也显示首帧，不是黑砖（判官二轮复核 P2-2）", () => {
    const el = render(
      <OttoResult payload={{ kind: "video", urls: ["https://cdn.example/clip.mp4?sig=abc"] }} />,
    );
    const video = el.querySelector("video")!;
    expect(video).not.toBeNull();
    expect(video.getAttribute("src")).toBe("https://cdn.example/clip.mp4?sig=abc#t=0.001");
    expect(video.getAttribute("preload")).toBe("metadata");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Codex QA-CRE-004（2026-09-04 只读审计 §4.2）—— 当前轮只投影一个权威状态
//
// 审计原话：「current-turn 曾在后续 direct video 已成功后仍显示 That generation didn't go
// through；最新强制刷新后显示 🖼 result，仍不是可理解的 done state。」期望：「current-turn
// 只表达当前 Conversation 的一个明确阶段，成功状态可理解，批准一个 step 后进入下一个需要
// 用户决定的 step。」下面每一条都钉在那句话上。
// ─────────────────────────────────────────────────────────────────────────────

/** 一条持久消息在 useChat 列表里的样子（`threadToUiMessages` 给的那份形状）。 */
const said = (text: string) =>
  ({ role: "assistant", metadata: { kind: "TEXT" }, parts: [{ type: "text", text }] });
const genCard = () =>
  ({ role: "assistant", metadata: { kind: "GEN_CARD" }, parts: [{ type: "text", text: "📋 plan card" }] });
const genResult = (payload: Record<string, unknown>) =>
  ({ role: "assistant", metadata: { kind: "GEN_RESULT", payload }, parts: [{ type: "text", text: "🖼 result" }] });
const turnError = (text: string, payload: Record<string, unknown> = {}) =>
  ({ role: "assistant", metadata: { kind: "TURN_ERROR", payload }, parts: [{ type: "text", text }] });
/** 商家自己开口说的那一句 —— 它就是「上一轮」与「这一轮」的分界。 */
const asked = (text: string) =>
  ({ role: "user", metadata: { kind: "TEXT" }, parts: [{ type: "text", text }] });

/** 审计里屏幕上那句话，逐字。 */
const FAILURE_LINE = "That generation didn't go through — you weren't charged for it.";

describe("CREATE-A1 · 当前轮只投影一个权威状态（Codex QA-CRE-004）", () => {
  it("CREATE-A1 · 失败之后再成功一次，卡上不再留着上一句失败", () => {
    // 审计复现步骤 ①②：同一个画布先失败一次，再完成一次成功的直出视频。
    const messages = [
      genCard(),
      turnError("That one didn't come through — you weren't charged."),
      said(FAILURE_LINE),
      genCard(),
      genResult({ kind: "video", urls: ["https://cdn.example/clip.mp4"], costCredits: 11 }),
    ];
    const body = canvasTurnText(messages);
    expect(body).not.toContain("didn't go through");
    // 成功态说得出产物和收费 —— 两个数字都来自 GEN_RESULT payload 自己，不是这里算的。
    expect(body).toBe("Made 1 video · 11 credits.");
    const status = canvasTurnStatus({ ...baseStatus, terminal: latestTurnTerminal(messages) });
    expect(status.phase).toBe("done");
    expect(status.label).toBe("Done");
  });

  it("CREATE-A1 · 刷新之后同一份持久状态给同一张脸，不退化成 🖼 result 也不退化成空态", () => {
    // 审计复现步骤 ③：强制刷新读的是 durable thread —— 与上一条同一个列表形状。
    const messages = [
      said(FAILURE_LINE),
      genResult({ kind: "image", urls: ["https://cdn.example/a.png", "https://cdn.example/b.png"], costCredits: 2 }),
    ];
    const body = canvasTurnText(messages);
    expect(body).toBe("Made 2 images · 2 credits.");
    expect(body).not.toContain("🖼");
    const el = render(
      <OttoTurnCard
        status={canvasTurnStatus({ ...baseStatus, terminal: latestTurnTerminal(messages) })}
        text={body}
        streaming={false}
        confirmCards={[]}
        onApproved={() => {}}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    expect(el.textContent).toContain("Made 2 images · 2 credits.");
    expect(el.textContent).toContain("Done");
    expect(el.textContent).not.toContain(CANVAS_TURN_EMPTY_TEXT);
  });

  it("CREATE-A1 · Otto 在终局之后解释过了，就说他的原话", () => {
    // 「更新的那个赢」反过来也一样：失败之后 Otto 那句解释比 TURN_ERROR 新。
    const messages = [genCard(), turnError("That one didn't come through."), said(FAILURE_LINE)];
    expect(canvasTurnText(messages)).toBe(FAILURE_LINE);
    const status = canvasTurnStatus({ ...baseStatus, terminal: latestTurnTerminal(messages) });
    expect(status.phase).toBe("failed");
    expect(status.label).toBe("Failed");
  });

  it("CREATE-A1 · 失败的终局说的是那条持久消息自己那句给商家读的话", () => {
    const messages = [genCard(), turnError("I couldn't finish that one — and you weren't charged.")];
    expect(canvasTurnText(messages)).toBe("I couldn't finish that one — and you weren't charged.");
    expect(latestTurnTerminal(messages)?.outcome).toBe("failed");
  });

  it("CREATE-A1 · 商家自己按停的那一次不是失败", () => {
    // #602 T3 与线程徽章同一条口径：cancel 走的是同一种 TURN_ERROR，但它不是坏消息。
    const messages = [genCard(), turnError("You stopped that one.", { cancelled: true })];
    expect(latestTurnTerminal(messages)?.outcome).toBe("cancelled");
    expect(canvasTurnStatus({ ...baseStatus, terminal: latestTurnTerminal(messages) }).phase).toBe("ready");
  });

  it("CREATE-A1 · 上一轮的终局不挂在这一轮脸上", () => {
    // 商家做完一次生成又开口说下一句：那一次成功不再是「此刻这一轮」的结论。
    const messages = [
      genCard(),
      genResult({ kind: "video", urls: ["https://cdn.example/clip.mp4"], costCredits: 11 }),
      { role: "user", metadata: { kind: "TEXT" }, parts: [{ type: "text", text: "make it 1080p" }] },
    ];
    expect(latestTurnTerminal(messages)).toBeNull();
    expect(canvasTurnStatus({ ...baseStatus, terminal: latestTurnTerminal(messages) }).phase).toBe("ready");
  });

  it("CREATE-A1 · 有卡在跑、有卡等确认时终局让位 —— 五个状态互斥", () => {
    const messages = [
      genCard(),
      genResult({ kind: "image", urls: ["https://cdn.example/a.png"], costCredits: 1 }),
    ];
    const terminal = latestTurnTerminal(messages);
    expect(canvasTurnStatus({ ...baseStatus, terminal, workingCardCount: 1 }).phase).toBe("generating");
    expect(canvasTurnStatus({ ...baseStatus, terminal, pendingConfirmCount: 1 }).phase).toBe("needs-confirmation");
    expect(canvasTurnStatus({ ...baseStatus, terminal, isBusy: true }).phase).toBe("working");
    expect(canvasTurnStatus({ ...baseStatus, terminal }).phase).toBe("done");
  });

  // ── 判官复核 P1-1（2026-09-04，PR #1173）─────────────────────────────────────
  // 判官在真浏览器里录到：上面那句失败**换一条路又回来了**。这一轮没有终局时，正文从前直接
  // 吐「整条对话最后一条 assistant TEXT」，于是商家失败之后开口说下一句，卡上照旧挂着上一轮
  // 那句话。下面两条就是判官那两个纯函数探针的形状，逐字钉住。

  it("CREATE-A1 · 失败之后商家开口说下一句，这一轮的确认位不挂上一轮那句失败（判官探针 A）", () => {
    // 判官 PROBE-A：terminal=null，状态词 Needs confirmation，正文却是上一轮那句失败。
    const messages = [
      genCard(),
      turnError("That one didn't come through — you weren't charged."),
      said(FAILURE_LINE),
      asked("actually, make it a pandan kaya jar photo"),
      // 这一轮 Otto 只铸了一张卡，一个字没说。
      genCard(),
    ];
    expect(latestTurnTerminal(messages)).toBeNull();
    const body = canvasTurnText(messages);
    expect(body).toBeNull();
    const status = canvasTurnStatus({ ...baseStatus, pendingConfirmCount: 1 });
    expect(status.label).toBe("Needs confirmation");
    const el = render(
      <OttoTurnCard
        status={status}
        text={body}
        streaming={false}
        confirmCards={[{ cardId: "c1", threadId: "t1", payload: plan(), pendingApproval: false }]}
        onApproved={() => {}}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    // 屏幕上那句话没了 —— 全卡逐字搜。
    expect(el.textContent).not.toContain("didn't go through");
    expect(el.textContent).toContain(CANVAS_TURN_EMPTY_TEXT);
  });

  it("CREATE-A1 · 这一轮既没终局也没话说，卡面回空态而不是上一轮那句失败（判官探针 B）", () => {
    // 判官 PROBE-B：terminal=null，绿灯 Ready 配着那句失败 —— 正是审计截图那张脸。
    const messages = [
      turnError("That one didn't come through — you weren't charged."),
      said(FAILURE_LINE),
      asked("let's try something else"),
    ];
    const body = canvasTurnText(messages);
    expect(body).toBeNull();
    const status = canvasTurnStatus({ ...baseStatus, terminal: latestTurnTerminal(messages) });
    expect(status.phase).toBe("ready");
    const el = render(
      <OttoTurnCard
        status={status}
        text={body}
        streaming={false}
        confirmCards={[]}
        onApproved={() => {}}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    expect(el.textContent).not.toContain("didn't go through");
    expect(el.textContent).toContain(CANVAS_TURN_EMPTY_TEXT);
    // 反面：Otto 这一轮一开口，说的就是他这一轮的原话 —— 修的是「按轮切」，不是把正文清空。
    expect(canvasTurnText([...messages, said("Sure — a jam jar it is.")])).toBe("Sure — a jam jar it is.");
  });

  it("CREATE-A1 · 批准一步之后，下一张确认卡还在这张卡上等商家决定", () => {
    // 审计复现步骤 ④：两步 image → video 计划，批准图片之后 video 确认位必须还在。
    // 批过的那张进了 working（`deriveCardState`），没批的那张仍是 idle —— 判据同一个。
    const el = render(
      <OttoTurnCard
        status={canvasTurnStatus({ ...baseStatus, workingCardCount: 1, pendingConfirmCount: 1 })}
        text="Approved the image — the video is next."
        streaming={false}
        confirmCards={[
          {
            cardId: "c2",
            threadId: "t1",
            payload: plan({ kind: "video", estimatedCredits: 11, specChips: ["16:9", "5s", "720p"] }),
            pendingApproval: false,
          },
        ]}
        onApproved={() => {}}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    const rows = el.querySelectorAll('[aria-label="Generation confirmation"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("1 video");
    expect(rows[0].textContent).toContain("11 credits");
  });
});
