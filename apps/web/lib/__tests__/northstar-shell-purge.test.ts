/**
 * 北极星外壳净化(#609 · 2026-08-02 Founder 逐页裁决 · 父规格 #599)
 *
 * 裁决三条,这里各钉一条断言:
 *   ① 六扇门 —— **#801 起它们合流进主导航**:六个目的地一个不少地在
 *      `@fikirtive/core` 的 MERCHANT_NAV 里各有位置(Home 与 Canvas 合成主导航第一格
 *      Create,另外四扇本来就是主导航自己的门),而这层壳不再自建第二套导航。
 *      「活着但没门」与「两套导航各自漂移」这两种中间态一起消失。
 *   ② 假物清零 —— 商家的名字、邮箱、余额与 Sign out 只在全局导轨里写一次;这层壳里
 *      不许再出现写死的样板商家、写死余额或 Top up 入口。
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
 * 全程零后端、零生成、零渲染:全部是文件系统、源码读取与那份纯数据导航树。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CANVAS_HREF,
  CREATE_NAV_HREF,
  OTTO_ASSISTANT,
  everyNavDestination,
} from "@fikirtive/core/navigation";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "../..");
const REPO_ROOT = resolve(WEB_ROOT, "../..");
/** 外壳路由组的家。W2-5 起它叫 `app/create` —— `northstar-immersive` 是内部代号,不再是地址。 */
const SHELL_ROOT = resolve(WEB_ROOT, "app/create");

/**
 * 原来的六扇门 —— 每一扇现在的去处。
 *
 * `door` = 裁决当时的门牌;`livesAt` = 合流后它在主导航里的真实目的地;`route` = 那个
 * 目的地背后的真路由文件。Home 与 Canvas 合并成一格 Create:创作首页列着商家自己的每一张
 * 画布,点开就在画布上,所以主导航不再单列 Canvas 一行 —— 但它必须仍然在那扇门后面。
 */
const DOORS: ReadonlyArray<{ door: string; livesAt: string; route: string }> = [
  { door: "Home", livesAt: CREATE_NAV_HREF, route: "app/create/page.tsx" },
  { door: "Canvas", livesAt: CANVAS_HREF, route: "app/create/canvas/page.tsx" },
  { door: "Library", livesAt: "/otto?view=library", route: "app/otto/page.tsx" },
  { door: "Brand & products", livesAt: "/otto?view=memory", route: "app/otto/page.tsx" },
  { door: "Credits & billing", livesAt: "/billing", route: "app/billing/page.tsx" },
  { door: "Settings", livesAt: "/otto?view=account", route: "app/otto/page.tsx" },
];

/**
 * 被裁的路由:文件不在 = 直开 404。
 *
 * W2-5 改名之后它们按**新**根写:旧 `/northstar-immersive/create/home` 在新地址体系里就是
 * `/create/home`。改名不是复活的借口 —— 一个都不许借着搬家回来。
 */
const RETIRED_ROUTES = [
  "app/create/home/page.tsx",
  "app/create/factory/page.tsx",
  "app/create/storyboard/page.tsx",
  "app/create/ideas/page.tsx",
  "app/create/asset-viewer/page.tsx",
  "app/create/media-editor/page.tsx",
  "app/create/otto/page.tsx",
  "app/create/global/otto-chat/page.tsx",
  // #606 T7 第二刀 —— 剩下的 6 页 mock。其中 cityhall/admin 是一座**假的内部运维台**
  // (写死 environment "fikirtive-prod" 与假 commit),onboarding/login 是与真 /login
  // 打架的第二个登录页。开关删除后它们没有第二道门可躲,所以是删,不是关。
  "app/create/cityhall/admin/page.tsx",
  "app/create/global/legal/page.tsx",
  "app/create/global/notifications/page.tsx",
  "app/create/global/search/page.tsx",
  "app/create/onboarding/checklist/page.tsx",
  "app/create/onboarding/login/page.tsx",
] as const;

/** 整座设计稿画廊(`/northstar`)—— 目录级退场,不是逐页删。 */
const RETIRED_GALLERY_ROOT = "app/northstar";

/** 假页走后,北极星组件树里只剩这两件东西 —— 都是真外壳自己的零件。
 *  (#801:自有导航 immersive-nav.tsx 随六扇门合流一起退场。) */
const SURVIVING_NORTHSTAR_COMPONENTS = [
  "components/northstar/immersive/deeplink-fallback.tsx",
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
  "app/create/layout.tsx",
  "app/create/page.tsx",
  "app/create/canvas/page.tsx",
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

/* ── ① 六扇门合流进主导航 ─────────────────────────────────────────────────── */

describe("六扇门合流", () => {
  it("六扇门一扇不少地在主导航权威源里各有位置", () => {
    const destinations = everyNavDestination().map((item) => item.href);
    const homeless = DOORS.filter(
      // Canvas 是 Create 那扇门后面的东西(创作首页列着每一张画布),不必自己占一格。
      (door) => door.livesAt !== CANVAS_HREF && !destinations.includes(door.livesAt),
    );
    expect(homeless.map((door) => door.door)).toEqual([]);
  });

  it("画布仍然在 Create 那扇门后面 —— 没有被下线", () => {
    expect(CANVAS_HREF.startsWith(`${CREATE_NAV_HREF}/`)).toBe(true);
    expect(everyNavDestination().some((item) => item.href === CREATE_NAV_HREF)).toBe(true);
  });

  it("每一扇门背后都有一个真的路由文件", () => {
    for (const door of DOORS) {
      expect(existsSync(resolve(WEB_ROOT, door.route)), `${door.door} → ${door.route}`).toBe(true);
    }
  });

  it("这层壳不再自建第二套导航(自有导航组件已退场)", () => {
    expect(existsSync(resolve(WEB_ROOT, "components/northstar/immersive/immersive-nav.tsx"))).toBe(false);
    const shell = readFileSync(resolve(WEB_ROOT, "components/northstar/immersive/immersive-shell.tsx"), "utf8");
    expect(shell).not.toContain("ImmersiveNav");
    // 手机上那颗汉堡开的必须是**全局**抽屉,不是壳自己的第二个抽屉(#747 同一套交接)。
    expect(shell).toContain("useOpenGlobalNavigation");
  });
});

/* ── ② 假物清零 ─────────────────────────────────────────────────────────────── */

describe("假物清零", () => {
  it("身份、余额与 Top up 都不由这层壳来写", () => {
    const shell = readFileSync(resolve(WEB_ROOT, "components/northstar/immersive/immersive-shell.tsx"), "utf8");
    expect(shell).not.toContain("Top up");
    expect(shell).not.toMatch(/\d[\d,]*\s*credits/);
    // 身份栏随六扇门一起退场:名字、邮箱、余额与 Sign out 只在全局导轨里写一次。
    expect(shell).not.toContain("identity");
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
    // #801:地址不再抄在壳里,而是引权威源那一条助手常量 —— 解析出来仍然是 /otto。
    expect(shell).toContain("OTTO_ASSISTANT.href");
    expect(OTTO_ASSISTANT.href).toBe("/otto");
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
    // W2-5 之后这条更硬了:内部代号**一条链接都不许剩**。以前 `/northstar-immersive` 与
    // `/northstar-immersive/create/canvas` 是两条合法目的地(那时它们就是真地址);现在真地址
    // 叫 `/create`,所以任何 `/northstar…` 开头的字面量都只可能是没跟着搬家的残引。
    //
    // 只看链接,不看散文:先剥掉注释(注释里提退役路由是在交代历史,不是把人送过去),
    // 再抓引号/反引号后面紧跟着的 `/northstar…` 字面量。`@/components/northstar/…`
    // 这类 import 路径不以 `/northstar` 开头,天然不在内。
    const HREF_RE = /["'`](\/northstar[^"'`\s]*)/g;
    const reachable = reachableSources(SHELL_ENTRIES);
    const hits: string[] = [];
    for (const [file, source] of reachable) {
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const match of code.matchAll(HREF_RE)) {
        hits.push(`${file.slice(WEB_ROOT.length + 1)} :: ${match[1]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("外壳路由目录里只剩裁决留下的这些页", () => {
    expect(existsSync(resolve(SHELL_ROOT, "page.tsx"))).toBe(true);
    expect(existsSync(resolve(SHELL_ROOT, "canvas/page.tsx"))).toBe(true);
    expect(existsSync(resolve(SHELL_ROOT, "home"))).toBe(false);
    // 目录级枚举:这个路由组里的 page.tsx 恰好只有真 Create 与真 Canvas 两个,一个不多。
    const pages = filesUnder(SHELL_ROOT)
      .filter((file) => file.endsWith("page.tsx"))
      .map((file) => relative(SHELL_ROOT, file))
      .sort();
    expect(pages).toEqual(["canvas/page.tsx", "page.tsx"]);
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
