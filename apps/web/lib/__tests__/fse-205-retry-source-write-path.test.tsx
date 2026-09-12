// @vitest-environment jsdom
/**
 * FSE-205 —— 核实 `sourceMessageId` 在**直播**失败的重试草稿上到底有没有写进去，两条重试
 * 路径（失败卡 / 聊天消息）各复测一次。
 *
 * 规格 `docs/specs/creation-engine.md` §5 :163② 登记行（FSE-205，S5 批量裁决 2026-09-12，
 * #1358）：「先由代码侧确认 `sourceMessageId` 在失败卡重试路径上是否写入，缺则补；两条
 * 重试路各复测」。
 *
 * ── 核实结果（这个文件的第一份证据）───────────────────────────────────────────
 * 根因**坐实**，渲染条件本身（`restoredDraft?.sourceMessageId`，`OttoChatStream.tsx`）没有
 * 问题——问题在写入端 `liveRetryDraft`（同文件）：一轮**直播**失败（没有刷新，`messages`
 * 里那条用户消息只是 `sendMessage` 的乐观回显，没有 `metadata`）时，`retryDraft` 走的是
 * `source.sourceMessageId` 原样透传，而 `source`（`lastSentDraftRef.current`）那一格答的是
 * 「那次发送本身是不是某个更早回合的重来」——对**绝大多数**失败（商家第一次打这句话，
 * 从未被重试过）恒为 `null`。于是 `restoredDraft.sourceMessageId` 是 `null`，
 * `data-slot="retry-source"` 那一行永远不出现——不是只在某一条重试路径上，两条都一样：
 * 「失败卡」（画布 `OttoTurnCard`）与「聊天消息」（抽屉/默认形态里那条内联的
 * `OttoStreamErrorNotice`）背后走的是同一份 `editAndRetry` → `liveRetryDraft`，同一个根。
 *
 * 修法：新增一个 `latestUserMessageIdRef`（跟着 `messages` 更新，`onData` 是闭包不可信
 * 读最新的 `messages`，与 `lastSentDraftRef` 同一条纪律），`liveRetryDraft` 一律用它
 * 覆写 `sourceMessageId`——「这一轮失败该指向哪条消息」永远是此刻最新那条用户消息自己，
 * 与它当初带着什么无关。
 *
 * 这里驱动的是真的 `OttoChatStream`；`useChat` 是替身，好让这个文件把「直播失败」这一帧
 * 摆出来。钱只有一个把手（`plan-approval`），已被假件挡住。
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
    onData: null as ((part: unknown) => void) | null,
  },
}));
vi.mock("@/components/otto/plan-approval", () => ({ runPlanApproval: mocks.runPlanApproval }));
vi.mock("@ai-sdk/react", () => ({
  useChat: (opts?: { onData?: (part: unknown) => void }) => {
    mocks.chat.onData = opts?.onData ?? null;
    return {
      messages: mocks.chat.messages,
      setMessages: vi.fn(),
      sendMessage: mocks.sendMessage,
      status: mocks.chat.status,
      error: mocks.chat.error,
    };
  },
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

const { OttoChatStream } = await import("@/components/otto/OttoChatStream");
const { CHANGE_FORM_SEND } = await import("@/components/otto/CardOptionControls");
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
const CARD_ID = "card_1";
const AVATAR_ID = "ent_aisyah";
const PRODUCT_GENERATION_ID = "gen_coral_mug";
const SNAG = "Otto hit a snag — please try again. Reference: OTTO-4F2A9C31";
const CHANGE_TEXT = "add the exact product photo";

/** 一张服务端今天真会铸出来的图片卡，带一件演员引用（等确认，还没被批准）。 */
function cardPayload() {
  return {
    kind: "image",
    model: "seedream",
    params: { aspectRatio: "3:4", count: 1 },
    reason: "image",
    specChips: ["1728 × 2304", "3:4", "1 image"],
    downgraded: false,
    structuredPrompt: "Aisyah holding the coral travel mug, warm window light",
    entityIds: [AVATAR_ID],
    variantSel: {},
    estimatedPriceUsd: 0.04,
    estimatedCredits: 1,
    options: { maxCount: 4, aspectRatios: ["1:1", "3:4"], fineDetailAvailable: true },
    approvedEntities: [{ id: AVATAR_ID, name: "Aisyah", type: "CHARACTER" }],
    mediaReferences: [
      {
        generationId: PRODUCT_GENERATION_ID,
        kind: "image",
        label: "Coral travel mug",
        role: "baseImage",
        sourceProjectId: "proj_raya",
        sourceProjectName: "Raya launch",
        sameCanvas: true,
        previewUrl: "/files/a/b.png",
      },
    ],
  };
}

const genCardMessage = () => ({
  id: CARD_ID,
  role: "assistant",
  metadata: { kind: "GEN_CARD", durableId: CARD_ID, payload: cardPayload(), genJobId: null },
  parts: [{ type: "text", text: "📋 plan card" }],
});

const liveError = () => ({
  id: "a1",
  role: "assistant",
  parts: [{ type: "data-error", data: { kind: "error", text: SNAG } }],
});

// P2-3(判官修根,PR #1415)——一件挂在 composer 上的引用(不经过任何卡片),让「全新消息」
// 也带得动 `hasTurnReferences`:`restoreDraft` 只在草稿带着引用时才留住 `sourceMessageId`
// (§5 :163②「References kept」与「retry-source」共用同一道门槛),纯文字、零引用的消息
// 因此永远进不了 `restoredDraft`,retry-source 那一行也就永远不会出现——这不是
// `liveRetryDraft` 那半的事,构造场景时就得绕开它。
const PLAIN_MESSAGE_COMPOSER_REF = [{
  requestId: "req_plain_1",
  generationId: "gen_mug_plain",
  src: "/files/plain-mug.png",
  kind: "image" as const,
  previewKind: "image" as const,
  label: "Coral mug",
}];

const streamElement = (layout: "canvas" | "default", withComposerRef = false): ReactElement =>
  createElement(OttoChatStream, {
    layout,
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
    ...(withComposerRef ? { composerReferences: PLAIN_MESSAGE_COMPOSER_REF } : {}),
  }) as ReactElement;

async function mount(layout: "canvas" | "default", withComposerRef = false): Promise<HTMLElement> {
  mocks.chat.messages = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "make me a hero shot" }] },
    genCardMessage(),
  ];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(streamElement(layout, withComposerRef)); });
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

const buttonByText = (host: HTMLElement, text: string): HTMLButtonElement =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

/**
 * 真送出一轮带引用的（走确认卡「Change」/「Change something」那条路 —— 两种壳共用
 * `CardOptionControls`/`changeRequestDraft`，触发按钮文案各自不同），再让它在**直播**里
 * 失败（不刷新）：这一刻 `useChat` 手上那条用户消息只是乐观回显，没有 `metadata`。
 */
async function liveFailedChangeRequest(host: HTMLElement, changeButtonText: string): Promise<void> {
  await click(buttonByText(host, changeButtonText));
  const note = host.querySelector('[data-slot="card-change-form"] textarea') as HTMLTextAreaElement;
  await typeInto(note, CHANGE_TEXT);
  await click(buttonByText(host, CHANGE_FORM_SEND));

  const sentText = (mocks.sendMessage.mock.calls[0]![0] as { text: string }).text;
  mocks.chat.messages = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "make me a hero shot" }] },
    genCardMessage(),
    { id: "echo_1", role: "user", parts: [{ type: "text", text: sentText }] },
  ];
  mocks.chat.status = "streaming";
  await act(async () => { root!.render(streamElement(host === canvasHostRef ? "canvas" : "default")); });
  await act(async () => {
    mocks.chat.onData?.({ type: "data-error", data: { kind: "error", text: SNAG } });
  });
  mocks.chat.messages = [...mocks.chat.messages, liveError()];
  mocks.chat.status = "ready";
  await act(async () => { root!.render(streamElement(host === canvasHostRef ? "canvas" : "default")); });
  await act(async () => { await Promise.resolve(); });
}

// `liveFailedChangeRequest` needs to know which layout it is re-rendering — a plain module
// variable set right before the call keeps the helper's signature small.
let canvasHostRef: HTMLElement | null = null;

beforeEach(() => {
  mocks.runPlanApproval.mockReset();
  mocks.runPlanApproval.mockResolvedValue({ ok: true, chained: null });
  mocks.sendMessage.mockReset();
  mocks.sendMessage.mockResolvedValue(undefined);
  mocks.chat.status = "ready";
  mocks.chat.error = null;
  mocks.chat.messages = [];
  mocks.chat.onData = null;
  canvasHostRef = null;
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("FSE-205 —— 失败卡与聊天消息两条重试路径各复测一次", () => {
  it("FSE-205 失败卡（画布 OttoTurnCard）：直播失败后点 Edit and retry ⇒ retry-source 那一行说得出是对哪条消息的重试", async () => {
    const host = await mount("canvas");
    canvasHostRef = host;
    await liveFailedChangeRequest(host, "Change");

    const retry = buttonByText(host, EDIT_AND_RETRY_LABEL);
    expect(retry, "失败卡上没有那颗 Edit and retry —— 直播失败这一幕没演到").toBeTruthy();
    await click(retry);

    const line = host.querySelector('[data-slot="retry-source"]');
    expect(line, "「这一轮是那一轮的重来」只活在请求体里，商家在失败卡这条路上看不见").toBeTruthy();
    expect(line!.textContent, "说不出是对哪条消息的重试").toContain(CHANGE_TEXT);
    expect(buttonByText(line as HTMLElement, "Remove"), "看得见却取消不掉").toBeTruthy();
  });

  it("FSE-205 聊天消息（抽屉/默认形态的内联错误告示）：直播失败后点 Edit and retry ⇒ retry-source 那一行同样说得出是对哪条消息的重试", async () => {
    const host = await mount("default");
    canvasHostRef = null;
    await liveFailedChangeRequest(host, "Change something");

    const retry = buttonByText(host, EDIT_AND_RETRY_LABEL);
    expect(retry, "聊天消息那条路上没有那颗 Edit and retry —— 直播失败这一幕没演到").toBeTruthy();
    await click(retry);

    const line = host.querySelector('[data-slot="retry-source"]');
    expect(line, "同一次直播失败，聊天消息这条路也不该把 sourceMessageId 丢在半路").toBeTruthy();
    expect(line!.textContent).toContain(CHANGE_TEXT);
  });
});

/**
 * 判官修根 P2-2 / P2-3（PR #1415，FSE-211 复审）——`liveRetryDraft` 把「屏幕这一行该念
 * 哪条消息」与「请求体真正该回复给哪条消息」两个问题共用一格（`sourceMessageId`），
 * FSE-205 把这一格改写成乐观回显 id 只是为了修屏幕那一半；卡片 Change 请求的
 * `replyToMessageId`（本该回复给那张卡）被一起冲掉，直播失败后 Edit and retry 再送出去，
 * 落库的 `replyToMessageId` 退化成 `null`，那张卡的归属就断了。
 *
 * 修法（`sourceMessageId` 继续答屏幕那个问题不变；新增 `replyToMessageId` 只答请求体那个
 * 问题）：`liveRetryDraft` 与 `submit()` 各自的判官修根说明见 `OttoChatStream.tsx`。
 */
async function typeIntoComposer(host: HTMLElement, value: string): Promise<void> {
  const composer = host.querySelector("#otto-composer") as HTMLTextAreaElement;
  await typeInto(composer, value);
}

/**
 * 真送出一条**全新**消息(不经过任何卡片,直接打字 + composer 的 Send),再让它在**直播**
 * 里失败(不刷新)——与 `liveFailedChangeRequest` 同一套配方,唯二的差别:①这一轮从一开始
 * 就没有任何「回复给谁」的上文,`source.sourceMessageId` 恒为 `null`;②挂了一件
 * `composerReferences` 带来的附件(`mount(..., true)`),让它带得动引用而不必经过卡片——
 * 见上面 `PLAIN_MESSAGE_COMPOSER_REF` 的注释。附件一旦被这一轮吃掉(`sendTurn` 送出时清空
 * `attachedRefs`),`lastSentDraftRef.current.refs` 已经把它定格,后续重渲染不必再传一次。
 */
async function liveFailedPlainMessage(host: HTMLElement, text: string): Promise<void> {
  await typeIntoComposer(host, text);
  await click(buttonByText(host, "Send"));

  const sentText = (mocks.sendMessage.mock.calls[mocks.sendMessage.mock.calls.length - 1]![0] as { text: string }).text;
  mocks.chat.messages = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "make me a hero shot" }] },
    genCardMessage(),
    { id: "echo_plain", role: "user", parts: [{ type: "text", text: sentText }] },
  ];
  mocks.chat.status = "streaming";
  await act(async () => { root!.render(streamElement("default")); });
  await act(async () => {
    mocks.chat.onData?.({ type: "data-error", data: { kind: "error", text: SNAG } });
  });
  mocks.chat.messages = [...mocks.chat.messages, liveError()];
  mocks.chat.status = "ready";
  await act(async () => { root!.render(streamElement("default")); });
  await act(async () => { await Promise.resolve(); });
}

describe("判官修根 P2-2/P2-3 —— 屏幕那行与请求体的 replyToMessageId 是两个问题，别共用一格", () => {
  it("P2-2 卡片 Change → 直播失败 → Edit and retry → 真送出 ⇒ replyToMessageId 仍是那张卡，不是刚才那条还没落库的回显", async () => {
    const host = await mount("canvas");
    canvasHostRef = host;
    await liveFailedChangeRequest(host, "Change");

    const retry = buttonByText(host, EDIT_AND_RETRY_LABEL);
    await click(retry);

    // 屏幕那半不该退步:这一行仍然认得出是对哪条消息的重试(FSE-205 那一半不变)。
    const line = host.querySelector('[data-slot="retry-source"]');
    expect(line?.textContent).toContain(CHANGE_TEXT);

    const send = buttonByText(host, "Send");
    expect(send, "Edit and retry 之后输入框里应该有字,composer 的 Send 该是可点的").toBeTruthy();
    await click(send);

    expect(mocks.sendMessage, "点了 Send 却没有真的再送一次").toHaveBeenCalledTimes(2);
    const secondCallBody = mocks.sendMessage.mock.calls[1]![1] as { body?: Record<string, unknown> };
    expect(
      secondCallBody.body?.replyToMessageId,
      "落库 replyToMessageId 不该退化成刚才那条还没落库的乐观回显 id —— 应该仍是这张卡自己的消息 id",
    ).toBe(CARD_ID);
  });

  it("P2-3 全新消息(非卡片路)→ 直播失败 → Edit and retry ⇒ retry-source 那一行照样出现", async () => {
    const host = await mount("default", /* withComposerRef */ true);
    canvasHostRef = null;
    const PLAIN_TEXT = "make three product shots for the new mug";
    await liveFailedPlainMessage(host, PLAIN_TEXT);

    const retry = buttonByText(host, EDIT_AND_RETRY_LABEL);
    expect(retry, "全新消息(没有任何卡片/更早消息可指)直播失败之后也该有 Edit and retry").toBeTruthy();
    await click(retry);

    const line = host.querySelector('[data-slot="retry-source"]');
    expect(
      line,
      "liveRetryDraft 的 source 分支(这一轮自己就是 lastSentDraftRef,不是 null)也该让这一行出现 —— " +
        "没有更早的上文时,「正在重试的那一轮」就是它自己刚刚回显的那一条",
    ).toBeTruthy();
    expect(line!.textContent).toContain(PLAIN_TEXT);

    // 没有卡片、没有更早的回合可指:真送出时不该编一个 replyToMessageId 出来。
    const send = buttonByText(host, "Send");
    await click(send);
    const lastCallBody = mocks.sendMessage.mock.calls.at(-1)![1] as { body?: Record<string, unknown> };
    expect(
      lastCallBody.body?.replyToMessageId,
      "全新消息没有原本的回复目标,不该把乐观回显的 id 当成 replyToMessageId 送上去",
    ).toBeUndefined();
  });
});
