// @vitest-environment jsdom
/**
 * FSE-003 / FSE-004 —— 「Send to Otto」按字面真发送，「Edit and retry」把那句话**连同原引用**放回。
 *
 * 规格 `docs/specs/creation-engine.md`（验收 **CREATE-A1** / **CREATE-A2**）与
 * `docs/specs/frontend-baseline.md`（**FRONT-A12**，§5 2026-09-08 行把口径放宽为「那句话＋原引用
 * 一起放回」）。触发＝2026-09-08 staging E2E Round 1，Founder 当日裁「一片修完；Send 按字面真发送」。
 *
 * 走查现场两幕：
 *  · FSE-003：确认卡 Change →「补上确切商品图」→ Send to Otto。**没有新的 USER 消息**，最后一条
 *    USER 的时间戳一动不动，Otto 也没有回复 —— 商家只能改用主输入框重打一遍。调用链末端
 *    （`seedComposer`）只 `setText`，从来没有 submit。
 *  · FSE-004：带原商品图的 variation 失败，刷新后点 Edit and retry。回来的是一段扩写过的提示词，
 *    参考图 chip 一张都没有 —— 照它再送一次就是一次**无条件生成**，而商家以为在重试同一件事。
 *
 * 这里驱动的是真的 `OttoChatStream`（画布形态）与真的 `OttoTurnCard`。`useChat` 是替身，好让这个
 * 文件把「这一轮此刻是什么样」摆成任意一帧并读到送出去的**请求体**；替身之外的接线全是真的。
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
const { referenceUnavailableMessage } = await import("@fikirtive/core/gen-failure");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const THREAD_ID = "thread-1";
const CARD_ID = "card_1";
const AVATAR_ID = "ent_aisyah";
const PRODUCT_GENERATION_ID = "gen_coral_mug";
const SNAG = "Otto hit a snag — please try again. Reference: OTTO-4F2A9C31";

/** 一张服务端今天真会铸出来的图片卡，带演员与商品图两件引用回执。 */
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

/** 一条等确认的 GEN_CARD，在 useChat 手上的样子。 */
const genCardMessage = () => ({
  id: CARD_ID,
  role: "assistant",
  metadata: { kind: "GEN_CARD", durableId: CARD_ID, payload: cardPayload(), genJobId: null },
  parts: [{ type: "text", text: "📋 plan card" }],
});

/**
 * 刷新之后那条落库的 USER 消息 —— 服务端解析过的 typed refs 与这一轮真正挂上路的媒体都在它身上。
 * FSE-004 的复现路径（失败 → 刷新 → Edit and retry）到那一刻，客户端手上就只剩这一条。
 */
const failedUserMessage = () => ({
  id: "msg_failed_turn",
  role: "user",
  metadata: {
    kind: "TEXT",
    durableId: "msg_failed_turn",
    payload: {
      entityIds: [AVATAR_ID],
      sourceGenerationIds: [PRODUCT_GENERATION_ID],
      referenceVideoGenerationIds: [],
    },
    references: [
      { type: "official-avatar", id: AVATAR_ID, name: "Aisyah", source: "Official avatars", href: "/library" },
      { type: "generation", id: PRODUCT_GENERATION_ID, name: "Coral travel mug", source: "Raya launch", href: "/library" },
    ],
  },
  parts: [{ type: "text", text: "make another take with the mug" }],
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

async function mountCanvas(): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(streamElement()); });
  return container;
}

/** 服务端用一个流打开**之前**的普通 400 把整轮退回来（body 就是我们自己写的那一句）。 */
async function refuseTurn(sentence: string): Promise<void> {
  mocks.chat.status = "error";
  mocks.chat.error = new Error(JSON.stringify({ error: sentence }));
  await act(async () => { root!.render(streamElement()); });
  // 放回去那几个 setState 走 `queueMicrotask`，多刷一拍。
  await act(async () => { await Promise.resolve(); });
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

// ─────────────────────────────────────────────────────────────────────────────
// FSE-003 —— Send to Otto 真的发送
// ─────────────────────────────────────────────────────────────────────────────
describe("FSE-003 / CREATE-A1 —— 「Send to Otto」按字面真发送", () => {
  async function openChangeForm(): Promise<HTMLElement> {
    mocks.chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "make me a hero shot" }] },
      genCardMessage(),
    ];
    const host = await mountCanvas();
    await click(buttonByText(host, "Change"));
    return host;
  }

  it("FSE-003 / CREATE-A1 按一次 Send ⇒ 真的送出一轮（不是往输入框里塞一段字）", async () => {
    const host = await openChangeForm();
    const note = host.querySelector('[data-slot="card-change-form"] textarea') as HTMLTextAreaElement;
    await typeInto(note, "add the exact product photo");
    await click(buttonByText(host, CHANGE_FORM_SEND));

    expect(mocks.sendMessage, "按下 Send 之后一轮都没送出去").toHaveBeenCalledTimes(1);
    const [message] = mocks.sendMessage.mock.calls[0]!;
    expect((message as { text: string }).text).toContain("add the exact product photo");
    // 「连同当前卡送回对话」—— 卡的原话跟在后面，Otto 不必靠商家再描述一遍。
    expect((message as { text: string }).text).toContain(cardPayload().structuredPrompt);
    // 送完输入框是空的：那句话去了对话，不是留在草稿里等第二次按。
    expect(composer().value).toBe("");
  });

  it("FSE-003 / CREATE-A2 送出去的那一轮带着原卡与它的引用上下文", async () => {
    const host = await openChangeForm();
    const note = host.querySelector('[data-slot="card-change-form"] textarea') as HTMLTextAreaElement;
    await typeInto(note, "add the exact product photo");
    await click(buttonByText(host, CHANGE_FORM_SEND));

    const body = lastBody();
    expect(body["threadId"]).toBe(THREAD_ID);
    expect(body["entityIds"]).toEqual([AVATAR_ID]);
    expect(body["sourceGenerationIds"]).toEqual([PRODUCT_GENERATION_ID]);
    // 老读者只认单数那一格 —— 两格并存，与 `composerReferencePayload` 逐字同一个口径。
    expect(body["sourceGenerationId"]).toBe(PRODUCT_GENERATION_ID);
    // 源任务标识：改的是哪一张卡，记录里说得出来。
    expect(body["replyToMessageId"]).toBe(CARD_ID);
  });

  it("FSE-003 / CREATE-A1 双击 Send ⇒ 只送一轮（同一道闸，不重复计费）", async () => {
    const host = await openChangeForm();
    const note = host.querySelector('[data-slot="card-change-form"] textarea') as HTMLTextAreaElement;
    await typeInto(note, "add the exact product photo");
    const send = buttonByText(host, CHANGE_FORM_SEND);
    await click(send);
    await click(send);

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("FSE-003 / CREATE-A1 上一轮还在飞 ⇒ 不发送，但草稿回到输入框（不是「按了没反应」）", async () => {
    mocks.chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "make me a hero shot" }] },
      genCardMessage(),
    ];
    mocks.chat.status = "streaming";
    const host = await mountCanvas();
    await click(buttonByText(host, "Change"));
    const note = host.querySelector('[data-slot="card-change-form"] textarea') as HTMLTextAreaElement;
    await typeInto(note, "add the exact product photo");
    await click(buttonByText(host, CHANGE_FORM_SEND));

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(composer().value).toContain("add the exact product photo");
    // 引用也留着 —— 商家自己按下去时它们照旧跟着走。
    expect(host.querySelector('[data-slot="restored-references"]')?.textContent).toContain("Aisyah");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FSE-004 —— Edit and retry 把那句话连同原引用放回
// ─────────────────────────────────────────────────────────────────────────────
describe("FSE-004 / FRONT-A12 —— 重试草稿 = 那句话 ＋ typed refs ＋ 源任务标识", () => {
  async function failedTurn(): Promise<HTMLElement> {
    mocks.chat.messages = [failedUserMessage(), liveError()];
    return mountCanvas();
  }

  it("FSE-004 / FRONT-A12 点 Edit and retry ⇒ 那句话回输入框，而且**不发送**", async () => {
    const host = await failedTurn();
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));

    expect(composer().value).toBe("make another take with the mug");
    expect(mocks.sendMessage, "Edit and retry 绝不自己发送 —— 商家要先改").not.toHaveBeenCalled();
  });

  it("FSE-004 / FRONT-A12 原引用跟着回来，而且商家看得见它们回来了", async () => {
    const host = await failedTurn();
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));

    const line = host.querySelector('[data-slot="restored-references"]');
    expect(line, "引用回来了却没有任何一处说出口").toBeTruthy();
    expect(line!.textContent).toContain("Aisyah");
    expect(line!.textContent).toContain("Coral travel mug");
  });

  it("FSE-004 / CREATE-A2 改完再送 ⇒ 同一张源图与同一位演员随这一轮上路，源任务也带着", async () => {
    const host = await failedTurn();
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));
    await typeInto(composer(), "make another take with the mug, brighter");
    await click(buttonByText(host, "Send"));

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const body = lastBody();
    expect(body["sourceGenerationIds"]).toEqual([PRODUCT_GENERATION_ID]);
    expect(body["entityIds"]).toEqual([AVATAR_ID]);
    expect(body["references"]).toEqual([
      `official-avatar:${AVATAR_ID}`,
      `generation:${PRODUCT_GENERATION_ID}`,
    ]);
    expect(body["replyToMessageId"]).toBe("msg_failed_turn");
  });

  it("FSE-004 / FRONT-A12 商家自己去掉引用 ⇒ 下一轮就真的不带（无条件生成必须是他明说的）", async () => {
    const host = await failedTurn();
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));
    await click(buttonByText(host, "Remove references"));
    expect(host.querySelector('[data-slot="restored-references"]')).toBeNull();

    await typeInto(composer(), "just a plain poster");
    await click(buttonByText(host, "Send"));

    const body = lastBody();
    expect(body["sourceGenerationIds"]).toBeUndefined();
    expect(body["entityIds"]).toBeUndefined();
    expect(body["references"]).toBeUndefined();
  });

  it("FSE-004 / CREATE-A2 送出去被「有一件参考取不到」退回 ⇒ 引用也回到原处（要求重选，不静默变无条件生成）", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = await failedTurn();
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));
    await typeInto(composer(), "make another take with the mug, brighter");
    await click(buttonByText(host, "Send"));
    // 送出那一刻输入框与那一行都清空了 —— 这正是「不放回去就悄悄少了引用」的那一刻。
    expect(host.querySelector('[data-slot="restored-references"]')).toBeNull();

    await refuseTurn(referenceUnavailableMessage("notFound"));

    // 那句话回来了，引用也回来了：商家移掉取不到的那一件（或整块清掉）再送，
    // 而不是照着一份悄悄少了引用的草稿再按一次。
    expect(composer().value).toContain("make another take with the mug, brighter");
    const line = container!.querySelector('[data-slot="restored-references"]');
    expect(line, "被退回的那一轮把引用悄悄丢了").toBeTruthy();
    expect(line!.textContent).toContain("Aisyah");
    consoleError.mockRestore();
  });

  it("FSE-004 / FRONT-A12 取消（不按 Send）⇒ 一轮都没送出去，一分钱都没动", async () => {
    const host = await failedTurn();
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.runPlanApproval, "重试草稿这条路一次都不该碰批准动作").not.toHaveBeenCalled();
  });
});
