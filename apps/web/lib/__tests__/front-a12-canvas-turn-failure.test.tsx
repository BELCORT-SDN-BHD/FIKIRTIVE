// @vitest-environment jsdom
/**
 * FRONT-A12 —— 画布上「按了没反应」的第六处：**Otto 这一轮失败了，那张始终可见的状态卡
 * 还写着绿灯 Ready**。
 *
 * 规格 `docs/specs/frontend-baseline.md` §2 FRONT-A12（「任何写入失败都有错误反馈，不出现
 * 『假成功』」）；触发＝2026-09-05 走查（截图 `preserved/creation-12h-2026-09-04/
 * walkthrough-2026-09-05/13-15`）：在 /create/canvas 底部 Reply to Otto 发一句，输入框清空，
 * 48 秒里左上角状态卡始终「Otto / Ready / Tell Otto what you want to create or change.」，
 * 只有左下角默认折起的「Conversation」计数从 2 变 4；展开或整页刷新之后，同一张卡才变
 * 「Otto / Failed / Otto hit a snag — please try again. Reference: OTTO-…」。
 *
 * 病根不是少了一个订阅，是**这一轮的终局有三种到达方式而投影只认一种**（落了库的那一种，
 * 而落库那份要刷新才回到 `messages`）。下面每一条都钉在「三条路径出来的是同一张脸」上：
 *
 *   ① 直播 `data-error` 部件 ⇒ 当场 Failed，原句与 Reference 都在卡上；
 *   ② 传输级失败（流没打开就断了，消息上没有任何部件）⇒ 同样上脸，不是 Ready；
 *   ③ 刷新之后落了库的 TURN_ERROR ⇒ 逐字同一张脸；
 *   ④ 失败的出路就摆在卡上（「Edit and retry」把商家原话交回输入框），不必去展开抽屉；
 *   ⑤ 充值／抬上限那两种失败**不**给重试键 —— 它们的出路不在这里；
 *   ⑥ 送出那一刻当场是 Working，不是 Ready。
 *
 * 这里驱动的是真的 `OttoTurnCard` 与真的纯函数。钱只有一个把手（`plan-approval`），已被
 * 假件挡住：这个文件里的任何一条断言都花不出一个 credit。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runPlanApproval: vi.fn(),
  sendMessage: vi.fn(),
  chat: {
    status: "ready" as "ready" | "submitted" | "streaming" | "error",
    error: null as Error | null,
    messages: [] as Array<Record<string, unknown>>,
  },
}));
vi.mock("@/components/otto/plan-approval", () => ({ runPlanApproval: mocks.runPlanApproval }));
// 下面「真的接线」那一组渲染的是真的 `OttoChatStream`（画布形态）。useChat 被替身，好让这个
// 文件能把「这一轮此刻是什么样」摆成任意一帧；替身之外的接线全是真的。
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: mocks.chat.messages,
    setMessages: vi.fn(),
    sendMessage: mocks.sendMessage,
    status: mocks.chat.status,
    error: mocks.chat.error,
  }),
}));
vi.mock("ai", () => ({ DefaultChatTransport: class { constructor(_opts: unknown) { void _opts; } } }));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));

const { canvasTurnStatus, canvasTurnText, latestTurnTerminal } = await import("@/lib/otto-canvas-turn");
const { OttoTurnCard, CANVAS_TURN_EMPTY_TEXT } = await import("@/components/otto/OttoTurnCard");
const {
  CAP_EXIT_HREF,
  CAP_EXIT_LABEL,
  EDIT_AND_RETRY_LABEL,
  TOP_UP_HREF,
  TOP_UP_LABEL,
} = await import("@/components/otto/OttoStreamErrorNotice");
const { referenceUnavailableMessage } = await import("@fikirtive/core/gen-failure");
const { OttoChatStream } = await import("@/components/otto/OttoChatStream");
const CANVAS_CARD = '[aria-label="Otto current turn"]';

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

/** 走查里屏幕上那句话，逐字（`lib/otto-stream-errors.ts` 的 `streamTurnErrorText`）。 */
const SNAG = "Otto hit a snag — please try again. Reference: OTTO-4F2A9C31";

/** 商家自己开口说的那一句 —— 它就是「上一轮」与「这一轮」的分界。 */
const asked = (text: string) =>
  ({ role: "user", metadata: { kind: "TEXT" }, parts: [{ type: "text", text }] });
/** 一条落了库的 assistant TEXT。 */
const said = (text: string) =>
  ({ role: "assistant", metadata: { kind: "TEXT" }, parts: [{ type: "text", text }] });
/**
 * 直播里那条 assistant 消息：路由写下的 `data-error` 部件就挂在它的 parts 上（AI SDK 把非
 * transient 的 data 部件写进 `message.parts`），而它**没有** durable metadata —— 落库那份要
 * 等整页刷新才回来。走查录到的那一刻，屏幕上就只有这一条。
 */
const liveErrorMessage = (text: string, kind = "error") =>
  ({ role: "assistant", parts: [{ type: "data-error", data: { kind, text } }] });
/** 刷新之后同一次失败在列表里的样子（`threadToUiMessages` 给的那份形状）。 */
const durableTurnError = (text: string, kind = "error") =>
  ({
    role: "assistant",
    metadata: { kind: "TURN_ERROR", payload: { errorId: "OTTO-4F2A9C31", error: { kind, text } } },
    parts: [{ type: "text", text }],
  });

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node); });
  return container;
}

/** 一张卡此刻的整张脸 —— 状态词、正文、出路，全部由同一份消息派生。 */
function card(
  messages: readonly Record<string, unknown>[],
  opts: {
    isBusy?: boolean;
    liveError?: { kind: "error" | "insufficient_credits" | "spend_cap" | "provider_unavailable"; text: string } | null;
    retryDraft?: string | null;
  } = {},
) {
  const list = messages as Parameters<typeof latestTurnTerminal>[0];
  const terminal = latestTurnTerminal(list, opts.liveError ?? null);
  return render(
    <OttoTurnCard
      status={canvasTurnStatus({ ...baseStatus, isBusy: opts.isBusy ?? false, terminal })}
      text={canvasTurnText(list, opts.liveError ?? null)}
      streaming={false}
      confirmCards={[]}
      // 出路按类型分岔 —— 与 `OttoChatStream` 那一行逐字同一条判据。
      errorKind={terminal?.outcome === "failed" ? terminal.error?.kind ?? null : null}
      retryDraft={opts.retryDraft ?? null}
      onApproved={() => {}}
      onChangeSomething={() => {}}
      onOptionsChanged={() => {}}
    />,
  );
}

/** 画布形态的真 `OttoChatStream` —— 那张始终可见的卡就长在它里面。 */
async function canvas(): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(OttoChatStream, {
        layout: "canvas" as const,
        projectId: "project-1",
        entities: [],
        thread: { id: "thread-1", projectId: "project-1", title: "Untitled", updatedAt: new Date().toISOString(), messages: [] },
        balanceUsd: 40,
        onRefresh: async () => {},
        onThreadUpdate: () => {},
      }) as ReactElement,
    );
  });
  return container.querySelector(CANVAS_CARD) as HTMLElement;
}

beforeEach(() => {
  mocks.runPlanApproval.mockReset();
  mocks.runPlanApproval.mockResolvedValue({ ok: true, chained: null });
  mocks.sendMessage.mockReset();
  mocks.chat.status = "ready";
  mocks.chat.error = null;
  mocks.chat.messages = [];
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("FRONT-A12 ⑥ 画布状态卡：这一轮失败了就当场说出口", () => {
  it("FRONT-A12: 直播里这一轮失败，状态卡当场是 Failed，不是 Ready", () => {
    // 走查那一刻屏幕上的全部：商家的一句话，加一条只带 data-error 部件的 assistant 消息。
    const messages = [asked("make it 1080p"), liveErrorMessage(SNAG)];
    const el = card(messages);
    expect(el.textContent).toContain("Failed");
    expect(el.textContent).not.toContain("Ready");
    // 原句与那个可复制的短号都在卡上 —— 商家不必去展开左下角那个折起的抽屉。
    expect(el.textContent).toContain(SNAG);
    expect(el.textContent).toContain("Reference: OTTO-4F2A9C31");
    expect(el.textContent).not.toContain(CANVAS_TURN_EMPTY_TEXT);
    // 圆点也是失败色，而不是绿灯。
    expect(el.innerHTML).toContain("bg-destructive");
    // 失败那一句是当场念给读屏软件听的。
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(SNAG);
  });

  it("FRONT-A12: 失败排在「在飞」前面 —— 已经报了失败的一轮不再写 Working", () => {
    // `data-error` 是终局部件（路由写完就 return），可是 useChat 的 status 要等流真的关掉
    // 才落回 ready。那半拍里写「Working」，说的是一件已经不成立的事。
    const messages = [asked("make it 1080p"), liveErrorMessage(SNAG)];
    expect(card(messages, { isBusy: true }).textContent).toContain("Failed");
  });

  it("FRONT-A12: 流还没打开就断了（传输级失败）同样上脸，不是绿灯 Ready", () => {
    // 这一种消息上不会有任何部件 —— 失败只活在调用方的 status 里，作为 liveError 传进来。
    const el = card([asked("make it 1080p")], {
      liveError: { kind: "error", text: "Otto hit a snag — please try again." },
    });
    expect(el.textContent).toContain("Failed");
    expect(el.textContent).toContain("Otto hit a snag — please try again.");
  });

  it("FRONT-A12: 刷新之后落了库的那一份给同一张脸，逐字一样", () => {
    const live = card([asked("make it 1080p"), liveErrorMessage(SNAG)]).textContent;
    act(() => { root?.unmount(); });
    container?.remove();
    const durable = card([asked("make it 1080p"), durableTurnError(SNAG)]).textContent;
    expect(durable).toBe(live);
  });

  it("FRONT-A12: 失败的出路就在卡上 —— Edit and retry 把商家原话交回输入框", () => {
    const seeded: string[] = [];
    const messages = [asked("make it 1080p"), liveErrorMessage(SNAG)];
    const list = messages as Parameters<typeof latestTurnTerminal>[0];
    const el = render(
      <OttoTurnCard
        status={canvasTurnStatus({ ...baseStatus, terminal: latestTurnTerminal(list) })}
        text={canvasTurnText(list)}
        streaming={false}
        confirmCards={[]}
        retryDraft="make it 1080p"
        onApproved={() => {}}
        onChangeSomething={(seed) => seeded.push(seed)}
        onOptionsChanged={() => {}}
      />,
    );
    const button = [...el.querySelectorAll("button")].find((b) => b.textContent === EDIT_AND_RETRY_LABEL);
    expect(button, "失败卡上没有那颗 Edit and retry").toBeTruthy();
    act(() => { button!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(seeded).toEqual(["make it 1080p"]);
  });

  it("FRONT-A12: 能不能重试是按失败的类型判的，不是按措辞", () => {
    // `error` 能重试；充值与抬上限那两种的出路不在这张卡上（抽屉里那张告示带各自的键）。
    const retryable = latestTurnTerminal([asked("a"), liveErrorMessage(SNAG)] as Parameters<typeof latestTurnTerminal>[0]);
    expect(retryable?.error?.kind).toBe("error");
    const broke = latestTurnTerminal(
      [asked("a"), liveErrorMessage("You have 3.9 credits; this turn holds 11.", "insufficient_credits")] as Parameters<typeof latestTurnTerminal>[0],
    );
    expect(broke?.outcome).toBe("failed");
    expect(broke?.error?.kind).toBe("insufficient_credits");
    // 落库那份刷新之后还认得出同一个岔路口。
    const reloaded = latestTurnTerminal(
      [asked("a"), durableTurnError("You have 3.9 credits; this turn holds 11.", "insufficient_credits")] as Parameters<typeof latestTurnTerminal>[0],
    );
    expect(reloaded?.error?.kind).toBe("insufficient_credits");
  });

  it("FRONT-A12: 充值那一种不给重试键 —— 卡上不摆一个解决不了问题的动作", () => {
    const el = card([asked("a"), liveErrorMessage("You have 3.9 credits; this turn holds 11.", "insufficient_credits")], {
      retryDraft: null,
    });
    expect(el.textContent).toContain("Failed");
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === EDIT_AND_RETRY_LABEL)).toBe(false);
  });

  it("FRONT-A12: 送出那一刻当场是 Working，不是 Ready", () => {
    // 输入框一清空这张卡就得动 —— 走查里 48 秒不动，正是这半段的另一半。
    const el = card([asked("make it 1080p")], { isBusy: true });
    expect(el.textContent).toContain("Working");
    expect(el.textContent).not.toContain("Ready");
  });

  it("FRONT-A12: 上一轮的失败不挂在这一轮脸上", () => {
    // 商家失败一次、开口说下一句：那一次失败不再是「此刻这一轮」的结论。
    const messages = [asked("a jam jar"), liveErrorMessage(SNAG), asked("try again with 1080p")];
    const el = card(messages);
    expect(el.textContent).not.toContain("Failed");
    expect(el.textContent).toContain("Ready");
    expect(el.textContent).toContain(CANVAS_TURN_EMPTY_TEXT);
  });

  /**
   * #1225 判官 P2-5 —— 失败也要排在「有卡在跑」前面。
   *
   * `workingCardCount` 数的是画布上**所有**在飞的付费任务，不只是这一轮的。于是更早一轮的
   * 生成还在跑时，这一轮报的失败被一句「Generating」盖掉：商家看着绿灯转，以为自己刚说的
   * 那句话正在被做，而它已经失败了 —— 与走查那 48 秒是同一种病，只是换了个盖住它的词。
   *
   * 变异实证：把 `outcome !== "failed"` 这个判据从 `workingCardCount` 那一支去掉，这一条红。
   */
  it("FRONT-A12: 更早一轮还在生成，也不许把这一轮的失败写成 Generating", () => {
    const messages = [asked("make it 1080p"), liveErrorMessage(SNAG)];
    const list = messages as Parameters<typeof latestTurnTerminal>[0];
    const el = render(
      <OttoTurnCard
        status={canvasTurnStatus({ ...baseStatus, workingCardCount: 1, terminal: latestTurnTerminal(list) })}
        text={canvasTurnText(list)}
        streaming={false}
        confirmCards={[]}
        retryDraft="make it 1080p"
        onApproved={() => {}}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    expect(el.textContent).toContain("Failed");
    expect(el.textContent, "在飞的那张卡把这一轮的失败盖掉了").not.toContain("Generating");
    expect(el.textContent).toContain(SNAG);
  });

  /** 没失败的时候顺序一个字没变（上面那条不是把 Generating 判死）。 */
  it("FRONT-A12: 这一轮没失败时，有卡在跑照旧是 Generating", () => {
    const messages = [asked("make it 1080p")];
    const list = messages as Parameters<typeof latestTurnTerminal>[0];
    const el = render(
      <OttoTurnCard
        status={canvasTurnStatus({ ...baseStatus, workingCardCount: 1, terminal: latestTurnTerminal(list) })}
        text={canvasTurnText(list)}
        streaming={false}
        confirmCards={[]}
        onApproved={() => {}}
        onChangeSomething={() => {}}
        onOptionsChanged={() => {}}
      />,
    );
    expect(el.textContent).toContain("Generating");
    expect(el.textContent).not.toContain("Failed");
  });

  it("FRONT-A12: 好好走完的一轮不因为这条路变成失败（对照组）", () => {
    const el = card([asked("a jam jar"), said("Here's what I'd make.")]);
    expect(el.textContent).toContain("Ready");
    expect(el.textContent).toContain("Here's what I'd make.");
    expect(el.textContent).not.toContain("Failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 真的接线 —— 上面证的是投影，这一组证的是画布里那张卡**真的**读得到它
// ─────────────────────────────────────────────────────────────────────────────
describe("FRONT-A12 ⑥ 画布里那张卡真的接到了这一轮的失败", () => {
  it("FRONT-A12: 画布里一轮失败之后，卡上当场是 Failed 与那句原话（不必展开 Conversation）", async () => {
    mocks.chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "make it 1080p" }] },
      { id: "a1", role: "assistant", parts: [{ type: "data-error", data: { kind: "error", text: SNAG } }] },
    ];
    const el = await canvas();
    expect(el, "画布上没有那张始终可见的 Otto 卡").toBeTruthy();
    expect(el.textContent).toContain("Failed");
    expect(el.textContent).toContain(SNAG);
    expect(el.textContent).not.toContain("Ready");
  });

  it("FRONT-A12: 卡上那颗 Edit and retry 把商家自己那句话放回输入框", async () => {
    mocks.chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "make it 1080p" }] },
      { id: "a1", role: "assistant", parts: [{ type: "data-error", data: { kind: "error", text: SNAG } }] },
    ];
    const el = await canvas();
    const button = [...el.querySelectorAll("button")].find((b) => b.textContent === EDIT_AND_RETRY_LABEL);
    expect(button, "失败卡上没有那颗 Edit and retry").toBeTruthy();
    await act(async () => { button!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const composer = document.getElementById("otto-composer") as HTMLTextAreaElement | null;
    expect(composer?.value).toBe("make it 1080p");
  });

  it("FRONT-A12: 传输级失败（流没打开就断了）在画布里同样上脸", async () => {
    mocks.chat.status = "error";
    mocks.chat.error = new Error("Failed to fetch");
    mocks.chat.messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "make it 1080p" }] }];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = await canvas();
    expect(el.textContent).toContain("Failed");
    expect(el.textContent).toContain("Otto hit a snag — please try again.");
    // 开发者看的那句原文照旧只进日志，不上卡（#949 A2）。
    expect(el.textContent).not.toContain("Failed to fetch");
    consoleError.mockRestore();
  });

  it("FRONT-A12: 送出之后这张卡当场是 Working，不是 Ready", async () => {
    mocks.chat.status = "submitted";
    mocks.chat.messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "make it 1080p" }] }];
    const el = await canvas();
    expect(el.textContent).toContain("Working");
    expect(el.textContent).not.toContain("Ready");
  });

  /**
   * #1225 判官 P2-4 —— 失败正文的**颜色**此前只在投影那一组钉过（圆点 `bg-destructive`），
   * 真接线这一侧一条都没有。那句话读起来是不是一次失败，靠的就是它。
   *
   * 变异实证：把卡上正文那一段的 `text-destructive` 换成 `text-foreground`，这一条红。
   */
  it("FRONT-A12: 画布里那句失败正文是失败色，而且当场念给读屏软件听", async () => {
    mocks.chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "make it 1080p" }] },
      { id: "a1", role: "assistant", parts: [{ type: "data-error", data: { kind: "error", text: SNAG } }] },
    ];
    const el = await canvas();
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent, "失败那一句没被念出来").toContain(SNAG);
    expect(alert?.className).toContain("text-destructive");
    expect(alert?.className).not.toContain("text-foreground");
  });

  /**
   * #1225 判官 P2-2 与残留 —— 「两档不给重试键」此前只有投影那一组的一条，真接线一条都没有；
   * 而这两档在这张卡上从前**一个出口都没有**：商家读到「Not enough credits …」之后，卡上一个
   * 能按的东西都没有（画布形态下抽屉是折起的，那两颗键在里面他看不见）。
   *
   * 变异实证：把 `canvasRetryDraft` 的 `error?.kind === "error"` 判据去掉 ⇒ 这两条红；
   * 把 `errorKind` 这条线摘掉 ⇒ 同样红。
   */
  it("FRONT-A12: 充值那一档在画布里不给重试键，给的是 Top up", async () => {
    mocks.chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "make it 1080p" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{
          type: "data-error",
          data: {
            kind: "insufficient_credits",
            text: "You have 0.8 credits — starting a message with Otto needs at least 1 credit. Top up in Billing.",
          },
        }],
      },
    ];
    const el = await canvas();
    expect(el.textContent).toContain("Failed");
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === EDIT_AND_RETRY_LABEL)).toBe(false);
    const exit = [...el.querySelectorAll("a")].find((a) => a.textContent === TOP_UP_LABEL);
    expect(exit, "卡上没有那条充值出路").toBeTruthy();
    expect(exit!.getAttribute("href")).toBe(TOP_UP_HREF);
  });

  it("FRONT-A12: 抬上限那一档在画布里不给重试键，给的是上限那一页", async () => {
    mocks.chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "make it 1080p" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{
          type: "data-error",
          data: {
            kind: "spend_cap",
            text: "Paused by your spend cap — this needs 11 credits and your cap is 5 credits per action. Raise the cap in Billing & credits to run it.",
          },
        }],
      },
    ];
    const el = await canvas();
    expect(el.textContent).toContain("Failed");
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === EDIT_AND_RETRY_LABEL)).toBe(false);
    const exit = [...el.querySelectorAll("a")].find((a) => a.textContent === CAP_EXIT_LABEL);
    expect(exit, "卡上没有那条抬上限的出路").toBeTruthy();
    expect(exit!.getAttribute("href")).toBe(CAP_EXIT_HREF);
    // 上限被拒 ≠ 没钱:这条出路不许退化成一颗充值键。
    expect(el.textContent).not.toContain(TOP_UP_LABEL);
  });

  /** #1224 判官 P2-2 的画布这一半:说了「等一会儿再说」,就不许再给一颗「马上再送一次」。 */
  it("FRONT-A12: 供应商侧那一档在画布里一个键都不给", async () => {
    const honest =
      "Otto is unavailable right now on our side. This turn wasn't charged. Please try again later. Reference: OTTO-4F2A9C31";
    mocks.chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "make it 1080p" }] },
      { id: "a1", role: "assistant", parts: [{ type: "data-error", data: { kind: "provider_unavailable", text: honest } }] },
    ];
    const el = await canvas();
    expect(el.textContent).toContain("Failed");
    expect(el.textContent).toContain(honest);
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === EDIT_AND_RETRY_LABEL)).toBe(false);
    expect(el.querySelector("a")).toBeNull();
  });

  /**
   * #1225 残留 —— 同一次失败，两张脸各说一套：参考取不到那种 400 在输入框旁边写的是真正的
   * 原因，在这张卡上却是一句通用的「Otto hit a snag — please try again.」（照它说的再送一次，
   * 那件参考照样取不到）。现在两处读的是**同一次判定**。
   */
  it("FRONT-A12: 参考取不到那一种被退回，卡上说的是那句具体的原因", async () => {
    const sentence = referenceUnavailableMessage("notFound");
    mocks.chat.status = "error";
    mocks.chat.error = new Error(JSON.stringify({ error: sentence }));
    mocks.chat.messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "make it 1080p" }] }];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = await canvas();
    expect(el.textContent).toContain("Failed");
    expect(el.textContent).toContain(sentence);
    expect(el.textContent, "卡上仍是那句通用兜底").not.toContain("Otto hit a snag — please try again.");
    consoleError.mockRestore();
  });
});
