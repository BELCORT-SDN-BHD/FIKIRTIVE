// @vitest-environment jsdom
/**
 * r22-creation-conversation.test.ts —— Founder 2026-08-26 深夜七件的行为闸。
 *
 * 七件逐件钉住,看的全是**真挂载之后商家屏幕上的 DOM**、真的按下去之后发生的事、以及
 * 浏览器里真的存下的东西;零后端、零积分、零源码字面量断言(唯一的例外是那条「板上那张
 * 任务卡零残留」——它量的正是「源码里还有没有那个东西」)。
 *
 *   ① Create → 全屏创作对话:开合、产物落 Library、线程进面板那张表;
 *   ② 问卷卡:题号计数、字母键真的选得中、多选、Previous / Skip / Next;
 *   ③ `@`:候选浮出来、选中成芯、拔芯把句子里那一段一起拿走、发出去的消息带引用;
 *   ④ 板上那张任务卡零渲染、状态改由 Otto 头部承担;新项目开局不配「已完成」的话;
 *   ⑤ 答尾动作卡:每一张点了都真做;
 *   ⑥ 线程内 cr 闸卡:余额不够时出现,主键充值之后**接着把那一次跑完**;
 *   ⑦ 诚实偏离句式:模板本身 + 两处真实例(创作链的视频、研究链的样例摘录)。
 *
 * ── 变异自检(逐发实做,做完还原,红 → 绿)────────────────────────────────────
 *   1. `CreationConversation` 的落地回调里删掉 `onFile(assets)` ⇒ ①「产物落 Library」红;
 *   2. `upsertOttoFixtureThread` 直接 `return false` ⇒ ①「线程进那张表」红;
 *   3. `QuestionnaireCard` 的 `onKeyDown` 里去掉字母那一支 ⇒ ②「按 B 就选中 B」红;
 *   4. `QuestionnaireCard` 的多选分支改成单选(`onSelectedChange([label])`)⇒ ②「多选留得住两个」红;
 *   5. `questionnaireCountLabel` 改成从 0 起数 ⇒ ②「Question 1 of 2」红;
 *   6. `MentionField.drop` 只摘芯片、不改文本 ⇒ ③「拔芯把句子里那一段一起拿走」红;
 *   7. `run()` 里把 `creationCanAfford` 那道闸删掉 ⇒ ⑥「余额不够出闸卡」红;
 *   8. 闸卡主键里只 `setBalance(+N)`、不接着 `run(...)` ⇒ ⑥「充值之后接着跑完」红;
 *   9. 动作卡「Keep these in Starred」的 `onRun` 改成只 `push(一句话)` ⇒ ⑤「真的星标」红;
 *  10. `honestDeviationLine` 只还回前半句 ⇒ ⑦ 全红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToasts, installToastEnvironment, withToaster } from "./__helpers__/toast-probe";
installToastEnvironment();

import type { ImmersiveCanvasRuntimeContext } from "@/components/canvas/NorthstarCanvasWorkspace";
import type { LibraryArchive } from "@/components/library/library-fixture";
import type { ChatThreadDTO } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/library",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/canvas-actions", () => ({ listCanvasNodes: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: () => "canvas-action-test",
  useCanvasGen: () => ({ generateImage: vi.fn(), quoteCosts: vi.fn(), imageShapes: vi.fn() }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const { LibraryWorkroom } = await import("@/components/library/LibraryWorkroom");
const { R22CanvasSurface } = await import("@/components/canvas/R22CanvasSurface");
const { LIBRARY_FIXTURE_KEY, readLibraryArchive } = await import("@/components/library/library-fixture");
const { honestDeviationLine } = await import("@/components/otto/conversation/honest-deviation");
const { OTTO_RESEARCH_SAMPLE_NOTE } = await import("@/components/otto/conversation/otto-research");
const { ottoPanelFixtureStorageKey, upsertOttoFixtureThread } = await import("@/components/otto/conversation/otto-thread-archive");
const { questionnaireCountLabel, questionnaireLetter } = await import("@/components/otto/conversation/ConversationParts");
const { applyMentionPick, filterMentionCandidates } = await import("@/components/otto/conversation/MentionField");
const { CREATION_FIXTURE_START_CREDITS, creationBalanceLine, creationCanAfford } = await import("@/components/creation/creation-fixture");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");
const WORKSPACE_ID = "batik-house";
const libraryKey = `${LIBRARY_FIXTURE_KEY}:${WORKSPACE_ID}`;
/** 一次生成从排上到落地的样张节拍(`CREATION_RUN_MS` 720ms,留一点余量)。 */
const RUN_MS = 900;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mount(element: ReactElement): Promise<void> {
  await act(async () => { root!.render(withToaster(element)); });
  await act(async () => { await Promise.resolve(); });
}

/** 全屏对话是 Radix Dialog —— portal 到 `document.body`,只在 container 里翻永远找不到。 */
function pop<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function need<T extends Element>(selector: string): T {
  const node = pop<T>(selector) ?? container!.querySelector<T>(selector);
  expect(node, `找不到 ${selector} —— 下面的断言在核对空气`).not.toBeNull();
  return node as T;
}

function all<T extends Element>(selector: string): T[] {
  return [...document.querySelectorAll<T>(selector)];
}

async function click(node: Element | null): Promise<void> {
  expect(node, "要点的那个东西不在屏幕上").not.toBeNull();
  await act(async () => { (node as HTMLElement).click(); });
}

async function type(input: HTMLTextAreaElement | HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      value === undefined ? {} : Object.getPrototypeOf(input),
      "value",
    )?.set;
    setter?.call(input, value);
    input.selectionStart = value.length;
    input.selectionEnd = value.length;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(node: Element, key: string): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

async function tick(ms: number): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

const openLibrary = () => mount(createElement(LibraryWorkroom, {}));

/**
 * 此刻选中的是第几行(0 起)。
 *
 * 判词写成全等而不是 `match(/checked/)` —— Radix 的**未**选中态是 `data-state="unchecked"`,
 * 里面也含着 `checked` 这几个字母,松判词会把整排都算成选中,然后一条本该抓错的断言
 * 永远是绿的。
 */
function chosenLabels(): number[] {
  return all<HTMLElement>("[data-otto-quiz-option]")
    .map((node, index) => ({ index, state: node.getAttribute("data-state") ?? node.getAttribute("aria-checked") ?? "" }))
    .filter((row) => row.state === "checked" || row.state === "true")
    .map((row) => row.index);
}

/** Create → 全屏对话,并把一句**说得清楚**的话发出去(说不清楚会先出问卷)。 */
async function openCreation(): Promise<void> {
  await openLibrary();
  await click(need("[data-r22-lib-create]"));
}

function composer(): HTMLTextAreaElement {
  return need<HTMLTextAreaElement>("[data-r22-creation-composer] textarea");
}

async function say(text: string): Promise<void> {
  const input = composer();
  await type(input, text);
  await act(async () => {
    need("[data-r22-creation-composer]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function archive(): LibraryArchive {
  return readLibraryArchive(libraryKey);
}

/* ── ① Create → 全屏创作对话 ────────────────────────────────────────────────── */

describe("① Create 是一块地方,不是一条输入框", () => {
  it("按 Create 开出全屏对话:左产物、右线程,composer 在线程那一栏的底部", async () => {
    await openCreation();
    expect(pop("[data-r22-creation-full]"), "Create 没开出全屏对话").not.toBeNull();
    expect(pop("[data-r22-creation-art]"), "左边那栏产物区不在").not.toBeNull();
    expect(pop("[data-r22-creation-thread]"), "右边那条线程不在").not.toBeNull();
    expect(pop("[data-r22-creation-composer]"), "composer 不在线程那一栏里").not.toBeNull();
  });

  it("Quick create 那条轻入口原样留着,而且开的是另一件东西", async () => {
    await openLibrary();
    await click(need("[data-r22-lib-quick]"));
    expect(pop("[data-r22-lib-make]"), "Quick create 浮条被弄丢了").not.toBeNull();
    expect(pop("[data-r22-creation-full]"), "轻入口不该开出全屏对话").toBeNull();
  });

  it("做出来的东西同时落进 Library 存档,并出现在左边那一栏", async () => {
    await openCreation();
    const before = archive().assets.length;
    await say("Four candles on a market stall in warm morning light");
    await tick(RUN_MS);
    expect(all("[data-r22-creation-asset]").length, "左栏没有产物").toBeGreaterThan(0);
    expect(archive().assets.length, "做出来的东西没有进 Library 存档").toBeGreaterThan(before);
  });

  it("这一场创作进面板那张会话表,归属写在消息上(列表因此自己长得出回板的路)", async () => {
    // 面板存档还没建起来时不凭空造表(会把面板自己的种子顶掉),所以先放一张空表。
    window.sessionStorage.setItem(ottoPanelFixtureStorageKey(WORKSPACE_ID), JSON.stringify({ projects: [], threads: [], activeThreadId: null }));
    await openCreation();
    await say("Four candles on a market stall in warm morning light");
    await tick(RUN_MS);
    const stored = JSON.parse(window.sessionStorage.getItem(ottoPanelFixtureStorageKey(WORKSPACE_ID))!) as { threads: ChatThreadDTO[] };
    expect(stored.threads.length, "creation 线程没进那张表").toBe(1);
    expect(stored.threads[0]!.messages[0]!.payload, "线程没带回板的归属").toMatchObject({ ottoCanvas: { projectId: expect.any(String) } });
  });

  it("同一场再落一批不会在表里多出一行 —— 一场是一条会长的线程", async () => {
    window.sessionStorage.setItem(ottoPanelFixtureStorageKey(WORKSPACE_ID), JSON.stringify({ projects: [], threads: [], activeThreadId: null }));
    await openCreation();
    await say("Four candles on a market stall in warm morning light");
    await tick(RUN_MS);
    await say("Now the same shot with the gift box beside it");
    await tick(RUN_MS);
    const stored = JSON.parse(window.sessionStorage.getItem(ottoPanelFixtureStorageKey(WORKSPACE_ID))!) as { threads: ChatThreadDTO[] };
    expect(stored.threads.length, "同一场创作开了第二行").toBe(1);
  });

  it("存档还没建起来时不凭空造一张表(否则面板自己的种子会被顶掉)", () => {
    expect(upsertOttoFixtureThread(WORKSPACE_ID, { id: "x", projectId: "p", title: "t", updatedAt: "", pinnedAt: null, status: "done", messages: [] })).toBe(false);
    expect(window.sessionStorage.getItem(ottoPanelFixtureStorageKey(WORKSPACE_ID))).toBeNull();
  });
});

/* ── ② 问卷 ─────────────────────────────────────────────────────────────────── */

describe("② 问卷卡:题号、字母键、多选、Previous / Skip / Next", () => {
  /** 一句太含糊的话 —— 判词与 Library 快产车间同一条(`isVagueCreationRequest`)。 */
  const VAGUE = "make something nice";

  async function openQuiz(): Promise<void> {
    await openCreation();
    await say(VAGUE);
  }

  it("含糊的一句话先出问卷,左上写着 Question 1 of 2", async () => {
    await openQuiz();
    expect(pop("[data-otto-quiz-card]"), "含糊的一句话直接开跑了").not.toBeNull();
    // 逐字钉住,不是拿同一个函数两边一起算 —— 那样把「从 1 起数」改成「从 0 起数」,
    // 断言的两边会一起挪,闸就永远绿着(变异自检第 5 发正是这么抓出来的)。
    expect(need("[data-otto-quiz-count]").textContent).toContain("Question 1 of 2");
    expect(questionnaireCountLabel(0, 2)).toBe("Question 1 of 2");
  });

  it("每一行右端那枚字母角标就是真的按得动的那个键", async () => {
    await openQuiz();
    const keys = all("[data-otto-quiz-key]").map((node) => node.getAttribute("data-otto-quiz-key"));
    expect(keys.slice(0, 3)).toEqual([questionnaireLetter(0), questionnaireLetter(1), questionnaireLetter(2)]);
    const card = need("[data-otto-quiz-card]");
    await press(card, "b");
    expect(chosenLabels(), "按 B 没选中第二行").toEqual([1]);
  });

  it("Next 在没选之前按不动,选完就活过来", async () => {
    await openQuiz();
    expect(need<HTMLButtonElement>("[data-otto-quiz-next]").disabled, "什么都没选就能往下走").toBe(true);
    await press(need("[data-otto-quiz-card]"), "a");
    expect(need<HTMLButtonElement>("[data-otto-quiz-next]").disabled).toBe(false);
  });

  it("第二道是多选:两个都选得住,而且题号跟着走到 2 of 2", async () => {
    await openQuiz();
    await press(need("[data-otto-quiz-card]"), "a");
    await click(need("[data-otto-quiz-next]"));
    expect(need("[data-otto-quiz-count]").textContent).toContain("Question 2 of 2");
    await press(need("[data-otto-quiz-card]"), "a");
    await press(need("[data-otto-quiz-card]"), "c");
    expect(chosenLabels(), "多选只留得住一个 —— 那不是多选").toEqual([0, 2]);
  });

  it("Previous 回得去,而且回去看到的是他上次真选的那一个", async () => {
    await openQuiz();
    await press(need("[data-otto-quiz-card]"), "b");
    await click(need("[data-otto-quiz-next]"));
    await click(need("[data-otto-quiz-previous]"));
    expect(need("[data-otto-quiz-count]").textContent).toContain("Question 1 of 2");
    expect(chosenLabels(), "回到上一题看到的是空白").toEqual([1]);
  });

  it("第一道题上没有 Previous —— 没有可回去的地方就不画那颗键", async () => {
    await openQuiz();
    expect(pop("[data-otto-quiz-previous]")).toBeNull();
  });

  it("Skip 一路跳到底照样跑得起来 —— 问一句不该把人卡住", async () => {
    await openQuiz();
    await click(need("[data-otto-quiz-skip]"));
    await click(need("[data-otto-quiz-skip]"));
    expect(pop("[data-otto-quiz-card]"), "跳完还挂在那儿").toBeNull();
    await tick(RUN_MS);
    expect(all("[data-r22-creation-asset]").length, "跳完之后什么都没做出来").toBeGreaterThan(0);
  });
});

/* ── ③ @ 引用 ──────────────────────────────────────────────────────────────── */

describe("③ composer 的 @:承诺了就得真的做得到", () => {
  it("打一个 @ 就浮出候选表", async () => {
    await openCreation();
    await type(composer(), "put it next to @");
    expect(pop("[data-otto-mention-popover]"), "@ 打下去什么都没有").not.toBeNull();
    expect(all("[data-otto-mention-option]").length).toBeGreaterThan(0);
  });

  it("上下键 + Enter 选中,composer 里换成 @名字,芯片跟着出现", async () => {
    await openCreation();
    await type(composer(), "put it next to @");
    const first = all<HTMLElement>("[data-otto-mention-option]")[0]!;
    const id = first.getAttribute("data-otto-mention-option")!;
    await press(composer(), "ArrowDown");
    await press(composer(), "Enter");
    expect(composer().value, "选中之后句子里没有那个名字").toContain("@");
    expect(pop(`[data-otto-mention-chip]`), "选中了却没有芯片").not.toBeNull();
    expect(id.length).toBeGreaterThan(0);
  });

  it("拔掉芯片同时把句子里那一段 @名字 一起拿走 —— 两边不许各说各的", async () => {
    await openCreation();
    await type(composer(), "put it next to @");
    await press(composer(), "Enter");
    const before = composer().value;
    await click(need("[data-otto-mention-chip-remove]"));
    expect(composer().value.length, "只摘了芯片,句子里那一段还在").toBeLessThan(before.length);
    expect(pop("[data-otto-mention-chip]")).toBeNull();
  });

  it("发出去的那条消息带着这一次的引用", async () => {
    await openCreation();
    await type(composer(), "make one more like @");
    await press(composer(), "Enter");
    const withMention = composer().value;
    await say(`${withMention} in warm light please`);
    expect(need("[data-r22-creation-said]")?.getAttribute("data-r22-creation-said")).toBeTruthy();
    expect(document.querySelector("[data-r22-creation-refs]"), "消息记录没带引用").not.toBeNull();
  });

  it("画布 composer 的占位句承诺了 @,那一面也真的 @ 得动", async () => {
    const runtimeContext: ImmersiveCanvasRuntimeContext = {
      projects: [{ id: "project-a", name: "Raya launch" }],
      threads: [],
      activeProjectId: "project-a",
      activeThreadId: null,
      initialBalance: null,
      visualFixture: "r22",
    };
    await mount(createElement(R22CanvasSurface, { runtimeContext, entities: [] }));
    const input = need<HTMLTextAreaElement>("[data-r22-canvas-composer] textarea");
    expect(input.getAttribute("placeholder"), "画布占位句没承诺 @").toContain("@");
    await type(input, "more like @");
    expect(pop("[data-otto-mention-popover]"), "画布上 @ 打下去什么都没有").not.toBeNull();
  });

  it("纯函数:候选按打出来的字滤,插进去的那一段带着光标一起还回来", () => {
    const all = [
      { id: "a", name: "Teal batik candle 1", group: "Library" },
      { id: "b", name: "Raya launch", group: "Projects" },
    ];
    expect(filterMentionCandidates(all, "raya").map((row) => row.id)).toEqual(["b"]);
    expect(filterMentionCandidates(all, "").length, "还没打字时给的该是全表").toBe(2);
    const applied = applyMentionPick("more like @ba", 13, "Teal batik candle 1");
    expect(applied.text).toBe("more like @Teal batik candle 1 ");
    expect(applied.caret).toBe(applied.text.length);
  });
});

/* ── ④ 板上那张任务卡 / 新项目开局 ─────────────────────────────────────────── */

describe("④ 板上不再有那张任务卡,空板也不配完成语", () => {
  const canvasSource = readFileSync(path.join(WEB_ROOT, "components/canvas/R22CanvasSurface.tsx"), "utf8");

  it("源码里那张浮卡零残留(CSS 那一份也是)", () => {
    expect(canvasSource).not.toContain('className={`r22-canvas-job');
    expect(readFileSync(path.join(WEB_ROOT, "components/canvas/r22-canvas.css"), "utf8")).not.toContain(".r22-canvas-job {");
  });

  it("状态没丢:它搬到 Otto 头部那一格上了", () => {
    expect(canvasSource).toContain('"data-canvas-job-status": fixtureJob.status');
  });

  it("空板上的开局话里没有「已完成」那一族", async () => {
    const runtimeContext: ImmersiveCanvasRuntimeContext = {
      projects: [{ id: "project-a", name: "New project" }],
      threads: [],
      activeProjectId: "project-a",
      activeThreadId: null,
      initialBalance: null,
      visualFixture: "r22",
    };
    // 空工作区 = 板上没有开局那一批(`EmptyWorld` 那一支)。
    window.sessionStorage.setItem("r22:workspace-directory:v1", JSON.stringify({ activeId: "fresh", workspaces: [{ id: "fresh", name: "Fresh", role: "Admin" }] }));
    await mount(createElement(R22CanvasSurface, { runtimeContext, entities: [] }));
    const otto = need("[data-r22-canvas-otto]").textContent ?? "";
    expect(otto, "空板配了一段完成汇报").not.toContain("All 4 images are done");
    expect(otto, "空板配了一段完成汇报").not.toContain("landed on the canvas");
    expect(otto).toContain("Your brief is loaded");
  });
});

/* ── ⑤ 答尾动作卡 ──────────────────────────────────────────────────────────── */

describe("⑤ 答尾动作卡:零死卡", () => {
  it("落地之后长出动作卡,而且不是空的一列", async () => {
    await openCreation();
    await say("Four candles on a market stall in warm morning light");
    await tick(RUN_MS);
    expect(pop("[data-otto-action-cards]"), "落地之后没有动作卡").not.toBeNull();
    expect(all("[data-otto-action-card]").length).toBeGreaterThanOrEqual(2);
  });

  it("「Keep these in Starred」按下去**真的**在存档里星标了那几张", async () => {
    await openCreation();
    await say("Four candles on a market stall in warm morning light");
    await tick(RUN_MS);
    const madeIds = archive().assets.filter((asset) => asset.id.startsWith("quick:full-")).map((asset) => asset.id);
    expect(madeIds.length, "这一次什么都没做出来 —— 下面的断言在核对空气").toBeGreaterThan(0);
    expect(archive().assets.filter((asset) => madeIds.includes(asset.id)).every((asset) => asset.starred), "还没按就已经星标了").toBe(false);
    await click(need('[data-otto-action-card="star-these"]'));
    expect(archive().assets.filter((asset) => madeIds.includes(asset.id)).every((asset) => asset.starred), "按了动作卡,存档里什么都没动").toBe(true);
  });

  it("「Make a matching video」按下去真的再跑一次,而且产物多出来", async () => {
    await openCreation();
    await say("Four candles on a market stall in warm morning light");
    await tick(RUN_MS);
    const before = all("[data-r22-creation-asset]").length;
    await click(need('[data-otto-action-card="matching-video"]'));
    await tick(RUN_MS);
    expect(all("[data-r22-creation-asset]").length, "动作卡按了什么都没做出来").toBeGreaterThan(before);
  });

  it("画布的答案尾部也接上了同一份零件", async () => {
    const runtimeContext: ImmersiveCanvasRuntimeContext = {
      projects: [{ id: "project-a", name: "Raya launch" }],
      threads: [],
      activeProjectId: "project-a",
      activeThreadId: null,
      initialBalance: null,
      visualFixture: "r22",
    };
    await mount(createElement(R22CanvasSurface, { runtimeContext, entities: [] }));
    const input = need<HTMLTextAreaElement>("[data-r22-canvas-composer] textarea");
    await type(input, "Why is this waiting for review?");
    await act(async () => {
      need("[data-r22-canvas-composer]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await tick(50);
    expect(document.querySelector("[data-otto-action-cards]"), "画布答案尾部没有动作卡").not.toBeNull();
  });
});

/* ── ⑥ 线程内 cr 闸卡 ──────────────────────────────────────────────────────── */

describe("⑥ 闸长在线程里,不弹一层全局窗", () => {
  it("余额够的时候不出闸卡", async () => {
    await openCreation();
    await say("Four candles on a market stall in warm morning light");
    await tick(RUN_MS);
    expect(pop("[data-otto-gate-card]"), "余额还够就先拦人").toBeNull();
  });

  it("连着做几次把余额耗到不足,闸卡就在线程里出现,而且写清还差多少", async () => {
    await openCreation();
    for (let round = 0; round < 4; round += 1) {
      await say("Four candles on a market stall in warm morning light");
      await tick(RUN_MS);
    }
    const gate = need("[data-otto-gate-card]");
    expect(gate, "余额耗光了也没有闸").not.toBeNull();
    expect(need("[data-otto-gate-balance]").textContent, "闸卡没说还差多少").toMatch(/cr left/);
  });

  it("主键充值之后**接着把那一次跑完** —— 不是让商家再说一遍", async () => {
    await openCreation();
    for (let round = 0; round < 4; round += 1) {
      await say("Four candles on a market stall in warm morning light");
      await tick(RUN_MS);
    }
    const before = all("[data-r22-creation-asset]").length;
    await click(need("[data-otto-gate-primary]"));
    await tick(RUN_MS);
    expect(pop("[data-otto-gate-card]"), "充完值闸卡还挂在那儿").toBeNull();
    expect(all("[data-r22-creation-asset]").length, "充了值却没接着跑").toBeGreaterThan(before);
  });

  it("次键「Not now」只把闸卡收起来,一分钱不动", async () => {
    await openCreation();
    for (let round = 0; round < 4; round += 1) {
      await say("Four candles on a market stall in warm morning light");
      await tick(RUN_MS);
    }
    const assets = all("[data-r22-creation-asset]").length;
    await click(need("[data-otto-gate-secondary]"));
    await tick(RUN_MS);
    expect(pop("[data-otto-gate-card]")).toBeNull();
    expect(all("[data-r22-creation-asset]").length).toBe(assets);
  });

  it("纯函数:够不够与那一行字都只有一个出处", () => {
    expect(creationCanAfford(CREATION_FIXTURE_START_CREDITS, CREATION_FIXTURE_START_CREDITS)).toBe(true);
    expect(creationCanAfford(2, 3)).toBe(false);
    expect(creationBalanceLine(2, 3)).toBe("2 cr left · this one needs 3 cr");
  });
});

/* ── ⑦ 诚实偏离句式 ────────────────────────────────────────────────────────── */

describe("⑦ 做不到的那件事:一句,两半都在", () => {
  it("模板本身两半齐 —— 没做成的那件事 + 改做了什么", () => {
    const line = honestDeviationLine("A video you can play", "made a still frame from it");
    expect(line).toBe("A video you can play is not switched on yet, so I made a still frame from it instead.");
    expect(line, "少了「我改做了什么」那半句").toContain(" so I ");
  });

  it("实例一:研究链呈上来的摘录用的就是这一句", () => {
    expect(OTTO_RESEARCH_SAMPLE_NOTE).toContain("is not switched on yet, so I ");
    expect(OTTO_RESEARCH_SAMPLE_NOTE).toContain("sample lines");
  });

  it("实例二:创作链做了一段视频概念时,那一句贴在产物旁边", async () => {
    await openCreation();
    await click(need('[data-r22-creation-kind="video"]'));
    await say("A slow pan across the candle shelf in warm morning light");
    await tick(RUN_MS);
    const line = need("[data-r22-creation-deviation]").textContent ?? "";
    expect(line).toContain("is not switched on yet, so I ");
    expect(line).toContain("still frame");
  });

  it("做得成的那一次不挂这句话 —— 它是偏离报告,不是常驻免责段", async () => {
    await openCreation();
    await say("Four candles on a market stall in warm morning light");
    await tick(RUN_MS);
    expect(pop("[data-r22-creation-deviation]"), "什么都没偏离也在道歉").toBeNull();
  });
});
