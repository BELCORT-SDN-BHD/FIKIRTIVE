// @vitest-environment jsdom
/**
 * R3-F06 —— `/create` 起步页:输入框下面不再常驻那一叠费用说明(Founder 2026-09-14)。
 *
 * 这份文件原本叫 FRONT-A15,钉的是反方向:Founder 2026-09-05 裁决②「输入框下加一行价钱」
 * 给这一页松开一格,后来又补上搜索与上传理解两条,于是这一页的 composer 下面站着三段说明。
 * Founder 2026-09-14 看到那张截图,裁定输入附近这类堆叠的常驻说明不要,跨全部受影响入口
 * 撤掉(`docs/specs/frontend-baseline.md` 等三份规格的 2026-09-14 变更登记,R3-F06,APPROVED;
 * 该裁决明写覆盖 §5 的 2026-09-05 起步页披露落地记录,不以历史要求恢复同类说明)。
 *
 * 翻面之后这份文件钉三件:
 *   ① **那一叠真的不在了** —— 断言读的是真组件的真 DOM,而且同一次渲染里先确认输入框画得
 *      出来,否则「读不到」在一张空屏上恒绿。比的是商家读到的**句子**,不是组件名:
 *      换个组件把同一句话挂回来,这一条照样红。
 *   ② **起步页仍然不许写死价钱**。这一格没有因为说明撤了而松:哪天有人想在这一页写一句
 *      价钱,它必须来自单一来源,而不是手抄一个数(那种假话是悄悄发生的)。
 *   ③ **2026-09-03 裁决五那两处仍然不恢复**:可见的「Create with Otto」标题行,与
 *      「Nothing paid starts before you confirm the exact credits in Canvas.」整句。
 *
 * 撤的只有展示:这一页按一下送出去的第一轮对话**照样计费**(预扣 / 结算 / 退款一个字没动),
 * 价目在 Billing 念,出图仍旧先出确认卡。
 *
 * 一个 credit 都花不出去:开对话的服务器动作与路由跳转全是替身。
 */
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyLines, HAND_TYPED_CREDITS } from "./helpers/price-literal-fence";

vi.mock("@/lib/canvas-entry-actions", () => ({ createCanvasConversation: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { CreateWorkspace } = await import("@/components/start-something/CreateWorkspace");

/** 商家读到的那几句话的开头 —— R3-F06 撤掉的就是它们。比句子不比组件名。 */
const STANDING_COST_SENTENCES = [
  "Uploads are understood automatically",
  "Otto searches the web when your question needs it",
  "Otto checks with you on a card before it makes anything",
  "Each message holds up to",
] as const;

const WEB_ROOT = path.resolve(__dirname, "../..");
const codeOf = (relativePath: string) => fs.readFileSync(path.join(WEB_ROOT, relativePath), "utf8");

const START_PAGE = "components/start-something/StartSomething.tsx";

/** 「手抄的钱数」与「只扫商家读得到的那部分」两条判据,与另外三条成本小字围栏共用同一份
 *  (`helpers/price-literal-fence.ts`;判官 #1227 P2-3 ＝ #1219 P2-4)。 */

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

describe("R3-F06 起步页:输入框下面不再常驻费用说明", () => {
  it("R3-F06 起步页渲染时,输入框在,而那一叠费用说明一段都不在", async () => {
    const dom = await renderWorkspace();

    // 输入框确实画出来了 —— 否则下面的断言会在一张空屏上恒绿。
    expect(dom.querySelector('textarea[aria-label="Otto creation prompt"]')).not.toBeNull();
    for (const sentence of STANDING_COST_SENTENCES) {
      expect(dom.textContent, `「${sentence}」又常驻在起步页输入框附近了`).not.toContain(sentence);
    }
  });

  it("R3-F06 起步页源码里不再挂那三个组件,也没有抄回一份文案", async () => {
    const src = codeOf(START_PAGE);
    for (const gone of ["ConversationCostHint", "SearchCostHint", "UnderstandingCostHint"]) {
      expect(src, `${gone} 又被挂回起步页了`).not.toContain(gone);
    }
    for (const sentence of STANDING_COST_SENTENCES) {
      expect(src, `起步页自己抄了一份「${sentence}」`).not.toContain(sentence);
    }
  });

  it("R3-F06 撤的是说明不是输入框 —— 这一页照样送得出第一轮对话", async () => {
    // 反向活性:如果有人「顺手」把 composer 一起删了,上面两条会全绿而产品是坏的。
    const dom = await renderWorkspace();
    expect(dom.querySelector('textarea[aria-label="Otto creation prompt"]')).not.toBeNull();
    expect(dom.querySelector("h2#canvas-history-heading")).not.toBeNull();
  });
});

describe("R3-F06 起步页仍然不许写死价钱", () => {
  it("R3-F06 起步页源码里没有手抄的价钱 —— 这一格没有因为说明撤了而松", () => {
    const offenders = copyLines(codeOf(START_PAGE)).filter((line) => HAND_TYPED_CREDITS.test(line));
    expect(offenders, "起步页文案里出现了手抄的钱数").toEqual([]);
  });
});

describe("裁决五那两处仍然不恢复(2026-09-03,R3-F06 未松开这一格)", () => {
  it("标题行与「Nothing paid starts…」那句仍然不在", async () => {
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
