// @vitest-environment jsdom
/**
 * FRONT-A14 —— 起步页参考契约的**商家那一半**(规格 `docs/specs/frontend-baseline.md` §7.3⑨)。
 *
 * 服务端那一半(payload 形状、归属重查、草稿画布收编)在 `canvas-entry-actions.test.ts`。
 * 这一份问的是三条路各自走得通:商家在 Create 上挂的那件东西,**真的**跟着送出那一下上了车。
 *
 *   ① Upload image —— 走既有上传权威 `finalizeCandidateUploads`。它要 `projectId`,而起步页
 *      此刻没有,所以挂第一件参考时先把画布开出来(`ensureCanvasDraft`,同一个 requestId,
 *      所以随后 `createCanvasConversation` 收编的是**同一块**画布,不是第二块)。
 *   ② Choose from Library —— 复用画布 composer 那一个挑选器(`CanvasLibraryPicker`),
 *      它读的是全店生成史,不需要 projectId。
 *   ③ `@` 引用 —— 用两个 Otto composer 都在用的那个 hook(`useReferencePicker`),
 *      并沿用它自己的规矩:`@名字` 被删掉,那件引用就跟着下车。
 *
 * 三条最后都汇到同一处:`createCanvasConversation` 的 `references`,类型化 `{type, id}`。
 * 断言落在「送出那一下真的带了什么」上,不是落在源码字串上。
 *
 * 最后一环单独一组(判官 #1242 P1-1):起步页挂上去的那件东西,**画布首轮那一发请求里真的有**。
 * 此前这条链在测试上只闭合到 `ImmersiveCanvasEntry` 交出来的 `pendingFirst` prop 为止 ——
 * 判官把 `OttoChatStream` 里那段映射整段删掉,全量 543 文件 / 7558 条测试逐字照绿:商家把图挂上、
 * 画布照开、第一轮照送,而那张图从来没上车,屏幕上也没有一个字说它掉了。下面那一组真挂
 * `OttoChatStream`(`useChat` 用替身),读 `sendMessage` 的第二参 `body`。
 *
 * 文件名前缀是 `front-a14-`,不是同族那份 `front-a15-create-start-disclosure`:这里四条判据
 * 落的验收是 **FRONT-A14**(规格 `docs/specs/frontend-baseline.md`「验收落点：A14」),编号与文件名
 * 从此一致(判官 #1242 P2-3)。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  createCanvasConversation: vi.fn(),
  ensureCanvasDraft: vi.fn(),
  uploadFilesDirect: vi.fn(),
  finalizeCandidateUploads: vi.fn(),
  getGenerationHistory: vi.fn(),
  searchReferencesAction: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/canvas-entry-actions", () => ({
  createCanvasConversation: mocks.createCanvasConversation,
  ensureCanvasDraft: mocks.ensureCanvasDraft,
}));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: mocks.uploadFilesDirect }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: mocks.finalizeCandidateUploads }));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: mocks.getGenerationHistory }));
vi.mock("@/lib/reference-search-actions", () => ({ searchReferencesAction: mocks.searchReferencesAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
// 画布首轮那一发请求的出口。真传输够得着网络也够得着钱,所以换成替身 —— 断言读它收到的 body。
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    setMessages: vi.fn(),
    sendMessage: mocks.sendMessage,
    status: "ready",
    error: null,
  }),
}));
vi.mock("ai", () => ({ DefaultChatTransport: class { constructor(_opts: unknown) { void _opts; } } }));

const { StartSomething } = await import("@/components/start-something/StartSomething");
const { OttoChatStream } = await import("@/components/otto/OttoChatStream");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REQUEST_ID = /^[0-9a-f-]{36}$/i;
const DRAFT = "Put her in the new hoodie";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  mocks.createCanvasConversation.mockResolvedValue({
    projectId: "canvas_1",
    threadId: "thread_1",
    handoffId: "handoff_1",
  });
  mocks.ensureCanvasDraft.mockResolvedValue({ projectId: "canvas_1" });
  mocks.uploadFilesDirect.mockResolvedValue({
    files: [{ sha256: "a".repeat(64), ext: "png", sizeBytes: 12, originalFilename: "hoodie.png", upload: { mode: "existed" } }],
    failures: [],
  });
  mocks.finalizeCandidateUploads.mockResolvedValue({ ok: true, count: 1, failures: [], generationIds: ["gen-upload"] });
  mocks.getGenerationHistory.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
  mocks.searchReferencesAction.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" });
  URL.createObjectURL = vi.fn(() => "blob:http://localhost/entry-ref");
  URL.revokeObjectURL = vi.fn();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(StartSomething)); });
  await act(async () => { await Promise.resolve(); });
  return container;
}

/** 真鼠标那一发:Radix 的 trigger 认的是 pointerdown,不是 click。 */
async function openAddContext(dom: HTMLElement): Promise<void> {
  const trigger = dom.querySelector<HTMLButtonElement>('[aria-label="Add a reference"]')!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
}

function menuItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => (el.textContent ?? "").replace(/\s+/gu, " ").trim() === label,
  );
  expect(item, `菜单里没有「${label}」`).toBeDefined();
  return item!;
}

async function type(dom: HTMLElement, value: string): Promise<void> {
  const textarea = dom.querySelector<HTMLTextAreaElement>('[aria-label="Otto creation prompt"]')!;
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(textarea, value);
    textarea.selectionStart = value.length;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 键盘那一条路:发送键之外,Enter 也送出 —— 两个入口共用一把闸。 */
async function pressEnter(dom: HTMLElement): Promise<void> {
  const textarea = dom.querySelector<HTMLTextAreaElement>('[aria-label="Otto creation prompt"]')!;
  await act(async () => {
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await act(async () => { await Promise.resolve(); });
}

async function send(dom: HTMLElement): Promise<void> {
  const button = dom.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')!;
  await act(async () => { button.click(); });
  await act(async () => { await Promise.resolve(); });
}

/** 送出那一下真的带上去的 `references`(没带就是 undefined)。 */
function sentReferences(prompt: string = DRAFT): unknown {
  expect(mocks.createCanvasConversation).toHaveBeenCalledTimes(1);
  const input = mocks.createCanvasConversation.mock.calls[0]![0] as Record<string, unknown>;
  expect(input.prompt).toBe(prompt);
  expect(String(input.requestId)).toMatch(REQUEST_ID);
  return input.references;
}

describe("FRONT-A14 起步页 Add context 三条路", () => {
  it("FRONT-A14: Upload image —— 先开画布再走既有上传权威,选中的引用随送出上车", async () => {
    const dom = await mount();
    await openAddContext(dom);
    await act(async () => { menuItem("Upload image").click(); });

    const input = dom.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([1, 2, 3])], "hoodie.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    // 起步页此刻没有 projectId —— 上传之前先把画布开出来,用的是送出时同一个 requestId。
    expect(mocks.ensureCanvasDraft).toHaveBeenCalledTimes(1);
    const draftInput = mocks.ensureCanvasDraft.mock.calls[0]![0] as { requestId: string };
    expect(draftInput.requestId).toMatch(REQUEST_ID);
    expect(mocks.finalizeCandidateUploads).toHaveBeenCalledWith("canvas_1", "", [], expect.anything());

    // 芯片在输入框上,商家看得见自己挂了什么。
    expect(dom.textContent).toContain("hoodie.png");

    await type(dom, DRAFT);
    await send(dom);

    expect(sentReferences()).toEqual([{ type: "generation", id: "gen-upload" }]);
    // 同一个 requestId:草稿画布与送出开的是同一块,不会开出第二块。
    expect((mocks.createCanvasConversation.mock.calls[0]![0] as { requestId: string }).requestId)
      .toBe(draftInput.requestId);
  });

  it("FRONT-A14: Choose from Library —— 复用画布那一个挑选器,挑中的素材随送出上车", async () => {
    mocks.getGenerationHistory.mockResolvedValue({
      items: [{
        id: "gen-library",
        projectId: "canvas_other",
        assetId: "asset-1",
        url: "https://cdn.example/blue-cup.png",
        kind: "image",
        source: "generated",
        prompt: "Blue cup on marble",
        filename: "",
        width: null,
        height: null,
        durationS: null,
        favorite: false,
        createdAt: "2026-09-04T00:00:00.000Z",
      }],
      nextCursor: null,
      hasMore: false,
    });

    const dom = await mount();
    await openAddContext(dom);
    await act(async () => { menuItem("Choose from Library").click(); });
    await act(async () => { await Promise.resolve(); });

    // 挑选器读的是全店生成史 —— 它不需要 projectId,所以这条路一块画布都不开。
    expect(mocks.getGenerationHistory).toHaveBeenCalled();
    expect(mocks.ensureCanvasDraft).not.toHaveBeenCalled();

    const tile = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (el) => el.getAttribute("aria-label")?.includes("Blue cup"),
    )!;
    expect(tile, "挑选器里没有那件素材").toBeDefined();
    await act(async () => { tile.click(); });

    await type(dom, DRAFT);
    await send(dom);

    expect(sentReferences()).toEqual([{ type: "generation", id: "gen-library" }]);
  });

  it("FRONT-A14: `@` 引用 —— 挑中的实体随送出上车,`@名字` 删掉它就下车", async () => {
    mocks.searchReferencesAction.mockResolvedValue({
      items: [{ id: "ent-hoodie", name: "Hoodie", type: "product", source: "Product · Otto IQ", thumbUrl: null }],
      nextCursor: null,
      hasMore: false,
    });

    const dom = await mount();
    await type(dom, "Put her in the @Hood");
    // 搜索有 120ms 去抖 —— 等答案落地,菜单才有行可选。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });

    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (el) => (el.textContent ?? "").includes("Hoodie"),
    );
    expect(option, "引用菜单里没有那件实体").toBeDefined();
    // 菜单行认的是 mousedown(选中要抢在 composer 失焦之前发生)。
    await act(async () => {
      option!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    });

    const withMention = DRAFT.replace("hoodie", "@Hoodie");
    await type(dom, withMention);
    await send(dom);
    expect(sentReferences(withMention)).toEqual([{ type: "product", id: "ent-hoodie" }]);

    // 第二次:把 `@Hoodie` 从草稿里删掉,那件引用就不该再上车(picker 自己的规矩,没有第二套)。
    mocks.createCanvasConversation.mockClear();
    await type(dom, DRAFT);
    await send(dom);
    expect(mocks.createCanvasConversation).toHaveBeenCalledTimes(1);
    expect((mocks.createCanvasConversation.mock.calls[0]![0] as Record<string, unknown>).references)
      .toBeUndefined();
  });

  it("FRONT-A14: 上传失败说人话,不留一个「已经挂上了」的假芯片", async () => {
    mocks.finalizeCandidateUploads.mockResolvedValue({ error: "Project not found." });

    const dom = await mount();
    await openAddContext(dom);
    await act(async () => { menuItem("Upload image").click(); });
    const input = dom.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([1])], "hoodie.png", { type: "image/png" })],
      configurable: true,
    });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    expect(dom.textContent).toContain("Project not found.");
    expect(dom.textContent).not.toContain("hoodie.png");

    await type(dom, DRAFT);
    await send(dom);
    expect(sentReferences()).toBeUndefined();
  });

  it("FRONT-A14: 上传只收图片 —— 挑到影片当场说人话,不留一个画不出来的芯片", async () => {
    const dom = await mount();
    await openAddContext(dom);
    await act(async () => { menuItem("Upload image").click(); });

    // `accept` 只是提示:系统对话框切到「所有文件」就挑得到这一段。
    const input = dom.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([1])], "clip.mp4", { type: "video/mp4" })],
      configurable: true,
    });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    expect(dom.textContent).toContain("Videos go in from the Canvas");
    expect(dom.textContent).not.toContain("clip.mp4");
    // 一步都没往上传权威那边走 —— 不花钱、不落 Generation、不开画布。
    expect(mocks.uploadFilesDirect).not.toHaveBeenCalled();
    expect(mocks.finalizeCandidateUploads).not.toHaveBeenCalled();
    expect(mocks.ensureCanvasDraft).not.toHaveBeenCalled();
  });

  it("FRONT-A14: 上传还没落地时 Enter 不放行 —— 与发送键同一把闸", async () => {
    // 上传卡在半路:`ensureCanvasDraft` 永不落地,组件停在 uploading。
    let releaseDraft: (() => void) | null = null;
    mocks.ensureCanvasDraft.mockImplementation(
      () => new Promise((resolve) => { releaseDraft = () => resolve({ projectId: "canvas_1" }); }),
    );

    const dom = await mount();
    await openAddContext(dom);
    await act(async () => { menuItem("Upload image").click(); });
    const input = dom.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([1])], "hoodie.png", { type: "image/png" })],
      configurable: true,
    });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    await type(dom, DRAFT);
    // 发送键此刻是关着的 —— Enter 必须读同一把闸,否则那张正在传的图会被丢在原地。
    expect(dom.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')!.disabled).toBe(true);
    await pressEnter(dom);
    expect(mocks.createCanvasConversation).not.toHaveBeenCalled();

    // 上传落地之后,同一下 Enter 照送 —— 挡的是「还没好」,不是键盘这条路。
    await act(async () => { releaseDraft!(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await pressEnter(dom);
    expect(sentReferences()).toEqual([{ type: "generation", id: "gen-upload" }]);
  });

  it("FRONT-A14: 从 Library 挑一段影片,芯片按 previewKind 用 <video> 画,不是一个破图", async () => {
    mocks.getGenerationHistory.mockResolvedValue({
      items: [{
        id: "gen-clip",
        projectId: "canvas_other",
        assetId: "asset-2",
        url: "https://cdn.example/hoodie-spin.mp4",
        kind: "video",
        source: "generated",
        prompt: "Hoodie spin",
        filename: "",
        width: null,
        height: null,
        durationS: 5,
        favorite: false,
        createdAt: "2026-09-04T00:00:00.000Z",
      }],
      nextCursor: null,
      hasMore: false,
    });

    const dom = await mount();
    await openAddContext(dom);
    await act(async () => { menuItem("Choose from Library").click(); });
    await act(async () => { await Promise.resolve(); });

    const tile = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (el) => el.getAttribute("aria-label")?.includes("Hoodie spin"),
    )!;
    expect(tile, "挑选器里没有那段影片").toBeDefined();
    await act(async () => { tile.click(); });

    // 芯片那一格:影片用 <video>,同一格里没有第二个 <img> 顶着一个画不出来的 .mp4。
    const chip = [...dom.querySelectorAll<HTMLElement>("div")].find(
      (el) => (el.textContent ?? "").includes("Hoodie spin") && el.querySelector("video, img"),
    )!;
    expect(chip, "输入框上没有那件芯片").toBeDefined();
    expect(chip.querySelector("video")?.getAttribute("src")).toBe("https://cdn.example/hoodie-spin.mp4");
    expect(chip.querySelector("img")).toBeNull();
  });
});

/**
 * 最后一环:画布**首轮那一发请求**。上面四条问的是「送出那一下 `createCanvasConversation`
 * 收到了什么」,这一条问的是「navigation 之后,那件东西真的上了第一轮的车吗」。
 * 挂真 `OttoChatStream`,`pendingFirst` 给三份 id(服务端 `getCanvasConversationHandoff`
 * 重查归属之后交出来的就是这个形状),断言 `sendMessage` 的第二参 `body`。
 */
describe("FRONT-A14 起步页挂的引用真的进画布首轮那一发请求", () => {
  const THREAD = {
    id: "thread-1",
    projectId: "canvas_1",
    title: "Untitled",
    updatedAt: new Date("2026-09-05T00:00:00.000Z").toISOString(),
    messages: [],
  };

  async function mountStream(pendingFirst: Record<string, unknown> | null): Promise<void> {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(OttoChatStream, {
        projectId: "canvas_1",
        entities: [],
        thread: THREAD,
        balanceUsd: 10,
        onRefresh: async () => {},
        onThreadUpdate: () => {},
        ...(pendingFirst ? { pendingFirst } : {}),
      } as never));
    });
    await act(async () => { await Promise.resolve(); });
  }

  it("FRONT-A14: 首轮 body 同时带 entityIds、图片与影片素材 —— 三份都上车", async () => {
    await mountStream({
      text: DRAFT,
      entityIds: ["ent-hoodie", "ent-model"],
      sourceGenerationIds: ["gen-upload", "gen-library"],
      referenceVideoGenerationIds: ["gen-clip"],
    });

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const [message, options] = mocks.sendMessage.mock.calls[0] as [
      { text: string },
      { body: Record<string, unknown> },
    ];
    expect(message).toEqual({ text: DRAFT });
    expect(options.body).toMatchObject({
      projectId: "canvas_1",
      threadId: "thread-1",
      entityIds: ["ent-hoodie", "ent-model"],
      // 形状由手动送出用的**同一个** `composerReferencePayload` 铺开:单数键给旧路径,
      // 复数键给整串。少了任何一半,画布那一头就只认得第一件。
      sourceGenerationId: "gen-upload",
      sourceGenerationIds: ["gen-upload", "gen-library"],
      referenceVideoGenerationId: "gen-clip",
      referenceVideoGenerationIds: ["gen-clip"],
    });
  });

  it("FRONT-A14: 没挂引用的首轮不凭空造出引用键", async () => {
    await mountStream({ text: DRAFT });

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const body = (mocks.sendMessage.mock.calls[0] as [unknown, { body: Record<string, unknown> }])[1].body;
    expect(body).toMatchObject({ projectId: "canvas_1", threadId: "thread-1" });
    for (const key of [
      "entityIds",
      "sourceGenerationId",
      "sourceGenerationIds",
      "referenceVideoGenerationId",
      "referenceVideoGenerationIds",
    ]) {
      expect(body, `没挂引用却带了 ${key}`).not.toHaveProperty(key);
    }
  });
});

/**
 * 同一件事的**画布那一头**(判官 #1242)。起步页那条已经在上面钉死了(「上传还没落地时 Enter
 * 不放行」),而画布 composer 从前是两套口径:`+` 键读 `isBusy || uploading`,送出那一下只读
 * `isBusy` —— 商家挂了一张图、图还在传的当口敲一下 Enter(或点 Send),这一轮照送,那张正在传的
 * 参考此刻还没有 generationId,于是无声不上车,屏幕上也没有一个字说它掉了。
 * 两个入口现在读同一把闸 `composerBusy`。
 */
describe("FRONT-A14 画布 composer 上传在飞时不放行", () => {
  const THREAD = {
    id: "thread-1",
    projectId: "canvas_1",
    title: "Untitled",
    updatedAt: new Date("2026-09-05T00:00:00.000Z").toISOString(),
    messages: [],
  };

  async function mountComposer(): Promise<HTMLDivElement> {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(OttoChatStream, {
        projectId: "canvas_1",
        entities: [],
        thread: THREAD,
        balanceUsd: 10,
        onRefresh: async () => {},
        onThreadUpdate: () => {},
      } as never));
    });
    await act(async () => { await Promise.resolve(); });
    return container;
  }

  function sendButton(dom: HTMLElement): HTMLButtonElement {
    const button = [...dom.querySelectorAll<HTMLButtonElement>("button")].find(
      (el) => (el.textContent ?? "").replace(/\s+/gu, " ").trim() === "Send",
    );
    expect(button, "composer 里没有 Send 键").toBeDefined();
    return button!;
  }

  async function typeInComposer(dom: HTMLElement, value: string): Promise<void> {
    const textarea = dom.querySelector<HTMLTextAreaElement>('[aria-label="Reply to Otto"]')!;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(textarea, value);
      textarea.selectionStart = value.length;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function pressEnterInComposer(dom: HTMLElement): Promise<void> {
    const textarea = dom.querySelector<HTMLTextAreaElement>('[aria-label="Reply to Otto"]')!;
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await act(async () => { await Promise.resolve(); });
  }

  it("FRONT-A14: 上传还没落地时 Enter 与发送键都不放行,落地后照送且引用上车", async () => {
    // 上传卡在半路:`uploadFilesDirect` 永不落地,组件停在 uploading。
    let releaseUpload: (() => void) | null = null;
    mocks.uploadFilesDirect.mockImplementation(
      () => new Promise((resolve) => {
        releaseUpload = () => resolve({
          files: [{ sha256: "a".repeat(64), ext: "png", sizeBytes: 12, originalFilename: "hoodie.png", upload: { mode: "existed" } }],
          failures: [],
        });
      }),
    );

    const dom = await mountComposer();
    const input = dom.querySelector<HTMLInputElement>('[aria-label="Attach a file"]')!;
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([1])], "hoodie.png", { type: "image/png" })],
      configurable: true,
    });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    await typeInComposer(dom, DRAFT);
    // 发送键此刻是关着的 —— Enter 必须读同一把闸,否则那张正在传的图会被丢在原地。
    expect(sendButton(dom).disabled).toBe(true);
    await pressEnterInComposer(dom);
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    // 上传落地之后,同一下 Enter 照送 —— 挡的是「还没好」,不是键盘这条路。
    await act(async () => { releaseUpload!(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(sendButton(dom).disabled).toBe(false);
    await pressEnterInComposer(dom);

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const [message, options] = mocks.sendMessage.mock.calls[0] as [
      { text: string },
      { body: Record<string, unknown> },
    ];
    expect(message).toEqual({ text: DRAFT });
    expect(options.body).toMatchObject({
      projectId: "canvas_1",
      threadId: "thread-1",
      sourceGenerationId: "gen-upload",
      sourceGenerationIds: ["gen-upload"],
    });
  });
});
