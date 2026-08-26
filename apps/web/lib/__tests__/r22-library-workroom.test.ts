// @vitest-environment jsdom
/**
 * r22-library-workroom.test.ts —— Library 从「陈列柜」变成「工作台」之后的行为契约。
 *
 * 陈列柜只要「画得出来」就算对;工作台要「做得成事」才算对。所以这里每一条断言看的都是
 * 商家屏幕上真的发生的事(DOM、aria 状态、存档里到底存了什么),不是源码里写了什么字。
 *
 * 覆盖:
 *   ① 多选之后批量加星 —— 选中的每一张都真的进了 Starred,不是只有回执说进了;
 *   ② shift 连选 —— 两次点击之间那一段全部选上,而不是只选到点着的那两张;
 *   ③ 上传是一等公民 —— 真 file picker、真读成 data URL、真进存档,重挂一次还在;
 *   ④ 超预算当场拒收 —— 一句人话,而且**东西没进去**(假装成功再悄悄消失是最贵的那种谎);
 *   ⑤ 素材包 —— 加进去之后在包页看得见;
 *   ⑥ 详情层回链 —— 「Made in …」与「Open in canvas」都带得回那个 project;
 *   ⑦ Esc 不越层 —— 轮得到自己才吃,吃了就喊一声;轮不到就原样放过去给壳。
 *   ⑧ 浮层的关键帧是**专属**的,而且每一帧都带着居中的那半个 `-50%`(approvals 42503fa5
 *      付过这笔学费:借来的关键帧收尾帧一个 `transform:none`,层当场飞出视口)。
 *
 * 变异自查(逐条实做,做完全部还原,红 → 绿):
 *   · `bulkStar` 里把 `starred: true` 改成 `starred: asset.starred` ⇒ ① 红;
 *   · `onSelect` 里把 shift 那一支删掉(永远走单选) ⇒ ② 红;
 *   · `upload` 里把 `commit(...)` 换成只 `setNotice` ⇒ ③ 红;
 *   · `upload` 里把 `file.size > UPLOAD_BUDGET_BYTES` 那道闸删掉 ⇒ ④ 红;
 *   · `addToPack` 里把 `packIds: [...asset.packIds, packId]` 换成原样返回 ⇒ ⑤ 红;
 *   · `libraryCanvasHref` 里去掉 `project=` 那一段 ⇒ ⑥ 红;
 *   · Esc 处理里去掉 `if (!selected.length) return`(永远 preventDefault) ⇒ ⑦ 红;
 *   · `.r22-lib-layer[data-state="open"]` 改成借用 `r22-lib-bulk-in` ⇒ ⑧ 红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/library", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

// Radix 的 Dialog / ToggleGroup 在 jsdom 里要这几样。
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

const { LibraryWorkroom } = await import("@/components/library/LibraryWorkroom");
const { LIBRARY_FIXTURE_KEY, UPLOAD_BUDGET_BYTES } = await import("@/components/library/library-fixture");
const { scopedR22FixtureKey } = await import("@/components/r22/r22-workspace-fixture");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  document.documentElement.removeAttribute("data-kb");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
  window.sessionStorage.clear();
});

function mount(element: ReactElement) {
  act(() => root!.render(element));
}

/** 工作台默认就是 fixture 样张,存档开着 —— 「刷新还在」那一条全靠它。 */
function openLibrary() {
  mount(createElement(LibraryWorkroom, {}));
}

function checkbox(name: string): HTMLButtonElement {
  const node = container!.querySelector<HTMLButtonElement>(`[role="checkbox"][aria-label="Select ${name}"]`);
  if (!node) throw new Error(`no checkbox for ${name}`);
  return node;
}

function tile(name: string): HTMLElement {
  const opener = container!.querySelector<HTMLElement>(`button[aria-label="Open ${name}"]`);
  if (!opener) throw new Error(`no tile for ${name}`);
  return opener.closest("article") as HTMLElement;
}

function starOf(name: string): HTMLButtonElement {
  return tile(name).querySelector(".r22-lib-star") as HTMLButtonElement;
}

function click(node: HTMLElement, init: MouseEventInit = {}) {
  act(() => { node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })); });
}

/** 左边薄导航的一格。按钮里是 `<span>标签</span><em>数字</em>`,所以按 span 认。 */
function navTo(label: string) {
  const found = [...container!.querySelectorAll(".r22-lib-nav button")].find(
    (node) => node.querySelector("span")?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no nav entry ${label}`);
  click(found as HTMLElement);
}

function bulkButton(label: string): HTMLButtonElement {
  const bar = container!.querySelector(".r22-lib-bulk");
  if (!bar) throw new Error("the bulk bar is not on screen");
  const found = [...bar.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!found) throw new Error(`no bulk action ${label}`);
  return found as HTMLButtonElement;
}

/** 弹层走 Portal,挂在 `document.body` 上,不在挂载点那一支里。 */
function inLayer(selector: string): HTMLElement {
  const node = document.body.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`no ${selector} on screen`);
  return node;
}

function storedArchive() {
  const raw = window.sessionStorage.getItem(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY));
  return raw ? (JSON.parse(raw) as { assets: Array<{ id: string; name: string; starred: boolean; packIds: string[] }> }) : null;
}

async function pickFile(file: File) {
  const input = container!.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // FileReader 是异步的 —— 不等它,断言会跑在 onload 之前。
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

/* ── ① 多选之后批量加星 ──────────────────────────────────────────────────────── */

describe("Library 工作台:多选与批量", () => {
  it("① 选中的每一张都真的进了 Starred,而不是只有回执说进了", () => {
    openLibrary();
    expect(starOf("Raya table setting").getAttribute("aria-pressed")).toBe("false");
    expect(starOf("Raya opening clip").getAttribute("aria-pressed")).toBe("false");

    click(checkbox("Raya table setting"));
    click(checkbox("Raya opening clip"));
    expect(container!.querySelector(".r22-lib-bulk")!.textContent).toContain("2 selected");

    click(bulkButton("Star"));

    expect(starOf("Raya table setting").getAttribute("aria-pressed")).toBe("true");
    expect(starOf("Raya opening clip").getAttribute("aria-pressed")).toBe("true");
    expect(container!.textContent).toContain("2 items starred.");
    // 侧栏的 Starred 计数也跟着走 —— 种子里本来就有 3 张星标。
    navTo("Starred");
    expect(container!.querySelector('button[aria-label="Open Raya table setting"]')).toBeTruthy();
  });

  it("② shift 连选:两次点击之间那一段全部选上", () => {
    openLibrary();
    click(checkbox("Raya table setting"));
    click(checkbox("Raya gift box"), { shiftKey: true });

    // 24 Aug 那一组按 Newest 排:table setting → hero → opening clip → gift box → shopfront。
    // 从第一张连选到第四张 = 4 张,不是「点着的那两张」。
    expect(container!.querySelector(".r22-lib-bulk")!.textContent).toContain("4 selected");
    for (const name of ["Raya table setting", "Raya hero, teal batik", "Raya opening clip", "Raya gift box"]) {
      expect(checkbox(name).getAttribute("data-state"), name).toBe("checked");
    }
    expect(checkbox("Shopfront photo").getAttribute("data-state")).toBe("unchecked");
  });

  it("⑦ Esc 只剥自己那一层:有选中才吃,没选中原样放过去给壳", () => {
    openLibrary();

    const untouched = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(untouched); });
    expect(untouched.defaultPrevented, "没选中任何东西时 Library 也把这记 Esc 吃掉了 —— 壳那条链会断").toBe(false);

    click(checkbox("Raya table setting"));
    expect(container!.querySelector(".r22-lib-bulk")).toBeTruthy();

    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(consumed); });
    expect(consumed.defaultPrevented, "自己吃掉了却没喊一声,后注册的处理器会跟着再剥一层").toBe(true);
    expect(container!.querySelector(".r22-lib-bulk"), "Esc 之后多选态还在").toBeNull();
  });
});

/* ── ③④ 上传 ────────────────────────────────────────────────────────────────── */

describe("Library 工作台:上传是一等公民", () => {
  it("③ 上传的图片进了存档,重新打开这一页还在", async () => {
    openLibrary();
    await pickFile(new File([new Uint8Array(64)], "Shopfront awning.png", { type: "image/png" }));

    expect(container!.textContent).toContain("Shopfront awning is in your Library.");
    expect(container!.querySelector('button[aria-label="Open Shopfront awning"]'), "上传的图没进网格").toBeTruthy();
    expect(storedArchive()!.assets.some((asset) => asset.name === "Shopfront awning"), "上传的图没落进存档").toBe(true);

    // 「刷新一次还在」——拆掉重挂,走的是回读存档那条路。
    act(() => root!.unmount());
    root = createRoot(container!);
    openLibrary();
    expect(container!.querySelector('button[aria-label="Open Shopfront awning"]'), "重开之后上传的图没了").toBeTruthy();
    navTo("Uploads");
    expect(container!.querySelector('button[aria-label="Open Shopfront awning"]')).toBeTruthy();
  });

  it("④ 超出预算的图当场拒收 —— 一句人话,而且东西真的没进去", async () => {
    openLibrary();
    const before = container!.querySelectorAll(".r22-lib-tile").length;
    await pickFile(new File([new Uint8Array(UPLOAD_BUDGET_BYTES + 1)], "Huge banner.png", { type: "image/png" }));

    expect(container!.textContent).toContain("Huge banner is larger than 1.5 MB, so it was not added.");
    expect(container!.querySelector('button[aria-label="Open Huge banner"]'), "说了不行,却还是放进去了").toBeNull();
    expect(container!.querySelectorAll(".r22-lib-tile").length).toBe(before);
    expect(storedArchive()?.assets.some((asset) => asset.name === "Huge banner") ?? false).toBe(false);
  });
});

/* ── ⑤ 素材包 ───────────────────────────────────────────────────────────────── */

describe("Library 工作台:素材包", () => {
  it("⑤ 加进素材包之后,在那个包的页面里看得见", () => {
    openLibrary();
    click(checkbox("Market stall, morning"));
    click(bulkButton("Add to pack"));

    const layer = inLayer(".r22-lib-packlayer");
    const target = [...layer.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Candle care assets");
    expect(target, "素材包那一层里没有列出已有的包").toBeTruthy();
    click(target as HTMLElement);

    expect(container!.textContent).toContain("1 item in Candle care assets.");
    navTo("Candle care assets");
    expect(container!.querySelector('button[aria-label="Open Market stall, morning"]'), "包页里看不到刚加进去的那张").toBeTruthy();
    expect(storedArchive()!.assets.find((asset) => asset.name === "Market stall, morning")!.packIds).toContain("pack-candle");
  });
});

/* ── ⑥ 详情层 ───────────────────────────────────────────────────────────────── */

describe("Library 工作台:单图详情", () => {
  it("⑥ 回链带得回那个 project,上传物如实说它没有 prompt", () => {
    openLibrary();
    click(container!.querySelector('button[aria-label="Open Raya table setting"]') as HTMLElement);

    const layer = inLayer(".r22-lib-layer");
    expect(layer.textContent).toContain("Raya table setting");
    expect(layer.textContent).toContain("A Raya table with a teal batik runner");

    const origin = layer.querySelector("a.r22-lib-layer-origin") as HTMLAnchorElement;
    expect(origin.textContent).toBe("Made in Raya launch");
    expect(origin.getAttribute("href")).toContain("project=fixture-raya");
    expect((layer.querySelector("a.r22-lib-layer-open") as HTMLAnchorElement).getAttribute("href")).toContain("project=fixture-raya");

    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });

    click(container!.querySelector('button[aria-label="Open Shopfront photo"]') as HTMLElement);
    const uploaded = inLayer(".r22-lib-layer");
    expect(uploaded.textContent).toContain("Uploaded by you");
    expect(uploaded.querySelector("a.r22-lib-layer-open"), "上传物没有来源项目,却画了一条回画布的链接").toBeNull();
  });
});

/* ── ⑧ 动效纪律 ─────────────────────────────────────────────────────────────── */

describe("Library 工作台:动效纪律", () => {
  const css = readFileSync(path.join(WEB_ROOT, "components/library/r22-library.css"), "utf8");

  it("⑧ 详情层永远居中:translate 与入场动效不互相拆台", () => {
    const base = css.match(/\.r22-lib-layer \{[^}]*\}/)?.[0] ?? "";
    expect(base, "找不到 .r22-lib-layer 的基础规则").not.toBe("");
    expect(base, "换掉 DialogContent 默认类之后没有补回居中的 translate").toMatch(/transform:\s*translate\(-50%,\s*-50%\)/);

    const animation = css.match(/\.r22-lib-layer\[data-state="open"\] \{\s*animation:\s*([\w-]+)/)?.[1] ?? "";
    expect(animation, "找不到详情层的入场动效").not.toBe("");
    expect(animation, "详情层借用了别人的关键帧 —— 那条路 approvals 走过一次,层会飞出视口").toBe("r22-lib-layer-in");

    const frames = css.match(new RegExp(`@keyframes ${animation} \\{[^@]*?\\}\\s*\\}`))?.[0] ?? "";
    expect(frames, `找不到 @keyframes ${animation}`).not.toBe("");
    expect(frames, "入场动效的某一帧把居中 transform 抹掉了").not.toMatch(/transform:\s*none/);
    const transforms = frames.match(/transform:\s*[^;]+;/g) ?? [];
    expect(transforms.length, "关键帧里没有 transform,居中会在动画期间丢失").toBeGreaterThan(1);
    for (const declaration of transforms) expect(declaration, "这一帧没有居中").toContain("-50%");
  });

  it("⑧ 没有 transition: all,没有 scale(0),而且每一条过渡都在 200ms 以内", () => {
    // 注释里写着这条规矩本身(「没有 transition: all」),不剥掉的话围栏会把自己判红。
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules, "`transition: all` 会把没打算动的属性一起动起来").not.toMatch(/transition:\s*all\b/);
    expect(rules, "scale(0) 是消失,不是动效").not.toMatch(/scale\(0\)/);
    const durations = [...rules.matchAll(/transition:[^;}]+/g)].flatMap((match) => [...match[0].matchAll(/(\d+)ms/g)].map((hit) => Number(hit[1])));
    expect(durations.length).toBeGreaterThan(0);
    expect(Math.max(...durations), "有一条过渡长过 200ms").toBeLessThanOrEqual(200);
  });
});
