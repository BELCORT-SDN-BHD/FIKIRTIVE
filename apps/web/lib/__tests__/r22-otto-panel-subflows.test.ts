// @vitest-environment jsdom
/**
 * r22-otto-panel-subflows.test.ts —— Otto 面板的四条子流,行为级。
 *
 * Founder 2026-08-25 按 Cloudflare 那套面板逐条点名的四件事,一件都不能少:
 *   ① Giving feedback —— 每张答案卡自带 Helpful / Not helpful,按下去有回执,而且回执
 *      不许声称「已提交到什么地方」(它没有);
 *   ② Copying a chat —— Copy 真的写进剪贴板,`aria-live` 说 "Copied";
 *   ③ Switching a room chat —— 标题那颗按钮开的是原型那层切换器(搜索 / Today / Recent /
 *      一句尾注),切一条就换一段消息流,而不是把正在读的那段盖掉;
 *   ④ Switching to fullscreen view —— Expand 是**全屏接管**:面板铺满、主内容 `inert`、
 *      role=dialog + aria-modal、Esc 退回停靠。
 *
 * 视觉与文案权威 = R22 原型 `preserved/prototype-2026-08-24-r22/fikirtive-prototype-r22.html`
 * 的 `responseFor` / `answerHTML` / `renderRooms` / `setFullscreen`(L5867-5890、L6692-6744)。
 *
 * 零后端、零 provider、零积分:下面看的全是真挂载之后商家屏幕上的 DOM,与四个纯函数。
 */
import { act, createElement, useState, type FC, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OttoPanelShell, type OttoPanelShellProps } from "@/components/otto/panel/OttoPanelShell";
import { OttoPanelConversation } from "@/components/otto/panel/OttoPanelConversation";
import { OttoRoomSwitcher, OTTO_ROOMS_ID } from "@/components/otto/panel/OttoRoomSwitcher";
import {
  OTTO_ANSWER_CONFIRM,
  OTTO_ANSWER_ERROR_NOTE,
  OTTO_ANSWER_ERROR_TITLE,
  OTTO_ANSWER_WAIT_LABEL,
  OTTO_ANSWER_WAIT_MS,
  ottoAnswerCopyText,
  ottoAnswerShouldFail,
  responseFor,
} from "@/components/otto/panel/otto-answer";
import { OTTO_ROOMS_NOTE, buildOttoRooms, roomWhen } from "@/components/otto/panel/otto-rooms";
import type { ChatThreadDTO } from "@/lib/types";
import type { OttoPanelSeed } from "@/lib/otto-panel-seed";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT = { width: 1280, height: 720 };
const KNOWN = { activeRoutines: 0, channelConnected: false };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, writable: true, configurable: true });
  Object.defineProperty(document.documentElement, "clientWidth", { value: width, writable: true, configurable: true });
  Object.defineProperty(document.documentElement, "clientHeight", { value: height, writable: true, configurable: true });
}

beforeEach(() => {
  setViewport(VIEWPORT.width, VIEWPORT.height);
  window.localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
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

const Shell = OttoPanelShell as FC<Omit<OttoPanelShellProps, "children">>;

function shell(props: Partial<Omit<OttoPanelShellProps, "children">> = {}) {
  return createElement(
    Shell,
    { variant: "r22", ...props },
    createElement("div", { "data-main-content": "" }, "Page content"),
  );
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

/**
 * 面板体里那段会话,连同它自己的一份会话状态。
 *
 * 用一个小小的宿主而不是直接渲染组件:这一票要看的是「说一句话 → 想一想 → 落一张卡」
 * 这条链,而消息是由上层持有的(`OttoPanelHost` 的活),测试里得有人接住
 * `onThreadStarted` / `onThreadUpdate`,不然答案永远回不到屏幕上。
 */
function conversationHost(contextLabel?: string) {
  const Host: FC = () => {
    const [threads, setThreads] = useState<ChatThreadDTO[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    return createElement(OttoPanelConversation, {
      state: { status: "ready", seed: SEED, threads, activeThreadId: activeId, pendingFirst: null },
      fixture: true,
      contextLabel,
      onThreadStarted: (thread: ChatThreadDTO) => { setThreads([thread]); setActiveId(thread.id); },
      onStreamStart: () => {},
      onThreadUpdate: (thread: ChatThreadDTO) => setThreads((current) => [thread, ...current.filter((t) => t.id !== thread.id)]),
      onActiveThreadChange: () => {},
      onPendingFirstSent: () => {},
    });
  };
  return createElement(Host);
}

function panelEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-otto-panel]");
  if (!el) throw new Error("panel not rendered");
  return el;
}

/** r22 的面板默认收着,测面板前先按 pet 打开。 */
async function openPanel(props: Partial<Omit<OttoPanelShellProps, "children">> = {}): Promise<HTMLElement> {
  await render(shell(props));
  await act(async () => document.querySelector<HTMLElement>("[data-otto-launcher]")!.click());
  return panelEl();
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("答案模型:五条路各自说自己的实话(原型 responseFor)", () => {
  it("approval / review / schedule → 审批那一路,并且说清 approve ≠ publish", () => {
    for (const context of ["Approvals", "Schedule"]) {
      const answer = responseFor(context, "why is this waiting?", KNOWN);
      expect(answer.title).toBe("Why this needs review");
      expect(answer.bullets).toContain("Approve means schedule, not publish.");
      expect(answer.note).toBe("This chat did not change the approval or spend credits.");
    }
  });

  it("渠道那一条只在**知道**的时候说 —— 读不到就少说一句,不猜", () => {
    const unknown = responseFor("Approvals", "why?", { activeRoutines: 0, channelConnected: null });
    expect(unknown.bullets).toHaveLength(2);
    expect(unknown.bullets.join(" ")).not.toContain("channel");

    expect(responseFor("Approvals", "why?", { activeRoutines: 0, channelConnected: true }).bullets)
      .toContain("A channel is connected, but approval is still required.");
    expect(responseFor("Approvals", "why?", { activeRoutines: 0, channelConnected: false }).bullets)
      .toContain("No channel is connected, so approval holds work in Schedule.");
  });

  it("routine 三态:读不到 / 零条 / N 条,各说各的,一条都不冒充另一条", () => {
    const unknown = responseFor("Routines", "what can Otto prepare?", { activeRoutines: null, channelConnected: null });
    expect(unknown.lead).toBe("I cannot confirm routine state yet, so I will not claim autonomous work is running.");

    const none = responseFor("Routines", "what can Otto prepare?", { activeRoutines: 0, channelConnected: null });
    expect(none.lead).toContain("No routine is active right now");

    const one = responseFor("Routines", "what can Otto prepare?", { activeRoutines: 1, channelConnected: null });
    expect(one.lead).toBe("1 routine is active right now. Autonomous preparation stays within those routine boundaries.");

    const many = responseFor("Routines", "what can Otto prepare?", { activeRoutines: 3, channelConnected: null });
    expect(many.lead).toBe("3 routines are active right now. Autonomous preparation stays within those routine boundaries.");
  });

  it("Otto IQ / analytics / 兜底各自命中,而且每一路都带一条诚实注脚", () => {
    expect(responseFor("Otto IQ", "where did Otto learn this?", KNOWN).title).toBe("Otto IQ provenance");
    expect(responseFor("Analytics", "how did last week perform?", KNOWN).title).toBe("Analytics context");
    expect(responseFor("Library", "hello", KNOWN).title).toBe("Workspace help");

    for (const [context, prompt] of [["Approvals", "why"], ["Routines", "prepare"], ["Otto IQ", "provenance"], ["Analytics", "metric"], ["Library", "hi"]]) {
      const answer = responseFor(context, prompt, KNOWN);
      expect(answer.note, `${context} 少了诚实注脚`).toMatch(/did not|no credits were spent/i);
      expect(answer.bullets.length).toBeGreaterThan(0);
    }
  });

  it("Copy 出去的是整张卡:标题、导语、每一条要点、注脚,各占一行", () => {
    const answer = responseFor("Analytics", "metric", KNOWN);
    expect(ottoAnswerCopyText(answer).split("\n")).toEqual([
      answer.title,
      answer.lead,
      ...answer.bullets,
      answer.note,
    ]);
  });

  it("读不出来那一路只认整词 error / fail,不认 failure 之外的半个词", () => {
    expect(ottoAnswerShouldFail("show me the error")).toBe(true);
    expect(ottoAnswerShouldFail("did this fail?")).toBe(true);
    expect(ottoAnswerShouldFail("what is my terrorist policy")).toBe(false);
  });
});

describe("子流 ①②:Giving feedback 与 Copying a chat", () => {
  async function answered(): Promise<HTMLElement> {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(conversationHost("Approvals")));

    const input = document.querySelector<HTMLInputElement>("#r22-otto-fixture-composer")!;
    await act(async () => type(input, "Why is this waiting for review?"));
    await act(async () => { document.querySelector<HTMLFormElement>("[data-otto-panel-composer]")!.requestSubmit(); });
    await act(async () => { vi.advanceTimersByTime(OTTO_ANSWER_WAIT_MS); });

    const card = document.querySelector<HTMLElement>("[data-otto-answer]");
    if (!card) throw new Error("answer card not rendered");
    return card;
  }

  it("回话是一张结构化的卡:标题 + 导语 + 要点 + 注脚 + 一排动作", async () => {
    const card = await answered();
    expect(card.querySelector("h3")?.textContent).toBe("Why this needs review");
    expect(card.querySelectorAll("li").length).toBeGreaterThanOrEqual(2);
    expect(card.querySelector("[data-otto-answer-fact], .r22-otto-answer-fact")?.textContent)
      .toBe("This chat did not change the approval or spend credits.");
    for (const label of ["Copy", "Helpful", "Not helpful", "Get support"]) {
      expect([...card.querySelectorAll("button, a")].map((el) => el.textContent), label).toContain(label);
    }
  });

  it("Copy 真的写进剪贴板,回执说 Copied", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const card = await answered();
    await act(async () => { card.querySelector<HTMLElement>("[data-otto-answer-copy]")!.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("Why this needs review");
    expect(copied).toContain("Approve means schedule, not publish.");

    const confirm = card.querySelector<HTMLElement>("[data-otto-answer-confirm]")!;
    expect(confirm.textContent).toBe(OTTO_ANSWER_CONFIRM.copied);
    expect(confirm.getAttribute("aria-live")).toBe("polite");
  });

  it("剪贴板拒绝时不说 Copied —— 那句话是回执,不是装饰", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.reject(new Error("denied")));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const card = await answered();
    await act(async () => { card.querySelector<HTMLElement>("[data-otto-answer-copy]")!.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(card.querySelector("[data-otto-answer-confirm]")!.textContent).toBe("");
  });

  it("Helpful / Not helpful 是一对互斥的按下态,回执不声称发去了任何地方", async () => {
    const card = await answered();
    const up = card.querySelector<HTMLElement>('[data-otto-answer-feedback="up"]')!;
    const down = card.querySelector<HTMLElement>('[data-otto-answer-feedback="down"]')!;
    const confirm = card.querySelector<HTMLElement>("[data-otto-answer-confirm]")!;

    expect(up.getAttribute("aria-pressed")).toBe("false");

    await act(async () => up.click());
    expect(up.getAttribute("aria-pressed")).toBe("true");
    expect(down.getAttribute("aria-pressed")).toBe("false");
    expect(confirm.textContent).toBe(OTTO_ANSWER_CONFIRM.helpful);

    await act(async () => down.click());
    expect(up.getAttribute("aria-pressed")).toBe("false");
    expect(down.getAttribute("aria-pressed")).toBe("true");
    expect(confirm.textContent).toBe(OTTO_ANSWER_CONFIRM.notHelpful);

    // 「已发送 / 已提交」这类话一句都不许出现 —— 这两颗只记在这张卡上。
    expect(confirm.textContent?.toLowerCase()).not.toContain("sent");
    expect(confirm.textContent?.toLowerCase()).not.toContain("submitted");
  });

  it("Get support 是一条通往 /help 的真链接,并且当场说清没有发出任何消息", async () => {
    const card = await answered();
    const support = card.querySelector<HTMLAnchorElement>("[data-otto-answer-support]")!;
    expect(support.getAttribute("href")).toBe("/help");

    await act(async () => support.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(card.querySelector("[data-otto-answer-confirm]")!.textContent).toBe(OTTO_ANSWER_CONFIRM.support);
  });
});

describe("等待态与读不出来(原型 .otto-wait / .otto-error)", () => {
  async function say(text: string) {
    const input = document.querySelector<HTMLInputElement>("#r22-otto-fixture-composer")!;
    await act(async () => type(input, text));
    await act(async () => { document.querySelector<HTMLFormElement>("[data-otto-panel-composer]")!.requestSubmit(); });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(conversationHost("Analytics")));
  });

  it("发出去先出现「想一想」,落地之后它消失", async () => {
    await say("How did last week perform?");
    const wait = document.querySelector<HTMLElement>("[data-otto-panel-wait]");
    expect(wait?.textContent).toContain(OTTO_ANSWER_WAIT_LABEL);

    await act(async () => { vi.advanceTimersByTime(OTTO_ANSWER_WAIT_MS); });
    expect(document.querySelector("[data-otto-panel-wait]")).toBeNull();
    expect(document.querySelector("[data-otto-answer]")).not.toBeNull();
  });

  it("读不出来时留在会话里说实话 + 一颗 Retry;重试就走通", async () => {
    await say("show me the error");
    await act(async () => { vi.advanceTimersByTime(OTTO_ANSWER_WAIT_MS); });

    const error = document.querySelector<HTMLElement>("[data-otto-panel-answer-error]")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain(OTTO_ANSWER_ERROR_TITLE);
    expect(error.textContent).toContain(OTTO_ANSWER_ERROR_NOTE);
    expect(document.querySelector("[data-otto-answer]")).toBeNull();

    await act(async () => { document.querySelector<HTMLElement>("[data-otto-panel-answer-retry]")!.click(); });
    expect(document.querySelector("[data-otto-panel-wait]")).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(OTTO_ANSWER_WAIT_MS); });

    expect(document.querySelector("[data-otto-panel-answer-error]")).toBeNull();
    expect(document.querySelector("[data-otto-answer]")).not.toBeNull();
  });

  it("底下那一行说的是商家正在看的这一页", async () => {
    expect(document.querySelector("[data-otto-panel-context-note]")!.textContent)
      .toBe("Analytics · no action will run from chat");
  });
});

describe("子流 ③:Switching a room chat(原型 renderRooms)", () => {
  const NOW = Date.parse("2026-08-25T09:00:00.000Z");
  const THREADS: ChatThreadDTO[] = [
    { id: "t-today", projectId: "fixture-raya", title: "Raya launch plan", updatedAt: "2026-08-25T08:48:00.000Z", pinnedAt: null, status: "done", messages: [] },
    { id: "t-old", projectId: "fixture-raya", title: "Reconnect Instagram", updatedAt: "2026-08-21T08:15:00.000Z", pinnedAt: null, status: "done", messages: [] },
  ];

  it("时间标签随距离降分辨率,读不懂的时间戳说 Unknown", () => {
    expect(roomWhen("2026-08-25T09:00:00.000Z", NOW)).toBe("Now");
    expect(roomWhen("2026-08-25T08:48:00.000Z", NOW)).toBe("12m ago");
    expect(roomWhen("2026-08-25T05:00:00.000Z", NOW)).toBe("4h ago");
    expect(roomWhen("2026-08-24T09:00:00.000Z", NOW)).toBe("Yesterday");
    expect(roomWhen("not a date", NOW)).toBe("Unknown");
  });

  it("分两组、置顶在前、搜索按标题过滤", () => {
    const all = buildOttoRooms({ threads: THREADS, projects: SEED.projects, query: "", now: NOW });
    expect(all.today.map((room) => room.thread.id)).toEqual(["t-today"]);
    expect(all.recent.map((room) => room.thread.id)).toEqual(["t-old"]);
    expect(all.today[0].where).toBe("Raya launch");

    const pinnedOld = buildOttoRooms({
      threads: [THREADS[0], { ...THREADS[1], updatedAt: "2026-08-25T07:00:00.000Z", pinnedAt: "2026-08-25T08:00:00.000Z" }],
      projects: SEED.projects,
      query: "",
      now: NOW,
    });
    expect(pinnedOld.today.map((room) => room.thread.id)).toEqual(["t-old", "t-today"]);

    const searched = buildOttoRooms({ threads: THREADS, projects: SEED.projects, query: "instagram", now: NOW });
    expect(searched.today).toEqual([]);
    expect(searched.recent.map((room) => room.thread.id)).toEqual(["t-old"]);
  });

  it("切换器画的是原型那一层:搜索 + Today/Recent + 每行 when · where + 尾注", async () => {
    const picked: string[] = [];
    const switcher = createElement(OttoRoomSwitcher, {
      projects: SEED.projects,
      threads: THREADS,
      activeThreadId: "t-today",
      now: NOW,
      onSelectThread: (thread: ChatThreadDTO) => picked.push(thread.id),
      onNewChat: () => {},
      onRenameThread: () => {},
      onSetThreadPinned: () => {},
      onDeleteThread: () => {},
      onRenameProject: () => {},
      onSetProjectPinned: () => {},
      onDeleteProject: () => {},
    });
    const panel = await openPanel({ panelBody: conversationHost(), roomSwitcher: switcher, roomsId: OTTO_ROOMS_ID, onOpenHistory: () => {}, onNewChat: () => {} });

    // 它住在头部里,不是 portal 出去的一块 —— 全屏时的焦点陷阱按面板这棵子树算。
    const rooms = panel.querySelector<HTMLElement>("[data-otto-panel-rooms]")!;
    expect(panel.querySelector("[data-otto-panel-header]")!.contains(rooms)).toBe(true);
    expect(panel.querySelector("[data-otto-panel-title]")!.getAttribute("aria-controls")).toBe(OTTO_ROOMS_ID);
    expect(rooms.id).toBe(OTTO_ROOMS_ID);

    expect(rooms.querySelector<HTMLInputElement>('input[type="search"]')!.placeholder).toBe("Search conversations");
    expect(rooms.querySelector('[data-otto-panel-rooms-group="Today"]')!.textContent).toContain("Raya launch plan");
    expect(rooms.querySelector('[data-otto-panel-rooms-group="Recent"]')!.textContent).toContain("Reconnect Instagram");
    expect(rooms.querySelector('[data-otto-room="t-today"]')!.textContent).toContain("12m ago · Raya launch");
    expect(rooms.querySelector("[data-otto-panel-rooms-note]")!.textContent).toBe(OTTO_ROOMS_NOTE);
    expect(rooms.querySelector('[data-otto-room="t-today"]')!.getAttribute("aria-current")).toBe("true");

    // 切一条 = 换一段消息流,而不是把正在读的那段盖掉:会话一直在 DOM 里。
    expect(panel.querySelector('[data-otto-panel-conversation="fixture"]')).not.toBeNull();
    await act(async () => rooms.querySelector<HTMLElement>('[data-otto-room="t-old"]')!.click());
    expect(picked).toEqual(["t-old"]);
  });

  it("搜索框现打现过滤,搜不到就说搜不到 —— 不摆一条占位的行", async () => {
    const switcher = createElement(OttoRoomSwitcher, {
      projects: SEED.projects,
      threads: THREADS,
      activeThreadId: null,
      now: NOW,
      onSelectThread: () => {},
      onNewChat: () => {},
      onRenameThread: () => {},
      onSetThreadPinned: () => {},
      onDeleteThread: () => {},
      onRenameProject: () => {},
      onSetProjectPinned: () => {},
      onDeleteProject: () => {},
    });
    const panel = await openPanel({ panelBody: conversationHost(), roomSwitcher: switcher, roomsId: OTTO_ROOMS_ID, onOpenHistory: () => {}, onNewChat: () => {} });
    const rooms = panel.querySelector<HTMLElement>("[data-otto-panel-rooms]")!;
    const search = rooms.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => type(search, "instagram"));
    expect(rooms.querySelector('[data-otto-panel-rooms-group="Today"]')).toBeNull();
    expect(rooms.querySelector('[data-otto-room="t-old"]')).not.toBeNull();

    await act(async () => type(search, "zzz"));
    expect(rooms.querySelector("[data-otto-panel-rooms-nomatch]")!.textContent).toBe("No conversation matches that search.");
    expect(rooms.querySelector("[data-otto-room]")).toBeNull();
  });

  it("整理会话与整理项目没有跟着换壳消失(W2-11 救回来的那一批)", async () => {
    const switcher = createElement(OttoRoomSwitcher, {
      projects: SEED.projects,
      threads: THREADS,
      activeThreadId: null,
      now: NOW,
      onSelectThread: () => {},
      onNewChat: () => {},
      onRenameThread: () => {},
      onSetThreadPinned: () => {},
      onDeleteThread: () => {},
      onRenameProject: () => {},
      onSetProjectPinned: () => {},
      onDeleteProject: () => {},
    });
    const panel = await openPanel({ panelBody: conversationHost(), roomSwitcher: switcher, roomsId: OTTO_ROOMS_ID, onOpenHistory: () => {}, onNewChat: () => {} });
    const rooms = panel.querySelector<HTMLElement>("[data-otto-panel-rooms]")!;

    expect(rooms.querySelector('[aria-label="Raya launch plan controls"]')).not.toBeNull();
    expect(rooms.querySelector('[aria-label="Raya launch controls"]')).not.toBeNull();
    expect(rooms.querySelector("[data-otto-panel-rooms-new]")!.textContent).toBe("New conversation");
  });
});

describe("子流 ④:Switching to fullscreen view(原型 setFullscreen)", () => {
  function expandButton(panel: HTMLElement): HTMLButtonElement {
    return panel.querySelector<HTMLButtonElement>('[aria-label="Expand Otto"], [aria-label="Restore Otto"]')!;
  }

  it("Expand 是全屏接管:铺满、role=dialog + aria-modal、主内容 inert", async () => {
    const panel = await openPanel({ panelBody: conversationHost(), onOpenHistory: () => {}, onNewChat: () => {} });
    expect(panel.style.width).toBe("408px");
    expect(panel.hasAttribute("data-otto-panel-fullscreen")).toBe(false);

    await act(async () => expandButton(panel).click());

    const full = panelEl();
    expect(full.hasAttribute("data-otto-panel-fullscreen")).toBe(true);
    expect(full.style.position).toBe("fixed");
    expect(full.style.inset).toBe("0px");
    expect(full.style.width).toBe("auto");
    expect(full.getAttribute("role")).toBe("dialog");
    expect(full.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector("[data-otto-panel-main]")!.hasAttribute("inert")).toBe(true);
    expect(expandButton(full).textContent).toBe("Restore");
  });

  it("Restore 与 Esc 都退回停靠,而且面板不跟着关掉", async () => {
    const panel = await openPanel({ panelBody: conversationHost(), onOpenHistory: () => {}, onNewChat: () => {} });

    await act(async () => expandButton(panel).click());
    await act(async () => expandButton(panelEl()).click());
    expect(panelEl().hasAttribute("data-otto-panel-fullscreen")).toBe(false);
    expect(panelEl().style.width).toBe("408px");
    expect(document.querySelector("[data-otto-panel-main]")!.hasAttribute("inert")).toBe(false);

    await act(async () => expandButton(panelEl()).click());
    expect(panelEl().hasAttribute("data-otto-panel-fullscreen")).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    // Esc 只剥最上面那一层:回到停靠,面板还开着,会话没有被丢掉。
    expect(panelEl().hasAttribute("data-otto-panel-fullscreen")).toBe(false);
    expect(document.querySelector("[data-otto-panel]")).not.toBeNull();
    expect(panelEl().querySelector('[data-otto-panel-conversation="fixture"]')).not.toBeNull();
  });

  it("全屏那一下没有宽度过渡 —— 键盘发起的动作因此零动画", async () => {
    const panel = await openPanel({ panelBody: conversationHost(), onOpenHistory: () => {}, onNewChat: () => {} });
    await act(async () => expandButton(panel).click());
    expect(panelEl().style.transition).toBe("none");
  });

  it("退出全屏之后,商家自己的停靠宽度没有被 Expand 改写", async () => {
    const panel = await openPanel({ panelBody: conversationHost(), onOpenHistory: () => {}, onNewChat: () => {} });
    await act(async () => expandButton(panel).click());
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(panelEl().style.width).toBe("408px");
  });
});
