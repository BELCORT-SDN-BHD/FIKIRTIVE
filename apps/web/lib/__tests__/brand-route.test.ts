// @vitest-environment jsdom
/**
 * brand-route.test.ts —— W2-2:Brand 变真路由(规格书 `docs/specs/wave2-shell.md` §4.4)。
 *
 * 这一票的三条验收各钉一段:
 *
 *   ① **`/brand` 是一扇真门**,而且内容是搬家不是重写:路由文件的地址由权威常量
 *      `SHELL_ROUTES.brand` 推出来(不在测试里手抄第二遍 `/brand`),页面渲染的就是
 *      `OttoMemory` 那一份实现,等待画面走 `ui/skeleton`。
 *
 *   ② **手搓件退场**:这一面里不许再有手写的 `role="tablist"`,也不许再有那种
 *      `fixed inset-0` 自制弹窗。而且退场要**换来真东西** —— 所以下面不是只查源码里
 *      没有那两个形状,而是真挂一次组件,按方向键、按 Escape,看 WAI-ARIA 的两套模型
 *      是不是真的在了:手搓那版这两件事一件都做不到。
 *
 *   ③ **说实话**:诚实说明句逐字出现(§4.4 给的原文),一个字都不许改写。
 *
 * 另外钉一条纪律:**这一票不碰 `BrandKit` / `BrandRule`**。规格书 §1.2 与 §4.4 就建在
 * 「它们各只有一个读取点、全仓零写入点」这条实况上 —— 谁在换壳的路上顺手给它们接了一根
 * 线,这条纪律就悄悄没了,而地基重设计那张票会以为自己还在原地起步。
 *
 * 零后端、零生成:文件系统 + 一次真挂载。
 */
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { SECTIONS } from "@fikirtive/core/memory-sections";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { StuffItem } from "@/lib/stuff-items";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "../..");
const REPO_ROOT = resolve(WEB_ROOT, "../..");

/**
 * 注释不算数。下面几条围栏钉的是「界面上不许再有这个形状」,而讲清楚为什么不许,
 * 就得把那个形状的名字写出来 —— 一条读整份源码的断言会被自己那段说明噎死
 * (第一版就是这么红的)。所以先把注释剥掉,再看剩下的代码。
 */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const source = (relative: string) => readFileSync(join(WEB_ROOT, relative), "utf8");
const code = (relative: string) => withoutComments(source(relative));

/** 权威常量 → app router 里的目录。`/brand` → `app/brand`,`/library/editor` → `app/library/editor`。 */
function routeDir(href: string): string {
  return join("app", ...href.split("/").filter(Boolean));
}

// ───────────────────────────────────────────────────────────────────────────────
// ① /brand 是一扇真门,内容是搬家不是重写
// ───────────────────────────────────────────────────────────────────────────────

describe("W2-2 ① `/brand` 是真路由", () => {
  const dir = routeDir(SHELL_ROUTES.brand);

  it("权威常量指的那个地址下面真有一个 page.tsx —— 地址不在这里手抄第二遍", () => {
    expect(SHELL_ROUTES.brand, "常量本身被改了,下面的推导就全落空").toBe("/brand");
    expect(existsSync(join(WEB_ROOT, dir, "page.tsx")), `${dir}/page.tsx 不存在`).toBe(true);
  });

  it("页面渲染的是 R22OttoIQView 那一份实现,没有第二套品牌视图", () => {
    const page = source(join(dir, "page.tsx"));
    expect(page).toContain('from "@/components/otto-iq/R22OttoIQView"');
    expect(page).toContain("<R22OttoIQView");
  });

  it("等待画面走 ui/skeleton,不手搓那一份 pulse 配方(规格书 §5.6 ③)", () => {
    const loading = join(dir, "loading.tsx");
    expect(existsSync(join(WEB_ROOT, loading)), `${loading} 不存在`).toBe(true);
    expect(source(loading)).toContain('from "@/components/ui/skeleton"');
    expect(code(loading), "手搓骨架又回来了").not.toContain("animate-pulse");
  });

  it("换壳落地后:MERCHANT_NAV 的 Brand 一格指的正是这条真路由(W2-11 收口)", async () => {
    // 这条曾经是这一票的边界(规格书 §6.3):新旧路由并存,导航指过来是切换总票 W2-11 的
    // 事,写成断言当时是为了防「顺手把导航也改了」这种越界。W2-11 已经落地,边界完成了
    // 它的使命 —— 现在反过来钉「指对了」:MERCHANT_NAV 的 Brand 必须就是这一票建的
    // 这条真路由,不是另起了第二个地址,旧壳的 `/otto?view=memory` 也不该再是权威指的地方。
    const { MERCHANT_NAV } = await import("@fikirtive/core/navigation");
    const hrefs = JSON.stringify(MERCHANT_NAV);
    expect(hrefs, "MERCHANT_NAV 的 Brand 没有指向这一票建的真路由").toContain('"/brand"');
    expect(hrefs, "旧壳的 /otto?view=memory 不该再是导航权威指的地址").not.toContain("view=memory");
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 纪律:这一票不碰 BrandKit / BrandRule
// ───────────────────────────────────────────────────────────────────────────────

describe("W2-2 · 地基重设计的两张表原地不动(规格书 §1.2 / §4.4)", () => {
  const SCAN_ROOTS = ["apps", "packages"] as const;
  const SKIP = new Set(["node_modules", ".next", "dist", ".turbo", "coverage", ".git", "generated"]);

  function sourcesUnder(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) sourcesUnder(full, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  /** `prisma.brandKit.findFirst(` / `tx.brandRule.create(` 这一族调用点。 */
  const CALL = /\.(brandKit|brandRule)\.(\w+)\s*\(/g;
  const WRITES = /^(create|createMany|update|updateMany|upsert|delete|deleteMany)/;

  function callSites(): { file: string; model: string; op: string }[] {
    const hits: { file: string; model: string; op: string }[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of sourcesUnder(join(REPO_ROOT, root))) {
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(CALL)) {
          hits.push({ file: file.slice(REPO_ROOT.length + 1), model: m[1], op: m[2] });
        }
      }
    }
    return hits;
  }

  it("仍然只有那两个读取点,而且都在 memory-actions.ts 里", () => {
    expect(callSites()).toEqual([
      { file: "apps/web/lib/memory-actions.ts", model: "brandKit", op: "findFirst" },
      { file: "apps/web/lib/memory-actions.ts", model: "brandRule", op: "findMany" },
    ]);
  });

  it("全仓零写入点 —— 换壳的路上没人顺手给它们接线", () => {
    expect(callSites().filter((hit) => WRITES.test(hit.op))).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// ② + ③ 真挂一次:手搓件退场,换来的东西真的在;诚实说明句逐字在屏幕上
// ───────────────────────────────────────────────────────────────────────────────

const { routerReplace, redirectMock, requireOwnerMock, projectRows, searchParams } = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  redirectMock: vi.fn((target: string) => {
    // Next 的 `redirect()` 靠**抛异常**中断这次渲染 —— 一个只记账不抛的替身会让页面继续跑
    // 到底,于是「守卫拦住了」和「守卫没拦住但后面碰巧没炸」看起来一模一样。这里照抄它的
    // 语义,调用点因此不需要 `return redirect(...)` 才成立。
    throw Object.assign(new Error(`NEXT_REDIRECT:${target}`), { digest: `NEXT_REDIRECT;${target}` });
  }),
  requireOwnerMock: vi.fn(async () => ({ email: "shop@test.my", ownerId: "org_1" })),
  projectRows: { value: [{ id: "proj_1" }, { id: "proj_2" }] as { id: string }[] },
  searchParams: { value: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, refresh: vi.fn() }),
  usePathname: () => "/brand",
  useSearchParams: () => searchParams.value,
  redirect: redirectMock,
}));
vi.mock("@/lib/otto-client-actions", () => ({ ottoTurn: vi.fn() }));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn(async () => null) }));
vi.mock("@/lib/memory-actions", () => ({
  addMemory: vi.fn(), updateMemory: vi.fn(), deleteMemory: vi.fn(),
  listMyMemory: vi.fn(async () => []),
  listMemory: vi.fn(async () => []),
}));
vi.mock("@/lib/brand-record-actions", () => ({
  saveBrandRecord: vi.fn(), deleteBrandRecord: vi.fn(), restoreBrandRecord: vi.fn(),
  listMyBrandRecords: vi.fn(async () => []),
  listBrandRecords: vi.fn(async () => []),
}));
vi.mock("@/lib/product-ingest-actions", () => ({ ingestProductFromUrl: vi.fn() }));
// 页面这一侧的服务端依赖。这里只替掉「去数据库拿什么」，守卫本身(requireOwner)是被测的东西。
vi.mock("@/lib/auth-guard", () => ({ requireOwner: requireOwnerMock }));
vi.mock("@/lib/actions", () => ({ getOrCreateDefaultProject: vi.fn(async () => ({ id: "proj_ensured" })) }));
vi.mock("@/lib/data", () => ({
  getProjects: vi.fn(async () => projectRows.value),
  getEntities: vi.fn(async () => []),
  getMyAds: vi.fn(async () => []),
  getRecentGenerationThumbs: vi.fn(async () => []),
}));
vi.mock("@/lib/dto", () => ({ toEntityDTO: (entity: unknown) => entity }));

const { OttoMemory } = await import("@/components/otto/OttoMemory");
const { default: BrandPage } = await import("@/app/brand/page");
const { ottoTurn } = await import("@/lib/otto-client-actions");
const { getCoworkThreadClient } = await import("@/lib/cowork-fetch");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  searchParams.value = new URLSearchParams();
  projectRows.value = [{ id: "proj_1" }, { id: "proj_2" }];
  window.sessionStorage.clear();
  vi.clearAllMocks();
  // clearAllMocks 会把 hoisted 替身的实现一起清掉,所以每一条用例前重新装回来。
  requireOwnerMock.mockImplementation(async () => ({ email: "shop@test.my", ownerId: "org_1" }));
  redirectMock.mockImplementation((target: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${target}`), { digest: `NEXT_REDIRECT;${target}` });
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

const A_PRODUCT: BrandRecordRow[] = [{
  id: "rec_1",
  kind: "product",
  data: { name: "Sambal bottle" },
  status: "active",
  startsAt: null,
  endsAt: null,
  source: "user",
  pinned: false,
  updatedAt: new Date("2026-08-18T00:00:00.000Z"),
}];

const ONE_IMAGE: StuffItem[] = [{
  id: "gen:g1",
  source: "gen",
  label: "Nasi lemak plate",
  url: "https://cdn.test/nasi.png",
  mediaKind: "image",
  generationId: "g1",
  assetId: "asset_1",
}];

async function mountBrand(opts: { tab?: string; records?: BrandRecordRow[]; items?: StuffItem[] } = {}) {
  if (opts.tab) searchParams.value = new URLSearchParams(`tab=${opts.tab}`);
  return mount(createElement(OttoMemory, {
    initialMemory: [],
    initialRecords: opts.records ?? [],
    projectId: "proj_1",
    stuffItems: opts.items ?? [],
  }));
}

function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
}

/**
 * 等**那件事真的发生**,而不是等一段时间(#1030)。
 *
 * Radix 的 roving focus 不在按键那一刻搬焦点:`RovingFocusGroupItem` 的 `onKeyDown` 把
 * `focusFirst(candidateNodes)` 塞进一个 `setTimeout(…)` 里
 * (`@radix-ui/react-roving-focus`,1.1.13 的 dist 第 180 行)。而 `await act(...)` 保证的
 * 是「React 的活干完了、微任务排空了」——**它不保证 Node 的定时器队列轮到过**。于是
 * 「焦点走没走到下一个页签」变成一场和 1ms 定时器的赛跑:文件顺序一换、机器负载一变,
 * 同一份代码就一半绿一半红。#1030 记的三次独立观察,失败字节永远是同一句
 * `expected 'About the brand' to be 'Look & feel'` —— 焦点停在第一个页签上没动。
 *
 * 所以这里等的是条件本身:成立的那一刻就返回(通常第一轮就成立),没有 sleep、没有重试壳、
 * 没有放宽断言。只有那件事**真的没发生**才会耗到截止线,而那时下面的断言照常打印真实差异 ——
 * roving focus 真坏了,这条用例还是红的。
 */
async function actUntil(settled: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!settled() && Date.now() < deadline) {
    // 让出一个宏任务:Radix 那个 setTimeout 只有在这里才轮得到跑。包在 act 里,是因为它跑出来的
    // 焦点变化会顺着 Radix Tabs 的 onFocus 触发 React 更新 —— 那更新必须还在 act 的作用域内。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// 门本身:谁进得来,以及地址栏说的是不是屏幕上的事(判官 P2-1 / P3-1)
// ───────────────────────────────────────────────────────────────────────────────

/** 真跑一次这张服务端页面。`redirect()` 按 Next 的语义抛出,所以这里要接住。 */
async function runBrandPage(query: Record<string, string> = {}): Promise<{ redirectedTo: string | null }> {
  try {
    await BrandPage({ searchParams: Promise.resolve(query) });
    return { redirectedTo: null };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT;")) throw error;
    return { redirectedTo: digest.slice("NEXT_REDIRECT;".length) };
  }
}

describe("W2-2 · /brand 这扇门自己的行为", () => {
  it("没登录的人到不了这一面 —— 守卫说不,页面就去登录页(判官 P2-1)", async () => {
    // 这条断言存在的理由:整个 W2-2 之前没有一条测试碰过「未认证」。而 `/brand` 上画的是
    // 商家的品牌资料与产品目录,守卫是这一面唯一的墙。它以前只是「看起来写对了」。
    requireOwnerMock.mockImplementation(async () => ({ error: "Not authorized." }) as never);
    const { redirectedTo } = await runBrandPage();
    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(redirectedTo).toBe("/login");
  });

  it("守卫说不的时候,一条商家数据都没读过", async () => {
    // 「先读了再拦」和「拦住了」在屏幕上一样,在租户边界上不一样。
    const { listMemory } = await import("@/lib/memory-actions");
    const { listBrandRecords } = await import("@/lib/brand-record-actions");
    requireOwnerMock.mockImplementation(async () => ({ error: "Not authorized." }) as never);
    await runBrandPage();
    expect(listMemory).not.toHaveBeenCalled();
    expect(listBrandRecords).not.toHaveBeenCalled();
  });

  it("?project= 指到别人的项目时,改地址栏 —— 不静默回落(判官 P3-1)", async () => {
    // `/otto` 一直是这么做的。静默回落会把一个假 id 留在地址栏上,而屏幕上的内容其实来自
    // 另一个项目 —— 刷新、分享、收藏带走的都是那个假 id。
    const { redirectedTo } = await runBrandPage({ project: "proj_someone_else" });
    expect(redirectedTo).toBe("/brand?project=proj_1");
  });

  it("纠正地址的时候不顺手把页签丢了", async () => {
    const { redirectedTo } = await runBrandPage({ project: "proj_someone_else", tab: "products" });
    expect(redirectedTo).toBe("/brand?project=proj_1&tab=products");
  });

  it("?project= 是自己的项目就不动地址栏", async () => {
    const { redirectedTo } = await runBrandPage({ project: "proj_2" });
    expect(redirectedTo).toBeNull();
  });

  it("不带 ?project= 也不动地址栏 —— 归一只对着那个假 id,不是对着每一次访问", async () => {
    const { redirectedTo } = await runBrandPage();
    expect(redirectedTo).toBeNull();
  });
});

describe("W2-2 ③ 诚实说明句(规格书 §4.4 的原话,一个字不许改)", () => {
  const HONEST_NOTE =
    "Brand is where Otto learns your business. Colors, fonts, and logo are not part of this " +
    "yet — what you write here is what Otto uses today.";

  it("逐字出现在页面顶部", async () => {
    const dom = await mountBrand();
    expect(dom.textContent).toContain(HONEST_NOTE);
  });

  it("它在标题那一段里,不是埋在页签内容里", async () => {
    const dom = await mountBrand();
    const heading = dom.querySelector("h1");
    expect(heading?.textContent?.trim()).toBe("Brand memory");
    // 说明句必须排在第一个页签之前 —— 「说实话」是先说,不是补在后面。
    const text = dom.textContent ?? "";
    expect(text.indexOf(HONEST_NOTE)).toBeGreaterThan(-1);
    expect(text.indexOf(HONEST_NOTE)).toBeLessThan(text.indexOf(SECTIONS[0].label));
  });

  it("旧的那句话还在 —— 这一句是补的实话,不是把原话换掉", async () => {
    // #682 的逐句钉板(otto-pronoun-consistency)也钉着这一句;两处一起红比一处红好。
    const dom = await mountBrand();
    expect(dom.textContent).toContain("What Otto remembers about your brand — Otto uses it in every project.");
  });
});

describe("W2-2 ② 手搓 tablist 退场,换成 ui/tabs(规格书 §5.6 ②)", () => {
  it("源码里没有手写的 tablist / tab 角色 —— 剥掉注释之后一处都不剩", () => {
    const text = code("components/otto/OttoMemory.tsx");
    expect(text, "手搓 tablist 又回来了").not.toContain('role="tablist"');
    expect(text, "手搓 tab 又回来了").not.toContain('role="tab"');
    expect(source("components/otto/OttoMemory.tsx")).toContain('from "@/components/ui/tabs"');
  });

  it("六个页签照旧,一个不少 —— 名单取自 core 的 SECTIONS,不在这里抄第二份", async () => {
    const dom = await mountBrand();
    const tabs = Array.from(dom.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(SECTIONS.map((s) => s.label));
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("整条页签栏只占一个 Tab 停靠点(roving tabindex)—— 手搓那版是六个", async () => {
    const dom = await mountBrand();
    expect(dom.querySelector('[role="tablist"]')?.getAttribute("tabindex")).toBe("0");
    const tabs = Array.from(dom.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(SECTIONS.length);
    expect(tabs.filter((t) => t.getAttribute("tabindex") !== "-1")).toEqual([]);
  });

  it("方向键在页签之间走 —— 手搓那版按了什么都不会发生", async () => {
    const dom = await mountBrand();
    const tabs = Array.from(dom.querySelectorAll<HTMLElement>('[role="tab"]'));
    const [first, second] = tabs;

    await act(async () => { first.focus(); });
    // 先钉住起点。焦点还没落到页签上时,方向键本来就什么都不该发生 —— 那种失败必须长得像
    // 「焦点没进来」,不能伪装成「roving focus 坏了」。
    expect(document.activeElement, "方向键还没按,焦点就不在第一个页签上").toBe(first);

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    // 焦点推进是 Radix 推迟到宏任务里干的 —— 等它真的发生,而不是赌它已经发生(见 actUntil)。
    await actUntil(() => document.activeElement === second);

    expect(document.activeElement?.textContent?.trim()).toBe(SECTIONS[1].label);
    // 页签是 URL 的一部分(?tab=),所以「换页签」这件事在这一面就是换地址。
    expect(routerReplace).toHaveBeenCalledWith(`/brand?tab=${SECTIONS[1].key}`, { scroll: false });
  });

  it("每个页签都有自己的一块内容,而且只有选中的那一块画得出来", async () => {
    const dom = await mountBrand({ tab: "products", records: A_PRODUCT });
    const panels = Array.from(dom.querySelectorAll('[role="tabpanel"]'));
    expect(panels).toHaveLength(SECTIONS.length);
    const shown = panels.filter((p) => !p.hasAttribute("hidden"));
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent).toContain("Sambal bottle");
  });
});

describe("W2-2 ② 手搓图片弹窗退场,换成 ui/dialog(规格书 §5.6 ①)", () => {
  it("源码里没有那个自制的整屏遮罩 —— 剥掉注释之后一处都不剩", () => {
    expect(code("components/otto/OttoMemory.tsx"), "手搓弹窗又回来了").not.toContain("fixed inset-0");
    expect(source("components/otto/OttoMemory.tsx")).toContain('from "@/components/ui/dialog"');
  });

  async function openPicker(): Promise<HTMLElement> {
    const dom = await mountBrand({ tab: "products", records: A_PRODUCT, items: ONE_IMAGE });
    const add = buttonWithText(dom, "Add image · from Library");
    expect(add, "产品卡上的「从 Library 选图」入口不见了").toBeTruthy();
    await act(async () => { add!.click(); });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog, "点开之后没有任何一个 role=dialog —— 读屏软件不知道有东西打开了").toBeTruthy();
    return dialog!;
  }

  it("打开之后真的是一个有名字的弹窗(手搓那版连 role 都没有)", async () => {
    const dialog = await openPicker();
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy, "弹窗没有可访问名字 —— 读屏软件只会念出一堆内容,不知道这是什么").toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe("Choose an image from Library");
    expect(dialog.getAttribute("aria-describedby"), "弹窗没有说明").toBeTruthy();
    expect(dialog.textContent).toContain("Nasi lemak plate");
  });

  it("焦点被关进弹窗里 —— 打开之后键盘走不到背后那一页", async () => {
    const dialog = await openPicker();
    expect(dialog.contains(document.activeElement), "焦点还留在弹窗外面").toBe(true);
  });

  it("Escape 关掉它(手搓那版只认点遮罩,键盘用户没有出路)", async () => {
    const dialog = await openPicker();
    await act(async () => {
      // `cancelable: true` 是必须的(判官 P3-4)。默认的 KeyboardEvent 不可取消,
      // 而 Radix 的关闭路径要先 `preventDefault()` 才算数 —— 事件不可取消时,
      // 「有人挂了 onEscapeKeyDown 并把关闭拦下来」这类回归在这条断言里根本演不出来:
      // 判官第一发 Escape 变异没红,原因就在这一行。
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="dialog"]'), "按了 Escape 还开着").toBeNull();
  });

  it("选一张图就把它设成产品图,并且把弹窗收起来", async () => {
    const { saveBrandRecord } = await import("@/lib/brand-record-actions");
    const dialog = await openPicker();
    const tile = buttonWithText(dialog, "Nasi lemak plate");
    expect(tile, "弹窗里没有可点的图").toBeTruthy();
    await act(async () => { tile!.click(); });
    expect(saveBrandRecord).toHaveBeenCalledWith(expect.objectContaining({
      id: "rec_1",
      kind: "product",
      data: expect.objectContaining({ name: "Sambal bottle", imageAssetId: "asset_1" }),
    }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// #977:浏览器把 sessionStorage 锁上时,/brand 这扇门仍然开得了
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Chrome 的「阻止所有 Cookie」不是让 `getItem` 返回空 —— 它让**读 `sessionStorage` 这个属性
 * 本身**抛 SecurityError。抛点在属性上,是这几条用例的全部要害:任何
 * `window.sessionStorage.xxx()` 的裸取,都会在拿到那个方法之前就炸。
 *
 * 而 W2-2 之后 `OttoMemory` 就是 `/brand` 这条顶层路由的**全部页面内容**
 * (`app/brand/page.tsx`),它的 useEffect 同步体里抛一次,商家看到的不是「聊天记不住」,
 * 是整面品牌资料白屏。
 *
 * 还原函数必须调 —— 否则后面每一条用例的 `beforeEach`(`sessionStorage.clear()`)会跟着炸。
 */
function denySessionStorage(): () => void {
  const own = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get() {
      throw new DOMException("Access is denied for this document.", "SecurityError");
    },
  });
  return () => {
    delete (window as unknown as Record<string, unknown>).sessionStorage;
    if (own) Object.defineProperty(window, "sessionStorage", own);
  };
}

/** 指针的键由组件按 projectId 拼(`mountBrand` 挂的是 proj_1)。 */
const THREAD_KEY = "fikirtive:otto-brand-thread:proj_1";

function aThread(texts: string[]): Awaited<ReturnType<typeof getCoworkThreadClient>> {
  return {
    id: "thread_brand",
    projectId: "proj_1",
    title: "Brand",
    updatedAt: "2026-08-18T00:00:00.000Z",
    messages: texts.map((text, i) => ({
      id: `m_${i}`, role: "AGENT" as const, kind: "TEXT" as const, seq: i,
      text, payload: null, genJobId: null, createdAt: "2026-08-18T00:00:00.000Z",
    })),
  };
}

/** 在输入框里打一句话再按 Send(受控 textarea:得走原生 setter 才触发得了 onChange)。 */
async function say(dom: HTMLDivElement, text: string) {
  const box = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Tell Otto about your brand"]')!;
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const send = [...dom.querySelectorAll("button")].find((b) => b.textContent?.includes("Send"))!;
  await act(async () => send.click());
}

describe("#977 · 浏览器锁上 sessionStorage 时,/brand 仍然开得了", () => {
  afterEach(() => {
    // 这一段自己装的实现不许漏给别的用例(clearAllMocks 只清调用记录,不清实现)。
    vi.mocked(ottoTurn).mockReset();
    vi.mocked(getCoworkThreadClient).mockReset();
  });

  it("这把锁是真的:读 sessionStorage 这个属性本身就抛 SecurityError", () => {
    const restore = denySessionStorage();
    try {
      expect(() => globalThis.sessionStorage).toThrowError(/denied/i);
    } finally {
      restore();
    }
    expect(() => globalThis.sessionStorage).not.toThrow();
  });

  it("整面照常画得出来 —— 不打到错误边界(白屏)", async () => {
    const restore = denySessionStorage();
    try {
      const dom = await mountBrand();
      expect(dom.querySelector("h1")?.textContent?.trim()).toBe("Brand memory");
      expect(dom.querySelectorAll('[role="tab"]')).toHaveLength(SECTIONS.length);
    } finally {
      restore();
    }
  });

  it("聊天照常发得出去,只是记不住指针 —— 存不了就当没记", async () => {
    vi.mocked(ottoTurn).mockResolvedValue({ threadId: "thread_brand", status: "done", reply: "Saved that." });
    vi.mocked(getCoworkThreadClient).mockResolvedValue(aThread(["Saved that."]));
    const restore = denySessionStorage();
    try {
      const dom = await mountBrand();
      await say(dom, "We sell hand-poured candles.");
      expect(ottoTurn).toHaveBeenCalledTimes(1);
      expect(dom.textContent, "锁上之后连一句话都发不出去了").toContain("Saved that.");
    } finally {
      restore();
    }
    // 锁打开之后回头看:一条指针都没落地 —— 写不进去就是没写,不留半截。
    expect(window.sessionStorage.getItem(THREAD_KEY)).toBeNull();
  });

  it("锁没上的时候,记住的会话照旧续得上(加守卫不许把这条弄回归)", async () => {
    window.sessionStorage.setItem(THREAD_KEY, "thread_brand");
    vi.mocked(getCoworkThreadClient).mockResolvedValue(aThread(["Saved that."]));
    vi.mocked(ottoTurn).mockResolvedValue({ threadId: "thread_brand", status: "done", reply: "Noted." });

    const dom = await mountBrand();
    expect(getCoworkThreadClient, "重挂时没去读记住的那条会话").toHaveBeenCalledWith("thread_brand");
    expect(dom.textContent).toContain("Saved that.");

    await say(dom, "Our customers are gift buyers.");
    expect(ottoTurn, "下一句话另开了一条新会话").toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: "thread_brand" }),
    );
    expect(window.sessionStorage.getItem(THREAD_KEY)).toBe("thread_brand");
  });
});
