// @vitest-environment jsdom
/**
 * Home 那一行创作入口 —— 收成三件之后的不变量(beta 卫生大扫除 P2-17,2026-08-26)。
 *
 * 这份文件的上一版叫 `r22-home-create-menu.test.ts`,钉的是 chevron 那颗按钮「从死按钮
 * 换成真菜单」之后的三条。那一版修对了症状,没修对病:菜单挂上去之后,三项里有**两项**
 * 就摆在同一行上 —— `Start a project` 与紧邻的 `Create new` 同去 `/create`,
 * `Add brand context` 与紧邻的次要链接同去 `/brand`。同一句话在同一行里出现两遍,商家得
 * 先按一次才知道两颗是一回事。剩下的独有项只有 `Open Library`,而 Library 在侧栏常驻、
 * 在 ⌘K 的 Actions 组里也有一条。所以裁决是整颗菜单退场,不是再调一次菜单里的项。
 *
 * 顺带落地的措辞案(Founder):`Create without data` 的 data 指的是连接进来的渠道数据,
 * 而连接线同一晚整块闸进幕后(`r22-home-beta-connection-gate.test.ts`)—— 这句话因此在
 * 回答一个商家这一版根本问不出来的问题。换成创作口径。
 *
 * 六条钉的是**商家看到什么、按下去去哪里**:
 *   ① 创作行里没有按钮了,整行按遍也开不出 `role="menu"`;
 *   ② 行内只有两条链接,目的地互不重复(同一行不许有第二个通往同一扇门的入口);
 *   ③ `Add brand context` 在整个默认第一屏上只出现一次;
 *   ④ 行标题是创作口径,不再拿「data」说事;
 *   ⑤ 两条链接都指向 `app/` 底下真的存在的 page.tsx,且不含 beta 藏起来的门;
 *   ⑥ 样张态两条都带 fixture 参数;
 *   ⑦ 骨架里那一排占位的个数 == 落定页那一排控件的个数(骨架反向闸)。
 *
 * 变异自检(逐条实做,做完还原,红 → 绿):
 *   · 把 chevron 那颗 `DropdownMenu` 整块贴回 `HomeView` ⇒ ①②⑦ 红;
 *   · 只把次要那条 `Add brand context` 链接删掉、菜单留着 ⇒ ①③ 红;
 *   · 行标题改回 `Create without data` ⇒ ④ 红;
 *   · 次要链接的 href 改成 `/campaign` ⇒ ⑤ 红(既是死门也是被藏的门);
 *   · 骨架里把那颗 34×34 的方形占位加回去 ⇒ ⑦ 红。
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readOk, type HomeData } from "@/components/home/home-data";
import HomeLoading from "@/app/(home)/loading";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { HomeView } = await import("@/components/home/HomeView");

const APP_DIR = path.resolve(__dirname, "../../app");

const DATA: HomeData = {
  greeting: "Good morning, Nadia",
  credits: readOk("1,240 cr"),
  canvases: readOk([]),
  thumbs: readOk([]),
  upcoming: readOk([]),
  campaigns: readOk([]),
  equipment: readOk([]),
};

/** beta V1 藏起来的那几扇门 —— 创作行里出现任何一个就算把收窄撤了。 */
const HIDDEN_DOORS = ["/campaign", "/approvals", "/schedule", "/analytics", "/routines"] as const;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
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
});

async function mountHome(fixture = false) {
  await act(async () => {
    root!.render(createElement(HomeView, { data: DATA, connection: { kind: "not_connected" }, fixture } as never));
  });
}

function createRow(): HTMLElement {
  const node = container!.querySelector<HTMLElement>(".r22-home-create-row");
  if (!node) throw new Error("Home 上找不到创作行了 —— 下面的断言在核对空气");
  return node;
}

function rowLinks(): HTMLAnchorElement[] {
  return [...createRow().querySelectorAll("a")];
}

/** `/library?fixture=r22` → `library` —— 只留路由段,用来核对 `app/` 里那张 page.tsx。 */
function routeSegment(href: string): string {
  return href.split("?")[0]!.replace(/^\//, "");
}

describe("Home 创作行:chevron 菜单整颗退场(P2-17)", () => {
  it("① 行里一颗按钮都没有,整行按遍也开不出菜单", async () => {
    await mountHome();
    const row = createRow();
    expect(row.querySelectorAll("button"), "创作行里还有按钮 —— chevron 又回来了").toHaveLength(0);
    expect(row.querySelector('[aria-label="More creation choices"]'), "chevron 触发器还在").toBeNull();

    for (const node of row.querySelectorAll("a, button, span")) {
      await act(async () => {
        node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
        node.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      });
    }
    expect(document.querySelector('[role="menu"]'), "创作行里按出了一个菜单").toBeNull();
  });

  it("② 行内只有两条链接,而且目的地互不重复", async () => {
    await mountHome();
    const hrefs = rowLinks().map((link) => link.getAttribute("href") ?? "");
    expect(hrefs, "创作行的控件数不是两条").toEqual(["/create", "/brand"]);
    expect(new Set(hrefs).size, "同一行里有两个入口通往同一扇门").toBe(hrefs.length);
  });

  it("③ `Add brand context` 在默认第一屏上只出现一次", async () => {
    await mountHome();
    const occurrences = (container!.textContent ?? "").split("Add brand context").length - 1;
    expect(occurrences, "同一句话在同一屏上出现了不止一次").toBe(1);
  });

  it("④ 行标题换成创作口径,不再拿「data」说事", async () => {
    await mountHome();
    const heading = createRow().querySelector("b")?.textContent ?? "";
    expect(heading, "标题还在说 data —— 那份 data 商家这一版看不到").not.toMatch(/\bdata\b/i);
    expect(heading, "标题不见了").toBe("Start from a blank canvas");
  });

  it("⑤ 两条链接都是真门,且不含 beta 藏起来的那几扇", async () => {
    await mountHome();
    const hrefs = rowLinks().map((link) => link.getAttribute("href") ?? "");
    for (const href of hrefs) {
      expect(href, "链接没有 href").toMatch(/^\//);
      const segment = routeSegment(href);
      const page = segment === "" ? path.join(APP_DIR, "(home)/page.tsx") : path.join(APP_DIR, segment, "page.tsx");
      expect(existsSync(page), `${href} 在 app/ 底下没有对应的 page.tsx —— 这是一条死链`).toBe(true);
    }
    for (const door of HIDDEN_DOORS) {
      expect(hrefs.map(routeSegment), `${door} 是 beta 期被藏起来的门,不许从创作行放回去`)
        .not.toContain(routeSegment(door));
    }
  });

  it("⑥ 样张态两条都带着 fixture 参数走", async () => {
    await mountHome(true);
    const hrefs = rowLinks().map((link) => link.getAttribute("href") ?? "");
    expect(hrefs.length).toBe(2);
    for (const href of hrefs) {
      expect(href, `${href} 掉了 fixture 参数 —— 从样张点进去会落到生产态那一份`).toContain("fixture=r22");
    }
  });
});

describe("骨架反向闸:那一排占位的个数跟着落定页走", () => {
  it("⑦ 骨架画几件,落定页就有几件", async () => {
    await mountHome();
    const settled = createRow().querySelectorAll(".r22-home-create-actions > *").length;

    const skeleton = renderToStaticMarkup(createElement(HomeLoading));
    const actions = /<div class="r22-home-create-actions">([\s\S]*?)<\/div>\s*<\/section>/.exec(skeleton);
    expect(actions, "骨架里找不到创作行那一排了").not.toBeNull();
    const placeholders = actions![1]!.match(/data-slot="skeleton"/g)?.length ?? 0;

    expect(placeholders, `骨架画了 ${placeholders} 件,落定页只有 ${settled} 件 —— 进 Home 会先闪一件待会儿消失的东西`)
      .toBe(settled);
  });
});

describe("HomeData 不再带没人渲染的孤儿字段(P3-1)", () => {
  it("`billingHref` / `billingLabel` 连类型带构造点一起退场", async () => {
    const shape = await import("@/components/home/home-data");
    // 类型层面已经删掉,所以这里核的是**构造点**:样张那一份不再填这两格。
    const { R22HomeFixture } = await import("@/components/home/HomeView");
    const markup = renderToStaticMarkup(createElement(R22HomeFixture, {} as never));
    expect(markup, "Home 上冒出了一条余额链接 —— 余额按设计原则第 18 条归 Billing 一处")
      .not.toContain("Billing & credits");
    expect(Object.keys(shape.HOME_COPY), "金样被顺手改了").toContain("workspaceDataUnreadable");
  });
});
