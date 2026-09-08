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
  /** `@` 菜单背后那一次真的服务端搜索 —— 这个文件里它只答一件东西:一张 gif。 */
  searchReferencesAction: vi.fn(),
  chat: {
    status: "ready" as "ready" | "submitted" | "streaming" | "error",
    error: null as Error | null,
    messages: [] as Array<Record<string, unknown>>,
    /**
     * FSE-004 复修轮:`useChat` 的 `onData` —— **直播**那一刻的唯一信使。
     *
     * 上一版这个替身把 options 整份丢掉,于是这个文件只演得出「刷新之后」那一种形状,
     * 而判官 P1-2 点的正是它演不到的那一种:商家坐在屏幕前看着这一轮失败(没刷新)。
     * 真实运行时那一刻只有 `onData` 在说话,所以替身必须把它接出来。
     */
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
vi.mock("@/lib/reference-search-actions", () => ({ searchReferencesAction: mocks.searchReferencesAction }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(),
  ottoTurn: vi.fn(),
  ottoUpdateGenCardOptions: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));

const { OttoChatStream, COMPOSER_BUSY_NOTICE } = await import("@/components/otto/OttoChatStream");
const { CHANGE_FORM_SEND } = await import("@/components/otto/CardOptionControls");
const { EDIT_AND_RETRY_LABEL } = await import("@/components/otto/OttoStreamErrorNotice");
const { referenceUnavailableMessage } = await import("@fikirtive/core/gen-failure");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// `@` 菜单靠它定位;jsdom 不带,缺了它菜单一行都渲染不出来,而这条测试的前提正是那一行。
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

/**
 * 复修轮四(判官 2026-09-08 P1)—— 商家 `@` 到的那一件 gif。
 *
 * `upload` 不是实体类型(`ENTITY_REFERENCE_TYPES` 里没有它),所以这一轮唯一带的是
 * `references` 那一格:`entityIds` / `sourceGenerationIds` / `referenceVideoGenerationIds`
 * 三格全空 —— 正是那条计数漏算的形状。gif 上传允许、当引用不行,服务端回的是
 * `unsupportedFormat` 那一句 400(`lib/reference-search.ts` 的 `@` 搜索不按扩展名过滤)。
 */
const GIF_ROW = {
  type: "upload" as const,
  id: "upl_party_gif",
  name: "party.gif",
  source: "Uploads",
  thumbUrl: null,
};
const GIF_REF = `upload:${GIF_ROW.id}`;

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

/**
 * 流**还没打开**就断了的那一种（网络断／解析炸）：`useChat` 只把它挂在 `status` 与 `error` 上，
 * 消息上一个部件都没有，body 也不是白名单认得出的那一句。
 */
async function transportFailure(): Promise<void> {
  mocks.chat.status = "error";
  mocks.chat.error = new Error("Failed to fetch");
  await act(async () => { root!.render(streamElement()); });
  await act(async () => { await Promise.resolve(); });
}

/**
 * 直播那一刻服务端把这一轮判死:一个 `data-error` 从流里到达(**没有**刷新)。
 * 落库那条 USER 消息此刻还不在手上 —— 手上那条是 `sendMessage({text})` 的乐观回显。
 */
async function liveFailure(sentText: string): Promise<void> {
  // 送出去 → 流开着（`submitted`/`streaming`）→ 一个 data-error 到达 → 回到 `ready`。
  // 这一串状态位不能省：送出那道闸（`submitLockRef`）正是靠 `isBusy` 落下来又抬起来的。
  mocks.chat.messages = [
    { id: "echo_1", role: "user", parts: [{ type: "text", text: sentText }] },
  ];
  mocks.chat.status = "streaming";
  await act(async () => { root!.render(streamElement()); });
  await act(async () => {
    mocks.chat.onData?.({ type: "data-error", data: { kind: "error", text: SNAG } });
  });
  mocks.chat.messages = [
    { id: "echo_1", role: "user", parts: [{ type: "text", text: sentText }] },
    liveError(),
  ];
  mocks.chat.status = "ready";
  await act(async () => { root!.render(streamElement()); });
  await act(async () => { await Promise.resolve(); });
}

/** 画布上那张卡本体 —— 抽屉里那张告示不算数(画布形态下它是折起的)。 */
const canvasCard = (): HTMLElement =>
  container!.querySelector('[aria-label="Otto current turn"]') as HTMLElement;

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
  mocks.chat.onData = null;
  mocks.searchReferencesAction.mockReset();
  mocks.searchReferencesAction.mockResolvedValue({ items: [GIF_ROW], nextCursor: null });
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

    // 判官 2026-09-08 P3：上一版这两下分两个 `act` 点，第一下就把表单卸载了，第二下点在一颗
    // **脱离 DOM** 的按钮上 —— 那道闸一次都没被考过，测试是空转的。真的双击发生在同一帧里：
    // 第一下送出去的那个 promise 还没 resolve、React 还没把表单收起来，第二下就到了。
    let secondHitLiveButton = false;
    await act(async () => {
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      secondHitLiveButton = send.isConnected;
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(secondHitLiveButton, "第二下点在已经脱离 DOM 的按钮上 —— 这条测试没考到那道闸").toBe(true);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    // 被闸挡下的那一下什么都不做：一次双击不该既送出一轮，又把同一段字塞回输入框。
    expect(composer().value, "双击的第二下把已经送出去的那段字塞回了输入框").toBe("");
  });

  it("FSE-003 / CREATE-A1 按 Send 时输入框里打了一半的字 ⇒ 原样留着（卡走的是独立通道）", async () => {
    const host = await openChangeForm();
    // 商家一边在主输入框里打下一句，一边在卡上按 Send —— 走查之后这是完全正常的一幕。
    await typeInto(composer(), "and then a video for Raya");
    const note = host.querySelector('[data-slot="card-change-form"] textarea') as HTMLTextAreaElement;
    await typeInto(note, "add the exact product photo");
    await click(buttonByText(host, CHANGE_FORM_SEND));

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect((mocks.sendMessage.mock.calls[0]![0] as { text: string }).text).toContain("add the exact product photo");
    // 判官 2026-09-08 P2：卡上那颗 Send 从前借输入框那条路走，于是送出的一瞬把商家打了一半
    // 的那句话无声清空 —— 屏幕上没有任何一处说过它去哪了。
    expect(composer().value, "卡上那颗 Send 把商家打了一半的那句话无声清空了").toBe("and then a video for Raya");
  });

  async function busyChangeForm(): Promise<HTMLElement> {
    mocks.chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "make me a hero shot" }] },
      genCardMessage(),
    ];
    mocks.chat.status = "streaming";
    const host = await mountCanvas();
    await click(buttonByText(host, "Change"));
    return host;
  }

  it("FSE-003 / CREATE-A1 上一轮还在飞、输入框是空的 ⇒ 不发送，草稿回到输入框（不是「按了没反应」）", async () => {
    const host = await busyChangeForm();
    const note = host.querySelector('[data-slot="card-change-form"] textarea') as HTMLTextAreaElement;
    await typeInto(note, "add the exact product photo");
    await click(buttonByText(host, CHANGE_FORM_SEND));

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(composer().value).toContain("add the exact product photo");
    // 引用也留着 —— 商家自己按下去时它们照旧跟着走。
    expect(host.querySelector('[data-slot="restored-references"]')?.textContent).toContain("Aisyah");
    // 输入框本来就是空的，那句话真的放回去了 —— 不必再多说一句。
    expect(host.querySelector('[data-slot="composer-busy-notice"]')).toBeNull();
  });

  // 复修轮四（判官 2026-09-08 P2）—— 同一颗键，输入框里有字的那一半。
  // `restoreDraft` 从前**无条件** `seedComposer`：商家一边打下一句、一边在卡上按 Send 被闸
  // 挡下，他打了一半的那句话当场被卡的原话换掉，而屏幕上一个字都不说它去哪了。
  it("FSE-003 / CREATE-A1 上一轮还在飞、输入框有字 ⇒ 不覆盖商家正在打的那句话，改成说出没送出去", async () => {
    const host = await busyChangeForm();
    await typeInto(composer(), "and then a video for Raya");
    const note = host.querySelector('[data-slot="card-change-form"] textarea') as HTMLTextAreaElement;
    await typeInto(note, "add the exact product photo");
    await click(buttonByText(host, CHANGE_FORM_SEND));

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(composer().value, "商家正在打的那句话被卡的原话覆盖了").toBe("and then a video for Raya");
    // 「按了没反应」是走查的原病灶：没送出去这件事必须有人说出口。
    const notice = host.querySelector('[data-slot="composer-busy-notice"]');
    expect(notice, "那颗键没送出去，屏幕上一个字都不说").toBeTruthy();
    expect(notice!.textContent).toBe(COMPOSER_BUSY_NOTICE);
    // 引用照旧留着 —— 它们不占输入框。
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

  // 复修轮四（判官 2026-09-08 P3）—— 商家按下 Edit and retry 之后**改过**那句话，再按一次
  // （或者另一条恢复路径到达）时，从前会把他改的字换回原话，而屏幕上一处都不说。
  it("FSE-004 / FRONT-A12 商家改过那句话之后 ⇒ 再恢复一次不把他改的字换回原话", async () => {
    const host = await failedTurn();
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));
    expect(composer().value).toBe("make another take with the mug");

    await typeInto(composer(), "same shot but no mug at all");
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));

    expect(composer().value, "商家改过的那句话被原话换回去了").toBe("same shot but no mug at all");
    // 引用照旧回来 —— 它们不占输入框。
    expect(host.querySelector('[data-slot="restored-references"]')?.textContent).toContain("Aisyah");
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

  // ───────────────────────────────────────────────────────────────────────────
  // 复修轮（判官 2026-09-08 P1-2）—— **直播**那一种失败：商家坐在屏幕前看着它失败，没刷新。
  //
  // 那一刻手上那条 USER 消息只是 `sendMessage({text})` 的乐观回显：只有 `parts`，`metadata`
  // 一格都没有。上一版画布那颗 Edit and retry 只读消息，于是引用一件都不回来，而屏幕上一个字
  // 都不说 ——「带回来了」与「没带回来」长得一模一样，下一次送出就是一次无条件生成。
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * 真送出一轮**带引用**的（走确认卡那条路）。这一刻手上那条最新的 USER 消息还是挂载时
   * 那条白板（`u1`，没有 metadata）—— 与真实运行时「没刷新」那一刻的形状逐字相同：
   * 从消息里读不出任何引用，能说话的只有这一轮送出时留下的现场记录。
   */
  async function sendChangeRequestTurn(): Promise<HTMLElement> {
    mocks.chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "make me a hero shot" }] },
      genCardMessage(),
    ];
    const host = await mountCanvas();
    await click(buttonByText(host, "Change"));
    const note = host.querySelector('[data-slot="card-change-form"] textarea') as HTMLTextAreaElement;
    await typeInto(note, "add the exact product photo");
    await click(buttonByText(host, CHANGE_FORM_SEND));
    return host;
  }

  /** 先真送出一轮带引用的（走确认卡那条路），再让它在直播里失败。 */
  async function liveFailedTurnAfterSend(): Promise<HTMLElement> {
    const host = await sendChangeRequestTurn();
    const sentText = (mocks.sendMessage.mock.calls[0]![0] as { text: string }).text;
    await liveFailure(sentText);
    return host;
  }

  it("FSE-004 / FRONT-A12 直播失败（没刷新）⇒ 画布那颗 Edit and retry 把原引用一起放回", async () => {
    await liveFailedTurnAfterSend();

    const retry = buttonByText(canvasCard(), EDIT_AND_RETRY_LABEL);
    expect(retry, "画布卡上没有 Edit and retry —— 直播失败这一幕根本没演到").toBeTruthy();
    await click(retry);

    expect(composer().value).toContain("add the exact product photo");
    const line = container!.querySelector('[data-slot="restored-references"]');
    expect(line, "引用一件都没回来，而屏幕上一个字都不说 —— 正是 FSE-004 的病灶").toBeTruthy();
    expect(line!.textContent).toContain("Aisyah");
  });

  it("FSE-004 / CREATE-A2 直播失败后改完再送 ⇒ 同一张源图与同一位演员照旧上路（不是无条件生成）", async () => {
    await liveFailedTurnAfterSend();
    await click(buttonByText(canvasCard(), EDIT_AND_RETRY_LABEL));
    await typeInto(composer(), "add the exact product photo, brighter");
    await click(buttonByText(container!, "Send"));

    // 第一次是确认卡那一轮（失败的那一轮），第二次才是这次重试 —— 不钉住次数，
    // 「第二次根本没送出去」会被 `at(-1)` 读成第一次的请求体，测试就假绿了。
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    const body = lastBody();
    expect(body["sourceGenerationIds"]).toEqual([PRODUCT_GENERATION_ID]);
    expect(body["entityIds"]).toEqual([AVATAR_ID]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 复修轮三（判官 2026-09-08 P1）—— **传输级**那一种失败：流还没打开就断了。
  //
  // 上一轮只修好了 `data-error` 那一半。`status === "error"` 这一条路从不设 `retryDraft`，
  // 于是画布那颗 Edit and retry 只读得到落库消息那一份 —— 而这一刻手上那条 USER 消息只是
  // `sendMessage({text})` 的乐观回显，引用一件都没有。放回去的就是「那句话 ＋ 零引用」。
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * 真送出一轮**带引用**的（Edit and retry → 改一句 → Send），然后把手上的消息摆成
   * 「送出去了但还没刷新」那一刻的形状：useChat 追加的是一条**乐观回显**（只有 parts，
   * `metadata` 一格都没有）。从这一刻的消息里读得出的引用是零 —— 能说话的只有这一轮
   * 送出时留下的现场记录。
   */
  const RETRY_SENT_TEXT = "make another take with the mug, brighter";
  async function sentTurnWithRefsNoRefresh(): Promise<HTMLElement> {
    const host = await failedTurn();
    await click(buttonByText(host, EDIT_AND_RETRY_LABEL));
    await typeInto(composer(), RETRY_SENT_TEXT);
    await click(buttonByText(host, "Send"));
    expect(mocks.sendMessage, "这一幕的前提是真的送出了一轮带引用的").toHaveBeenCalledTimes(1);
    mocks.chat.messages = [
      failedUserMessage(),
      liveError(),
      { id: "echo_2", role: "user", parts: [{ type: "text", text: RETRY_SENT_TEXT }] },
    ];
    await act(async () => { root!.render(streamElement()); });
    return host;
  }

  it("FSE-004 / FRONT-A12 传输级失败（流还没打开就断了）⇒ Edit and retry 也把原引用一起放回", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await sentTurnWithRefsNoRefresh();
    await transportFailure();

    const retry = buttonByText(canvasCard(), EDIT_AND_RETRY_LABEL);
    expect(retry, "传输级失败之后画布卡上没有 Edit and retry —— 这一幕根本没演到").toBeTruthy();
    await click(retry);

    expect(composer().value).toContain(RETRY_SENT_TEXT);
    const line = container!.querySelector('[data-slot="restored-references"]');
    expect(line, "传输级失败从不设重试草稿 —— 引用一件都没回来，而屏幕上一个字都不说").toBeTruthy();
    expect(line!.textContent).toContain("Aisyah");
    expect(line!.textContent).toContain("Coral travel mug");
    consoleError.mockRestore();
  });

  it("FSE-004 / FRONT-A12 「有一件参考取不到」退回之后再点 Edit and retry ⇒ 已放回的引用不被抹掉", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await sentTurnWithRefsNoRefresh();
    await refuseTurn(referenceUnavailableMessage("notFound"));

    // 那条 400 已经把引用放回来了，屏幕上也说了「References kept: …」。
    const restored = container!.querySelector('[data-slot="restored-references"]');
    expect(restored, "被退回的那一轮把引用悄悄丢了").toBeTruthy();
    expect(restored!.textContent).toContain("Aisyah");

    // 同一张卡上还挂着 Edit and retry。它读的重试草稿要是空的，这一按就把刚放回来的
    // 那几件**抹掉** —— 商家读到的是「移掉那一件再试」，而系统连剩下的也一起丢了。
    await click(buttonByText(canvasCard(), EDIT_AND_RETRY_LABEL));

    const line = container!.querySelector('[data-slot="restored-references"]');
    expect(line, "再点一次 Edit and retry 把刚放回来的引用抹掉了").toBeTruthy();
    expect(line!.textContent).toContain("Aisyah");
    expect(line!.textContent).toContain("Coral travel mug");
    consoleError.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 复修轮四（判官 2026-09-08 P1）—— 一轮**只有** `@` 到的引用（`references` 一格）被退回。
//
// 走查形状：商家 `@` 一件 gif（`@` 搜索不按扩展名过滤，gif 挑得到），送出去被
// `unsupportedFormat` 那句 400 整轮退回。`restoredDraft` 设上了，可那一行的计数只加
// entityIds ＋ sourceGenerationIds ＋ referenceVideoGenerationIds —— 漏掉 `references`，
// 于是它算出 0 而返回 null：屏幕上没有「References kept: …」，也就没有 Remove references。
// 而 `submit()` 每一次都合并 `restoredDraft.refs`，那件 gif 跟着之后**每一次**送出，
// 商家被锁在同一条 400 里，除了刷新页面没有第二条出路。
// ─────────────────────────────────────────────────────────────────────────────
describe("FSE-004 / FRONT-A12 —— 只 `@` 到一件的那一轮被退回后，商家有得可移", () => {
  /** 真的打一个 `@`、真的从菜单里选中那一行 —— 走的是真 `useReferencePicker`。 */
  async function mentionGif(): Promise<void> {
    const el = composer();
    const value = "@party";
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(el, value);
      el.setSelectionRange(value.length, value.length);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // 选择器的防抖是 120ms，这里用真时钟等它连同那次搜索一起落地。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    const row = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent?.includes(GIF_ROW.name));
    expect(row, "`@` 菜单里没有那件 gif —— 这条测试后面的话就都不算数").toBeTruthy();
    await act(async () => {
      row!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
  }

  async function pressEnter(): Promise<void> {
    await act(async () => {
      composer().dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
    });
  }

  /**
   * 一轮真的**在飞**过之后才被退回。这一串状态位不能省：送出那道闸（`submitLockRef`）
   * 靠 `isBusy` 落下来又抬起来，省掉它下一次送出会被自己的闸挡住，测试就演不到复现路径。
   */
  async function flyThenRefuse(sentence: string): Promise<void> {
    mocks.chat.status = "submitted";
    await act(async () => { root!.render(streamElement()); });
    await refuseTurn(sentence);
  }

  /** `@` 一件 gif → 送出 → 被格式那一句 400 退回。 */
  async function refusedGifTurn(): Promise<HTMLElement> {
    const host = await mountCanvas();
    await mentionGif();
    await pressEnter();
    expect(mocks.sendMessage, "这一幕的前提是真的送出了一轮").toHaveBeenCalledTimes(1);
    expect(lastBody()["references"], "送出去的那一轮没带那件 gif").toEqual([GIF_REF]);
    // 那一轮**只有** `references` 一格 —— 正是漏算的那个形状。
    expect(lastBody()["entityIds"]).toBeUndefined();
    expect(lastBody()["sourceGenerationIds"]).toBeUndefined();
    await flyThenRefuse(referenceUnavailableMessage("unsupportedFormat"));
    return host;
  }

  it("FSE-004 / FRONT-A12 只 `@` 到一件的那一轮被退回 ⇒ 屏幕上说得出它还在，也给得出 Remove", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = await refusedGifTurn();

    // 那句「换一件再问」上屏了 —— 商家读到的就是「有一件参考用不了」。
    expect(host.textContent).toContain(referenceUnavailableMessage("unsupportedFormat"));
    const line = container!.querySelector('[data-slot="restored-references"]');
    expect(line, "引用还跟着这一份草稿，屏幕上却一个字都不说 —— 唯一的清除入口也就没有了").toBeTruthy();
    expect(line!.textContent).toContain("References kept: 1 reference");
    expect(buttonByText(container!, "Remove references"), "没有 Remove references 可按").toBeTruthy();
    consoleError.mockRestore();
  });

  it("FSE-004 / FRONT-A12 按下 Remove references ⇒ 下一次送出真的不再带它", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await refusedGifTurn();
    await click(buttonByText(container!, "Remove references"));
    expect(container!.querySelector('[data-slot="restored-references"]')).toBeNull();

    await typeInto(composer(), "just a plain poster");
    await click(buttonByText(container!, "Send"));

    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    expect(lastBody()["references"], "移掉了那件 gif，它还是爬回了请求体").toBeUndefined();
    consoleError.mockRestore();
  });

  it("FSE-004 / FRONT-A12 不按 Remove 直接再送 ⇒ 它照旧跟着（那一句要的就是重选，不是静默丢弃）", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await refusedGifTurn();

    await typeInto(composer(), "make it a poster with that clip");
    await click(buttonByText(container!, "Send"));

    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    expect(lastBody()["references"]).toEqual([GIF_REF]);
    consoleError.mockRestore();
  });
});
