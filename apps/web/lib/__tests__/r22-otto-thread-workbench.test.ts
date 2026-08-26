// @vitest-environment jsdom
/**
 * r22-otto-thread-workbench.test.ts —— 「线程即工作台」的行为闸。
 *
 * Founder 2026-08-26 四条裁决,逐条钉住:
 *   ① 所有 approval 与 status 都走线程/聊天记录 ——「像我在 Claude Code 开 parallel
 *      session:第一个完成时可以回去看报告、回答、继续」;
 *   ② 全站对话组件语言统一 —— creation 与非画布 Otto 是**分开的线程**,零件同一份;
 *   ③ Otto IQ 全托付 —— 商家给一个网址,Otto 整理完在**那个线程里**请他 approve,
 *      批准的落进 Otto IQ 对应的格子;
 *   ④ 线程内问答是生成式 UI 卡,与画布 Ask 卡同族。
 *
 * 这份文件看的全是真挂载之后商家屏幕上的 DOM,与几个纯函数;零后端、零积分。
 *
 * ── 变异自检(逐发实做,做完还原,红 → 绿)────────────────────────────────────
 *   1. `decideResearch` 里删掉 `appendOttoIQSavedRow(...)` 那一行(批准不落格)
 *      ⇒「批准真的落进 Otto IQ 的格子」红;
 *   2. `ThreadStatusPill` 把 state 钉死成 `done` ⇒「三态各画各的」与「等你压过还在跑」红;
 *   3. `advanceOttoResearch` 的 `working` 分支直接 `return state`(进度卡不推进)
 *      ⇒「进度卡逐拍推进」与「走完转等你」红;
 *   4. `withResearch` 不把新状态写回 payload(刷新丢档)⇒「刷新之后回来接着看」红;
 *   5. `ProjectStartDialog` 把 `AskOptionCard` 换回手搓的一排 label + RadioGroup
 *      ⇒「共用零件三处引用同一份」红,外加 `r22-shadcn-composition` 那条围栏一起红;
 *   6. `OttoRoomSwitcher` 的 `room.canvas` 判断改成恒 `null`(creation 行不带回板的路)
 *      ⇒「creation 线程行尾带回板的路」红;
 *   7. `decideOttoResearchCategory` 的 Skip 也写一条进 Otto IQ ⇒「Skip 什么都不落」红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, useState, type FC, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskOptionCard } from "@/components/otto/conversation/ConversationParts";
import { OttoPanelConversation } from "@/components/otto/panel/OttoPanelConversation";
import { OttoRoomSwitcher } from "@/components/otto/panel/OttoRoomSwitcher";
import { buildOttoRooms } from "@/components/otto/panel/otto-rooms";
import {
  OTTO_THREAD_STATE_LABEL,
  canvasMarkOf,
  ottoThreadState,
} from "@/components/otto/conversation/otto-thread-state";
import {
  OTTO_RESEARCH_SAMPLE_SITE,
  OTTO_RESEARCH_STEPS,
  OTTO_RESEARCH_TICK_MS,
  advanceOttoResearch,
  buildOttoResearchThread,
  decideOttoResearchCategory,
  nextOttoResearchOrdinal,
  ottoResearchTicking,
  siteLinkIn,
  startOttoResearch,
  takeOttoSiteResearchRequest,
  requestOttoSiteResearch,
} from "@/components/otto/conversation/otto-research";
import { readOttoIQSavedRows } from "@/components/otto-iq/otto-iq-fixture";
import type { ChatThreadDTO } from "@/lib/types";
import type { OttoPanelSeed } from "@/lib/otto-panel-seed";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");
const NOW_ISO = "2026-08-25T08:42:00.000Z";
const NOW = Date.parse("2026-08-25T09:00:00.000Z");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

function need<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

function all<T extends Element = HTMLElement>(selector: string): T[] {
  return [...document.querySelectorAll<T>(selector)];
}

async function click(el: Element) {
  await act(async () => (el as HTMLElement).click());
}

const SEED: OttoPanelSeed = {
  projectId: "fixture-raya",
  entities: [],
  projects: [{ id: "fixture-raya", name: "Raya launch", pinnedAt: null }],
  threads: [],
  activeThreadId: null,
  balanceUsd: 250,
  userName: "Nadia",
};

/* ── 会话宿主:上层持有线程,与 `OttoPanelHost` 同一条数据流 ────────────────── */

/** 宿主外面留一个把手,好让「刷新」那一条能把当时的线程原样再挂一次。 */
const live: { threads: ChatThreadDTO[] } = { threads: [] };

function conversationHost(initial: ChatThreadDTO[] = [], initialActive: string | null = null) {
  const Host: FC = () => {
    const [threads, setThreads] = useState<ChatThreadDTO[]>(initial);
    const [activeId, setActiveId] = useState<string | null>(initialActive);
    live.threads = threads;
    return createElement(OttoPanelConversation, {
      state: { status: "ready", seed: SEED, threads, activeThreadId: activeId, pendingFirst: null },
      fixture: true,
      onThreadStarted: (thread: ChatThreadDTO) => { setThreads((current) => [thread, ...current.filter((t) => t.id !== thread.id)]); setActiveId(thread.id); },
      onStreamStart: () => {},
      onThreadUpdate: (thread: ChatThreadDTO) => setThreads((current) => current.map((t) => (t.id === thread.id ? thread : t))),
      onActiveThreadChange: () => {},
      onPendingFirstSent: () => {},
    });
  };
  return createElement(Host);
}

/** 商家在输入框里说一句话并按发送。 */
async function say(text: string) {
  const input = need<HTMLInputElement>("#r22-otto-fixture-composer");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => need<HTMLFormElement>("[data-otto-panel-composer]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

/** 把研究推到某一个阶段(拍数由状态机自己说了算,不写死)。 */
async function tickResearchTo(stage: "waiting") {
  for (let i = 0; i < OTTO_RESEARCH_STEPS.length + 2; i += 1) {
    if (document.querySelector('[data-otto-research="waiting"]')) return;
    await act(async () => { vi.advanceTimersByTime(OTTO_RESEARCH_TICK_MS); });
  }
  if (!document.querySelector(`[data-otto-research="${stage}"]`)) throw new Error(`research never reached ${stage}`);
}

/* ── 线程三态 ───────────────────────────────────────────────────────────────── */

function thread(partial: Partial<ChatThreadDTO> & { id: string }): ChatThreadDTO {
  return {
    projectId: "fixture-raya",
    title: partial.id,
    updatedAt: NOW_ISO,
    pinnedAt: null,
    status: null,
    messages: [],
    ...partial,
  };
}

const RESEARCH_MESSAGE = (stage: string) => ({
  id: "m1", role: "AGENT" as const, kind: "TEXT" as const, seq: 1, text: "…",
  payload: { ottoResearch: { site: "harvestcandle.co", stage, step: 0, workedSeconds: 48, categories: [] } },
  genJobId: null, createdAt: NOW_ISO,
});

describe("① 线程三态:推导只有一处,三面读的是同一句话", () => {
  it("状态由线程与它的消息推导出来,而不是三面各判各的", () => {
    expect(ottoThreadState(thread({ id: "a", status: "working" }))).toBe("working");
    expect(ottoThreadState(thread({ id: "b", status: "done" }))).toBe("done");
    expect(ottoThreadState(thread({ id: "c", status: "failed" }))).toBe("failed");
    expect(ottoThreadState(thread({ id: "d", status: null }))).toBe("idle");
  });

  it("「等你」压过「还在跑」——他做得了的事排在他只能干等的事前面", () => {
    const waiting = thread({ id: "e", status: "working", messages: [RESEARCH_MESSAGE("waiting")] });
    expect(ottoThreadState(waiting)).toBe("needs-you");
    const settled = thread({ id: "f", status: "working", messages: [RESEARCH_MESSAGE("done")] });
    expect(ottoThreadState(settled)).toBe("working");
  });

  it("状态词是人话,不是状态机的名字", () => {
    expect(OTTO_THREAD_STATE_LABEL["needs-you"]).toBe("Needs you");
    expect(OTTO_THREAD_STATE_LABEL.failed).toBe("Needs attention");
    expect(Object.values(OTTO_THREAD_STATE_LABEL).join(" ")).not.toMatch(/_|[A-Z]{3,}/);
  });
});

/* ── 线程列表 ───────────────────────────────────────────────────────────────── */

const CANVAS_THREAD = thread({
  id: "t-canvas",
  title: "Raya market stall shots",
  status: "working",
  messages: [{ id: "cm1", role: "USER", kind: "TEXT", seq: 1, text: "Four shots", payload: { ottoCanvas: { projectId: "fixture-raya", projectName: "Raya launch" } }, genJobId: null, createdAt: NOW_ISO }],
});
const WAITING_THREAD = thread({ id: "t-wait", title: "Read harvestcandle.co", status: "working", messages: [RESEARCH_MESSAGE("waiting")] });
const DONE_THREAD = thread({ id: "t-done", title: "Raya launch plan", status: "done" });

function switcher(threads: ChatThreadDTO[]) {
  return createElement(OttoRoomSwitcher, {
    projects: SEED.projects,
    threads,
    activeThreadId: null,
    now: NOW,
    fixture: true,
    onSelectThread: () => {},
    onNewChat: () => {},
    onRenameThread: () => {},
    onSetThreadPinned: () => {},
    onDeleteThread: () => {},
    onRenameProject: () => {},
    onSetProjectPinned: () => {},
    onDeleteProject: () => {},
  });
}

describe("② 线程列表:三态看得见,creation 那几行带一条回板的路", () => {
  it("模型层给每一行带上状态与画布归属", () => {
    const rooms = buildOttoRooms({ threads: [CANVAS_THREAD, WAITING_THREAD, DONE_THREAD], projects: SEED.projects, query: "", now: NOW });
    const byId = new Map([...rooms.today, ...rooms.recent].map((room) => [room.thread.id, room]));
    expect(byId.get("t-canvas")!.state).toBe("working");
    expect(byId.get("t-wait")!.state).toBe("needs-you");
    expect(byId.get("t-done")!.state).toBe("done");
    expect(byId.get("t-canvas")!.canvas).toEqual({ projectId: "fixture-raya", projectName: "Raya launch" });
    expect(byId.get("t-done")!.canvas, "普通对话不该被当成 creation 线程").toBeNull();
  });

  it("三态在列表上各画各的:还在跑一枚转圈、等你一枚琥珀、完成一颗安静的点", async () => {
    await render(switcher([CANVAS_THREAD, WAITING_THREAD, DONE_THREAD]));
    expect(all('[data-otto-thread-state="working"]').length).toBe(1);
    expect(need('[data-otto-thread-state="working"]').querySelector('[data-slot="spinner"]'), "还在跑那一行没有转圈").not.toBeNull();
    expect(need('[data-otto-thread-state="needs-you"]').textContent).toBe("Needs you");
    expect(need('[data-otto-thread-state="done"]').textContent).toContain("Done");
  });

  it("creation 线程与普通对话同列一张表,行尾带一条回它自己那块板的路", async () => {
    await render(switcher([CANVAS_THREAD, DONE_THREAD]));
    const link = need<HTMLAnchorElement>('[data-otto-room-canvas="fixture-raya"]');
    expect(link.textContent).toContain("Canvas");
    expect(link.getAttribute("href")).toContain("project=fixture-raya");
    expect(link.getAttribute("href"), "样张这一支的链接要留在样张里").toContain("fixture=r22");
    expect(document.querySelectorAll("[data-otto-room-canvas]").length, "普通对话不该多出一条回板的路").toBe(1);
  });
});

/* ── 研究托付全链 ───────────────────────────────────────────────────────────── */

describe("③ 研究托付:应承 → 进度 → 等你 → 批准落格 → 完成", () => {
  it("状态机自己走完三步就转「等你」,之后等的是人不是时钟", () => {
    let state = startOttoResearch(OTTO_RESEARCH_SAMPLE_SITE);
    expect(state.stage).toBe("accepted");
    state = advanceOttoResearch(state);
    expect([state.stage, state.step]).toEqual(["working", 0]);
    for (let i = 0; i < OTTO_RESEARCH_STEPS.length - 1; i += 1) state = advanceOttoResearch(state);
    expect([state.stage, state.step]).toEqual(["working", OTTO_RESEARCH_STEPS.length - 1]);
    state = advanceOttoResearch(state);
    expect(state.stage).toBe("waiting");
    expect(ottoResearchTicking(state), "等人的时候不该再排定时器").toBe(false);
    expect(advanceOttoResearch(state), "再敲一下也不许把它推走").toEqual(state);

    // 逐组处置,最后一组落定的那一刻才转完成 —— 剩一组没答就宣布做完是骗人。
    let decided = decideOttoResearchCategory(state, state.categories[0].id, "approved");
    expect(decided.stage).toBe("waiting");
    decided = decideOttoResearchCategory(decided, state.categories[1].id, "skipped");
    decided = decideOttoResearchCategory(decided, state.categories[2].id, "approved");
    expect(decided.stage).toBe("done");
  });

  it("面板里贴一条链接就另开一条线程,并且当场给出应承句与进度卡", async () => {
    vi.useFakeTimers();
    await render(conversationHost());
    await say("Here is my site harvestcandle.co — read it for me.");

    expect(need('[data-otto-research="accepted"]').textContent, "没有说清可以先去忙").toContain("go and do something else");
    expect(need("[data-otto-progress-card]"), "应承之后没有进度卡").not.toBeNull();
    expect(live.threads.length, "研究该另开一条线程,不接在别的对话后面").toBe(1);
    expect(live.threads[0].id).toMatch(/^fixture-research-\d+$/);
    expect(ottoThreadState(live.threads[0]), "开跑的线程该读成「还在跑」").toBe("working");
  });

  it("进度卡逐拍推进,不是一句永恒的「正在处理」", async () => {
    vi.useFakeTimers();
    await render(conversationHost());
    await say(OTTO_RESEARCH_SAMPLE_SITE);
    const stepAt = () => need("[data-otto-progress-card]").getAttribute("data-otto-progress-step");

    expect(stepAt()).toBe("0");
    await act(async () => { vi.advanceTimersByTime(OTTO_RESEARCH_TICK_MS); });
    expect(stepAt(), "第一拍之后还停在原地").toBe("0"); // accepted → working(第 0 步)
    await act(async () => { vi.advanceTimersByTime(OTTO_RESEARCH_TICK_MS); });
    expect(stepAt()).toBe("1");
    await act(async () => { vi.advanceTimersByTime(OTTO_RESEARCH_TICK_MS); });
    expect(stepAt()).toBe("2");
  });

  it("走完就转「等你」:一张实体卡 + 三组可以逐组处置的结果,并且逐字说清是样例", async () => {
    vi.useFakeTimers();
    await render(conversationHost());
    await say(OTTO_RESEARCH_SAMPLE_SITE);
    await tickResearchTo("waiting");

    expect(need("[data-otto-waiting-card]"), "等人的那一刻没有一张实体卡").not.toBeNull();
    expect(all("[data-otto-research-category]").length).toBe(3);
    // 2026-08-26 第 7 件:这一句改走诚实偏离句式 —— 没做成的那件事 + 改做了什么,一句。
    expect(need("[data-otto-waiting-card]").textContent, "没有说清这是样例内容").toContain("is not switched on yet, so I ");
    expect(need("[data-otto-waiting-card]").textContent, "没有说清这是样例内容").toContain("sample lines");
    expect(ottoThreadState(live.threads[0]), "等人的线程该读成「等你」").toBe("needs-you");
  });

  it("批准一组就真的落进 Otto IQ 对应的格子(不是先画个绿标再说)", async () => {
    vi.useFakeTimers();
    await render(conversationHost());
    await say(OTTO_RESEARCH_SAMPLE_SITE);
    await tickResearchTo("waiting");

    expect(readOttoIQSavedRows(), "还没点头就已经存进去了").toEqual([]);
    await click(need('[data-otto-research-approve="voice"]'));

    const saved = readOttoIQSavedRows();
    expect(saved.length).toBe(1);
    expect(saved[0].category, "落错了格子 —— Brand voice 该进 voice").toBe("voice");
    expect(saved[0].content).toContain(OTTO_RESEARCH_SAMPLE_SITE);
    expect(need('[data-otto-research-category="voice"]').getAttribute("data-decision")).toBe("approved");
  });

  it("Skip 什么都不落 —— 跳过的那一组在 Otto IQ 里连一条都不该有", async () => {
    vi.useFakeTimers();
    await render(conversationHost());
    await say(OTTO_RESEARCH_SAMPLE_SITE);
    await tickResearchTo("waiting");

    await click(need('[data-otto-research-skip="audience"]'));
    expect(readOttoIQSavedRows().some((row) => row.id.includes("audience")), "跳过的一组也存进去了").toBe(false);
    expect(need('[data-otto-research-category="audience"]').getAttribute("data-decision")).toBe("skipped");
  });

  it("三组全处置完就转完成:一句回执、一条去 Otto IQ 的路、一行工时", async () => {
    vi.useFakeTimers();
    await render(conversationHost());
    await say(OTTO_RESEARCH_SAMPLE_SITE);
    await tickResearchTo("waiting");

    await click(need('[data-otto-research-approve="voice"]'));
    await click(need('[data-otto-research-approve="products"]'));
    expect(document.querySelector('[data-otto-research="done"]'), "还有一组没处置就宣布完成").toBeNull();
    await click(need('[data-otto-research-skip="audience"]'));

    const done = need('[data-otto-research="done"]');
    expect(done.textContent).toContain("Kept 2 of 3 groups");
    expect(need<HTMLAnchorElement>("[data-otto-research-open-iq]").getAttribute("href")).toBe("/brand?fixture=r22");
    expect(ottoThreadState(live.threads[0])).toBe("done");

    // 工时行收着只占一行,点开才交代做了什么(Linear 形)。
    expect(document.querySelector("[data-otto-worked-steps]")).toBeNull();
    await click(need("[data-otto-worked-line]"));
    expect(all("[data-otto-worked-steps] li").length).toBe(OTTO_RESEARCH_STEPS.length);
  });

  it("刷新之后回来接着看:线程档案里带着整件事走到哪了", async () => {
    vi.useFakeTimers();
    await render(conversationHost());
    await say(OTTO_RESEARCH_SAMPLE_SITE);
    await tickResearchTo("waiting");
    await click(need('[data-otto-research-approve="voice"]'));

    // 「刷新」= 把当时那份线程原样再挂一次(存档形状与 `OttoPanelHost` 落盘的那份相同)。
    const archived = live.threads.map((item) => JSON.parse(JSON.stringify(item)) as ChatThreadDTO);
    await act(async () => root?.unmount());
    container?.remove();
    await render(conversationHost(archived, archived[0].id));

    expect(need('[data-otto-research="waiting"]'), "刷新之后整件事回到了起点").not.toBeNull();
    expect(need('[data-otto-research-category="voice"]').getAttribute("data-decision"), "刷新之后商家刚做的判断没了").toBe("approved");
    expect(readOttoIQSavedRows().length, "刷新之后 Otto IQ 里那条也该还在").toBe(1);
  });

  it("Otto IQ 那扇门留下的条子被面板取走一次就没了 —— 再开一次不会重复开线程", () => {
    requestOttoSiteResearch(OTTO_RESEARCH_SAMPLE_SITE);
    expect(takeOttoSiteResearchRequest()).toBe(OTTO_RESEARCH_SAMPLE_SITE);
    expect(takeOttoSiteResearchRequest()).toBeNull();
  });

  it("两个入口建出来的是同一形状的线程,排号接着上一条数", () => {
    const first = buildOttoResearchThread({ projectId: "p", site: "harvestcandle.co", said: "read it", ordinal: 1, now: NOW_ISO });
    expect(first.status).toBe("working");
    expect(first.messages.map((message) => message.role)).toEqual(["USER", "AGENT"]);
    expect(ottoThreadState(first)).toBe("working");
    expect(nextOttoResearchOrdinal([first])).toBe(2);
  });

  it("认得出商家给的是不是一条链接 —— 一句正常问话不许被当成托付", () => {
    expect(siteLinkIn("harvestcandle.co")).toBe("harvestcandle.co");
    expect(siteLinkIn("read https://harvestcandle.co/about please")).toBe("https://harvestcandle.co/about");
    expect(siteLinkIn("Why is this waiting for review?")).toBeNull();
  });
});

/* ── 共用零件 ───────────────────────────────────────────────────────────────── */

describe("④ 对话零件:三处引用的是同一份", () => {
  const PARTS = "components/otto/conversation/ConversationParts.tsx";

  function source(relative: string): string {
    return readFileSync(path.join(WEB_ROOT, relative), "utf8");
  }

  it("Create 弹窗、画布、Otto 线程三处都 import 自那一份,没有第二份实现", () => {
    const importRe = /from\s+"@\/components\/otto\/conversation\/ConversationParts"/;
    for (const relative of [
      "components/projects/ProjectStartDialog.tsx",
      "components/canvas/R22CanvasSurface.tsx",
      "components/otto/panel/OttoPanelConversation.tsx",
      "components/otto/panel/OttoRoomSwitcher.tsx",
      // 2026-08-26 深夜第 1 件加入的第五个调用点:全屏创作对话。它是 Create 那条主路径
      // 整块地方,问卷卡、动作卡、闸卡、气泡全部取自同一份零件。
      "components/creation/CreationConversation.tsx",
    ]) {
      expect(source(relative), `${relative} 没有接上共用零件`).toMatch(importRe);
    }
    // 手搓的第二份长什么样:自己 import RadioGroup 再自己摆一遍 label。三个调用点都不许有。
    for (const relative of ["components/projects/ProjectStartDialog.tsx", "components/canvas/R22CanvasSurface.tsx"]) {
      expect(source(relative), `${relative} 还留着自己那份单选实现`).not.toMatch(/from\s+"@\/components\/ui\/radio-group"/);
    }
    expect(source(PARTS), "共用零件自己必须是真 RadioGroup").toContain("<RadioGroup");
  });

  it("选项卡是一组真单选,而且**可以跳过**(Klarna 形:问一句不该把人卡住)", async () => {
    const Host: FC = () => {
      const [value, setValue] = useState("");
      const [outcome, setOutcome] = useState("");
      return createElement("div", {},
        createElement(AskOptionCardForTest, { value, setValue, setOutcome }),
        createElement("p", { "data-outcome": "" }, outcome),
      );
    };
    await render(createElement(Host));

    expect(need("[data-otto-ask-card] [data-slot=radio-group]"), "不是一组真单选").not.toBeNull();
    expect(need<HTMLButtonElement>("[data-otto-ask-submit]").disabled, "一个都没选,主动作却是活的").toBe(true);

    await click(need('[data-otto-ask-option="Launch"]'));
    expect(need<HTMLButtonElement>("[data-otto-ask-submit]").disabled).toBe(false);
    await click(need("[data-otto-ask-submit]"));
    expect(need("[data-outcome]").textContent).toBe("answered:Launch");

    await click(need("[data-otto-ask-skip]"));
    expect(need("[data-outcome]").textContent, "跳过这条路没通").toBe("skipped");
  });
});

/** 上面那条要的最小宿主 —— 与 Create 弹窗/画布用的是同一个零件。 */
const AskOptionCardForTest: FC<{ value: string; setValue: (value: string) => void; setOutcome: (value: string) => void }> = ({ value, setValue, setOutcome }) => {
  return createElement(AskOptionCard, {
    idPrefix: "test-ask",
    question: "What is this project for?",
    options: [{ label: "Launch", description: "A new thing going out" }, { label: "Always on", description: "Everyday posting" }],
    value,
    onValueChange: setValue,
    onSubmit: () => setOutcome(`answered:${value}`),
    onSkip: () => setOutcome("skipped"),
  });
};

/* ── 画布 Ask 卡同族 ────────────────────────────────────────────────────────── */

describe("⑤ 画布的问题卡与线程问答卡同族", () => {
  // 2026-08-26 第 2 件之后画布那张卡整张走共用问卷零件(单选、多选、题号、
  // Previous/Skip/Next 全在那一份里),所以这条断言跟着实现走:「画布用的是共用零件」
  // 钉在画布上,「多选是真 Checkbox」钉在现在真的画它的那一份上。
  it("画布的问题卡整张用共用零件,多选那一路也在那一份里", () => {
    const canvas = readFileSync(path.join(WEB_ROOT, "components/canvas/R22CanvasSurface.tsx"), "utf8");
    expect(canvas).toContain("<QuestionnaireCard");
    expect(readFileSync(path.join(WEB_ROOT, "components/otto/conversation/ConversationParts.tsx"), "utf8"), "多选要用真 Checkbox").toContain("<Checkbox");
  });

  it("creation 线程的画布归属只由 `otto-thread-state` 判断,列表不自己再猜一遍", () => {
    expect(canvasMarkOf(CANVAS_THREAD)).toEqual({ projectId: "fixture-raya", projectName: "Raya launch" });
    expect(canvasMarkOf(DONE_THREAD)).toBeNull();
    const switcherSource = readFileSync(path.join(WEB_ROOT, "components/otto/panel/OttoRoomSwitcher.tsx"), "utf8");
    expect(switcherSource, "切换器自己又判了一遍画布归属").not.toMatch(/ottoCanvas/);
  });
});
