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
 * #606(D7 · T7 第二刀)再加两条:④ **假页清零** —— 整座设计稿画廊 `/northstar` 与剩下的
 * 6 页 mock 从树里删掉,北极星组件树只剩真外壳自己的三件零件;⑤ **预览开关退场** ——
 * 那个让北极星路由在生产上 404 的环境变量,全仓一处不剩(名字由下面 RETIRED_PREVIEW_FLAG
 * 拼出来,所以本文件自己不构成残引);登录墙不再把 northstar 前缀排除在外。
 * (未登录访问真路由会发生什么,由 northstar-routes-auth.test.ts 钉。)
 *
 * 全程零后端、零生成:只渲染导航这一个纯前端组件,其余是文件系统与源码读取。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "../..");
const REPO_ROOT = resolve(WEB_ROOT, "../..");
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
  // #606 T7 第二刀 —— 剩下的 6 页 mock。其中 cityhall/admin 是一座**假的内部运维台**
  // (写死 environment "fikirtive-prod" 与假 commit),onboarding/login 是与真 /login
  // 打架的第二个登录页。开关删除后它们没有第二道门可躲,所以是删,不是关。
  "app/northstar-immersive/cityhall/admin/page.tsx",
  "app/northstar-immersive/global/legal/page.tsx",
  "app/northstar-immersive/global/notifications/page.tsx",
  "app/northstar-immersive/global/search/page.tsx",
  "app/northstar-immersive/onboarding/checklist/page.tsx",
  "app/northstar-immersive/onboarding/login/page.tsx",
] as const;

/** 整座设计稿画廊(`/northstar`)—— 目录级退场,不是逐页删。 */
const RETIRED_GALLERY_ROOT = "app/northstar";

/** 假页走后,北极星组件树里只剩这三件东西 —— 都是真外壳自己的零件。 */
const SURVIVING_NORTHSTAR_COMPONENTS = [
  "components/northstar/immersive/deeplink-fallback.tsx",
  "components/northstar/immersive/immersive-nav.tsx",
  "components/northstar/immersive/immersive-shell.tsx",
] as const;

/** 预览开关 —— 名字本身就是残引,源码、脚本、配置与文档里一处都不许剩。 */
const RETIRED_PREVIEW_FLAG = ["NORTHSTAR", "PREVIEW"].join("_");
const FLAG_SCAN_ROOTS = ["apps", "packages", "scripts", "docs", ".github"] as const;
const FLAG_SCAN_SKIP = new Set(["node_modules", ".next", "dist", ".turbo", "coverage", ".git"]);

function filesUnder(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (FLAG_SCAN_SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

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

async function renderNav(identity: { name: string; email: string }) {
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

  // 「没登录就不冒充任何人」这条搬去了 northstar-routes-auth.test.ts:#606 之后未登录根本
  // 走不到导航 —— 受控入口先 redirect("/login")。导航因此不再有「未登录形态」可测。

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
    const reachable = reachableSources(SHELL_ENTRIES);
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
    /** 壳里合法的目的地只有这两条 —— 其余任何 `/northstar…` 开头的**链接**都是残引。 */
    const LIVE_HREFS = ["/northstar-immersive", "/northstar-immersive/create/canvas"];
    // 只看链接,不看散文:先剥掉注释(注释里提退役路由是在交代历史,不是把人送过去),
    // 再抓引号/反引号后面紧跟着的 `/northstar…` 字面量。`@/components/northstar/…`
    // 这类 import 路径不以 `/northstar` 开头,天然不在内。
    const HREF_RE = /["'`](\/northstar[^"'`\s]*)/g;
    const reachable = reachableSources(SHELL_ENTRIES);
    const hits: string[] = [];
    for (const [file, source] of reachable) {
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        // 模板串写法 `${BASE}/create/canvas` 也算 —— BASE 就是这条前缀。
        .replace(/\$\{BASE\}/g, "/northstar-immersive");
      for (const match of code.matchAll(HREF_RE)) {
        const href = match[1].split("?")[0].replace(/\/$/, "");
        if (!LIVE_HREFS.includes(href)) hits.push(`${file.slice(WEB_ROOT.length + 1)} :: ${match[1]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("外壳路由目录里只剩裁决留下的这些页", () => {
    expect(existsSync(resolve(SHELL_ROOT, "page.tsx"))).toBe(true);
    expect(existsSync(resolve(SHELL_ROOT, "create/canvas/page.tsx"))).toBe(true);
    expect(existsSync(resolve(SHELL_ROOT, "create/home"))).toBe(false);
    // 目录级枚举:这个路由组里的 page.tsx 恰好只有真 Home 与真 Canvas 两个,一个不多。
    const pages = filesUnder(SHELL_ROOT)
      .filter((file) => file.endsWith("page.tsx"))
      .map((file) => relative(SHELL_ROOT, file))
      .sort();
    expect(pages).toEqual(["create/canvas/page.tsx", "page.tsx"]);
  });
});

/* ── ④ #606 T7 第二刀:假页清零 + 预览开关退场 ────────────────────────────── */

describe("假页清零", () => {
  it("整座设计稿画廊 /northstar 不在树里了", () => {
    expect(existsSync(resolve(WEB_ROOT, RETIRED_GALLERY_ROOT))).toBe(false);
  });

  it("北极星组件树里只剩真外壳自己的零件", () => {
    const root = resolve(WEB_ROOT, "components/northstar");
    const left = filesUnder(root)
      .map((file) => relative(WEB_ROOT, file))
      .sort();
    expect(left).toEqual([...SURVIVING_NORTHSTAR_COMPONENTS].sort());
  });

  it("留下的每一件都真的被两条真路由用着(没有留下孤儿)", () => {
    const reachable = new Set(
      [...reachableSources(SHELL_ENTRIES).keys()].map((file) => relative(WEB_ROOT, file)),
    );
    const orphans = SURVIVING_NORTHSTAR_COMPONENTS.filter((file) => !reachable.has(file));
    expect(orphans).toEqual([]);
  });
});

describe("预览开关退场", () => {
  it("全仓再没有一处提到这个开关(源码、脚本、配置、文档)", () => {
    const hits: string[] = [];
    for (const root of FLAG_SCAN_ROOTS) {
      for (const file of filesUnder(resolve(REPO_ROOT, root))) {
        let source: string;
        try {
          if (statSync(file).size > 2_000_000) continue; // 跳过二进制/大文件
          source = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        // 本文件自己会拼出这个名字来做断言,不算残引。
        if (resolve(file) === resolve(fileURLToPath(import.meta.url))) continue;
        if (source.includes(RETIRED_PREVIEW_FLAG)) hits.push(relative(REPO_ROOT, file));
      }
    }
    expect(hits).toEqual([]);
  });

  it("三个受控入口里再没有生产环境的 404 分支", () => {
    for (const entry of [
      "components/canvas/NorthstarShellEntry.tsx",
      "components/canvas/NorthstarHomeEntry.tsx",
      "components/canvas/ImmersiveCanvasEntry.tsx",
    ]) {
      const source = readFileSync(resolve(WEB_ROOT, entry), "utf8");
      expect(source, entry).not.toContain("notFound");
    }
  });

  it("登录墙 matcher 不再把 northstar 排除在外", () => {
    const proxySource = readFileSync(resolve(WEB_ROOT, "proxy.ts"), "utf8");
    const matcher = /matcher:\s*\[([^\]]*)\]/.exec(proxySource)?.[1] ?? "";
    expect(matcher).not.toContain("northstar");
  });
});
