// @vitest-environment jsdom
/**
 * FRONT §7.1 ⑨ —— Create 起步页按已批准设计。
 *
 * 权威是设计夹具 `/product-patterns/create`,也就是
 * `design-system/patterns/canvas/CreateWorkspaceReference.tsx` 与它渲染的
 * `CreationComposer`(surface="entry")。这份测试钉两件事:
 *
 *   ① 主干自己加上去、设计里没有的那两句文案从商家看到的 DOM 里消失了 ——
 *      可见的「Create with Otto」标题行(连同 Otto 头像与副标题)与
 *      「Nothing paid starts before you confirm the exact credits in Canvas.」整句。
 *      钱的披露没有被删掉,它本来就在画布的确认卡上;起步页不启动任何付费动作。
 *   ② 生产组件与夹具组件同源:标题、composer、Canvas history 行、发送键的
 *      class / aria 字串逐条在两边源码里都出现,任何一边先漂移这条就红。
 *
 * 「+ Add context」在生产上不渲染:`createCanvasConversation` 只收
 * `{prompt, requestId}`,handoff 行只存 `{prompt, threadId}`,起步页没有把引用带进画布的
 * 契约。按 Founder 规则①「设计有、后端没有契约的控件不渲染」,并登记在 PR 的
 * 「设计有、生产暂不显示」表里。
 */
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasDisplayName, formatCanvasTitle } from "@/lib/canvas-title";

vi.mock("@/lib/canvas-entry-actions", () => ({ createCanvasConversation: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { CreateWorkspace } = await import("@/components/start-something/CreateWorkspace");

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relativePath: string) => fs.readFileSync(path.join(WEB_ROOT, relativePath), "utf8");

/** 折叠空白后比较:多行 JSX 属性与单行写法不该算作「不同源」。 */
const flat = (source: string) => source.replace(/\s+/g, " ");

const FIXTURE_WORKSPACE = flat(read("design-system/patterns/canvas/CreateWorkspaceReference.tsx"));
const FIXTURE_COMPOSER = flat(read("design-system/patterns/canvas/CreationComposer.tsx"));
const PRODUCTION_WORKSPACE = flat(read("components/start-something/CreateWorkspace.tsx"));
const PRODUCTION_COMPOSER = flat(read("components/start-something/StartSomething.tsx"));
/** 去掉注释后的生产 composer —— 用于「这段字串一处都不该有」这类断言,注释里的说明不算实现。 */
const PRODUCTION_COMPOSER_CODE = flat(
  read("components/start-something/StartSomething.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
);

const PROJECTS = [
  { id: "p-1", name: "Raya campaign", updatedLabel: "1 Aug 2026" },
  { id: "p-2", name: "Weekend tea launch", updatedLabel: "3 Aug 2026" },
];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderWorkspace(projects = PROJECTS) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<CreateWorkspace projects={projects} />));
  return container;
}

describe("FRONT-A14 Create 起步页按已批准设计", () => {
  it("FRONT-A14 主干自加的两句文案不再出现在起步页 DOM 里", async () => {
    const dom = await renderWorkspace();

    expect(dom.textContent).not.toContain("Nothing paid starts before you confirm the exact credits in Canvas.");
    expect(dom.textContent).not.toContain("Start with the outcome");
    // 「Create with Otto」只作为 section 的无障碍名字存在(夹具就是这样),
    // 不再是一行看得见的标题。
    const headings = [...dom.querySelectorAll("h1, h2, h3")].map((node) => node.textContent);
    expect(headings).not.toContain("Create with Otto");
    expect(dom.querySelector('section[aria-label="Create with Otto"]')).not.toBeNull();
    expect(PRODUCTION_WORKSPACE).not.toContain("OttoAvatar");
  });

  it("FRONT-A14 页面结构与夹具一致:一个 Create 标题、一个 composer、一段 Canvas history", async () => {
    const dom = await renderWorkspace();

    expect(dom.querySelector("h1")?.textContent).toBe("Create");
    expect(dom.querySelector("h2#canvas-history-heading")?.textContent).toBe("Canvas history");
    expect(dom.querySelectorAll('section[aria-label="Create with Otto"] textarea')).toHaveLength(1);
    expect(dom.querySelectorAll("h1")).toHaveLength(1);

    const rows = [...dom.querySelectorAll("ul > li > a")];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("href")).toBe("/create/canvas?project=p-1");
    expect(rows[0]?.textContent).toContain("Raya campaign");
    expect(rows[0]?.textContent).toContain("Updated 1 Aug 2026");
  });

  it("FRONT-A14 composer 的输入框与发送键就是夹具的那一个", async () => {
    const dom = await renderWorkspace();

    const textarea = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Otto creation prompt"]')!;
    expect(textarea).not.toBeNull();
    expect(textarea.placeholder).toBe("Describe an image or video to create");

    const send = dom.querySelector<HTMLButtonElement>('button[aria-label="Send prompt"]')!;
    expect(send).not.toBeNull();
    expect(send.type).toBe("submit");
    expect(send.disabled).toBe(true); // 空输入时发送键不可用,和夹具一样
    expect(send.textContent).toBe(""); // 图标键,没有文字标签
  });

  it("FRONT-A14 空的 Canvas history 用设计系统的空态,不是一段裸文字", async () => {
    const dom = await renderWorkspace([]);

    expect(dom.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(dom.textContent).toContain("No canvases yet");
    expect(dom.querySelectorAll("ul > li")).toHaveLength(0);
  });

  it.each([
    'mx-auto w-full max-w-[920px] px-8 py-12',
    'className="text-3xl font-semibold tracking-tight"',
    'aria-label="Create with Otto" className="mx-auto mt-14 max-w-[680px]"',
    'aria-labelledby="canvas-history-heading" className="mx-auto mt-14 max-w-[680px] border-t border-border pt-7"',
    '<h2 id="canvas-history-heading" className="text-sm font-semibold">Canvas history</h2>',
    'className="border-b border-border"',
    'className="group flex items-center gap-3 rounded-[var(--radius)] px-1 py-3 outline-none transition-colors duration-[var(--dur-1)] ease-[var(--ease-standard)] hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none"',
    '<span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-muted"><PanelsTopLeft className="size-4" aria-hidden /></span>',
    '<span className="min-w-0 flex-1">',
    '<span className="block truncate text-sm font-semibold">',
    '<span className="mt-0.5 block truncate text-xs text-muted-foreground">',
    '<ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />',
  ])("FRONT-A14 起步页与夹具 CreateWorkspaceReference 同源:%s", (fragment) => {
    expect(FIXTURE_WORKSPACE).toContain(fragment);
    expect(PRODUCTION_WORKSPACE).toContain(fragment);
  });

  it.each([
    'className="flex-col items-stretch rounded-[var(--radius-card)] bg-background p-2"',
    'aria-label="Otto creation prompt"',
    '"Describe an image or video to create"',
    'w-full px-2.5 py-2 text-base leading-6',
    'min-h-[78px]',
    'aria-label="Send prompt"',
    'size="icon-sm"',
    'variant="otto"',
    '<ArrowUpIcon />',
  ])("FRONT-A14 起步页 composer 与夹具 CreationComposer 同源:%s", (fragment) => {
    expect(FIXTURE_COMPOSER).toContain(fragment);
    expect(PRODUCTION_COMPOSER).toContain(fragment);
  });
});

describe("FRONT-A12 起步页不出现夹具数据,也不出现没有契约的控件", () => {
  it("FRONT-A12 夹具的样板画布与「Review fixture only」一条都不进生产 DOM", async () => {
    const dom = await renderWorkspace();

    for (const fixtureString of [
      "Hari Raya gifting",
      "3 generations · Updated today",
      "Review fixture only",
      "Warm gift-box hero · Library",
      "fikirtive.com/product",
    ]) {
      expect(dom.textContent).not.toContain(fixtureString);
    }
  });

  it("FRONT-A12 「+ Add context」在起步页不渲染:没有把引用带进画布的后端契约", async () => {
    const dom = await renderWorkspace();

    expect(dom.querySelector('button[aria-label="Add a reference"]')).toBeNull();
    expect(dom.textContent).not.toContain("Add context");
    expect(dom.querySelector('input[type="file"]')).toBeNull();
    // 夹具那三条都是只改一个显示字串、什么都不落库的样板动作。生产源码里(注释以外)
    // 一处都不该有。
    expect(FIXTURE_COMPOSER).toContain("Choose from Library");
    expect(PRODUCTION_COMPOSER_CODE).not.toContain("Choose from Library");
    expect(PRODUCTION_COMPOSER_CODE).not.toContain("Add URL");
    expect(PRODUCTION_COMPOSER_CODE).not.toContain("DropdownMenu");
  });
});

describe("FRONT-A15 Canvas history 行的显示层映射（判官 #1174 P2：接线本身此前无测试守）", () => {
  // `canvas-title.test.ts` 钉的是 `formatCanvasTitle`/`canvasDisplayName` 这两个纯函数
  // 本身；这里钉的是 `CreateWorkspace.tsx` 真的把它们接到了 DOM 上——把 `:94` 的
  // `formatCanvasTitle(project.name)` 改回裸的 `{project.name}`，或者删掉 `:91` 的
  // `title={canvasDisplayName(project.name)}`，下面两条断言要先红。

  it("FRONT-A15 legacy 占位名（\"New project\"）在起步页显示为今天的画布词汇，不是裸库名", async () => {
    const legacyName = "New project";
    const dom = await renderWorkspace([{ id: "p-legacy", name: legacyName, updatedLabel: "1 Aug 2026" }]);

    const visible = dom.querySelector<HTMLSpanElement>("ul > li > a span.block.truncate.text-sm.font-semibold");
    expect(visible?.textContent).toBe(formatCanvasTitle(legacyName));
    expect(visible?.textContent).toBe("New canvas");
    expect(visible?.textContent).not.toBe(legacyName); // 裸库名 "New project" 不该直接进商家看到的 DOM

    const link = dom.querySelector<HTMLAnchorElement>("ul > li > a");
    expect(link?.getAttribute("title")).toBe(canvasDisplayName(legacyName));
  });

  it("FRONT-A15 很长的 prompt 名：可见行截断带省略号，title= 是没截断的完整名", async () => {
    const longName =
      "Warm golden hour lifestyle photo of a young family unboxing a new tea gift set on their dining table with soft morning light streaming through the window and steam rising from the teapot";
    const dom = await renderWorkspace([{ id: "p-long", name: longName, updatedLabel: "3 Aug 2026" }]);

    const visible = dom.querySelector<HTMLSpanElement>("ul > li > a span.block.truncate.text-sm.font-semibold");
    expect(visible?.textContent).toBe(formatCanvasTitle(longName));
    expect(visible?.textContent).not.toBe(longName); // 一行放不下,必须截断
    expect(visible?.textContent?.endsWith("…")).toBe(true);

    const link = dom.querySelector<HTMLAnchorElement>("ul > li > a");
    expect(link?.getAttribute("title")).toBe(canvasDisplayName(longName));
    expect(link?.getAttribute("title")).toBe(longName); // title= 兜住完整名,不截断——一次 hover 就够
  });
});

/**
 * FRONT-A15 —— 起步页「渲染出的控件集合与夹具逐控件一致」。
 *
 * 上面 FRONT-A14 各条钉的是「这两句文案不在」与「class 字串同源」;这一组把起步页上
 * **所有**可按的东西整套读出来再比,所以多长一颗键(哪怕没人事先为它写断言)也会红 ——
 * 这就是设计对照要的变异判据:多画一个／少一个都当场红。
 */
describe("FRONT-A15 起步页:整套控件与夹具比集合", () => {
  /** DOM 里所有可按的东西,按屏幕阅读器读到的名字。 */
  function controlNames(dom: HTMLElement): string[] {
    return [...dom.querySelectorAll("button, a, input, [role='button']")].map(
      (el) =>
        el.getAttribute("aria-label") ??
        el.getAttribute("title") ??
        (el.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
  }

  it("FRONT-A15 空画布史时,起步页只有一个发送键 —— 没有第二颗,也没有 Add context", async () => {
    const dom = await renderWorkspace([]);

    expect(controlNames(dom)).toEqual(["Send prompt"]);
    // 夹具的另一颗(「Add a reference」)不在:把引用带进画布的契约还没建
    // (`docs/specs/frontend-baseline.md` §7.3「⑨ 下一刀 · 起步页参考契约」)。
    expect(FIXTURE_COMPOSER).toContain('aria-label="Add a reference"');
    expect(dom.querySelector('[aria-label="Add a reference"]')).toBeNull();
  });

  it("FRONT-A15 有画布史时,多出来的每一项都是一行画布,没有别的控件混进来", async () => {
    const dom = await renderWorkspace();

    expect(controlNames(dom)).toEqual(["Send prompt", "Raya campaign", "Weekend tea launch"]);
  });

  it("FRONT-A15 裁决五点名的标题行与那一句,在 DOM 与源码里都不在", async () => {
    const dom = await renderWorkspace();

    // 屏幕上没有这一行标题(夹具里 "Create with Otto" 只是 section 的无障碍名字)。
    expect(dom.querySelector("h2#create-with-otto-heading")).toBeNull();
    expect(dom.textContent).not.toContain("Nothing paid starts before you confirm the exact credits in Canvas.");
    expect(FIXTURE_WORKSPACE).toContain('aria-label="Create with Otto"');
    expect(PRODUCTION_WORKSPACE).toContain('aria-label="Create with Otto"');
  });

  it("FRONT-A15 裁决六点名的两个控件,起步页也不出现", async () => {
    const dom = await renderWorkspace();

    for (const name of ["Frame select", "Undo", "Redo"]) {
      expect(controlNames(dom)).not.toContain(name);
    }
  });
});
