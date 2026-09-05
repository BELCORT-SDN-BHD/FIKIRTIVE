// @vitest-environment jsdom
/**
 * FRONT-A15 —— `/create` 起步页:输入框下面那一行价钱(Founder 2026-09-05 裁决②)。
 *
 * 为什么这一页非有不可。起步页按一下发送键,`lib/canvas-entry-actions.ts` 在同一笔事务里
 * 建好一条 `surface="canvas"` 的对话,画布拿到 `pendingFirst` 之后**挂载即把第一轮送出去**
 * (`components/otto/OttoChatStream.tsx` 的预扣 `otto-stream:<userMessageId>`)。也就是说:
 * 第一轮付费对话由这一页按下的那一下发出,而这条路径此前从按下到扣钱**全程零披露** ——
 * 画布门厅那一支挂着的披露被整条路径跳过。Founder 2026-09-05 裁决②松开 2026-09-03 裁决五
 * 的一格,给这一页补上与画布**同一份**文案。
 *
 * 这份文件钉四件:
 *   ① 起步页渲染出来时,那条披露**就在**,而且位置对:在输入框之下、Canvas history 之上。
 *      断言读的是真组件的真 DOM —— 把 `<ConversationCostHint />` 摘掉,这条当场红。
 *   ② 挂的是画布/门厅用的**同一个**组件,不是第二份价目字面量。
 *   ③ 起步页源码里一个手抄的钱数都没有(「界面不许写死价钱」那道围栏此前只点名了披露组件
 *      自己与两位邻居,起步页不在名单里)。手抄一个「4 credits」不会有任何行为测试变红 ——
 *      它只会在下一次调预扣上限时**悄悄**变成假话。
 *   ④ 裁决五点名删掉的那两处**不恢复**:可见的「Create with Otto」标题行,与
 *      「Nothing paid starts before you confirm the exact credits in Canvas.」整句。
 *      松开的只有「这一页不出现价钱」这一格,不是那条裁决本身。
 *
 * 一个 credit 都花不出去:开对话的服务器动作与路由跳转全是替身。
 */
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/canvas-entry-actions", () => ({ createCanvasConversation: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { CreateWorkspace } = await import("@/components/start-something/CreateWorkspace");
const { CONVERSATION_COST_HINT } = await import("@/components/otto/ConversationCostHint");
const { CHAT_HOLD_NOTE } = await import("@/lib/credit-format");

const WEB_ROOT = path.resolve(__dirname, "../..");
const codeOf = (relativePath: string) => fs.readFileSync(path.join(WEB_ROOT, relativePath), "utf8");

const START_PAGE = "components/start-something/StartSomething.tsx";

/** 「12 credits」「0.1 credit」这类**手抄的钱数** —— 与另外三条成本小字围栏用的是同一条正则。 */
const HAND_TYPED_CREDITS = /\d[\d,.]*\s*credits?\b/i;

/** 只扫商家读得到的那部分:注释里解释「这个数怎么来的」是文档,不是文案。 */
function copyLines(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .map((line) => line.trim());
}

const PROJECTS = [{ id: "p-1", name: "Raya campaign", updatedLabel: "1 Aug 2026" }];

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

/** 屏幕上那条披露的元素本体(按商家读到的整句找,不按 class 找)。 */
function hintNode(dom: HTMLElement): Element | undefined {
  return [...dom.querySelectorAll("span")].find((el) => el.textContent === CONVERSATION_COST_HINT);
}

describe("FRONT-A15 起步页:输入框下面那一行价钱", () => {
  it("FRONT-A15 起步页渲染时,对话价目披露就在同一屏上", async () => {
    const dom = await renderWorkspace();

    // 输入框确实画出来了 —— 否则下一条断言会在一张空屏上恒绿。
    expect(dom.querySelector('textarea[aria-label="Otto creation prompt"]')).not.toBeNull();
    expect(dom.textContent, "起步页按一下就开一条要钱的对话,屏幕上却读不到价目").toContain(
      CONVERSATION_COST_HINT,
    );
  });

  it("FRONT-A15 披露在输入框之下、Canvas history 之上", async () => {
    const dom = await renderWorkspace();

    const textarea = dom.querySelector('textarea[aria-label="Otto creation prompt"]')!;
    const hint = hintNode(dom);
    const history = dom.querySelector("h2#canvas-history-heading")!;
    expect(hint, "找不到那条披露").toBeDefined();

    expect(
      textarea.compareDocumentPosition(hint!) & Node.DOCUMENT_POSITION_FOLLOWING,
      "披露跑到输入框上面去了",
    ).toBeGreaterThan(0);
    expect(
      hint!.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING,
      "披露掉到 Canvas history 下面去了",
    ).toBeGreaterThan(0);
  });

  it("FRONT-A15 挂的是画布那一支的同一个组件,不是第二份价目", () => {
    const src = codeOf(START_PAGE);
    expect(src).toContain('import { ConversationCostHint } from "@/components/otto/ConversationCostHint"');
    expect(src.split("<ConversationCostHint />").length - 1, "起步页不是只挂一次").toBe(1);
  });
});

describe("FRONT-A15 起步页不许写死价钱", () => {
  it("FRONT-A15 起步页源码里没有手抄的价钱 —— 数值只能来自那一个共享组件", () => {
    const offenders = copyLines(codeOf(START_PAGE)).filter((line) => HAND_TYPED_CREDITS.test(line));
    expect(offenders, "起步页文案里出现了手抄的钱数").toEqual([]);
  });

  it("FRONT-A15 商家在起步页读到的那句话里,数字与预扣上限同源", () => {
    // 不比字面量:把预扣上限调一格,`CHAT_HOLD_NOTE` 与这句话一起变,这条仍然绿;
    // 而任何人手抄一个数进文案,上一条当场红。
    expect(CONVERSATION_COST_HINT).toContain(CHAT_HOLD_NOTE);
  });
});

describe("FRONT-A15 裁决五那两处不恢复", () => {
  it("FRONT-A15 补了价钱,但标题行与「Nothing paid starts…」那句仍然不在", async () => {
    const dom = await renderWorkspace();

    expect(dom.textContent).not.toContain(
      "Nothing paid starts before you confirm the exact credits in Canvas.",
    );
    expect(dom.textContent).not.toContain("Start with the outcome");
    expect(dom.querySelector("h2#create-with-otto-heading")).toBeNull();
    const headings = [...dom.querySelectorAll("h1, h2, h3")].map((node) => node.textContent);
    expect(headings).not.toContain("Create with Otto");
  });
});
