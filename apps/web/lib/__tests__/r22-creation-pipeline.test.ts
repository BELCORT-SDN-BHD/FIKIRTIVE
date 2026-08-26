// @vitest-environment jsdom
/**
 * r22-creation-pipeline.test.ts —— 「Creation 总管道」第二波的行为契约。
 *
 * 这一波要证明的是**一件东西只有一本账**:在画布上做出来的、在仓库里做出来的、商家自己传
 * 上来的,全都住在 Library 那一份 v2 存档里(`fikirtive.r22.library.state.v2`)。上一版画布
 * 另开了一个 `r22:library:pack` 键,于是画布加进包里的图在 Library 的素材包页里根本看不见,
 * 而且两边谁都不会报错 —— 静默的分账是这一面最贵的一种坏法,所以下面有一条 grep 断言直接
 * 钉住「那个旧键零残留」。
 *
 * 每条断言看的都是商家屏幕上真的发生的事(DOM、aria、可读文本)与浏览器里真的存下的东西
 * (sessionStorage),不是源码里写了什么字 —— 唯一的例外是那条旧键围栏,它量的正是「源码里
 * 还有没有那个字」。
 *
 * 覆盖:
 *   ① 画布 Add to pack 写进 v2 存档,而且幂等 —— 再收一次不多出一条;
 *   ② 选包弹层能就地新建一个包,新包与那张图一起落进存档;
 *   ③ 画布的 From Library 读的是 v2 存档 —— 商家刚上传的照片在这里挑得到;
 *   ④ 画布一批做完自动进库,而且不重复入库;
 *   ⑤ Made by Otto 与 PROJECTS 两条分类过滤对得上;
 *   ⑥ Quick create 做出来的东西进库、归今天那一组、Made by Otto 计数跟着走;
 *   ⑦ 含糊的一句话先出问题卡,而且**报价在等待期间原样冻着**;
 *   ⑧ Continue in Canvas 把这次的 prompt 与成品带进那块画布的会话;
 *   ⑨ 旧键 `r22:library:pack` 零残留。
 *
 * 变异自查(逐条实做,做完全部还原,红 → 绿):
 *   · `saveArtToPack` 里把 `attachToPack(...)` 换成只 `addLibraryAssets(...)` ⇒ ① 红;
 *   · `addLibraryAssets` 里去掉 `known` 那道去重闸 ⇒ ①④ 红;
 *   · `createPackForArt` 里不把新包写进 `packs` ⇒ ② 红;
 *   · From Library 那一格改回四张写死的私种子 ⇒ ③ 红;
 *   · `startFixtureJob` 里删掉 `fileBatchIntoLibrary(made)` ⇒ ④ 红;
 *   · `matchesSection` 里把 `made` 那一支删掉 ⇒ ⑤ 红;
 *   · `libraryProjects` 里不按 `projectId` 分组(返回空数组) ⇒ ⑤ 红;
 *   · `runQuickCreate` 里把 `commit(addLibraryAssets(...))` 换成只 `say(...)` ⇒ ⑥ 红;
 *   · `send()` 里跳过 `quickCreateQuestion` 直接 `run` ⇒ ⑦ 红;
 *   · `frozenQuote` 那一支删掉(报价永远读此刻参数) ⇒ ⑦ 后半红;
 *   · `runQuickCreate` 里删掉 `appendCanvasFixtureHandoff(...)` ⇒ ⑧ 红。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImmersiveCanvasRuntimeContext } from "@/components/canvas/NorthstarCanvasWorkspace";
import type { FixtureBatch } from "@/components/canvas/r22-canvas-fixture";
import type { LibraryArchive } from "@/components/library/library-fixture";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/library",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/canvas-actions", () => ({ listCanvasNodes: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: () => "canvas-action-test",
  useCanvasGen: () => ({ generateImage: vi.fn(), quoteCosts: vi.fn(), imageShapes: vi.fn() }),
}));

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

const { R22CanvasSurface } = await import("@/components/canvas/R22CanvasSurface");
const { LibraryWorkroom } = await import("@/components/library/LibraryWorkroom");
const { LIBRARY_FIXTURE_KEY, QUICK_CREATE_PROJECT_ID } = await import("@/components/library/library-fixture");
const { canvasFixtureSessionKey, CANVAS_FIXTURE_SESSION_VERSION } = await import("@/components/canvas/r22-canvas-fixture");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");
/** `DEFAULT_R22_WORKSPACE_DIRECTORY.activeId` —— 没有 seed directory 时的默认 workspace。 */
const WORKSPACE_ID = "batik-house";
const libraryKey = `${LIBRARY_FIXTURE_KEY}:${WORKSPACE_ID}`;
/** 一次生成跑完需要的时间(排队 320ms → 落地 920ms),两面同一套节拍。 */
const JOB_MS = 1200;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ── 场地 ───────────────────────────────────────────────────────────────────── */

function runtimeContext(): ImmersiveCanvasRuntimeContext {
  return {
    projects: [{ id: "project-a", name: "Raya launch" }, { id: "project-b", name: "Merdeka teaser" }],
    threads: [],
    activeProjectId: "project-a",
    activeThreadId: null,
    initialBalance: null,
    visualFixture: "r22",
  };
}

async function mount(element: ReactElement): Promise<void> {
  await act(async () => { root!.render(element); });
  await act(async () => { await Promise.resolve(); });
}

const openCanvas = () => mount(createElement(R22CanvasSurface, { runtimeContext: runtimeContext(), entities: [] }));
const openLibrary = () => mount(createElement(LibraryWorkroom, {}));

function need<T extends Element>(selector: string): T {
  const node = container!.querySelector<T>(selector);
  expect(node, `找不到 ${selector} —— 下面的断言在核对空气`).not.toBeNull();
  return node as T;
}

function all<T extends Element>(selector: string): T[] {
  return [...container!.querySelectorAll<T>(selector)];
}

async function click(node: Element): Promise<void> {
  await act(async () => { (node as HTMLElement).click(); });
}

function typeInto(node: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

function archive(): LibraryArchive {
  const raw = window.sessionStorage.getItem(libraryKey);
  expect(raw, `${libraryKey} 里什么都没有 —— 两面共用的那本账根本没被写过`).not.toBeNull();
  return JSON.parse(raw!) as LibraryArchive;
}

/** 左边薄导航的一格。按钮里是 `<span>标签</span><em>数字</em>`,所以按 span 认。 */
function navEntry(label: string): HTMLElement {
  const found = all(".r22-lib-nav button").find((node) => node.querySelector("span")?.textContent?.trim() === label);
  expect(found, `左导航里没有「${label}」这一格`).toBeTruthy();
  return found as HTMLElement;
}

function tileNames(): string[] {
  return all<HTMLElement>(".r22-lib-tile .r22-lib-meta b").map((node) => node.textContent ?? "");
}

function noticeText(): string {
  return container!.querySelector(".r22-lib-notice span")?.textContent ?? "";
}

/** 打开 Quick create 生成条,写一句话。 */
async function quickCompose(prompt: string): Promise<void> {
  await click(need("[data-r22-lib-create]"));
  await act(async () => { typeInto(need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]'), prompt); });
}

async function quickSend(): Promise<void> {
  await click(need(".r22-lib-make-send"));
}

/** 打开生成条上那个参数弹层(形状与张数住在里面,与画布 composer 同一个形状)。 */
async function openQuickParams(): Promise<void> {
  await click(need(".r22-lib-make-shape"));
}

/* ── ① ② 画布把东西收进素材包 ───────────────────────────────────────────────── */

describe("① 画布 Add to pack 写的是 Library 那一份存档", () => {
  it("选一个包收进去,再收一次不多出一条", async () => {
    await openCanvas();

    await click(need('[aria-label="Add Image 2 to a Library pack"]'));
    await click(need('[data-canvas-pack-pick="pack-candle"]'));

    const saved = archive().assets.filter((asset) => asset.id === "canvas:project-a:art-2");
    expect(saved, "画布那张图没有作为一条素材进存档").toHaveLength(1);
    expect(saved[0]!.packIds).toEqual(["pack-candle"]);
    expect(saved[0]!.source, "画布做出来的东西不算生成物").toBe("made");
    expect(saved[0]!.projectId, "存下来的东西没记住它是在哪块板上做的").toBe("project-a");

    await click(need('[aria-label="Add Image 2 to a Library pack"]'));
    await click(need('[data-canvas-pack-pick="pack-candle"]'));

    const again = archive().assets.filter((asset) => asset.id === "canvas:project-a:art-2");
    expect(again, "多收一次就在库里多出一张一样的图").toHaveLength(1);
    expect(again[0]!.packIds, "多收一次就在包里多挂一次").toEqual(["pack-candle"]);
  });

  it("② 就地新建一个包,新包与那张图一起落进存档", async () => {
    await openCanvas();

    await click(need('[aria-label="Add Image 3 to a Library pack"]'));
    await act(async () => { typeInto(need<HTMLInputElement>('[data-canvas-pack-menu="art-3"] input'), "Merdeka assets"); });
    await click(need("[data-canvas-pack-create]"));

    const stored = archive();
    expect(stored.packs.map((pack) => pack.name), "新包没进存档 —— 商家下次打开就没有这个包").toContain("Merdeka assets");
    const pack = stored.packs.find((row) => row.name === "Merdeka assets")!;
    expect(stored.assets.find((asset) => asset.id === "canvas:project-a:art-3")!.packIds).toEqual([pack.id]);
  });
});

/* ── ③ From Library 读的是同一本账 ──────────────────────────────────────────── */

describe("③ 画布的 From Library 挑的是商家真的存着的东西", () => {
  it("商家刚上传的照片,在画布的素材库弹层里挑得到", async () => {
    // 先在 Library 里放一张只有商家自己有的东西(直接写存档 = 「上一次他上传过」)。
    const seeded: LibraryArchive = {
      packs: [],
      assets: [{
        id: "upload-shopfront-awning",
        poster: "/fixtures/r22-canvas/art-1.jpg",
        kind: "image",
        name: "Shopfront awning",
        createdAt: "2026-08-25T02:00:00.000Z",
        starred: false,
        source: "uploaded",
        packIds: [],
      }],
    };
    window.sessionStorage.setItem(libraryKey, JSON.stringify(seeded));

    await openCanvas();
    await click(need('button[aria-label="Attach"]'));
    await click(all<HTMLButtonElement>(".r22-canvas-attach-menu button").find((node) => node.textContent === "From Library")!);

    const picks = all<HTMLElement>("[data-canvas-library-pick]");
    expect(picks.map((node) => node.textContent), "画布挑的仍然是它自己那几张私种子").toEqual(["Shopfront awning"]);

    await click(picks[0]!);
    expect(need("[data-canvas-reference-chip] b").textContent).toBe("Shopfront awning");
  });
});

/* ── ④ 做完自动进库 ────────────────────────────────────────────────────────── */

describe("④ 画布一批做完就自动进库", () => {
  it("送一句话 → 成品进 Library 存档,重挂一次也不重复入库", async () => {
    vi.useFakeTimers();
    await openCanvas();

    await act(async () => { typeInto(need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]'), "Make a Raya poster"); });
    await act(async () => { need<HTMLFormElement>("form.r22-canvas-composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { vi.advanceTimersByTime(JOB_MS); });

    const filed = archive().assets.filter((asset) => asset.id.startsWith("canvas:project-a:batch-"));
    expect(filed.length, "板上做完了,库里一件都没有 —— 商家得再手动存一次").toBe(1);
    expect(filed[0]!.projectName).toBe("Raya launch");
    expect(filed[0]!.source).toBe("made");
    const before = archive().assets.length;

    // 刷新一次:存档回放会把同一批重新摆回板上,库里不该因此多出一份。
    await act(async () => root!.unmount());
    root = createRoot(container!);
    await openCanvas();
    await act(async () => { vi.advanceTimersByTime(JOB_MS); });

    expect(archive().assets.length, "回放一次就在库里多出一份重复的东西").toBe(before);
  });
});

/* ── ⑤ 两条新分类 ──────────────────────────────────────────────────────────── */

describe("⑤ Made by Otto 与 PROJECTS 过滤的是对的那一堆", () => {
  it("Made by Otto 只有生成物,项目那一格只有那个项目的东西", async () => {
    await openLibrary();

    await click(navEntry("Made by Otto"));
    expect(tileNames(), "生成物那一格里混进了商家自己传的东西").not.toContain("Shopfront photo");
    expect(tileNames()).toContain("Raya table setting");
    expect(navEntry("Made by Otto").querySelector("em")!.textContent, "计数没跟着真实数量走").toBe("11");

    await click(navEntry("Uploads"));
    expect(tileNames()).toEqual(["Shopfront photo", "Market sign"]);

    // PROJECTS 是自动长出来的:种子里三个项目,一个都不用手动登记。
    await click(navEntry("Candle care"));
    expect(tileNames()).toEqual(["Pandan candle, close up", "Wick trim tip", "Candle care set", "Candle pour clip"]);
    expect(navEntry("Candle care").querySelector("em")!.textContent).toBe("4");
  });
});

/* ── ⑥ ⑦ ⑧ Quick create ────────────────────────────────────────────────────── */

describe("⑥ Quick create 做出来的东西真的进了库", () => {
  it("说清楚的一句话直接开跑,成品归今天那一组,Made by Otto 跟着 +2", async () => {
    vi.useFakeTimers();
    await openLibrary();
    const madeBefore = Number(navEntry("Made by Otto").querySelector("em")!.textContent);

    await quickCompose("A teal batik candle on a rattan tray");
    await openQuickParams();
    await click(need('[data-r22-lib-count="2"]'));
    expect(need("[data-r22-lib-price]").textContent, "两张的报价没跟着张数走").toBe("6 cr");
    await quickSend();

    expect(noticeText(), "按下去之后一句人话都没有").toContain("Otto is on it");
    await act(async () => { vi.advanceTimersByTime(JOB_MS); });

    const made = archive().assets.filter((asset) => asset.projectId === QUICK_CREATE_PROJECT_ID);
    expect(made.length, "Quick create 做完了,库里一件都没有").toBe(2);
    expect(made[0]!.source).toBe("made");
    expect(noticeText()).toContain("6 cr");

    // 归今天那一组:第一个日组的组头就是今天。
    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    expect(all<HTMLElement>(".r22-lib-group h3")[0]!.textContent).toBe(today);
    expect(tileNames().slice(0, 2).every((name) => name.startsWith("A teal batik candle")), "刚做出来的东西不在第一屏").toBe(true);
    expect(Number(navEntry("Made by Otto").querySelector("em")!.textContent)).toBe(madeBefore + 2);
    // 项目那一节自动多了一格,零手动整理。
    expect(navEntry("Quick create").querySelector("em")!.textContent).toBe("2");
  });
});

describe("⑦ 太含糊就先问一句,而且等待期间报价冻着", () => {
  it("含糊的一句话出问题卡,拨参数报价不动;回答之后才开跑", async () => {
    vi.useFakeTimers();
    await openLibrary();

    await quickCompose("make something nice");
    const quoted = need("[data-r22-lib-price]").textContent;
    await quickSend();

    expect(container!.querySelector("[data-r22-lib-ask]"), "一句含糊话直接开跑了 —— 那四张多半全不对,还是收了钱的").toBeTruthy();
    expect(window.sessionStorage.getItem(libraryKey), "还没回答就已经往库里写东西了").toBeNull();

    // 等待期间拨张数:价钱一个字都不许动 —— 跳动的价钱等于在说「你多想了一会儿就变贵了」。
    await openQuickParams();
    await click(need('[data-r22-lib-count="4"]'));
    expect(need("[data-r22-lib-price]").textContent, "等着回答的时候报价自己跳了").toBe(quoted);

    await click(need('[data-r22-lib-ask-option="A product shot"]'));
    await click(need("[data-r22-lib-ask-go]"));
    await act(async () => { vi.advanceTimersByTime(JOB_MS); });

    const made = archive().assets.filter((asset) => asset.projectId === QUICK_CREATE_PROJECT_ID);
    expect(made.length, "回答完了还是没开跑").toBeGreaterThan(0);
    expect(made[0]!.prompt, "回答没有跟着那句话一起进去").toContain("A product shot");
  });
});

describe("⑧ Continue in Canvas 把这一次带进那块板", () => {
  it("回执上那颗按钮指向 Quick create 那块板,板上真的有这一批", async () => {
    vi.useFakeTimers();
    await openLibrary();

    await quickCompose("A pandan candle on white linen");
    await quickSend();
    await act(async () => { vi.advanceTimersByTime(JOB_MS); });

    const act1 = need<HTMLAnchorElement>("[data-r22-lib-continue]");
    expect(act1.textContent).toBe("Continue in Canvas");
    expect(act1.getAttribute("href")).toContain(`project=${QUICK_CREATE_PROJECT_ID}`);
    expect(act1.getAttribute("href")).toContain("fixture=r22");

    const sessionKey = `${canvasFixtureSessionKey(QUICK_CREATE_PROJECT_ID, null)}:${WORKSPACE_ID}`;
    const raw = window.sessionStorage.getItem(sessionKey);
    expect(raw, "点过去会是一块空板 —— 这一次的东西根本没送进那个会话").not.toBeNull();
    const session = JSON.parse(raw!) as { version: number; messages: Array<{ from: string; text: string }>; batches: FixtureBatch[] };
    expect(session.version, "版本号对不上,画布会当场把它丢掉").toBe(CANVAS_FIXTURE_SESSION_VERSION);
    expect(session.messages.at(-1)!.text).toBe("A pandan candle on white linen");
    expect(session.batches).toHaveLength(1);
    expect(session.batches[0]!.art).toHaveLength(1);

    // 详情层的「Open in canvas」回的是同一块板 —— 两条路不该指向两个地方。
    await click(need(`button[aria-label="Open ${session.batches[0]!.art[0]!.label}"]`));
    const open = document.body.querySelector<HTMLAnchorElement>("a.r22-lib-layer-open");
    expect(open, "Quick create 的产物在详情层里没有回画布的路").toBeTruthy();
    expect(open!.getAttribute("href")).toContain(`project=${QUICK_CREATE_PROJECT_ID}`);
  });
});

/* ── ⑨ 旧键零残留 ──────────────────────────────────────────────────────────── */

describe("⑨ 分账的那个旧键退役得干干净净", () => {
  it("整个 app 目录里再也找不到 `r22:library:pack`", () => {
    const SKIP = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);
    const hits: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|css)$/.test(entry.name)) continue;
        // 这份文件自己写着那个键名(就是为了钉住它),不能把自己判红。
        if (full === __filename) continue;
        if (readFileSync(full, "utf8").includes("r22:library:pack")) hits.push(path.relative(WEB_ROOT, full));
      }
    }
    walk(WEB_ROOT);
    expect(hits, `还有地方在读写那个分账的旧键 —— 两本账会再次悄悄分家:${hits.join(", ")}`).toEqual([]);
  });
});
