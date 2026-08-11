/**
 * 创作正名 + 画布旗舰面接进主导航(#801)—— 双面围栏。
 *
 * Founder 裁决:「画布也是 creation 板块的,而且是主要一个卖点」。所以这里钉的是商家看得见
 * 的结果,不是内部函数:
 *   ① **UI 一面** —— 主导航第一格就是创作,点开就是画布的家;它在 375px 抽屉里同样到得了;
 *      六扇门的每一个目的地在导轨里都有门;Otto 在导轨里是助手不是板块;旧路由重定向不 404。
 *   ② **Otto 一面** —— Otto 的指路文案与导轨画的是同一份声明(界面地图从 MERCHANT_NAV
 *      生成),所以它说的路商家真的走得通。
 *
 * 全程零后端、零生成:只做静态渲染与源码读取。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CANVAS_HREF,
  CREATE_NAV_HREF,
  CREATE_NAV_LABEL,
  MERCHANT_NAV,
  MERCHANT_NAV_REDIRECTS,
  OTTO_ASSISTANT,
  everyNavDestination,
  merchantNavMap,
} from "@fikirtive/core/navigation";
import { MerchantShellContent, isMerchantSurface } from "@/components/global-navigation";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/otto"),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("@/lib/tenant-actions", () => ({
  stopImpersonatingTenant: vi.fn(),
}));

const WEB_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

/** Every section name the rail draws — the list a tooltip must not quietly re-copy. */
const NAV_SECTION_LABELS = MERCHANT_NAV.map((node) => node.label);

/** Source with comments stripped: a path in a comment is history, not a destination. */
function sourceCode(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function renderShell(pathname: string): string {
  return renderToStaticMarkup(
    createElement(
      MerchantShellContent,
      { pathname, signOutAction: vi.fn(async () => undefined) },
      createElement("div", null, "Page content"),
    ),
  );
}

/* ── ① UI 一面 ─────────────────────────────────────────────────────────────── */

describe("创作是主导航的第一格", () => {
  it("导轨里有一扇写着创作名字的门,通向画布的家", () => {
    const markup = renderShell("/campaign");

    expect(markup).toContain(`href="${CREATE_NAV_HREF}"`);
    expect(markup).toContain(`>${CREATE_NAV_LABEL}<`);
  });

  it("站在创作面上时那扇门是亮的", () => {
    expect(renderShell(CREATE_NAV_HREF)).toMatch(
      new RegExp(`aria-current="page" title="${CREATE_NAV_LABEL}"`),
    );
    expect(renderShell(CANVAS_HREF)).toMatch(
      new RegExp(`aria-current="page" title="${CREATE_NAV_LABEL}"`),
    );
  });

  it("画布不再是「活着但没门」—— 它自己就是一个商家表面,壳会围着它", () => {
    expect(isMerchantSurface(CREATE_NAV_HREF)).toBe(true);
    expect(isMerchantSurface(CANVAS_HREF)).toBe(true);
    expect(renderShell(CANVAS_HREF)).toContain('aria-label="Global navigation"');
  });

  it("创作名字只写在一处 —— 壳里不许再手抄一份字面量", () => {
    const nav = readFileSync(path.join(WEB_ROOT, "components/global-navigation.tsx"), "utf8");
    // 壳只画数据:整棵树从 @fikirtive/core/navigation 来,壳里没有第二份 label 字面量。
    expect(nav).toMatch(/from\s+["']@fikirtive\/core\/navigation["']/);
    expect(nav).not.toContain(`"${CREATE_NAV_LABEL}"`);
  });
});

describe("六扇门都有门,且 375px 抽屉里到得了", () => {
  it("导轨在手机档把每一个目的地都画出来(抽屉里,不是折起来看不见)", () => {
    // 手机档导轨就是这同一段 markup —— 它靠 translate 滑入,不是靠条件渲染,所以
    // 「抽屉里有没有」等于「这段 markup 里有没有」。
    const markup = renderShell("/campaign");

    const missing = everyNavDestination()
      .map((item) => item.href)
      .filter((href) => !markup.includes(`href="${href.replace(/&/g, "&amp;")}"`));

    expect(missing).toEqual([]);
  });

  it("手机档不画第二颗汉堡:自带顶栏的面自己承担入口", () => {
    // /campaign 由壳画那颗浮动汉堡;创作面与 Otto 自带顶栏,壳一颗都不画(#747/#801)。
    expect(renderShell("/campaign")).toContain('aria-label="Open navigation"');
    expect(renderShell(CREATE_NAV_HREF)).not.toContain('aria-label="Open navigation"');
    expect(renderShell(CANVAS_HREF)).not.toContain('aria-label="Open navigation"');
  });
});

describe("Otto 是助手,不是板块", () => {
  it("导轨里 Otto 有自己的位置,而且不长成板块的样子", () => {
    const markup = renderShell("/campaign");

    expect(markup).toContain(`href="${OTTO_ASSISTANT.href}"`);
    expect(markup).toContain(`>${OTTO_ASSISTANT.label}<`);
  });

  it("它不在板块列表里 —— 板块第一格是创作", () => {
    const markup = renderShell("/campaign");
    const assistantAt = markup.indexOf(`title="${OTTO_ASSISTANT.label}"`);
    const createAt = markup.indexOf(`title="${CREATE_NAV_LABEL}"`);
    const campaignAt = markup.indexOf('title="Campaign"');

    // 助手画在板块之上;板块自己的第一格是创作,不是 Otto。
    expect(assistantAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(assistantAt);
    expect(campaignAt).toBeGreaterThan(createAt);
  });

  it("每一个商家表面都够得着它(导轨常驻,创作面上也在)", () => {
    for (const surface of ["/campaign", "/crm/inbox", "/billing", CREATE_NAV_HREF, CANVAS_HREF]) {
      expect(renderShell(surface), surface).toContain(`href="${OTTO_ASSISTANT.href}"`);
    }
  });
});

describe("收敛掉的旧路由一律 redirect,不 404", () => {
  it.each(MERCHANT_NAV_REDIRECTS.map((row) => [row.from, row.to] as const))(
    "%s 有一个真的重定向路由送人去 %s",
    (from, to) => {
      const route = path.join(WEB_ROOT, "app", from.replace(/^\//, ""), "page.tsx");
      expect(existsSync(route), `${from} 没有路由文件`).toBe(true);

      const source = readFileSync(route, "utf8");
      expect(source, `${from} 不是重定向`).toContain("redirect(");
      expect(source, `${from} 没送到 ${to}`).toContain(to);
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
 * ① **硬写路径**:壳里每写一次 "/northstar-immersive" 或 "/otto",导航就多了一份会各自
 *    漂移的真相。白标改名、路由搬家,漏掉任何一处就是一条死链。所以壳只准引权威常量。
 * ② **抄一份结构**:任何在导航之外把板块名列一遍的文案(tooltip、说明、指路),都会在下一次
 *    加板块时悄悄过期 —— 它已经过期过一次(那句 tooltip 列了四项,漏了 Workspace)。
 *    修法不是补全枚举,是不枚举。
 */
describe("壳里不留第二份地址", () => {
  const SHELLS = [
    "components/global-navigation.tsx",
    "components/northstar/immersive/immersive-shell.tsx",
    "components/canvas/NorthstarHome.tsx",
    "components/canvas/NorthstarCanvasWorkspace.tsx",
    "components/canvas/ImmersiveCanvasEntry.tsx",
  ] as const;

  it.each(SHELLS)("%s 不硬写创作面或助手的路径", (file) => {
    const source = sourceCode(file);

    expect(source, `${file} 硬写了创作面路径`).not.toContain(`"${CREATE_NAV_HREF}"`);
    expect(source, `${file} 硬写了画布路径`).not.toContain(`"${CANVAS_HREF}"`);
    expect(source, `${file} 硬写了画布路径(模板串)`).not.toContain(`\`${CANVAS_HREF}`);
    expect(source, `${file} 硬写了助手路径`).not.toContain(`"${OTTO_ASSISTANT.href}"`);
  });

  it("引的是权威源,不是自己又定义了一份常量", () => {
    for (const file of SHELLS) {
      expect(sourceCode(file), `${file} 没有引权威源`).toMatch(/from\s+["']@fikirtive\/core\/navigation["']/);
    }
  });
});

describe("导航之外不抄一份板块名单", () => {
  it("Otto 手机菜单那颗「Go to…」的说明不枚举板块", () => {
    const ottoNav = sourceCode("components/otto/OttoNav.tsx");
    const titles = [...ottoNav.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
    const listing = titles.filter((title) =>
      NAV_SECTION_LABELS.some((label) => title.includes(label)),
    );

    expect(listing, "这颗按钮的说明又把板块列了一遍,列表一定会先过期").toEqual([]);
    expect(ottoNav).toContain('title="Open navigation"');
  });
});

/* ── ② Otto 一面 ───────────────────────────────────────────────────────────── */

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

  it("Otto 被明确告知只有一本日历", () => {
    const instructions = readFileSync(
      path.join(REPO_ROOT, "packages/otto/src/__snapshots__/otto-instructions.golden.txt"),
      "utf8",
    );

    expect(instructions).toContain("There is ONE calendar");
    expect(instructions).not.toContain("/campaign/calendar");
  });

  it("地图是生成的,不是抄的 —— 与权威源逐条对得上", () => {
    const map = merchantNavMap();
    for (const item of everyNavDestination()) {
      expect(map).toContain(`${item.label} (${item.href})`);
    }
  });
});
