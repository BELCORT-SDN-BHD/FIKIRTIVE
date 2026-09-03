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

const mocks = vi.hoisted(() => ({ runPlanApproval: vi.fn() }));
vi.mock("@/components/otto/plan-approval", () => ({ runPlanApproval: mocks.runPlanApproval }));

const {
  activeStepLabel,
  canvasProgressDetail,
  canvasTurnStatus,
  currentTurnStartIndex,
  latestAssistantSayable,
  STILL_WORKING_AFTER_SECONDS,
} = await import("@/lib/otto-canvas-turn");
const { STILL_WORKING_NOTE } = await import("@/lib/progress-format");
const { TURN_NARRATION } = await import("@/lib/otto-turn-narration");
const { videoFirstFrameSrc } = await import("@/lib/video-first-frame");
const { OttoTurnCard, CANVAS_TURN_EMPTY_TEXT } = await import("@/components/otto/OttoTurnCard");

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
      />,
    );
    expect(el.textContent).toContain(CANVAS_TURN_EMPTY_TEXT);
  });
});

describe("CREATE-A1 · 一页只有一个 Otto 入口，素材库筛选行够得到（走查 P1-8）", () => {
  it("CREATE-A1 · 创作前厅与画布都不再挂第二个 Otto 面板", async () => {
    const { ottoPanelMountsOn } = await import("@/components/otto/panel/panel-surface");
    const { CREATE_NAV_HREF, CANVAS_HREF } = await import("@fikirtive/core/navigation");
    // 这两面自己都带着一只 Otto 输入框。别的商家面一个都没动（面板默认开合＝Founder
    // 2026-08-18 Q3-A，本票没碰）。
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
});
