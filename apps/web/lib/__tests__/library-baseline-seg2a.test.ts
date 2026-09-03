// @vitest-environment jsdom
/**
 * library-baseline-seg2a —— `/library` 按**已批准的前端基线**重画之后,屏幕上到底有什么
 * (规格 `docs/specs/frontend-baseline.md` §7.1 段② / 验收行 FRONT-A5)。
 *
 * 这份围栏钉三件商家看得见的事:
 *   ① **同源**:页头、一级页签、Elements 分栏的每一句字都逐字来自已批准的 pattern
 *      (`design-system/patterns/library/`),不是这一票自己新写的一套说法;
 *   ② **页签集合 = 今天真有数据支撑的那几格**:Favorites 与 Collections 后端没有对象
 *      (backend-handoff-contract.md §7 的两行「未具备」),所以一格都不许画出来 ——
 *      画一个点不动的页签就是前端规则第①条明禁的假控件;
 *   ③ **列表是服务器的**:第一页由页面在服务端取好,而且是 owner-gated 的那一个读;
 *      搜索/筛选改变时**重新向服务器要**,不在浏览器里过滤已加载的那几条。
 *
 * 变异自查(逐一实做,做完还原,红→绿):
 *   · 在 `LIBRARY_VIEWS` 里加回 `favorites` ⇒ ② 红;
 *   · 把页头副标题改成自己的一句话 ⇒ ① 红;
 *   · 让 `LibraryView` 从 `@/components/ui/...` 取组件 ⇒ ① 的基座那条红;
 *   · 把 `getGenerationHistory` 换成页面自己 new PrismaClient ⇒ ③ 红。
 */
import fs from "node:fs";
import path from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIBRARY_VIEWS as APPROVED_VIEWS, ELEMENT_VIEWS as APPROVED_ELEMENT_VIEWS } from "@/design-system/patterns/library/model";

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(WEB_ROOT, relative), "utf8");
/** 注释里的路径与旧说法是历史,不是事实 —— 判定前先剥掉。 */
const codeOf = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  getProjects: vi.fn(),
  getGenerationHistory: vi.fn(),
  getLibraryElements: vi.fn(),
  softDeleteEntity: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/data", () => ({ getProjects: mocks.getProjects }));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: mocks.getGenerationHistory }));
vi.mock("@/lib/library-elements", () => ({ getLibraryElements: mocks.getLibraryElements }));
vi.mock("@/lib/actions", () => ({ softDeleteEntity: mocks.softDeleteEntity }));
// 详情面不是这份围栏在测的东西,而它会把整条花费路径拖进来(与 #942 / #986 同一个理由)。
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: LibraryPage } = await import("@/app/library/page");

const HISTORY_PAGE = {
  items: [
    {
      id: "gen_1",
      projectId: "prj_1",
      assetId: "ast_1",
      url: "/files/u/own_1/a.png",
      kind: "image" as const,
      source: "generated" as const,
      prompt: "Raya storefront at dusk",
      filename: "",
      width: 1024,
      height: 1280,
      durationS: null,
      favorite: false,
      createdAt: new Date().toISOString(),
    },
  ],
  nextCursor: null,
  hasMore: false,
};

const mounted: { root: Root; container: HTMLDivElement }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ email: "shop@test.my", ownerId: "own_1" });
  mocks.getProjects.mockResolvedValue([{ id: "prj_1", name: "Hari Raya gifting" }]);
  mocks.getGenerationHistory.mockResolvedValue(HISTORY_PAGE);
  mocks.getLibraryElements.mockResolvedValue([
    { id: "ent_1", kind: "products" as const, name: "Kopi tumbler", coverUrl: null, mediaCount: 2 },
  ]);
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  document.body.replaceChildren();
});

async function mount(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  await act(async () => { await Promise.resolve(); });
  return document.body;
}

function tabLabels(dom: ParentNode): string[] {
  return Array.from(dom.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent?.trim() ?? "");
}

/* ── ① 屏幕上的字与已批准的 pattern 同源 ──────────────────────────────────── */

describe("FRONT-A5 Library 的表面与已批准的设计同源", () => {
  it("页头逐字来自已批准的 Library pattern,不是这一票自己新写的一句", async () => {
    const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({}) }));
    expect(dom.querySelector("h1")?.textContent).toBe("Library");
    const reference = read("design-system/patterns/library/LibraryReference.tsx");
    expect(dom.textContent).toContain("Find, organize and reuse everything you create.");
    expect(reference, "夹具里已经没有这句话了 —— 两边不同源").toContain(
      "Find, organize and reuse everything you create.",
    );
  });

  it("每一个一级页签的名字都逐字出现在已批准的 LIBRARY_VIEWS 里", async () => {
    const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({}) }));
    const approved = new Set(APPROVED_VIEWS.map((view) => view.label));
    for (const label of tabLabels(dom)) {
      expect(approved.has(label), `「${label}」不是已批准的一级视图名`).toBe(true);
    }
  });

  it("Elements 的分栏名同样逐字来自已批准的 ELEMENT_VIEWS", async () => {
    const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({ view: "elements" }) }));
    const approved = new Set<string>(APPROVED_ELEMENT_VIEWS);
    const elementTabs = tabLabels(dom).filter((label) => !APPROVED_VIEWS.some((view) => view.label === label));
    expect(elementTabs.length).toBeGreaterThan(0);
    for (const label of elementTabs) {
      expect(approved.has(label), `「${label}」不是已批准的 Elements 分栏`).toBe(true);
    }
  });

  it("组件基座只用 design-system —— 不从 components/ui 取第二套", () => {
    const source = codeOf("components/library/LibraryView.tsx");
    expect(source).toContain("@/design-system/primitives/");
    expect(source, "又从 components/ui 拿了一套组件").not.toMatch(/from "@\/components\/ui\//);
  });
});

/* ── ② 页签集合 = 今天真有数据支撑的那几格 ────────────────────────────────── */

describe("FRONT-A5 没有真实能力的入口一个都不出现", () => {
  it("只画得出生成历史、上传与 Elements 三格", async () => {
    const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({}) }));
    expect(tabLabels(dom)).toEqual(["Generation history", "Uploads", "Elements"]);
  });

  it.each([
    ["Favorites", "跨类型 favorite 还没有 typed preference"],
    ["Collections", "Collection / membership 还没有 schema 与动作"],
  ])("%s 页签不出现(%s)", async (label) => {
    const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({}) }));
    expect(tabLabels(dom)).not.toContain(label);
  });

  it("选择模式、批量动作与 Upload files 三颗按不动的键都不画", async () => {
    const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({}) }));
    const buttons = Array.from(dom.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(buttons).not.toContain("Select");
    expect(buttons).not.toContain("Add to collection");
    expect(buttons).not.toContain("Upload files");
  });

  it("地址栏点名 Favorites 时落回生成历史,而不是画一格空白", async () => {
    const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({ view: "favorites" }) }));
    // 落回生成历史 = 查的是不带来源约束的那一次(Uploads 那一格才会带 sources)。
    expect(mocks.getGenerationHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sources: undefined }),
    );
    expect(dom.querySelector('button[aria-label="Open Raya storefront at dusk"]')).toBeTruthy();
  });
});

/* ── ③ 列表来自服务器 ───────────────────────────────────────────────────── */

describe("FRONT-A5 列表与筛选来自服务器", () => {
  it("首屏那一页由页面向 owner-gated 的 getGenerationHistory 要,不是浏览器里的假数据", async () => {
    const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.getGenerationHistory).toHaveBeenCalledTimes(1);
    // 页面不自己传 ownerId —— 身份只来自服务端 principal(规格 §1 九问6)。
    expect(JSON.stringify(mocks.getGenerationHistory.mock.calls[0][0] ?? {})).not.toContain("own_1");
    expect(dom.querySelector('button[aria-label="Open Raya storefront at dusk"]')).toBeTruthy();
  });

  it("Uploads 页签本身就是一次来源约束,服务端照这个约束查", async () => {
    await mount(await LibraryPage({ searchParams: Promise.resolve({ view: "uploads" }) }));
    expect(mocks.getGenerationHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ["upload"] }),
    );
  });

  it("读失败时说读失败并给重试,不把商家的库画成空的", async () => {
    mocks.getGenerationHistory.mockResolvedValue({ error: "Unauthorized." });
    const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({}) }));
    expect(dom.textContent).toContain("We couldn't load your Library");
    expect(dom.textContent, "读失败被画成了「你还没有东西」").not.toContain("Nothing here yet");
    expect(Array.from(dom.querySelectorAll("button")).map((b) => b.textContent?.trim())).toContain("Try again");
  });

  it("没登录的人到不了 Library —— 守卫在,而且送去登录页", async () => {
    mocks.requireOwner.mockResolvedValue({ error: "Not authorized." });
    await expect(LibraryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

/* ── 段②后续切片:今天还证明不了的验收行,占位不冒充 ──────────────────────── */

describe("段②后续切片(本轮不交付,占位登记)", () => {
  it.todo("FRONT-A5 按收藏筛选与点收藏:Favorites 视图随 cross-object preference 契约一起交付");
  it.todo("FRONT-A6 新建 collection、加入/移除成员、删除 collection:Collection 表尚未存在");
  it.todo("FRONT-A7 Library 的 Use in canvas:typed-object handoff 尚未统一,本轮只走现有详情面");
});
