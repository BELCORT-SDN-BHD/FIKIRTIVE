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
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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

const { StartSomething } = await import("@/components/start-something/StartSomething");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REQUEST_ID = /^[0-9a-f-]{36}$/i;
const DRAFT = "Put her in the new hoodie";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
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
});
