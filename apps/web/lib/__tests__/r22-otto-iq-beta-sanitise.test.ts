// @vitest-environment jsdom
/**
 * r22-otto-iq-beta-sanitise.test.ts —— Otto IQ 的 beta 卫生大扫除,逐条钉住。
 *
 * Founder 2026-08-26 深夜:「整个 otto IQ 的 flow + UI components 都有问题,会遇到死按钮
 * 或没有意义的东西的情况…把没有用的东西删除(for 这个 beta phase)」。发现阶段台账逐条
 * 点名了十处;这份文件钉的是「删掉之后不许长回来」,以及「留下来的那几处报的是真数」。
 *
 * 每条都在真 DOM 上验,不是读源码字符串 —— 死件的特征恰恰是**源码里看着都在**。
 *
 * 变异自检(逐条实做,做完还原,红 → 绿):
 *   · 卡上的计数改回写死的 `FIXTURE_COUNTS[item.id]` ⇒ ③ 红;
 *   · hub 头部把那颗只开面板的 `Ask Otto` 放回来 ⇒ ① 红;
 *   · Review 提示条与它那一层放回来 ⇒ ② 红;
 *   · 详情层 Scope 改回写死的 `Workspace` ⇒ ⑦ 红;
 *   · Knowledge Base 的 `choose` 那一步与另两条支路放回来 ⇒ ⑤ 红;
 *   · `BETA_HIDDEN_CARDS` 清空 ⇒ ⑨ 红。
 */
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryRow } from "@/lib/memory-actions";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/brand",
}));
vi.mock("@/components/otto/panel/OttoPanelShell", () => ({
  useOttoPanelControls: () => ({ openPanel: vi.fn(), closePanel: vi.fn() }),
}));
vi.mock("@/lib/memory-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/memory-actions")>()),
  addMemory: vi.fn(async () => ({ id: "new-row" })),
  updateMemory: vi.fn(async () => ({ ok: true })),
  deleteMemory: vi.fn(async () => ({ ok: true })),
}));

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const { R22OttoIQView } = await import("@/components/otto-iq/R22OttoIQView");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UPDATED = new Date("2026-08-25T08:42:00.000Z");
const row = (id: string, category: string, content: string, pinned = true): MemoryRow =>
  ({ id, category, content, source: "user", pinned, updatedAt: UPDATED }) as MemoryRow;

/** 三条 style 规则 + 一条 private 的 audience —— 计数与 Scope 两条都要有对象可数。 */
const MEMORY: MemoryRow[] = [
  row("style-1", "style", "Never say “cheap”: use “good value” instead."),
  row("style-2", "style", "Never promise “guaranteed results”."),
  row("style-3", "style", "Never say “bargain”: use “good value” instead."),
  row("audience-1", "audience", "Weekend gift buyer: shops Friday evening.", false),
];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  try { window.sessionStorage.clear(); } catch { /* 存档被锁住时这一面照样能用 */ }
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.replaceChildren();
});

async function mount(element: React.ReactElement): Promise<void> {
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const all = (selector: string): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>(selector)];

function need(selector: string): HTMLElement {
  const node = document.body.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`找不到 ${selector}`);
  return node;
}

function byText(selector: string, text: string): HTMLElement | undefined {
  return all(selector).find((item) => item.textContent?.trim() === text);
}

async function click(node: Element): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function typeInto(node: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 弹层挂在 body 的 portal 上,不在 host 里 —— 读 body 才看得见整屏。 */
const screen = () => document.body.innerHTML.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

const mountHub = (fixture = true) => mount(h(R22OttoIQView, { initialMemory: MEMORY, fixture } as never));

describe("Otto IQ · beta 卫生大扫除(Founder 2026-08-26)", () => {
  it("① hub 头部只剩一颗主键 —— 两颗都叫「Ask Otto」的日子结束了", async () => {
    await mountHub();
    const headerButtons = all(".r22-iq > header button").map((button) => button.textContent!.trim());
    expect(headerButtons, "头部还是两个以上入口").toEqual(["Ask Otto to read your site"]);
    // 留下的那一颗是主键(不是 is-quiet 的次要键),而且开的是那一层收网址的对话。
    const primary = need("[data-otto-iq-research]");
    expect(primary.className).not.toContain("is-quiet");
    await click(primary);
    expect(document.body.querySelector("[data-otto-iq-research-dialog]"), "主键没开出那一层").toBeTruthy();
  });

  it("② Review 提示条与它那一不可完成的层零渲染", async () => {
    await mountHub();
    expect(document.body.querySelector(".r22-iq-nudge"), "提示条又长回来了").toBeNull();
    expect(screen()).not.toContain("Otto noticed");
    expect(screen()).not.toContain("Review Otto suggestions");
    // 承诺 keep 却给不出 keep 的那句话,连同它一起走。
    expect(screen()).not.toContain("Nothing joins Otto IQ until you keep it");
  });

  it("③ 五张卡报的是真数,不是写死的字样", async () => {
    await mountHub();
    const status = (kind: string) => need(`.r22-iq-grid > button[data-kind="${kind}"] em`).textContent!.trim();
    expect(status("style"), "三条 style 规则,卡上要读三条").toBe("3 saved");
    expect(status("audiences")).toBe("1 saved");
    expect(status("sources"), "一条都没有的那一格说人话,不说机器腔").toBe("Nothing here yet");
    expect(screen(), "写死的字样还在").not.toContain("2 rules");
    expect(screen()).not.toContain("Not set up yet");
  });

  it("④ 「Start here」横幅与那颗只发道歉的导出键都不在了,consent 那句留着", async () => {
    await mount(h(R22OttoIQView, { initialMemory: [], fixture: true } as never));
    expect(screen(), "空态横幅与五张卡说的是同一件事").not.toContain("Start here");
    expect(screen()).not.toContain("Export or delete everything");
    expect(screen()).not.toContain("is not switched on yet");
    expect(screen(), "consent 那句是产品承诺,不该跟着删").toContain("Only you choose what is saved here");
  });

  it("⑤ Knowledge Base 按下 Add 直接进能真存下来的那条路,没有文件与链接两条假支路", async () => {
    await mount(h(R22OttoIQView, { initialMemory: [], initialPane: "sources", fixture: true } as never));
    await click(byText(".r22-iq > header button", "Add Knowledge Base")!);
    expect(document.body.querySelector(".r22-kb-picker"), "三选一的选择器又回来了").toBeNull();
    expect(document.body.querySelectorAll(".r22-kb-flow input[type=file]").length, "又能选文件了").toBe(0);
    expect(document.body.querySelector(".r22-kb-flow")!.textContent).toContain("Add text to Knowledge Base");

    // 入口简化之后这条流仍然走得通:填两格 → 真的存进那一面。
    await typeInto(need("#kb-name") as HTMLInputElement, "Candle care");
    await typeInto(need("#kb-body") as HTMLTextAreaElement, "Trim the wick to 5 mm before each burn.");
    await click(byText(".r22-kb-flow button", "Add to Knowledge Base")!);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(screen(), "存不进去了").toContain("Knowledge source saved");
  });

  it("⑥ Audience 四步收成两步,中间那两步只能收来源却读不了", async () => {
    await mount(h(R22OttoIQView, { initialMemory: [], initialPane: "audiences", fixture: true } as never));
    await click(byText(".r22-iq > header button", "Add Audiences")!);
    const steps = all(".r22-audience-steps span").map((step) => step.textContent!.trim());
    expect(steps).toEqual(["1 Basic information", "2 Review"]);
    expect(need(".r22-audience-steps").getAttribute("aria-label")).toBe("Step 1 of 2");
    expect(screen()).not.toContain("Customer stories");
  });

  it("⑦ 详情层与表格的 Scope 读的是那一条自己的可见范围,不再恒为 Workspace", async () => {
    await mount(h(R22OttoIQView, { initialMemory: MEMORY, initialPane: "audiences", fixture: true } as never));
    const cells = all(".r22-iq-rows tbody tr td:nth-child(3)").map((cell) => cell.textContent!.trim());
    expect(cells, "private 的那一条被报成了 Workspace").toEqual(["Private"]);
    await click(need('.r22-iq-rows tbody tr[data-r22-iq-row="audience-1"]'));
    const detail = need(".r22-iq-detail");
    expect(detail.textContent).toContain("Private");
    expect(detail.textContent).not.toContain("Workspace");
  });

  it("⑧ 五张卡左边那一格有真图案,不是一块空色块", async () => {
    await mountHub();
    const tiles = all(".r22-iq-grid > button > i");
    expect(tiles.length).toBe(5);
    expect(tiles.every((tile) => tile.classList.contains("r22-iq-tile")), "插画类名不在场").toBe(true);
    expect(tiles.map((tile) => tile.getAttribute("data-pattern"))).toEqual(["voice", "audiences", "sources", "style", "visual"]);
    // 五张卡各一种形状 —— 同一个 data-pattern 出现两次就等于两张卡长一样。
    expect(new Set(tiles.map((tile) => tile.getAttribute("data-pattern"))).size).toBe(5);
  });

  it("⑨ Brand Voice 在生产上只藏入口:hub 不摆那张卡,那一面本身照旧到得了", async () => {
    await mount(h(R22OttoIQView, { initialMemory: MEMORY, fixture: false } as never));
    expect(all(".r22-iq-grid > button").map((card) => card.getAttribute("data-kind")))
      .toEqual(["audiences", "sources", "style", "visual"]);

    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(h(R22OttoIQView, { initialMemory: MEMORY, initialPane: "voice", fixture: false } as never));
    expect(byText(".r22-iq > header button", "Add Brand Voice"), "那一面被连坐删掉了 —— 说好只藏不删").toBeTruthy();
  });

  it("⑩ Style Guide 不再声称 Otto 会自己提规则(全仓没有那条路)", async () => {
    await mount(h(R22OttoIQView, { initialMemory: [], initialPane: "style", fixture: true } as never));
    await click(byText(".r22-iq > header button", "Add Style Guide")!);
    expect(document.body.querySelector(".r22-style-flow")!.textContent).not.toContain("Otto can suggest rules");
  });

  it("⑪ Visual Guideline 没有那一格选完文件才被拒的 Logo", async () => {
    await mount(h(R22OttoIQView, { initialMemory: [], initialPane: "visual", fixture: true } as never));
    await click(byText(".r22-iq > header button", "Add Visual Guidelines")!);
    await typeInto(need("#visual-name") as HTMLInputElement, "Lilin photography");
    await click(byText(".r22-visual-flow button", "Next")!);
    expect(document.body.querySelectorAll(".r22-visual-flow input[type=file]").length).toBe(0);
    expect(document.body.querySelector(".r22-visual-flow")!.textContent).not.toContain("Logo");
  });
});
