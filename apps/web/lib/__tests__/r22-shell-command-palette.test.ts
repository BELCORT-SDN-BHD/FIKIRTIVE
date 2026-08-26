// @vitest-environment jsdom
/**
 * r22-shell-command-palette.test.ts —— cmd+K 归位 `ui/command` 的行为契约(审计 A-3 / C-3),
 * 外加 C-7 那块「零动效」的碑。
 *
 * 换掉的是什么:壳里此前手写了 `role="combobox"`、`aria-expanded`、`aria-controls`、
 * `aria-activedescendant`、`role="listbox"` / `role="option"`、上下键循环、Enter 跳转、
 * `onMouseEnter` 同步高亮 —— 一整套 cmdk 的行为,约 25 行。写第二遍不是错,是**第二份**:
 * 两份键盘模型迟早分家,而分家只有用键盘的人碰得到。
 *
 * 加进来的是什么(C-3,Mobbin 取证:Magnific / Vapi / Devin / Mistral 四家的 palette 都把
 * 动作排在导航之前):一个 `Actions` 组排最上,三条**今天真的到得了**的创作动作;底部一条
 * `↑↓ navigate / ↵ select` 提示栏,按键走 `ui/kbd`。
 *
 * ⚠️ 这一层**零入场动画**(C-7 的碑,Raycast:一天按几百次的东西,最优解就是不做动画)。
 * 下面「零动效」那一段就是钉子:换件的时候最容易顺手把 `CommandDialog` 的默认动画带进来。
 *
 * 变异自检(2026-08-26 逐条**实做**,做完以 commit `fbd9c5b4` 为锚还原,红 → 绿):
 *   · `searchResults` 里删掉 Actions 那三条 ⇒ ②③ 红;
 *   · `SEARCH_GROUPS` 把 "Actions" 挪到 "Go to" 之后 ⇒ ③ 红;
 *   · Actions 里把 `Open Library` 的 href 换成 `/campaign`(一扇 beta 藏起来的门)⇒ ② 红,
 *     `r22-beta-nav-scope` ⑫ 一并红;
 *   · `<Command loop>` 的 `loop` 拿掉 ⇒ ⑤ 的循环那条红;
 *   · `CommandEmpty` 整条删掉 ⇒ ⑥ 红;
 *   · `DialogContent` 上的 `unstyled` 拿掉(= 把默认入场动画放回来)⇒ ⑦ 红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => navigation,
}));
vi.mock("@/lib/global-search-actions", () => ({
  loadGlobalSearchProjects: vi.fn().mockResolvedValue({ projects: [{ id: "raya", name: "Raya launch" }] }),
}));
vi.mock("next/image", () => ({ default: () => null }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const { R22DashboardShell } = await import("@/components/r22/R22DashboardShell");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");
const source = (relative: string) => readFileSync(path.join(WEB_ROOT, relative), "utf8");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.replaceChildren();
});

async function mountShell(): Promise<void> {
  await act(async () => {
    root.render(h(R22DashboardShell, {
      location: "/",
      account: null,
      signOutAction: async () => {},
      children: null,
    } as never));
  });
}

/** 真的按一记 ⌘K —— 不是伸手去点那颗触发按钮。 */
async function pressCmdK(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true }));
  });
}

function palette(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(".r22-dashboard-search-dialog");
}

function groups(): Array<{ heading: string; items: string[] }> {
  return [...document.body.querySelectorAll<HTMLElement>("[data-slot='command-group']")].map((group) => ({
    heading: group.querySelector("[cmdk-group-heading]")?.textContent?.trim() ?? "",
    items: [...group.querySelectorAll<HTMLElement>("[data-slot='command-item']")].map((item) => item.querySelector("span")?.textContent?.trim() ?? ""),
  }));
}

function items(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>("[data-slot='command-item']")];
}

function selectedItem(): HTMLElement | undefined {
  return items().find((node) => node.getAttribute("data-selected") === "true");
}

async function typeQuery(value: string): Promise<void> {
  const input = document.body.querySelector<HTMLInputElement>("[data-slot='command-input']")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressKey(key: string): Promise<void> {
  const input = document.body.querySelector<HTMLInputElement>("[data-slot='command-input']")!;
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
}

/* ── ① 开与关 ──────────────────────────────────────────────────────────────── */

describe("① ⌘K 开,Esc 关", () => {
  it("开局关着;⌘K 开出来", async () => {
    await mountShell();
    expect(palette(), "开局就开着 —— 下面那条在核对空气").toBeNull();
    await pressCmdK();
    expect(palette(), "⌘K 按下去什么都没发生").toBeTruthy();
  });

  it("Esc 关回去", async () => {
    await mountShell();
    await pressCmdK();
    await act(async () => {
      document.body.querySelector("[data-slot='command-input']")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(palette(), "Esc 关不掉").toBeNull();
  });
});

/* ── ②③ Actions 组 ────────────────────────────────────────────────────────── */

describe("②③ Actions 组排最上,三条都是真去处", () => {
  it("三条创作动作在,而且指的是 beta 商家今天到得了的三扇门", async () => {
    await mountShell();
    await pressCmdK();

    const actions = groups().find((group) => group.heading === "Actions");
    expect(actions, "palette 里没有 Actions 组 —— 商家只能『去』,不能『做』").toBeTruthy();
    expect(actions!.items).toEqual(["Start a project", "Open Library", "Add brand context"]);

    const hrefs = [...document.body.querySelectorAll<HTMLAnchorElement>("[data-slot='command-group'] a")]
      .slice(0, 3)
      .map((node) => node.getAttribute("href"));
    expect(hrefs, "Actions 里有一条指着不存在或被藏起来的门").toEqual(["/create", "/library", "/brand"]);
  });

  it("Actions 排在 Go to 与 Projects 之前(C-3 的 Mobbin 形状)", async () => {
    await mountShell();
    await pressCmdK();
    const headings = groups().map((group) => group.heading);
    expect(headings[0], "Actions 没有排在最上").toBe("Actions");
    expect(headings).toContain("Go to");
  });

  it("底部提示栏在,按键走 ui/kbd,不是一个裸 <kbd>", async () => {
    await mountShell();
    await pressCmdK();
    const hint = document.body.querySelector<HTMLElement>(".r22-dashboard-search-hint");
    expect(hint, "底部没有那条导航提示栏").toBeTruthy();
    expect(hint!.textContent).toContain("navigate");
    expect(hint!.textContent).toContain("select");
    expect(hint!.querySelectorAll("[data-slot='kbd']").length, "提示栏里的按键不是 ui/kbd").toBeGreaterThanOrEqual(3);
  });
});

/* ── ④⑤ 键盘行为不降 ──────────────────────────────────────────────────────── */

describe("④⑤ 键盘行为一格都没降", () => {
  it("上下键在结果里走,而且到头会绕回来", async () => {
    await mountShell();
    await pressCmdK();

    const total = items().length;
    expect(total, "一条结果都没有 —— 下面在核对空气").toBeGreaterThan(2);
    const first = selectedItem();
    expect(first, "开局没有一条被选中").toBeTruthy();

    await pressKey("ArrowDown");
    expect(selectedItem(), "按下去高亮没动").not.toBe(first);

    // 从第一条往上 = 绕到最后一条(`<Command loop>`)。
    await pressKey("ArrowUp");
    await pressKey("ArrowUp");
    expect(selectedItem(), "到头没有绕回来 —— loop 掉了").toBe(items()[total - 1]);
  });

  it("Enter 执行当前那一条", async () => {
    await mountShell();
    await pressCmdK();
    navigation.push.mockClear();

    await pressKey("Enter");
    expect(navigation.push, "Enter 什么都没执行").toHaveBeenCalledWith("/create");
    expect(palette(), "执行完 palette 没关").toBeNull();
  });
});

/* ── ⑥ 三种「没东西可给」的状态 ────────────────────────────────────────────── */

describe("⑥ loading / error / 无结果三行", () => {
  it("搜不到东西时出 CommandEmpty,不是一片空白", async () => {
    await mountShell();
    await pressCmdK();
    await typeQuery("zzzz-nothing-matches-zzzz");

    const empty = document.body.querySelector("[data-slot='command-empty']");
    expect(empty, "什么都搜不到时屏幕上一句话都没有").toBeTruthy();
    expect(empty!.textContent).toContain("No matching result");
    expect(items().length, "说没有结果,却还列着结果").toBe(0);
  });

  it("等项目名单的时候有一颗 spinner,读不到时照实说", () => {
    const shell = source("components/r22/R22DashboardShell.tsx");
    const loading = shell.slice(shell.indexOf('projectsState === "loading"'));
    expect(loading.slice(0, 200), "等待那一行没有旋转器").toContain("<Spinner");
    expect(shell, "读不到项目时没有照实说").toContain("Your projects could not be searched. Pages are still listed.");
    // 三行都住在共用的那一格里,不是三种长相。
    expect(shell).toContain("r22-dashboard-search-empty");
  });
});

/* ── ⑦ 零动效的碑 ─────────────────────────────────────────────────────────── */

describe("⑦ cmd+K 零入场动画 —— C-7 的碑,换件的时候最容易撞掉的一块", () => {
  it("走的是这一面自己那个 unstyled 的 DialogContent,不是带默认动画的 CommandDialog", () => {
    const shell = source("components/r22/R22DashboardShell.tsx");
    expect(shell, "换成了 CommandDialog —— 它套的是带 animate-in / zoom-in-95 的默认 DialogContent").not.toContain("<CommandDialog");
    const dialog = shell.slice(shell.indexOf('overlayClassName="r22-dashboard-search-scrim"') - 200, shell.indexOf('overlayClassName="r22-dashboard-search-scrim"') + 200);
    expect(dialog, "DialogContent 上的 unstyled 掉了 —— 默认入场动画会一路回来").toContain("unstyled");
  });

  it("那两段 css 里没有一条 animation、没有一条 transition", () => {
    const css = source("components/r22/r22-dashboard.css");
    for (const selector of [".r22-dashboard-search-scrim", ".r22-dashboard-search-dialog {"]) {
      const start = css.indexOf(selector);
      expect(start, `${selector} 找不到了 —— 这条围栏在核对空气`).toBeGreaterThan(-1);
      const rule = css.slice(start, css.indexOf("}", start));
      expect(rule, `${selector} 上长出了动画`).not.toContain("animation");
      expect(rule, `${selector} 上长出了过渡`).not.toContain("transition");
    }
  });

  it("手写的那一套 combobox 语义真的退役了", () => {
    // 注释里逐条点名它们「为什么走了」是这次改动的记录,所以先把注释剥掉再扫代码。
    const shell = source("components/r22/R22DashboardShell.tsx")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const handWritten of ['role="combobox"', "aria-activedescendant", 'role="listbox"', 'role="option"', "setSelectedResult"]) {
      expect(shell.includes(handWritten), `壳里还手写着 ${handWritten}`).toBe(false);
    }
    expect(shell, "没有接上 ui/command").toContain('from "@/components/ui/command"');
  });
});

/* ── ⑧ 一行里两段字不叠印 ─────────────────────────────────────────────────── */

/**
 * Founder 2026-08-26 截图报的「每行两段文字叠印」不是布局塌了,是**颜色渗漏**:
 * next-themes 在系统深色时给 <html> 落 `.dark`,shadcn 那三枚文字类
 * (`text-popover-foreground` / `text-foreground` / `data-[selected=true]:text-accent-foreground`)
 * 跟着翻成 #FAFAFA;而 r22 这一层是固定浅色(面还是白的),label 那半截白字压在白面上
 * 只剩一层影,右边写死 `--r22-ink-3` 的 mono detail 照常实色 —— 看上去就是两段字叠在一起。
 * 同一枚渗漏还把 `ui/kbd` 的 `bg-muted` 底翻成近黑。
 *
 * 这里不钉像素:把真渲染出来的那棵树,连同真的 `r22-dashboard.css`,和三枚**深色字面值**的
 * 打桩类一起丢进 jsdom 的层叠里,问「这一行的字最后由谁上色」。答案必须是 r22 的墨,
 * 不是那三枚会翻脸的 token。行宽那条同理:靠 `flex` 的从属关系断言,不量像素。
 */
describe("⑧ 深色渗漏:一行里 label 与 detail 不叠印", () => {
  /** 三枚 shadcn 文字类在系统深色下的真实落点(globals.css `.dark` 段:#FAFAFA)。 */
  const DARK_INK = "rgb(250, 250, 250)";

  function paintDarkTailwind(): void {
    const style = document.createElement("style");
    style.textContent = [
      ".text-popover-foreground{color:" + DARK_INK + "}",
      ".text-foreground{color:" + DARK_INK + "}",
      '.data-\\[selected\\=true\\]\\:text-accent-foreground[data-selected="true"]{color:' + DARK_INK + "}",
      ".bg-muted{background-color:rgb(22, 22, 25)}",
      source("components/r22/r22-dashboard.css"),
    ].join("\n");
    document.head.appendChild(style);
  }

  afterEach(() => { document.head.querySelectorAll("style").forEach((node) => node.remove()); });

  it("label 的颜色由 r22 的墨说了算,不是深色下会翻脸的那三枚 token", async () => {
    await mountShell();
    await pressCmdK();
    paintDarkTailwind();

    const rows = items();
    expect(rows.length, "一条结果都没有 —— 下面在核对空气").toBeGreaterThan(2);

    for (const row of rows) {
      const label = row.querySelector("span")!;
      const detail = row.querySelector("small")!;
      expect(getComputedStyle(row).color, "整行的字被深色 token 接管了").not.toBe(DARK_INK);
      expect(getComputedStyle(label).color, "label 被深色 token 接管了 —— 白字白底,就是那个『叠印』").not.toBe(DARK_INK);
      expect(getComputedStyle(label).color, "label 不再由 r22 的墨上色").toContain("--r22-ink");
      // 两段字必须分得开:label 实墨,detail 是浅一档的 ink-3。
      expect(getComputedStyle(detail).color, "detail 不再是浅一档的 mono 灰").toContain("--r22-ink-3");
      expect(getComputedStyle(detail).color).not.toBe(getComputedStyle(label).color);
    }
  });

  it("选中那一行也一样 —— `data-[selected=true]:text-accent-foreground` 压得住", async () => {
    await mountShell();
    await pressCmdK();
    paintDarkTailwind();

    const selected = selectedItem();
    expect(selected, "开局没有一条被选中").toBeTruthy();
    expect(getComputedStyle(selected!).color, "选中行的字被 accent-foreground 接管了").not.toBe(DARK_INK);
    expect(getComputedStyle(selected!.querySelector("span")!).color).toContain("--r22-ink");
  });

  it("底部与输入行的按键底色也没被 `bg-muted` 翻成近黑", async () => {
    await mountShell();
    await pressCmdK();
    paintDarkTailwind();

    const keys = [...document.body.querySelectorAll<HTMLElement>(".r22-dashboard-search-dialog kbd")];
    expect(keys.length, "面里一颗按键都没有").toBeGreaterThan(2);
    for (const key of keys) expect(getComputedStyle(key).backgroundColor, "按键底被深色 muted 接管了").toContain("--r22-chrome");
  });

  it("一行就是一个 <a> 摊满整行:label 撑开,detail 落在行尾", async () => {
    await mountShell();
    await pressCmdK();
    paintDarkTailwind();

    for (const row of items()) {
      expect(row.children.length, "一行里不止一个孩子 —— 结构变了,detail 可能不在同一条流里").toBe(1);
      const link = row.children[0] as HTMLElement;
      expect(link.tagName, "行里那一个孩子不是 <a>").toBe("A");
      expect(getComputedStyle(link).display, "行内那条 <a> 不是 flex —— 图标/label/detail 不再排在一条线上").toBe("flex");
      // cmdk 的 item 自己是 flex 容器:<a> 不长,就缩成内容宽,detail 会紧贴在 label 屁股后面。
      expect(getComputedStyle(link).flexGrow, "<a> 没有摊满整行 —— detail 会贴着 label,不在行尾").toBe("1");
      expect(getComputedStyle(row.querySelector("span")!).flexGrow, "label 没有撑开 —— detail 顶不到行尾").toBe("1");
      expect(getComputedStyle(row.querySelector("small")!).flexGrow, "detail 不该跟着撑").not.toBe("1");
    }
  });
});
