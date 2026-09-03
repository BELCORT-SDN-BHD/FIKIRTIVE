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
import { LIBRARY_ELEMENT_VIEWS, libraryElementKind } from "@/lib/library-elements-model";

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

/** 唯一一条登记在案、设计里没有的 Elements 分栏(理由见 `lib/library-elements-model.ts`)。 */
const REGISTERED_EXTRA_ELEMENT_TAB = "Brand marks";

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

  it("Elements 的分栏名逐字来自已批准的 ELEMENT_VIEWS,只有一条登记在案的例外", async () => {
    const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({ view: "elements" }) }));
    const approved = new Set<string>(APPROVED_ELEMENT_VIEWS);
    const elementTabs = tabLabels(dom).filter((label) => !APPROVED_VIEWS.some((view) => view.label === label));
    expect(elementTabs.length).toBeGreaterThan(0);
    for (const label of elementTabs) {
      // `Brand marks` 是本 PR 唯一一条「设计没有、生产必须有」的分栏(见下面那一组围栏):
      // BRANDMARK 是今天就能被创建的 EntityType,没有这一栏商家就永远看不到、也删不掉它。
      // 白名单只有这一个词 —— 再多一个自造分栏,这条仍然红。
      expect(approved.has(label) || label === REGISTERED_EXTRA_ELEMENT_TAB, `「${label}」不是已批准的 Elements 分栏`).toBe(true);
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

/* ── ④ 屏幕上的日界是商家自己的钟 ───────────────────────────────────────── */

describe("FRONT-A5 网格的时间分组按浏览者本地时区,不按 UTC", () => {
  /**
   * 生产实测(2026-09-03 17:24 +08):库里最新一行 `createdAt = 2026-09-02 18:21:30 UTC`,
   * 那是商家**当天凌晨 02:21** 做的东西 —— 页面却整组只写了一个 `Yesterday 11`。
   * 这一条钉的是屏幕上那行字本身:在 UTC+8 的浏览器里,它必须是 `Today`。
   */
  it("UTC+8 的浏览器里,本地凌晨做的那一行落在 Today 组", async () => {
    mocks.getGenerationHistory.mockResolvedValue({
      items: [{ ...HISTORY_PAGE.items[0], createdAt: "2026-09-02T18:21:30.000Z" }],
      nextCursor: null,
      hasMore: false,
    });
    vi.setSystemTime(new Date("2026-09-03T09:24:00.000Z"));
    const previousTz = process.env.TZ;
    process.env.TZ = "Asia/Kuala_Lumpur";
    try {
      const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({}) }));
      const headings = Array.from(dom.querySelectorAll("h2")).map((node) => node.textContent?.trim());
      expect(headings).toContain("Today");
      expect(headings, "按 UTC 算就会变成 Yesterday —— 商家今天早上做的东西被说成昨天").not.toContain("Yesterday");
    } finally {
      process.env.TZ = previousTz;
      vi.useRealTimers();
    }
  });
});

/* ── ⑤ 商家创建得出来的元素,一个都不许在 Library 里消失 ────────────────── */

/**
 * 换壳最容易造出来的一种假成功:Otto 那边照常回一句「已保存」,商家到 Library 却永远找不到
 * 那个元素 —— 连删掉它的唯一入口(`softDeleteEntity`)也一起没了。
 *
 * `BRANDMARK` 正是这么一类:`lib/actions.ts` 的 `ENTITY_TYPES` 收它、`packages/otto` 的
 * manage-entities 把它列为可创建类型、`MentionInput` 在提示词里认它。已批准的 Elements 设计
 * 没画这一栏,但「设计里没有」不等于「商家没有」。
 */
describe("FRONT-A5 每一个创建得出来的 EntityType 都有回得去的家", () => {
  it("lib/actions.ts 承认的每一个 EntityType 都能落到一个 Elements 分栏,一个都不落 null", () => {
    const entityTypes = codeOf("lib/actions.ts").match(/const ENTITY_TYPES = new Set\(\[([^\]]*)\]\)/);
    expect(entityTypes, "lib/actions.ts 的 ENTITY_TYPES 找不到了").toBeTruthy();
    const types = Array.from(entityTypes![1].matchAll(/"([A-Z]+)"/g)).map((match) => match[1]);
    expect(types).toContain("BRANDMARK");
    const kinds = new Set(LIBRARY_ELEMENT_VIEWS.map((view) => view.value));
    for (const type of types) {
      // CHARACTER 走 catalogKey 分叉;两条分支都得落在一个真的分栏上。
      const resolved = type === "CHARACTER"
        ? [libraryElementKind(type, null), libraryElementKind(type, "actor_01")]
        : [libraryElementKind(type, null)];
      for (const kind of resolved) {
        expect(kind, `${type} 在 Library 里没有家 —— 商家保存了就再也看不到`).not.toBeNull();
        expect(kinds.has(kind!), `${type} 落在 ${kind},但 Elements 没有这一栏`).toBe(true);
      }
    }
  });

  it("Brand mark 元素在 Elements 里画得出卡片,也点得开那个删除入口", async () => {
    mocks.getLibraryElements.mockResolvedValue([
      { id: "ent_bm", kind: "brandmarks" as const, name: "Kedai Kopi wordmark", coverUrl: null, mediaCount: 1 },
    ]);
    const dom = await mount(
      await LibraryPage({ searchParams: Promise.resolve({ view: "elements", element: "brandmarks" }) }),
    );
    expect(tabLabels(dom)).toContain("Brand marks");
    const card = dom.querySelector('button[aria-label="Open Kedai Kopi wordmark"]');
    expect(card, "Brand mark 元素在 Library 里看不见").toBeTruthy();
    await act(async () => { (card as HTMLButtonElement).click(); });
    const buttons = Array.from(dom.querySelectorAll("button")).map((button) => button.textContent?.trim());
    expect(buttons, "删自己元素的唯一入口没了").toContain("Remove from Library");
  });
});

/* ── 段②后续切片:今天还证明不了的验收行,占位不冒充 ──────────────────────── */

describe("段②后续切片(本轮不交付,占位登记)", () => {
  it.todo("FRONT-A5 按收藏筛选与点收藏:Favorites 视图随 cross-object preference 契约一起交付");
  it.todo("FRONT-A6 新建 collection、加入/移除成员、删除 collection:Collection 表尚未存在");
  it.todo("FRONT-A7 Library 的 Use in canvas:typed-object handoff 尚未统一,本轮只走现有详情面");
});
