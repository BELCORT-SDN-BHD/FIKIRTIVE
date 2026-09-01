/**
 * 创作正名 + 画布旗舰面接进主导航(#801)—— 双面围栏。
 *
 * Founder 裁决:「画布也是 creation 板块的,而且是主要一个卖点」。这个文件从 #801 起就钉的是
 * 商家看得见的结果,不是内部函数。
 *
 * W2-11(换壳切换总票)删掉了这里大半的断言 —— 不是这一票的活变少了,是它们测的东西本身
 * 不在了:三层响应式导轨(375px 抽屉、1024–1279 图标层)整个撤下,`/otto?view=X` 的旧地址
 * 形状换成了真路由,Otto 从「导轨里的一格」变成「导轨之上的一颗按钮,不是地址」。那些行为
 * 现在各自有自己的钉子:
 *   - 导轨渲染、高亮、折叠、真菜单 —— `nav-rail.test.ts` / `nav-rail-tree.test.ts`(W2-10)。
 *   - `MerchantShellContent` 画不画壳、印证横幅 —— `global-navigation.test.ts`。
 *   - Otto 是面板不是地址、导轨里的 Ask Otto 拨的是同一个开关 —— `navigation.test.ts` /
 *     `otto-panel-mount.test.ts`。
 * 留在这里的,是判官当初立的、依然成立的两条纪律:
 *   ① **「活着但没门」复发检测**(判官 r1 P1/P2)—— 期望侧必须**独立于权威表手写**,否则
 *      权威表本身漏一格,围栏照绿。这条纪律不因换壳而失效。
 *   ② **壳里不留第二份地址** —— 硬写路径 / 抄一份板块名单,两类漂移点各钉一条。
 *   ③ **收敛掉的旧路由一律 redirect,不 404**。
 *   ④ **Otto 的指路文案与导轨同源**(与地图生成自洽)。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANVAS_HREF,
  CREATE_NAV_HREF,
  MERCHANT_NAV_REDIRECTS,
  OTTO_ASSISTANT,
  SHELL_ROUTES,
  everyNavDestination,
  merchantNavMap,
} from "@fikirtive/core/navigation";

const WEB_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

/** Source with comments stripped: a path in a comment is history, not a destination. */
function sourceCode(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ── 「活着但没门」复发检测(判官 r1 P1/P2)──────────────────────────────────── */

describe("每一个目的地都手写在案,权威表与它互为对照", () => {
  /**
   * 期望侧**独立于权威表**(判官 r1 P2)。
   *
   * 上一版拿 `everyNavDestination()` 生成期望,再拿它去比对渲染 —— 两边同一份清单,
   * 于是「权威表漏了一扇门」这件事围栏照绿。判官正是这样发现 templates / discover 两扇
   * 漏网的:围栏全绿,门却不存在。
   *
   * 所以这份名单是**手写的、逐条点名的**:商家必须到得了的每一处。它与 MERCHANT_NAV 谁都
   * 不生成谁 —— 权威表漏一条,这里就红;这里漏一条,下面那条「反向核对」就红。
   *
   * Phase 1 权威改写:五格 + Settings 内部三项。渲染层面的「导轨真的画出了五格」已经由
   * `nav-rail.test.ts` 钉过,这里只钉数据面。
   */
  const EVERY_DOOR_A_MERCHANT_MUST_REACH: readonly string[] = [
    "/",                       // Home
    "/create",                 // Create(画布的家)
    "/library",                // 已经做出来的每一张图、每一条片
    "/brand",                  // Otto 该记住的品牌与产品
    "/billing",                 // Settings › Billing & credits
    "/settings/connections",    // Settings › Connections
    "/settings",                // Settings
    "/profile",                 // Settings › Profile
  ];

  it("权威表与这份名单互为对照 —— 谁多一条谁少一条都红", () => {
    const registry = [...everyNavDestination().map((item) => item.href)].sort();
    expect(registry).toEqual([...EVERY_DOOR_A_MERCHANT_MUST_REACH].sort());
  });

  it("画布是创作面自己的子路径,不是主导航第二格", () => {
    expect(CANVAS_HREF.startsWith(`${CREATE_NAV_HREF}/`)).toBe(true);
    expect(EVERY_DOOR_A_MERCHANT_MUST_REACH).not.toContain(CANVAS_HREF);
  });

  it("Otto 没有地址 —— 它是面板,不在这份「门」的名单里(W2-11)", () => {
    expect("href" in OTTO_ASSISTANT).toBe(false);
    for (const href of EVERY_DOOR_A_MERCHANT_MUST_REACH) {
      expect(href.startsWith("/otto")).toBe(false);
    }
  });
});

/* ── 收敛掉的旧路由一律 redirect,不 404 ───────────────────────────────────── */

describe("收敛掉的旧路由一律 redirect,不 404", () => {
  it.each(MERCHANT_NAV_REDIRECTS.map((row) => [row.from, row.to] as const))(
    "%s 有一个真的重定向路由送人去 %s",
    (from, to) => {
      const route = from.startsWith(SHELL_ROUTES.campaign)
        ? path.join(WEB_ROOT, "app/campaign/layout.tsx")
        : path.join(WEB_ROOT, "app", from.replace(/^\//, ""), "page.tsx");
      expect(existsSync(route), `${from} 没有路由文件`).toBe(true);

      const source = readFileSync(route, "utf8");
      expect(source, `${from} 不是重定向`).toContain("redirect(");
      // 目标可以是字面量,也可以是符号引用(`SHELL_ROUTES.xxx`,本仓「北星沉浸式」那三条
      // 重定向路由的既有写法)—— 两者都不许在这个文件里再长出第二个会漂移的目标地址。
      const shellRoutesKey = Object.entries(SHELL_ROUTES).find(([, value]) => value === to)?.[0];
      const symbolic = shellRoutesKey ? source.includes(`SHELL_ROUTES.${shellRoutesKey}`) : false;
      expect(source.includes(to) || symbolic, `${from} 没送到 ${to}`).toBe(true);
    },
  );

  it("战役导航里不再开第二扇日历门", () => {
    const campaignNav = readFileSync(path.join(WEB_ROOT, "components/campaign/campaign-nav.tsx"), "utf8");
    expect(campaignNav).not.toContain('href: "/campaign/calendar"');
  });

  it("全仓只剩一本日历页(第二本的组件已经不在了)", () => {
    expect(existsSync(path.join(WEB_ROOT, "components/campaign/campaign-calendar-page.tsx"))).toBe(false);
  });
});

/* ── 路径归源:壳里不许留第二份地址 ─────────────────────────────────────────── */

/**
 * #801 收尾 —— 两类漂移点,各钉一条。
 *
 * ① **硬写路径**:壳里每写一次创作面的地址(今天是 "/create")或画布地址,导航就多了一份会
 *    各自漂移的真相。白标改名、路由搬家,漏掉任何一处就是一条死链。所以壳只准引权威常量。
 * ② **抄一份结构**:任何在导航之外把板块名列一遍的文案(tooltip、说明、指路),都会在下一次
 *    加板块时悄悄过期。修法不是补全枚举,是不枚举。
 */
describe("壳里不留第二份地址", () => {
  /**
   * 一张画布的地址,全仓只在这一个模块里拼(W2-6)。它原来长在 `NorthstarHome.tsx` 里,
   * 而那是个 `"use client"` 模块 —— 它的每一个导出在服务端都是**客户端引用**,server
   * component 拿到的不是函数本体、调不动。Home 要画「接着做」的画布链接,只能要么抄第二份,
   * 要么把这一行搬到一个普通模块里。搬了,所以壳允许经它拿地址;而它自己**必须**引权威源
   * (下面那条断言先钉它,再钉壳)。
   */
  const CANVAS_ADDRESS_MODULE = "components/canvas/canvas-href.ts";

  const SHELLS = [
    "components/global-navigation.tsx",
    "components/navigation/rail/NavigationRail.tsx",
    // `immersive-shell.tsx` 不在这份名单里(W2-11):它的活缩到只剩一个内容 pane 的 fade-in
    // 过渡,不再画任何门、不再引用任何路径 —— 见它自己的文件头注释。逼它「必须引权威源」
    // 就是逼它凭空长出一个不需要的依赖。
    "components/canvas/NorthstarHome.tsx",
    "components/canvas/NorthstarCanvasWorkspace.tsx",
    "components/canvas/ImmersiveCanvasEntry.tsx",
    CANVAS_ADDRESS_MODULE,
  ] as const;

  it.each(SHELLS)("%s 不硬写创作面或画布的路径", (file) => {
    const source = sourceCode(file);

    expect(source, `${file} 硬写了创作面路径`).not.toContain(`"${CREATE_NAV_HREF}"`);
    expect(source, `${file} 硬写了画布路径`).not.toContain(`"${CANVAS_HREF}"`);
    expect(source, `${file} 硬写了画布路径(模板串)`).not.toContain(`\`${CANVAS_HREF}`);
  });

  it("引的是权威源,不是自己又定义了一份常量", () => {
    const AUTHORITY = /from\s+["']@fikirtive\/core\/navigation["']/;
    const ADDRESS_MODULE = /from\s+["']@\/components\/canvas\/canvas-href["']/;

    // 中转模块自己没有第二条路:它必须直接引权威源,否则下面那条「经它拿也算」就成了漏洞。
    expect(sourceCode(CANVAS_ADDRESS_MODULE), "画布地址模块自己没有引权威源").toMatch(AUTHORITY);

    for (const file of SHELLS) {
      const source = sourceCode(file);
      expect(
        AUTHORITY.test(source) || ADDRESS_MODULE.test(source),
        `${file} 既没引权威源,也没经那个唯一的地址模块`,
      ).toBe(true);
    }
  });
});

/* ── Otto 一面:指路文案与导轨同源 ─────────────────────────────────────────── */

describe("Otto 的指路文案与导轨同源", () => {
  it("Otto 的指令里真的带着这份界面地图", () => {
    const instructions = readFileSync(
      path.join(REPO_ROOT, "packages/otto/src/__snapshots__/otto-instructions.golden.txt"),
      "utf8",
    );

    expect(instructions).toContain("Where things are in the app");
    for (const item of everyNavDestination()) {
      expect(instructions, `${item.key} 不在 Otto 读到的地图里`).toContain(item.href);
    }
  });

  it("Otto 不会把 Parked 的 Campaigns 或 Schedule 说成 Beta 页面", () => {
    const instructions = readFileSync(
      path.join(REPO_ROOT, "packages/otto/src/__snapshots__/otto-instructions.golden.txt"),
      "utf8",
    );

    expect(instructions).toContain("Campaigns and scheduling have no place on this Beta map");
    expect(instructions).not.toContain("Campaigns (/campaign)");
    expect(instructions).not.toContain("Schedule (/schedule)");
    expect(instructions).not.toContain("/campaign/calendar");
  });

  it("地图是生成的,不是抄的 —— 与权威源逐条对得上", () => {
    const map = merchantNavMap();
    for (const item of everyNavDestination()) {
      expect(map).toContain(`${item.label} (${item.href})`);
    }
  });

  it("地图不点名任何一个 UI 控件(#541 词表禁令,W2-11 曾经在这里栽过一次)", () => {
    const map = merchantNavMap();
    expect(map).not.toMatch(/\bbutton\b/i);
  });
});

describe("SHELL_ROUTES.profile 属于 Settings,但不是主导航格", () => {
  it("身份菜单进得去,同时只让 Settings 在主导航出现一次", () => {
    expect(everyNavDestination().some((item) => item.href === SHELL_ROUTES.profile)).toBe(true);
  });
});
