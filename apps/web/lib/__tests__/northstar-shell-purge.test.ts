// @vitest-environment jsdom
/**
 * 北极星外壳净化(#609 · 2026-08-02 Founder 逐页裁决 · 父规格 #599)
 *
 * 裁决三条,这里各钉一条断言:
 *   ① 六扇门 —— 创作版导航只剩 Home · Canvas · Library · 品牌与商品资料 · 买积分账单 ·
 *      设置。逐门指向仓库里真正存在的路由文件(四扇通向线上产品,两扇留在壳内)。
 *   ② 假物清零 —— 导航栏渲染的是**登录进来的这个人**(名 + 邮箱由认证会话喂进来),
 *      不是写死的样板商家;写死余额与 Top up 连同它们的入口一起没了。
 *   ③ 六页退场 + 假 Otto 砍除 —— 被裁的路由文件不再存在(直开 = 404),外壳不再挂
 *      那个会编造经营事实的假 Otto 小窗,只留一颗跳真对话的按钮。
 *
 * 最硬的一条是「壳的自有表面碰不到任何一份样板数据」:从 layout / Home / Canvas 三个入口
 * 顺着 import 走遍可达源码,里面不许出现北极星样板模块(_mock / global/_data / _store /
 * _selectors),也不许出现「This will spend real credits」「upgrade ticket」「1,240」。
 * 这条不靠外观蒙混 —— 改前它是红的(layout → 外壳 → _store;Home → 假首页 → _mock)。
 *
 * 全程零后端、零生成:只渲染导航这一个纯前端组件,其余是文件系统与源码读取。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "../..");
const SHELL_ROOT = resolve(WEB_ROOT, "app/northstar-immersive");

vi.mock("next/navigation", () => ({
  usePathname: () => "/northstar-immersive",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

/** 六扇门 —— 顺序即导航从上到下的顺序。 */
const DOORS: ReadonlyArray<{ label: string; href: string; route: string }> = [
  { label: "Home", href: "/northstar-immersive", route: "app/northstar-immersive/page.tsx" },
  { label: "Canvas", href: "/northstar-immersive/create/canvas", route: "app/northstar-immersive/create/canvas/page.tsx" },
  { label: "Library", href: "/otto?view=library", route: "app/otto/page.tsx" },
  { label: "Brand & products", href: "/otto?view=memory", route: "app/otto/page.tsx" },
  { label: "Credits & billing", href: "/billing", route: "app/billing/page.tsx" },
  { label: "Settings", href: "/otto?view=account", route: "app/otto/page.tsx" },
];

/** 被裁的路由:文件不在 = 直开 404。 */
const RETIRED_ROUTES = [
  "app/northstar-immersive/create/home/page.tsx",
  "app/northstar-immersive/create/factory/page.tsx",
  "app/northstar-immersive/create/storyboard/page.tsx",
  "app/northstar-immersive/create/ideas/page.tsx",
  "app/northstar-immersive/create/asset-viewer/page.tsx",
  "app/northstar-immersive/create/media-editor/page.tsx",
  "app/northstar-immersive/otto/page.tsx",
  "app/northstar-immersive/global/otto-chat/page.tsx",
] as const;

/* ── 可达源码遍历:从入口顺着 import 走,收集本仓内的每一个源文件 ────────────────── */

const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function resolveSource(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = resolve(WEB_ROOT, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return null; // 包依赖(next / react / @fikirtive/*)不进遍历
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

function reachableSources(entries: readonly string[]): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = entries.map((entry) => resolve(WEB_ROOT, entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    seen.set(file, source);
    for (const match of source.matchAll(IMPORT_RE)) {
      const next = resolveSource(match[1], file);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

/** 外壳自有表面的三个入口:常驻壳 + 留在壳内的两扇门。 */
const SHELL_ENTRIES = [
  "app/northstar-immersive/layout.tsx",
  "app/northstar-immersive/page.tsx",
  "app/northstar-immersive/create/canvas/page.tsx",
] as const;

/** 北极星样板数据模块 —— 壳的自有表面一份都碰不到。 */
const FIXTURE_MODULES = [
  "components/northstar/_mock",
  "components/northstar/global/_data",
  "components/northstar/immersive/_store",
  "components/northstar/immersive/_selectors",
] as const;

/** 空头承诺与内部黑话 —— 商家不该在壳里读到的字。 */
const BANNED_COPY = ["This will spend real credits", "upgrade ticket", "1,240"] as const;

/* ── 渲染 ────────────────────────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function renderNav(identity: { name: string; email: string } | null) {
  const { ImmersiveNav } = await import("@/components/northstar/immersive/immersive-nav");
  await act(async () => {
    root.render(createElement(ImmersiveNav, { identity }));
  });
  const nav = container.querySelector("nav");
  if (!nav) throw new Error("nav did not render");
  return nav;
}

function navHrefs(nav: Element): string[] {
  const seen: string[] = [];
  for (const anchor of Array.from(nav.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href")!;
    if (!seen.includes(href)) seen.push(href);
  }
  return seen;
}

/* ── ① 六扇门 ───────────────────────────────────────────────────────────────── */

describe("六扇门", () => {
  it("导航恰好通向这六个目的地,顺序照裁决", async () => {
    const nav = await renderNav({ name: "Nurul Huda", email: "nurul@warungnurul.my" });
    expect(navHrefs(nav)).toEqual(DOORS.map((door) => door.href));
  });

  it("六个门牌都写着人话标签", async () => {
    const nav = await renderNav({ name: "Nurul Huda", email: "nurul@warungnurul.my" });
    for (const door of DOORS) expect(nav.textContent).toContain(door.label);
  });

  it("每一扇门背后都有一个真的路由文件", () => {
    for (const door of DOORS) {
      expect(existsSync(resolve(WEB_ROOT, door.route)), `${door.label} → ${door.route}`).toBe(true);
    }
  });

  it("导航里再没有第七条通往任何别处的路", async () => {
    const nav = await renderNav({ name: "Nurul Huda", email: "nurul@warungnurul.my" });
    const stray = navHrefs(nav).filter((href) => !DOORS.some((door) => door.href === href));
    expect(stray).toEqual([]);
  });
});

/* ── ② 假物清零 ─────────────────────────────────────────────────────────────── */

describe("假物清零", () => {
  it("身份栏写的是登录进来的这个人", async () => {
    const nav = await renderNav({ name: "Nurul Huda", email: "nurul@warungnurul.my" });
    expect(nav.textContent).toContain("Nurul Huda");
    expect(nav.textContent).toContain("nurul@warungnurul.my");
  });

  it("没登录就不冒充任何人", async () => {
    const nav = await renderNav(null);
    expect(nav.textContent).not.toContain("Nurul Huda");
    expect(nav.textContent).toContain("Sign in");
  });

  it("写死的余额与 Top up 入口都不在了", async () => {
    const nav = await renderNav({ name: "Nurul Huda", email: "nurul@warungnurul.my" });
    expect(nav.textContent).not.toContain("Top up");
    expect(nav.textContent).not.toMatch(/\d[\d,]*\s*credits/);
  });

  it("壳的自有表面碰不到任何一份北极星样板数据", () => {
    const sources = reachableSources(SHELL_ENTRIES);
    const hits: string[] = [];
    for (const file of sources.keys()) {
      for (const fixture of FIXTURE_MODULES) {
        if (file.includes(fixture)) hits.push(file.slice(WEB_ROOT.length + 1));
      }
    }
    expect(hits).toEqual([]);
  });

  it("壳的自有表面读不到空头承诺与内部黑话", () => {
    const hits: string[] = [];
    for (const [file, source] of reachableSources(SHELL_ENTRIES)) {
      for (const phrase of BANNED_COPY) {
        if (source.includes(phrase)) hits.push(`${file.slice(WEB_ROOT.length + 1)} :: ${phrase}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

/* ── ③ 六页退场 + 假 Otto 砍除 ──────────────────────────────────────────────── */

describe("退场", () => {
  it("被裁的路由文件都不在了(直开 404)", () => {
    const alive = RETIRED_ROUTES.filter((route) => existsSync(resolve(WEB_ROOT, route)));
    expect(alive).toEqual([]);
  });

  it("外壳不再挂那个会编造经营事实的假 Otto 小窗", () => {
    const shell = readFileSync(resolve(WEB_ROOT, "components/northstar/immersive/immersive-shell.tsx"), "utf8");
    expect(shell).not.toContain("immersive-dock");
  });

  it("壳里那一颗 Otto 按钮跳的是真对话", () => {
    const shell = readFileSync(resolve(WEB_ROOT, "components/northstar/immersive/immersive-shell.tsx"), "utf8");
    expect(shell).toContain('"/otto"');
    expect(shell).not.toContain("/northstar-immersive/otto");
  });

  it("退役组件不再被壳里任何一页引用", () => {
    const reachable = reachableSources([
      ...SHELL_ENTRIES,
      ...["global/legal", "global/notifications", "global/search", "onboarding/checklist", "onboarding/login", "cityhall/admin"].map(
        (segment) => `app/northstar-immersive/${segment}/page.tsx`,
      ),
    ]);
    const retiredComponents = [
      "immersive/immersive-dock",
      "immersive/immersive-home",
      "immersive/otto-fullscreen",
      "immersive/studio-factory/studio-",
    ];
    const hits = [...reachable.keys()].filter((file) =>
      retiredComponents.some((component) => file.includes(component)),
    );
    expect(hits).toEqual([]);
  });

  it("壳里没有任何一条链接指向已退场的路由", () => {
    const retiredHrefs = [
      "/northstar-immersive/create/home",
      "/northstar-immersive/create/factory",
      "/northstar-immersive/create/storyboard",
      "/northstar-immersive/create/ideas",
      "/northstar-immersive/create/asset-viewer",
      "/northstar-immersive/create/media-editor",
    ];
    const reachable = reachableSources([
      ...SHELL_ENTRIES,
      ...["global/legal", "global/notifications", "global/search", "onboarding/checklist", "onboarding/login", "cityhall/admin"].map(
        (segment) => `app/northstar-immersive/${segment}/page.tsx`,
      ),
    ]);
    const hits: string[] = [];
    for (const [file, source] of reachable) {
      // 模板串写法 `${BASE}/create/home` 也算 —— BASE 就是这条前缀。
      const normalised = source.replace(/\$\{BASE\}/g, "/northstar-immersive");
      for (const href of retiredHrefs) {
        if (normalised.includes(href)) hits.push(`${file.slice(WEB_ROOT.length + 1)} :: ${href}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("外壳路由目录里只剩裁决留下的这些页", () => {
    expect(existsSync(resolve(SHELL_ROOT, "page.tsx"))).toBe(true);
    expect(existsSync(resolve(SHELL_ROOT, "create/canvas/page.tsx"))).toBe(true);
    expect(existsSync(resolve(SHELL_ROOT, "create/home"))).toBe(false);
  });
});
