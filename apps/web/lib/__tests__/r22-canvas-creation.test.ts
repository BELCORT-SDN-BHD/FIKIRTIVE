// @vitest-environment jsdom
/**
 * r22-canvas-creation.test.ts —— 画布**创作能力**的十条行为契约。
 *
 * 这一批做的是「在板上做东西」这件事本身:选中几张再问一句、挂一张参考图、改形状与张数、
 * 视频概念、逐图动作排、跟手改一版。形状取自 Stitch 的画布代理与 Claude 的结构化问题卡,
 * 骨架是既有实现,这里加的是能力,不是重构。
 *
 * 这一面整个是样例:零后端、零 provider、零积分。下面每条断言看的都是商家屏幕上真实出现
 * 的东西(DOM 上的 `aria-pressed` / textContent / `download` 属性)与浏览器里真实存下的东西
 * (sessionStorage),不是源码字符串。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImmersiveCanvasRuntimeContext } from "@/components/canvas/NorthstarCanvasWorkspace";
import { LIBRARY_FIXTURE_KEY, type LibraryArchive } from "@/components/library/library-fixture";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/canvas-actions", () => ({ listCanvasNodes: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: () => "canvas-action-test",
  useCanvasGen: () => ({ generateImage: vi.fn(), quoteCosts: vi.fn(), imageShapes: vi.fn() }),
}));

// Radix 的 popover / menu 在 jsdom 里要这几样才活得起来(popper 量尺寸、指针捕获、
// 滚动到高亮项)。抄 `r22-home-create-menu.test.ts` 的同一份,不重发明。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { R22CanvasSurface } = await import("@/components/canvas/R22CanvasSurface");

/** `DEFAULT_R22_WORKSPACE_DIRECTORY.activeId` —— 没有 seed directory 时的默认 workspace。 */
const WORKSPACE_ID = "batik-house";
const storageKey = (projectId: string) => `r22:canvas:${projectId}:new:${WORKSPACE_ID}`;
/** 素材包与成品都住在 Library 那一份 v2 存档里 —— 这一面不再另开第二本账。 */
const libraryKey = `${LIBRARY_FIXTURE_KEY}:${WORKSPACE_ID}`;

/** 一次生成跑完需要的时间(排队 320ms → 落板 920ms)。 */
const JOB_MS = 1200;

function runtimeContext(activeProjectId: string): ImmersiveCanvasRuntimeContext {
  return {
    projects: [{ id: "project-a", name: "Raya launch" }, { id: "project-b", name: "Merdeka teaser" }],
    threads: [],
    activeProjectId,
    activeThreadId: null,
    initialBalance: null,
    visualFixture: "r22",
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(activeProjectId: string): Promise<void> {
  await act(async () => {
    root!.render(createElement(R22CanvasSurface, { runtimeContext: runtimeContext(activeProjectId), entities: [] }));
  });
  await act(async () => { await Promise.resolve(); });
}

async function mount(activeProjectId = "project-a"): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render(activeProjectId);
}

/**
 * 从 `document` 找,不是从 `container` 找。
 *
 * 五层浮层现在是 Radix 的 popover / dropdown-menu,它们 **portal 到 `document.body`** ——
 * 只在 container 里翻,弹层里的每一个按钮都会「找不到」,而那种失败长得像功能坏了。
 * container 本身就挂在 body 下,所以从 document 找是同一批节点再加上浮层那几层。
 */
function need<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  expect(node, `找不到 ${selector} —— 下面的断言在核对空气`).not.toBeNull();
  return node as T;
}

function all<T extends Element>(selector: string): T[] {
  return [...document.querySelectorAll<T>(selector)];
}

async function click(node: Element): Promise<void> {
  await act(async () => { (node as HTMLElement).click(); });
}

/**
 * 开一个 Radix **menu**。菜单是在 `pointerdown` 上开的(popover 是在 `click` 上),
 * 所以光 `.click()` 开不出来 —— 这里补上真浏览器里一定会先到的那一记。
 */
async function openMenu(node: Element): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    (node as HTMLElement).click();
  });
}

/** 商家真的点一张图:先按下再松手(那一记 pointerdown 会清掉上一次拖拽留下的旗子),再 click。 */
async function clickArt(id: string): Promise<void> {
  const art = need<HTMLElement>(`[data-canvas-select="${id}"]`);
  await act(async () => { art.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 400, clientY: 400, button: 0 })); });
  await act(async () => { window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 400, clientY: 400, button: 0 })); });
  await act(async () => { art.click(); });
}

/** 框选出两张 —— 一次真的多选。jsdom 量不出几何,所以先把四张的位置钉住。 */
async function boxSelectFirstTwo(): Promise<void> {
  ["art-1", "art-2", "art-3", "art-4"].forEach((id, index) => {
    const left = 100 + index * 144;
    Object.defineProperty(need(`[data-canvas-select="${id}"]`), "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left, top: 100, right: left + 128, bottom: 328, x: left, y: 100, width: 128, height: 228, toJSON: () => ({}) }),
    });
  });
  await click(need('[data-r22-canvas-tools] button[aria-label="Box select"]'));
  const stage = need<HTMLElement>("[data-r22-canvas-stage]");
  await act(async () => { stage.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 90, clientY: 90, button: 0 })); });
  await act(async () => { window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 380, clientY: 340, button: 0 })); });
  await act(async () => { window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 380, clientY: 340, button: 0 })); });
}

function type(node: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

async function askOtto(prompt: string): Promise<void> {
  await act(async () => { type(need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]'), prompt); });
  await act(async () => {
    need<HTMLFormElement>("form.r22-canvas-composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function chips(): string[] {
  return all<HTMLElement>("[data-canvas-context-chip] b").map((node) => node.textContent ?? "");
}

function answerCard(): HTMLElement {
  return need<HTMLElement>("[data-otto-answer]");
}

function batchIds(): string[] {
  return all<HTMLElement>("[data-canvas-batch]").map((node) => node.dataset.canvasBatch!);
}

function priceLabel(): string {
  return need(".r22-canvas-price").textContent ?? "";
}

function noticeText(): string {
  return container!.querySelector(".r22-canvas-notice span")?.textContent ?? "";
}

function stored(projectId: string): Record<string, unknown> {
  const raw = window.sessionStorage.getItem(storageKey(projectId));
  expect(raw, `${storageKey(projectId)} 里什么都没存 —— 这一面根本没写过存档`).not.toBeNull();
  return JSON.parse(raw!) as Record<string, unknown>;
}

/** 打开参数弹层。 */
async function openParams(): Promise<void> {
  await click(need('.r22-canvas-ratio'));
}

/** 挂一张素材库里的图上去。 */
async function attachFromLibrary(index = 0): Promise<void> {
  await openMenu(need('button[aria-label="Attach"]'));
  const fromLibrary = all<HTMLButtonElement>(".r22-canvas-attach-menu button").find((node) => node.textContent === "From Library");
  expect(fromLibrary, "附件菜单开了但里头没有「From Library」").toBeTruthy();
  await click(fromLibrary!);
  await click(all<HTMLButtonElement>("[data-canvas-library-pick]")[index]!);
}

// ---------------------------------------------------------------------------
// ① 选中 → composer 上下文 chips(Stitch 的画布代理精髓)
// ---------------------------------------------------------------------------
describe("① 板上选中几张,composer 就长出几枚 chip", () => {
  it("框选两张 → 两枚 chip;× 掉一枚,板上那一张也跟着不再选中", async () => {
    await mount();
    expect(chips(), "什么都没选就先长出了 chip").toEqual([]);

    await boxSelectFirstTwo();

    expect(chips(), "选中了两张,composer 上没有对应的 chip").toEqual(["Image 1", "Image 2"]);

    await click(need('[data-canvas-chip-remove="art-1"]'));

    expect(chips(), "× 掉一枚 chip,它没有真的从这次请求里出去").toEqual(["Image 2"]);
    expect(need('[data-canvas-select="art-1"]').getAttribute("aria-pressed"), "chip 去了,板上那一张还亮着选中").toBe("false");
    expect(need('[data-canvas-select="art-2"]').getAttribute("aria-pressed")).toBe("true");
  });

  it("单点一张也长出一枚 chip,再点一下就没了", async () => {
    await mount();

    await clickArt("art-3");
    expect(chips(), "点了一张,composer 上没有那枚 chip").toEqual(["Image 3"]);

    await clickArt("art-3");
    expect(chips(), "再点一下没有取消").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ② selection-aware 答案:答的是选中的那几张,不是一段通话
// ---------------------------------------------------------------------------
describe("② 选中之后问一句,答案指名道姓", () => {
  it("选中两张再问价钱,卡上说的是「For Image 1 and Image 2」,而且认下没动过它们", async () => {
    await mount();
    await boxSelectFirstTwo();

    await askOtto("How much does this cost?");

    const card = answerCard();
    const lead = card.querySelector("p")?.textContent ?? "";
    expect(lead, "答案没有指名它在讲哪几张").toContain("For Image 1 and Image 2");
    // 价钱那一路本身一个字没被吞掉。
    const bullets = [...card.querySelectorAll("ul li")].map((node) => node.textContent ?? "");
    expect(bullets, "选中之后价钱那一路被吞掉了").toContain("3 cr per image.");
    expect(bullets.join(" "), "答话是解释,不是动作 —— 它必须认下自己什么都没动").toContain("Nothing was changed on Image 1 and Image 2");
  });

  it("什么都没选时,同一句话的答案里不多一个字", async () => {
    await mount();

    await askOtto("How much does this cost?");

    expect(answerCard().querySelector("p")?.textContent ?? "", "没选中却也报了一串图名").not.toContain("For Image");
  });
});

// ---------------------------------------------------------------------------
// ③ 参考图:挂上去、发出去、刷新还在
// ---------------------------------------------------------------------------
describe("③ 参考图挂在这一次请求上", () => {
  it("素材库挑一张 → composer 上一枚参考 chip,而且进了存档", async () => {
    await mount();

    await attachFromLibrary();

    expect(all("[data-canvas-reference-chip]").length, "挑了一张,composer 上没有参考 chip").toBe(1);
    expect(stored("project-a").attachments, "挂上的参考图没进存档,刷新一次就没了").toHaveLength(1);
  });

  it("上传一张图走的是真的文件选择器,存下来的是那张图本身", async () => {
    await mount();
    const input = need<HTMLInputElement>(".r22-canvas-file-input");
    const file = new File(["a-small-reference"], "table-setting.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });

    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    // 读文件是异步的,读完才会长出 chip。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(need("[data-canvas-reference-chip] b").textContent, "上传的那张图没有变成一枚 chip").toBe("table-setting.png");
    const attachments = stored("project-a").attachments as Array<{ src: string }>;
    expect(attachments, "上传的参考图没进存档").toHaveLength(1);
    expect(attachments[0]!.src.startsWith("data:"), "存进档的不是那张图本身").toBe(true);
  });

  it("太大的图诚实拒绝 —— 说清楚为什么,不是默默什么都没发生", async () => {
    await mount();
    const input = need<HTMLInputElement>(".r22-canvas-file-input");
    const file = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 2_000_000 });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });

    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(all("[data-canvas-reference-chip]").length, "超预算的图还是被挂上去了").toBe(0);
    expect(noticeText(), "拒了却什么都不说").toContain("larger than 1.5 MB");
  });

  it("重新挂载(= 刷新)之后,那张参考图还挂在 composer 上", async () => {
    await mount();
    await attachFromLibrary();
    await act(async () => root!.unmount());
    container!.remove();

    await mount();

    expect(all("[data-canvas-reference-chip]").length, "存档读回来了但参考图没落到屏上").toBe(1);
  });

  it("发出去之后,参考图归那条消息,输入框上不再挂着它", async () => {
    vi.useFakeTimers();
    await mount();
    await attachFromLibrary();

    await askOtto("Make 4 images of the teal batik candle");

    expect(all("[data-canvas-reference-chip]").length, "发完了参考图还挂在输入框上,下一句会再带一遍").toBe(0);
    expect(all("[data-canvas-message-refs]").length, "发出去的那条消息上没有留下参考图").toBe(1);
    // Otto 用人话认下这次带了参考图 —— 不是一句「attachment attached」。
    expect(noticeText()).toContain("reference image");
  });
});

// ---------------------------------------------------------------------------
// ④ 参数弹层:形状 / 张数 / 图还是视频,价钱跟着动
// ---------------------------------------------------------------------------
describe("④ 参数改了,价钱当场跟着改", () => {
  it("默认 1 张图 = 3 cr;改成 4 张 = 12 cr;换成视频概念 = 24 cr", async () => {
    await mount();
    expect(priceLabel()).toBe("3 cr");

    await openParams();
    await click(need('[data-canvas-count="4"]'));

    expect(priceLabel(), "张数改了价钱没动 —— 这是最会咬人的那种谎").toBe("12 cr");

    await click(need('[data-canvas-kind="video"]'));

    expect(priceLabel(), "换成视频概念价钱没动").toBe("24 cr");
  });

  it("比例格里挑一个,输入框那颗 chip 跟着换,而且四个形状都在", async () => {
    await mount();
    await openParams();

    expect(all<HTMLElement>("[data-canvas-ratio]").map((node) => node.dataset.canvasRatio)).toEqual(["9:16", "1:1", "4:5", "16:9"]);

    await click(need('[data-canvas-ratio="4:5"]'));

    expect(need(".r22-canvas-ratio").textContent, "挑了一个形状,输入框上那颗 chip 没换").toBe("4:5");
    // 形状格子归位到 ToggleGroup `type="single"` 之后,选中态说的是 `aria-checked`
    // (一组里挑一个),不再是 `aria-pressed`(一颗各自开关的按钮)。
    expect(need('[data-canvas-ratio="4:5"]').getAttribute("aria-checked")).toBe("true");
    expect(need('[data-canvas-ratio="9:16"]').getAttribute("aria-checked"), "挑了新形状,旧的那颗还留着选中").toBe("false");
  });
});

// ---------------------------------------------------------------------------
// ⑤ 视频概念卡:诚实标注,不假装出真视频
// ---------------------------------------------------------------------------
describe("⑤ 视频这一面 V1 只做概念卡", () => {
  it("做一个视频,落板的是概念卡,卡上逐字说清楚它不是一段能播的视频", async () => {
    vi.useFakeTimers();
    await mount();
    await openParams();
    await click(need('[data-canvas-kind="video"]'));
    await click(need('.r22-canvas-ratio')); // 收起弹层,免得它挡住板

    await askOtto("Make a video of the candle");
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_MS); });

    const cards = all<HTMLElement>("[data-canvas-batch]");
    const concept = cards[cards.length - 1]!;
    expect(concept.textContent, "概念卡没有说清楚自己是什么").toContain("Concept only — a still stand-in, not a playable video.");
    expect(concept.querySelector(".r22-canvas-batch-tag")?.textContent).toContain("video concept");
    expect(concept.querySelector(".r22-canvas-batch-tag")?.textContent, "视频概念的价钱不是 6 cr").toContain("6 cr");
    // 概念卡上没有下载 —— 没有文件可以存下来,灰着放一颗也是一句假话。
    expect(concept.querySelector('[data-canvas-art-action="download"]'), "概念卡上放了一颗按不出东西的下载").toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ⑥ 逐图动作排:星标 / 下载 / 再来一批 / 收进素材包
// ---------------------------------------------------------------------------
describe("⑥ 每张成品自己带一排动作", () => {
  it("Make more like Image 1 → 新一批带来源标注,旧那批还在原地", async () => {
    vi.useFakeTimers();
    await mount();
    const before = batchIds();

    await click(need('[aria-label="Make more like Image 1"]'));
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_MS); });

    const after = batchIds();
    expect(after.length, "没有多出一批").toBe(before.length + 1);
    expect(after.slice(0, before.length), "旧那批被新的一批顶掉了 —— 那不叫改一版,叫覆盖").toEqual(before);
    expect(need("[data-canvas-batch-origin]").textContent, "新一批没说自己是从哪一张长出来的").toBe("Variant of Image 1");
  });

  it("Download 真的把那一张交给浏览器存下去", async () => {
    await mount();
    const clicks: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.getAttribute("href") ?? "", download: this.download });
    });

    await click(need('[aria-label="Download Image 2"]'));

    expect(clicks, "按了下载,浏览器那边什么都没发生").toHaveLength(1);
    expect(clicks[0]!.href).toBe("/fixtures/r22-canvas/art-2.jpg");
    expect(clicks[0]!.download, "存下去的文件没有名字").toBe("image-2.jpg");
  });

  it("Star 只管这一张,再按一下取消", async () => {
    await mount();
    const star = () => need('[aria-label="Star Image 3"]');
    expect(star().getAttribute("aria-pressed")).toBe("false");

    await click(star());
    expect(star().getAttribute("aria-pressed"), "星标没记上").toBe("true");
    expect(stored("project-a").starred, "星标没进存档").toEqual(["art-3"]);

    await click(star());
    expect(star().getAttribute("aria-pressed"), "再按一下没有取消").toBe("false");
  });

  it("Add to pack 先问收进哪一个包,选完写进 Library 那份存档,再选一次只留一条", async () => {
    await mount();

    // 上一版这一颗是无名一键。现在它开出一个小弹层:商家自己挑收进哪一个包。
    await click(need('[aria-label="Add Image 1 to a Library pack"]'));
    expect(need('[data-canvas-pack-menu="art-1"]'), "按下之后没有出选包的弹层").toBeTruthy();

    await click(need('[data-canvas-pack-pick="pack-raya"]'));

    const raw = window.sessionStorage.getItem(libraryKey);
    expect(raw, `${libraryKey} 里什么都没有 —— 素材包那一面读不到画布加的东西`).not.toBeNull();
    const archive = JSON.parse(raw!) as LibraryArchive;
    const saved = archive.assets.find((asset) => asset.id === "canvas:project-a:art-1");
    expect(saved, "画布那张图没有作为一条素材进 Library 存档").toBeTruthy();
    expect(saved!.name).toBe("Image 1");
    expect(saved!.poster).toBe("/fixtures/r22-canvas/art-1.jpg");
    expect(saved!.packIds).toContain("pack-raya");
    expect(noticeText()).toBe("Image 1 is in Raya assets.");

    await click(need('[aria-label="Add Image 1 to a Library pack"]'));
    await click(need('[data-canvas-pack-pick="pack-raya"]'));

    const again = JSON.parse(window.sessionStorage.getItem(libraryKey)!) as LibraryArchive;
    expect(again.assets.filter((asset) => asset.id === "canvas:project-a:art-1"), "多按一下就多出一张一样的图").toHaveLength(1);
    expect(again.assets.find((asset) => asset.id === "canvas:project-a:art-1")!.packIds).toEqual(["pack-raya"]);
    expect(noticeText()).toBe("Image 1 is already in Raya assets.");
  });
});

// ---------------------------------------------------------------------------
// ⑦ 跟手改一版:新一批入场,旧一批留在原地
// ---------------------------------------------------------------------------
describe("⑦ 最新那一批下面给出跟手改一版的几句", () => {
  it("按下「Warmer light」→ 那句话落进输入框、送出去、多出一批,旧那批还在", async () => {
    vi.useFakeTimers();
    await mount();
    const before = batchIds();
    const suggestion = need<HTMLButtonElement>('[data-canvas-iterate="Warmer light"]');

    await click(suggestion);

    // 那句话是从输入框送出去的,所以它先落进 Conversation。
    const said = [...container!.querySelectorAll(".r22-canvas-conversation-list > li")].map((node) => node.textContent ?? "");
    expect(said.some((line) => line.includes("warmer light")), "chip 按下去什么都没送出去").toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_MS); });

    const after = batchIds();
    expect(after.length, "跟手改一版没有做出新的一批").toBe(before.length + 1);
    expect(after.slice(0, before.length), "旧那批被顶掉了").toEqual(before);
    // 建议永远长在最新那一批下面,不在旧的那几批上重复出现。
    expect(all('[data-canvas-batch-next]').length, "每一批下面都挂了一份建议").toBe(1);

    // 再改一版 —— 板上必须是三批并存。只做一次是看不出「并存」还是「覆盖」的:
    // 覆盖的那一版此刻同样是「多了一批」,第二次才把它抓出来。
    await click(need<HTMLButtonElement>('[data-canvas-iterate="Closer crop"]'));
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_MS); });

    const third = batchIds();
    expect(third.length, "第二次改一版把上一版顶掉了 —— 那不叫改一版,叫覆盖").toBe(before.length + 2);
    expect(new Set(third).size, "板上两批用了同一个身份").toBe(third.length);
    expect(third.slice(0, after.length), "上一版没有留在原地").toEqual(after);
  });
});

// ---------------------------------------------------------------------------
// ⑦b 跟手改一版的张数跟着**源批次**走(编排者真机回炉件 P3)
// ---------------------------------------------------------------------------
describe("⑦b 「这一批再来一版」的张数是源批次的张数", () => {
  it("在 4 张的批次上按 Warmer light → 新的一批还是 4 张 12 cr,价格贴纸同步", async () => {
    vi.useFakeTimers();
    await mount();
    // 源批次(开局那一批)是四张。
    expect(need('[data-canvas-batch="batch"] .r22-canvas-batch-tag').textContent).toContain("4 images");

    await click(need<HTMLButtonElement>('[data-canvas-iterate="Warmer light"]'));
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_MS); });

    const cards = all<HTMLElement>("[data-canvas-batch] .r22-canvas-batch-tag");
    const made = cards[cards.length - 1]!.textContent ?? "";
    expect(made, "四张的批次改一版只出了一张 —— 商家读到的语义与屏上出来的东西对不上").toContain("4 images");
    expect(made, "张数对了但价钱没跟上").toContain("12 cr");
    // 屏上那个报价必须和真正做出来的东西是同一个数。
    expect(priceLabel(), "价格贴纸还停在改一版之前的那个数").toBe("12 cr");
  });

  it("商家自己在参数弹层拨过张数,就听商家的", async () => {
    vi.useFakeTimers();
    await mount();
    await openParams();
    await click(need('[data-canvas-count="2"]'));
    await click(need(".r22-canvas-ratio"));

    await click(need<HTMLButtonElement>('[data-canvas-iterate="Warmer light"]'));
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_MS); });

    const cards = all<HTMLElement>("[data-canvas-batch] .r22-canvas-batch-tag");
    const made = cards[cards.length - 1]!.textContent ?? "";
    expect(made, "商家自己拨的张数被源批次盖过去了").toContain("2 images");
    expect(made).toContain("6 cr");
  });
});

// ---------------------------------------------------------------------------
// ⑧ 切项目:新长出来的东西一件都不许跟过去
// ---------------------------------------------------------------------------
describe("⑧ 切项目之后,这一面新加的状态全清", () => {
  it("A 里做的批次 / 星标 / 参考图 / 参数都不跟到 B,也不被写进 B 的存档", async () => {
    vi.useFakeTimers();
    await mount("project-a");
    await attachFromLibrary();
    await click(need('[aria-label="Star Image 1"]'));
    await openParams();
    await click(need('[data-canvas-count="4"]'));
    await click(need('.r22-canvas-ratio'));
    await askOtto("Make 4 images of the teal batik candle");
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_MS); });
    expect(batchIds().length, "A 里根本没做出第二批,后面的断言在核对空气").toBe(2);

    await render("project-b");

    expect(batchIds(), "上一个项目做出来的那一批跟着切过来了").toEqual(["batch"]);
    expect(all("[data-canvas-reference-chip]").length, "上一个项目挂着的参考图跟过来了").toBe(0);
    expect(need('[aria-label="Star Image 1"]').getAttribute("aria-pressed"), "上一个项目的星标跟过来了").toBe("false");
    expect(priceLabel(), "上一个项目的张数跟过来了").toBe("3 cr");
    const archiveB = stored("project-b");
    expect(archiveB.batches, "project A 做的批次被存进了 project B 的 key").toEqual([]);
    expect(archiveB.starred).toEqual([]);
    expect(archiveB.attachments).toEqual([]);

    await render("project-a");
    expect(batchIds().length, "清内存态时把 project A 的存档也一起清了").toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ⑨ 手在板上走的时候,不许顺手刷出一片原生文字选区(编排者真机回炉件 P2)
// ---------------------------------------------------------------------------
describe("⑨ 框选与拖拽进行中抑制文本选择", () => {
  /** jsdom 画不出原生选区,所以这里钉的是浏览器真正据以抑制它的那一样东西:stage 上那面旗。 */
  function gesturing(): boolean {
    return need<HTMLElement>("[data-r22-canvas-stage]").className.includes("is-gesturing");
  }

  it("框选:按下就摁住,拖的全程都摁着,松手立刻摘掉", async () => {
    await mount();
    await click(need('[data-r22-canvas-tools] button[aria-label="Box select"]'));
    const stage = need<HTMLElement>("[data-r22-canvas-stage]");
    expect(gesturing(), "什么都没做就先把文本选择摁住了 —— 那会连正常复制一起杀掉").toBe(false);

    await act(async () => { stage.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 90, clientY: 90, button: 0 })); });
    expect(gesturing(), "框选起手没有摁住文本选择 —— 框扫过卡片时整片字会被刷成蓝色").toBe(true);

    await act(async () => { window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 380, clientY: 340, button: 0 })); });
    expect(gesturing(), "拖到一半就松开了抑制").toBe(true);

    await act(async () => { window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 380, clientY: 340, button: 0 })); });
    expect(gesturing(), "松手之后还摁着 —— 商家从此复制不动板上的字").toBe(false);
  });

  it("拖卡片:按下那一刻就摁住,不等 3px 阈值(文字选区从按下就开始刷)", async () => {
    await mount();
    const sticky = need<HTMLElement>('[data-canvas-object="sticky"]');

    await act(async () => { sticky.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 500, clientY: 500, button: 0 })); });
    expect(gesturing(), "拖卡片起手没有摁住,或者等到越过阈值才摁 —— 那时候字已经被刷蓝了").toBe(true);

    await act(async () => { window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 500, clientY: 500, button: 0 })); });
    expect(gesturing()).toBe(false);
  });

  it("那面旗接着的是一条 user-select: none,而且没有被焊死在 stage 上", () => {
    const css = readFileSync(path.resolve(__dirname, "../../components/canvas/r22-canvas.css"), "utf8");
    const gesturingRule = /\.r22-canvas-stage\.is-gesturing\s*\{([^}]*)\}/.exec(css);
    expect(gesturingRule, "旗挂上了,却没有任何一条声明接着它 —— 浏览器那边什么都不会发生").not.toBeNull();
    expect(gesturingRule![1]).toContain("user-select: none");

    // 一刀切的抑制会杀掉正常复制:摘录卡上那段商家自己网页的文字本来就该选得中。
    const stageRule = /\.r22-canvas-stage\s*\{([^}]*)\}/.exec(css);
    expect(stageRule, "stage 那条规则不见了").not.toBeNull();
    expect(stageRule![1], "user-select: none 被焊死在 stage 上,板上的字从此一个都复制不走").not.toContain("user-select");
  });
});
