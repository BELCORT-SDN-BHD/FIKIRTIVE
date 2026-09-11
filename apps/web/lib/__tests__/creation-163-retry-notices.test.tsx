// @vitest-environment jsdom
/**
 * creation §5 :163①②③ —— PR #1270 落下的三条残留（判官 P2／P3，2026-09-08 登记）。
 *
 * 规格 `docs/specs/creation-engine.md`（§5 :163 行；验收 **CREATE-A1**「花钱前先见增强稿预览，
 * 可编辑可直接用」）。三条各自的病灶都是同一种形状：**屏幕上一个字都不说**。
 *
 *   · ① 输入框里有字时点 Edit and retry —— 那句话没有放回去，而按键看上去毫无反应
 *        （四处 onRetry 一律丢掉 `restoreDraft` 的返回值）。
 *   · ② `restoredDraft.sourceMessageId` —— 「这一轮是那一轮的重来」只活在请求体里，商家看不见
 *        它，也没有一处能取消。
 *   · ③ 「References kept: …」有一个名字可念时就只念名字，没名字的那几件整个消失，而它们
 *        照旧跟着下一次送出。
 *
 * 这里驱动的是真的 `OttoChatStream`（画布形态）与真的 `OttoTurnCard`：`useChat` 是替身，好让
 * 这个文件把「这一轮此刻是什么样」摆成任意一帧并读到送出去的请求体；替身之外的接线全是真的。
 * 钱只有一个把手（`plan-approval`），已被假件挡住：这个文件里的任何一条断言都花不出一个 credit。
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
vi.mock("@/lib/reference-search-actions", () => ({ searchReferencesAction: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(),
  ottoTurn: vi.fn(),
  ottoUpdateGenCardOptions: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));

const { OttoChatStream, RETRY_DRAFT_KEPT_NOTICE } = await import("@/components/otto/OttoChatStream");
const { EDIT_AND_RETRY_LABEL } = await import("@/components/otto/OttoStreamErrorNotice");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const THREAD_ID = "thread-1";
const AVATAR_ID = "ent_aisyah";
const PRODUCT_GENERATION_ID = "gen_coral_mug";
/** 商家手动挂上去的那一段片子 —— 只有 id，没有任何名字可念（正是 ③ 漏报的那一种）。 */
const CLIP_GENERATION_ID = "gen_shop_broll";
const FAILED_TEXT = "make another take with the mug";
const SNAG = "Otto hit a snag — please try again. Reference: OTTO-4F2A9C31";

/**
 * 刷新之后那条落库的 USER 消息：服务端解析过的 typed refs（带名字）与这一轮真正挂上路的媒体。
 * `extraClip` 那一格加进来的是**没有名字**的一件 —— refs 三件、labels 两个。
 */
const failedUserMessage = (extraClip = false) => ({
  id: "msg_failed_turn",
  role: "user",
  metadata: {
    kind: "TEXT",
    durableId: "msg_failed_turn",
    payload: {
      entityIds: [AVATAR_ID],
      sourceGenerationIds: [PRODUCT_GENERATION_ID],
      referenceVideoGenerationIds: extraClip ? [CLIP_GENERATION_ID] : [],
    },
    references: [
      { type: "official-avatar", id: AVATAR_ID, name: "Aisyah", source: "Official avatars", href: "/library" },
      { type: "generation", id: PRODUCT_GENERATION_ID, name: "Coral travel mug", source: "Raya launch", href: "/library" },
    ],
  },
  parts: [{ type: "text", text: FAILED_TEXT }],
});

const liveError = () => ({
  id: "a1",
  role: "assistant",
  parts: [{ type: "data-error", data: { kind: "error", text: SNAG } }],
});

const streamElement = (): ReactElement =>
  createElement(OttoChatStream, {
    layout: "canvas" as const,
    projectId: "project-1",
    entities: [],
    thread: {
      id: THREAD_ID,
      projectId: "project-1",
      title: "Untitled",
      updatedAt: new Date().toISOString(),
      messages: [],
    },
    balanceUsd: 40,
    onRefresh: async () => {},
    onThreadUpdate: () => {},
  }) as ReactElement;

/** 一轮失败摆在屏幕上：那条落库的 USER 消息 ＋ 这一轮的 data-error。 */
async function failedTurn(extraClip = false): Promise<HTMLElement> {
  mocks.chat.messages = [failedUserMessage(extraClip), liveError()];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(streamElement()); });
  return container;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function typeInto(el: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressEnter(): Promise<void> {
  await act(async () => {
    composer().dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
    );
  });
}

const buttonByText = (host: HTMLElement, text: string): HTMLButtonElement =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

const composer = (): HTMLTextAreaElement =>
  document.getElementById("otto-composer") as HTMLTextAreaElement;

/** 最后一次送出去的请求体 —— 「这一轮到底带了什么」的唯一证人。 */
const lastBody = (): Record<string, unknown> =>
  (mocks.sendMessage.mock.calls.at(-1)?.[1] as { body: Record<string, unknown> }).body;

beforeEach(() => {
  mocks.runPlanApproval.mockReset();
  mocks.runPlanApproval.mockResolvedValue({ ok: true, chained: null });
  mocks.sendMessage.mockReset();
  mocks.sendMessage.mockResolvedValue(undefined);
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

describe("creation §5 :163 —— PR #1270 三条残留", () => {
  it("creation §5 :163① / CREATE-A1 输入框有字时点 Edit and retry ⇒ 不覆盖商家正在打的字，并说出那句话没有放回去", async () => {
    const host = await failedTurn();
    await typeInto(composer(), "actually make it a video for Raya");

    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));

    expect(composer().value, "商家正在打的那句话被上一轮的原话覆盖了").toBe(
      "actually make it a video for Raya",
    );
    const notice = host.querySelector('[data-slot="composer-busy-notice"]');
    expect(notice, "那句话没放回去，而屏幕上一个字都不说 —— 看上去就是「按了没反应」").toBeTruthy();
    expect(notice!.textContent).toBe(RETRY_DRAFT_KEPT_NOTICE);
    // 引用照旧回来 —— 它们不占输入框，这一句只说文字那一半。
    expect(host.querySelector('[data-slot="restored-references"]')?.textContent).toContain("Aisyah");
  });

  it("creation §5 :163① 输入框是空的那一次 ⇒ 那句话真的放回去了，不多说一句", async () => {
    const host = await failedTurn();
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));

    expect(composer().value).toBe(FAILED_TEXT);
    expect(
      host.querySelector('[data-slot="composer-busy-notice"]'),
      "放回去成功还挂着一句「没放回去」—— 那是一句过期的话",
    ).toBeNull();
  });

  it("creation §5 :163② 恢复出来的草稿说得出它是对哪条消息的重试，并给得出独立的 Remove", async () => {
    const host = await failedTurn();
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));

    const line = host.querySelector('[data-slot="retry-source"]');
    expect(line, "「这一轮是那一轮的重来」只活在请求体里，商家看不见").toBeTruthy();
    expect(line!.textContent, "说不出是对哪条消息的重试").toContain(FAILED_TEXT);
    expect(buttonByText(line as HTMLElement, "Remove"), "看得见却取消不掉").toBeTruthy();
  });

  it("creation §5 :163② 按下那颗 Remove ⇒ 引用一件不动，下一轮是一条普通的新消息（不再带源任务）", async () => {
    const host = await failedTurn();
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));
    // 清掉之前：这一轮确实挂在那一轮名下。
    expect(host.querySelector('[data-slot="retry-source"]')).toBeTruthy();

    await click(buttonByText(host.querySelector('[data-slot="retry-source"]') as HTMLElement, "Remove"));

    expect(host.querySelector('[data-slot="retry-source"]'), "按了 Remove 那一行还在").toBeNull();
    expect(
      host.querySelector('[data-slot="restored-references"]')?.textContent,
      "Remove 只该清源任务这一格，引用被连坐清掉了",
    ).toContain("Aisyah");

    await pressEnter();
    expect(mocks.sendMessage, "这一幕的前提是真的送出了一轮").toHaveBeenCalledTimes(1);
    expect(lastBody()["replyToMessageId"], "清掉之后这一轮仍挂在旧那一轮名下").toBeUndefined();
    expect(lastBody()["entityIds"], "引用被连坐清掉了").toEqual([AVATAR_ID]);
  });

  it("creation §5 :163③ 有名字可念时，没名字的那几件仍要报个数（「+ N more」）", async () => {
    const host = await failedTurn(true);
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));

    const line = host.querySelector('[data-slot="restored-references"]');
    expect(line, "引用回来了却没有任何一处说出口").toBeTruthy();
    expect(line!.textContent).toContain("Aisyah");
    expect(line!.textContent).toContain("Coral travel mug");
    expect(
      line!.textContent,
      "第三件没有名字可念，于是它在屏幕上整个消失 —— 而它跟着下一次送出",
    ).toContain("+ 1 more");
  });
});
