// @vitest-environment jsdom
/**
 * r22-receipts-and-empty-actions.test.ts —— P2 第一批的行为契约(审计 A-4 / A-5 / B-6 /
 * B-7 / C-5 / C-7b / A-8 / C-10)。
 *
 * 这一批改的都是**商家手上的东西**,所以除了两条对账扫描,每条都在真 DOM 上按下去看结果:
 *
 *   ① 回执只有一种长相 —— 五扇门各自手搓的那条横幅退役,全部走 `toast()`;
 *   ② 「Hide from Library」不再立一道模态闸:直接做,回执上给一颗 Undo,而且 Undo **真的**
 *      把那一批放回来(不是只把话说圆);
 *   ③ 空态里点名了动作,屏幕上就有那颗按钮,而且它通向今天真的存在的去处;
 *   ④ Home 的「Otto will analyse」承诺块整块撤下(Founder 裁决 2026-08-26,断言在
 *      `home-page.test.ts` ③,这里只钉容器与骨架不再画它);
 *   ⑤ 三层遮罩补上淡入,减弱动效与键盘发起两条通道都关得掉;
 *   ⑥ 旋转器与进度条归位正典件,五份手画的 keyframes 归零。
 *
 * 变异自检(2026-08-26 逐条**实做**,做完以 commit `fbd9c5b4` 为锚还原,红 → 绿):
 *   · `removeSelected()` 里把 Undo 的 `onClick` 换成 `() => {}` ⇒ ② 的「真恢复」红;
 *   · `restoreHidden()` 里把 `hidden: false` 写回 `hidden: true` ⇒ ② 红;
 *   · 空态那颗 Upload 改成 `onClick={() => {}}`(不再点工具排那个 input)⇒ ③-a 红;
 *   · 空态那颗 Open Canvas 的 href 改成 `#` ⇒ ③-b 红;
 *   · `R22ProjectsView` 空态那颗 Create project 拿掉 `setStartOpen(true)` ⇒ ③-c 红;
 *   · `commit()` 里把 `toast(message)` 换回 `setNotice(message)` 形状(即不弹)⇒ ① 红;
 *   · `.r22-lib-scrim[data-state="open"]` 那条 animation 删掉 ⇒ ⑤ 红;
 *   · `ui/spinner.tsx` 里把 `motion-reduce:animate-none` 删掉 ⇒ ⑥ 的减弱动效那条红。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToasts, installToastEnvironment, latestToast, settleToasts, toastAction, toastTexts, withToaster } from "./__helpers__/toast-probe";

installToastEnvironment();

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/library",
}));
vi.mock("@/lib/actions", () => ({ createProject: vi.fn() }));

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const { LibraryWorkroom } = await import("@/components/library/LibraryWorkroom");
const { R22ProjectsView } = await import("@/components/projects/R22ProjectsView");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  document.documentElement.removeAttribute("data-kb");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  clearToasts();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
  window.sessionStorage.clear();
});

async function mount(element: Parameters<typeof withToaster>[0]): Promise<void> {
  await act(async () => { root!.render(withToaster(element)); });
}

function all<T extends Element = HTMLElement>(selector: string): T[] {
  return [...container!.querySelectorAll<T>(selector)];
}

function need<T extends Element = HTMLElement>(selector: string): T {
  const node = container!.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

async function click(node: Element | null | undefined): Promise<void> {
  expect(node, "要按的那颗键不在屏幕上").toBeTruthy();
  await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}

function byText(selector: string, text: string): HTMLElement | undefined {
  return all(selector).find((node) => (node.textContent ?? "").trim() === text);
}

function source(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

/* ── ① 回执只有一种长相 ────────────────────────────────────────────────────── */

describe("① 回执一律走 toast", () => {
  it("Library 星标一张 → 屏上出现一条回执,句子一个字没变", async () => {
    await mount(createElement(LibraryWorkroom, { restore: false }));
    const star = need('button[aria-label$=" to Starred"]');
    await click(star);
    await settleToasts();

    expect(toastTexts().length, "按下去一条回执都没有").toBe(1);
    expect(latestToast()).toContain("is in Starred.");
  });

  it("五扇门自己那条回执横幅的类名,全树归零", () => {
    // `r22-lib-notice-act` 不在此列:那颗「Continue in Canvas」还在,只是搬进了 toast 的
    // action 位。所以名字后面不许再跟 `-`,否则会把它一起误判成没清干净。
    const RETIRED = ["r22-library-notice", "r22-lib-notice", "r22-iq-hub-notice", "r22-settings-notice", "r22-canvas-notice"];
    const hits: string[] = [];
    const SKIP = new Set(["node_modules", ".next", "dist", "coverage", ".turbo", "public", "__tests__"]);
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(tsx?|css)$/.test(entry.name)) continue;
        const text = readFileSync(full, "utf8");
        for (const name of RETIRED) {
          // 注释里提到它为什么走了是可以的;`className=` / css 选择器里还画着它就不行。
          const painted = new RegExp(`(className=[^\\n]*|\\.)${name}(?![\\w-])`);
          for (const line of text.split("\n")) {
            if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) continue;
            if (painted.test(line)) hits.push(`${path.relative(WEB_ROOT, full)} — ${name}`);
          }
        }
      }
    }
    walk(path.join(WEB_ROOT, "app"));
    walk(path.join(WEB_ROOT, "components"));
    expect(hits, "还有门自己画着一条回执横幅").toEqual([]);
  });

  it("Settings 与 Otto IQ 也改口了:两份源码里都在调 toast,不再自己画一条", () => {
    for (const relative of ["components/settings/R22SettingsShell.tsx", "components/otto-iq/R22OttoIQView.tsx"]) {
      expect(source(relative), `${relative} 没有接上共用的回执`).toContain('from "sonner"');
    }
    // Toaster 只有一份,挂在根布局上 —— 五扇门共用的就是它。
    expect(source("app/layout.tsx")).toContain("<Toaster />");
  });
});

/* ── ② Hide 改行内 undo ────────────────────────────────────────────────────── */

describe("② Hide from Library:直接做 + 一颗真的 Undo", () => {
  async function selectFirstAndHide(): Promise<string> {
    await mount(createElement(LibraryWorkroom, { restore: false }));
    const firstName = need(".r22-lib-tile .r22-lib-meta b, .r22-lib-tile b").textContent!;
    await click(need('[role="checkbox"]'));
    await click(byText(".r22-lib-bulk button", "Remove"));
    await settleToasts();
    return firstName;
  }

  it("不再弹一次模态闸 —— 按下去东西就收起来了", async () => {
    const before = (await mount(createElement(LibraryWorkroom, { restore: false })), all(".r22-lib-tile").length);
    expect(before, "样张里一张图都没有 —— 下面在核对空气").toBeGreaterThan(0);

    await click(need('[role="checkbox"]'));
    await click(byText(".r22-lib-bulk button", "Remove"));
    await settleToasts();

    expect(document.body.querySelector('[role="alertdialog"]'), "还在弹一次确认窗").toBeNull();
    expect(all(".r22-lib-tile").length, "按下去东西没被收起来").toBe(before - 1);
    expect(latestToast()).toContain("hidden from your Library");
  });

  it("回执上那颗 Undo 真的把那一批放回来", async () => {
    await selectFirstAndHide();
    const afterHide = all(".r22-lib-tile").length;

    const undo = toastAction("Undo");
    expect(undo, "回执上没有 Undo").toBeTruthy();
    await act(async () => { undo!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    await settleToasts();

    expect(all(".r22-lib-tile").length, "按了 Undo 东西没回来").toBe(afterHide + 1);
    expect(latestToast()).toContain("back in your Library.");
  });

  it("Otto IQ 的 Delete context 仍然是一次模态确认 —— 那一个是真删", () => {
    const view = source("components/otto-iq/R22OttoIQView.tsx");
    expect(view, "把可逆动作的手法推给了真删").toContain("<AlertDialog");
    expect(view).toContain("Delete");
  });
});

/* ── ③ 空态里的动作是真去处 ────────────────────────────────────────────────── */

describe("③ 空态点名了动作,屏幕上就有那颗按钮", () => {
  it("Library 空态那颗 Upload 按的是工具排上**同一个** file picker", async () => {
    await mount(createElement(LibraryWorkroom, { restore: false, empty: true }));

    const picker = need<HTMLInputElement>(".r22-lib-file");
    let clicked = 0;
    picker.addEventListener("click", () => { clicked += 1; });

    await click(byText(".r22-lib-empty [data-slot='empty-content'] button", "Upload a picture"));
    expect(clicked, "空态那颗 Upload 没有接上真的文件选择器").toBe(1);
  });

  it("Library 空态那颗 Open Canvas 指向 /create 那扇门", async () => {
    await mount(createElement(LibraryWorkroom, { restore: false, empty: true }));
    const link = byText(".r22-lib-empty a", "Open Canvas") as HTMLAnchorElement | undefined;
    expect(link, "空态里那句话点名了 Canvas,屏幕上却没有去 Canvas 的路").toBeTruthy();
    expect(link!.getAttribute("href")!.startsWith("/create"), `Open Canvas 指的不是 /create:${link!.getAttribute("href")}`).toBe(true);
  });

  it("Library 搜索无结果时不长按钮 —— 那一句没有点名任何动作", async () => {
    await mount(createElement(LibraryWorkroom, { restore: false, empty: true }));
    await act(async () => {
      const search = need<HTMLInputElement>('input[aria-label="Search library"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "nothing-matches-this");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(all(".r22-lib-empty a, .r22-lib-empty [data-slot='empty-content'] button").length).toBe(0);
  });

  it("Canvas projects 空态那颗 Create project 真的开出建项目那一层", async () => {
    await mount(createElement(R22ProjectsView, { projects: [], fixture: true, fixtureState: "empty" } as never));

    expect(document.body.querySelector(".r22-projects-start"), "开局对话框开局就开着 —— 下面那条在核对空气").toBeNull();
    await click(byText(".r22-projects-empty button", "Create project"));
    expect(document.body.querySelector(".r22-projects-start"), "空态那颗 Create project 是颗死键").toBeTruthy();
  });

  it("九处空态全部归位 `ui/empty`,没有一处还是裸 div 加一句话", () => {
    const SITES: Array<[string, number]> = [
      ["components/library/LibraryWorkroom.tsx", 1],
      ["components/library/R22LibraryView.tsx", 1],
      ["components/projects/R22ProjectsView.tsx", 1],
      ["components/otto-iq/R22OttoIQView.tsx", 2],
      ["components/r22/R22DashboardShell.tsx", 2],
      ["components/settings/R22SettingsShell.tsx", 3],
    ];
    let total = 0;
    for (const [relative, count] of SITES) {
      const text = source(relative);
      expect(text, `${relative} 没有引入 ui/empty`).toContain('from "@/components/ui/empty"');
      const found = text.match(/<Empty\b/g)?.length ?? 0;
      expect(found, `${relative} 的空态没有全部归位`).toBeGreaterThanOrEqual(count);
      total += count;
    }
    // 台账 A-5 的标题写「九处」,但它自己那张表列的是十行(Settings 那一处是 ×3,
    // Otto IQ 与壳各 ×2)。这里按**表**算,不按标题算。
    expect(total, "审计 A-5 那张表列的是十处").toBe(10);
  });
});

/* ── ④ Home 承诺块整块撤下 ─────────────────────────────────────────────────── */

describe("④ 「Otto will analyse」承诺块整块撤下(Founder 裁决 2026-08-26)", () => {
  it("落定页与骨架都不再画它 —— 骨架画一张落定页没有的卡就是把跳屏请回来", () => {
    const view = source("components/home/HomeView.tsx");
    const skeleton = source("app/(home)/loading.tsx");
    for (const [name, text] of [["落定页", view], ["骨架", skeleton]] as const) {
      expect(text, `${name}还画着那张卡`).not.toContain("r22-home-analysis");
      expect(text, `${name}还画着那三枚芯片`).not.toContain("r22-home-chip");
    }
    // 那几条 css 一并退役,不留一份没人用的样式。
    const css = source("components/home/r22-home.css");
    expect(css, "承诺块的 css 还留着").not.toContain("r22-home-analysis");
    expect(css, "芯片的 css 还留着").not.toContain("r22-home-chip");
  });
});

/* ── ⑤ 三层遮罩补淡入 ──────────────────────────────────────────────────────── */

describe("⑤ 遮罩不再硬切", () => {
  const CASES: Array<[string, string, string]> = [
    ["Library 详情层 / 素材包层", "components/library/r22-library.css", "r22-lib-scrim"],
    ["单图编辑层", "components/library/r22-image-edit.css", "r22-edit-scrim"],
  ];

  it.each(CASES)("%s 的遮罩有入场淡入", (_name, relative, scrim) => {
    const css = source(relative);
    const rule = new RegExp(`\\.${scrim}\\[data-state="open"\\]\\s*\\{[^}]*animation:[^}]*\\}`);
    expect(rule.test(css), `${scrim} 还是硬切 —— 面板花 180ms 淡入,背景却瞬间压黑`).toBe(true);
    expect(css, `${scrim} 的淡入没有关键帧`).toMatch(new RegExp(`@keyframes ${scrim}-in`));
  });

  it.each(CASES)("%s 的遮罩在减弱动效与键盘发起两条通道下都关得掉", (_name, relative, scrim) => {
    const css = source(relative);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced, "减弱动效下遮罩照样淡").toContain(scrim);
    // `html[data-kb="1"]` 那两条从今天起真的关得到东西 —— 在此之前它们关的是一个不存在的动画。
    expect(css, "键盘发起的动作没有走零动效通道").toMatch(new RegExp(`html\\[data-kb="1"\\][^{]*\\.${scrim}`));
  });

  it("三层用的就是这两条遮罩,不是各挂各的", () => {
    expect(source("components/library/LibraryDetailLayer.tsx")).toContain('overlayClassName="r22-lib-scrim"');
    expect(source("components/library/LibraryPackDialog.tsx")).toContain('overlayClassName="r22-lib-scrim"');
    expect(source("components/library/ImageEditLayer.tsx")).toContain('overlayClassName="r22-edit-scrim"');
  });
});

/* ── ⑥ 旋转器与进度条归位 ──────────────────────────────────────────────────── */

describe("⑥ 旋转器归位 ui/spinner,进度条归位 ui/progress", () => {
  it("转速与「减弱动效下不转」都只定一次,定在那一件里", () => {
    // 那段注释里逐字写着这两个工具类是为什么在的 —— 所以先把注释剥掉再扫,
    // 否则删掉真正生效的那一份、只留注释,这条照样绿(变异自检第 7 发抓出来的正是这一格)。
    const spinner = source("components/ui/spinner.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(spinner, "转速没有收敛到一处").toContain("[animation-duration:700ms]");
    expect(spinner, "减弱动效下旋转器照转 —— 审计 C-10 的那两处缺口会长回来").toContain("motion-reduce:animate-none");
    // 它得真的落在 className 上,不是躺在文件某处。
    expect(spinner).toMatch(/className=\{cn\("[^"]*motion-reduce:animate-none[^"]*"/);
  });

  it("审计点名的五份手画 keyframes 归零", () => {
    const RETIRED: Array<[string, string]> = [
      ["components/r22/r22-dashboard.css", "r22-otto-spin"],
      ["components/canvas/r22-canvas.css", "r22-spin"],
      ["components/home/r22-home.css", "r22-home-spin"],
      ["components/otto-iq/r22-knowledge-flow.css", "r22-kb-spin"],
      ["components/otto-iq/r22-otto-iq-hub.css", "r22-brand-spin"],
    ];
    for (const [relative, keyframe] of RETIRED) {
      expect(source(relative), `${relative} 还自己画着 ${keyframe}`).not.toContain(`@keyframes ${keyframe}`);
    }
  });

  it("五个调用点都改用了那一件", () => {
    for (const relative of [
      "components/r22/r22-dashboard.css",
      "components/canvas/R22CanvasSurface.tsx",
      "components/home/HomeView.tsx",
      "components/otto-iq/R22OttoIQView.tsx",
      "components/otto/panel/OttoPanelConversation.tsx",
    ]) {
      const text = source(relative);
      const uses = text.includes("<Spinner") || text.includes('[data-slot="spinner"]') || text.includes("r22-otto-mini-ring");
      expect(uses, `${relative} 没接上 ui/spinner`).toBe(true);
    }
    // 不定式进度条换成 Radix 的 progressbar —— 语义由组件出,不再是一个裸 <i> 冒充。
    expect(source("components/otto-iq/R22OttoIQView.tsx")).toContain('<Progress className="r22-kb-progress"');
    expect(source("components/otto-iq/r22-knowledge-flow.css")).toContain("progress-indicator");
  });
});
