// @vitest-environment jsdom
/**
 * r22-canvas-vocabulary.test.ts —— 「Canvas 是门,project 是容器」(Founder 2026-08-26 点名)。
 *
 * 病灶:同一样东西在商家眼前有两个名字。侧栏那扇门叫 Canvas,进去之后装东西的那个盒子在
 * 列表页叫 project、在 Library 的空态叫「a canvas」、在删除确认里叫「the canvas」、在
 * Otto 面板里叫「canvas nodes」。商家读到的是三样东西,其实只有一样。
 *
 * 裁决:
 *   · **门与工具叫 Canvas** —— 侧栏那一格、「Continue in Canvas」、「Open in Canvas」;
 *   · **容器一律叫 project** —— 「in their project」「in the project where they were made」;
 *   · 「Canvas projects」这种「Canvas 的 projects」结构留着 —— 商家读起来指代唯一。
 *
 * 两条围栏:
 *   ① **不许再退回去**(ratchet):点名的这几个面里,`canvases`(容器才有复数)与
 *      「a / another / their canvas」(容器才数得清)一个都不许出现。留着的是「the canvas /
 *      this canvas」—— 那说的是**板**,不是盒子(「it landed on the canvas」是对的英文)。
 *   ② **改过的那几句真的在商家屏幕上**(抽查)—— 渲染两面,读 `textContent`,不是读源码
 *      里写了什么字。
 *
 * 变异自查(2026-08-26 逐条**实做**,做完以 commit 为锚还原,红 → 绿):
 *   · `LibraryWorkroom` 的空态改回「Make something on a canvas」 ⇒ ① 那一格红;
 *   · `LibraryDetailLayer` 的按钮改回「Open in canvas」 ⇒ ② 的门名那一条红;
 *   · `R22LibraryView` 的空态改回「Start from a canvas」 ⇒ ① 那一格与 ② 的渲染抽查
 *     两条一起红。
 *
 * 零后端、零生成:文件读取 + 两次纯渲染。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/library",
}));
vi.mock("next/image", () => ({ default: () => null }));

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const { R22LibraryView } = await import("@/components/library/R22LibraryView");
const { R22ProjectsView } = await import("@/components/projects/R22ProjectsView");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");

/**
 * 收进这条 ratchet 的面 —— beta V1 商家真的走得到的那几扇门里,会说到「装东西的盒子」
 * 的每一个文件。`NorthstarHome` / `StartSomething` 不在:今天没有任何一条路由渲染它们
 * (`/create` 走的是 `R22ProjectsEntry`),它们是死面,不是商家读得到的字。
 */
const SURFACES = [
  "app/create/loading.tsx",
  "app/create/page.tsx",
  "components/projects/R22ProjectsView.tsx",
  "components/projects/ProjectStartDialog.tsx",
  "components/projects/project-start.ts",
  "components/create/CreateBrowseSections.tsx",
  "components/library/R22LibraryView.tsx",
  "components/library/LibraryWorkroom.tsx",
  "components/library/LibraryCard.tsx",
  "components/library/LibraryDetailLayer.tsx",
  "components/library/LibraryQuickCreate.tsx",
  "components/home/home-data.ts",
  "components/otto/panel/otto-rooms.ts",
  "components/otto/panel/OttoPanelHost.tsx",
  "components/otto/OttoSchedule.tsx",
] as const;

/** 注释是在交代历史,不是商家读到的字。 */
function sourceCode(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * 「把容器叫成 canvas」长什么样。
 *
 * `canvases` —— 板不数个数,盒子才有复数。
 * 「a / another / their canvas」—— 同理,能数的那个一定是盒子。
 * 后面跟着 `card` / `project` 的放过:「a canvas card」说的是板上那张卡,
 * 「Canvas projects」是「Canvas 的 projects」,商家读起来指代唯一。
 */
const CONTAINER_AS_CANVAS = /\bcanvases\b|\b(?:a|another|their)\s+canvas\b(?!\s+(?:card|project))/i;

/**
 * 商家读得到的那一半:字符串字面量与 JSX 文本。类型名与变量名(`canvases: Read<…>`)
 * 不在其中 —— 这条围栏量的是**措辞**,不是标识符;把标识符也扫进来,唯一的结果是逼着
 * 后来的人给内部字段改名去讨好一条 grep。
 */
function merchantStrings(relative: string, source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\]*)`/g)) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  // JSX 文本只在 `.tsx` 里找 —— 在 `.ts` 里,`Read<HomeCanvas[]>` 这种泛型会被当成一段
  // 「标签之间的字」,于是这条围栏开始对着一个类型声明发脾气。
  if (relative.endsWith(".tsx")) {
    for (const match of source.matchAll(/>([^<>{}]+)</g)) out.push(match[1]!);
  }
  return out;
}

describe("① 容器不许再叫 canvas(ratchet)", () => {
  it.each(SURFACES)("%s 里没有把盒子叫成 canvas", (relative) => {
    const offenders = merchantStrings(relative, sourceCode(relative))
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter((text) => CONTAINER_AS_CANVAS.test(text));

    expect(offenders, `容器叫 project,门与工具才叫 Canvas —— ${relative}`).toEqual([]);
  });
});

/* ── ② 改过的那几句真的在商家屏幕上 ─────────────────────────────────────────── */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
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
  window.sessionStorage.clear();
});

async function render(element: Parameters<Root["render"]>[0]) {
  await act(async () => { root!.render(element); });
  return container!.textContent?.replace(/\s+/g, " ") ?? "";
}

describe("② 抽查:商家真的读到的是那几句", () => {
  it("Library 一件东西都没有时,那句话说的是 Canvas 这扇门", async () => {
    const text = await render(createElement(R22LibraryView, { initialItems: [] }));

    expect(text, "空态没说清楚该去哪").toContain("Start from Canvas");
    expect(text, "空态还在把盒子叫 canvas").not.toMatch(CONTAINER_AS_CANVAS);
  });

  it("Projects 列表页留着「Canvas」这扇门的名字 —— 门不改名", async () => {
    const text = await render(createElement(R22ProjectsView, { projects: [], fixture: true, fixtureState: "empty" }));

    // 「Canvas projects」= Canvas 的 projects,结构本身指代唯一,留着。
    expect(text).toContain("Canvas projects");
  });

  it("详情层那颗按钮与回执那条链子叫的是同一扇门", () => {
    // 同一个动作在两处叫两个名字(「Open in canvas」/「Continue in Canvas」),商家会以为
    // 那是两件事。这条钉的正是「两处逐字对得上门名」。
    expect(sourceCode("components/library/LibraryDetailLayer.tsx")).toContain("Open in Canvas");
    expect(sourceCode("components/library/LibraryWorkroom.tsx")).toContain("Continue in Canvas");
  });
});
