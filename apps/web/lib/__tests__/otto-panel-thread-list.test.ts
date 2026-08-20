// @vitest-environment jsdom
/**
 * #995(W2-8)—— 会话历史搬进面板,搬的是**同一份**列表。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4。
 *
 * 这一票唯一真正的风险不是「画不出来」,是**画出第二份**:面板自己去建一套分组/排序/上限,
 * 于是同一台机器上的导轨与面板给出两份互相矛盾的历史,而且两边都不会红。所以这里的第一组
 * 断言不是「列表长什么样」,是「列表与 `OttoNav` 同源同序」:
 *
 *   ① 面板画出来的顺序**逐条**等于 `buildOttoNavEntries` 给的顺序(同一个模型函数);
 *   ② 上限只有一处作者 —— `OttoNav.tsx` 里不许再有自己的数字;
 *   ③ 日期分组只**贴标签**,不重排(置顶那条不许被挪走);
 *   ④ `New chat` 在。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatThreadDTO } from "@/lib/types";
import {
  OTTO_NAV_PROJECT_LIMIT,
  OTTO_NAV_THREAD_LIMIT,
  buildOttoNavEntries,
  groupThreadsByDate,
  threadDateBucket,
} from "@/components/otto/otto-nav-model";
import { OttoThreadList } from "@/components/otto/panel/OttoThreadList";

const WEB_ROOT = path.resolve(__dirname, "../..");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 2026-08-18 12:00 本地时间 —— 「今天」的锚点,分档全部相对它算。 */
const NOW = new Date(2026, 7, 18, 12, 0, 0).getTime();
const DAY = 86_400_000;

function thread(over: Partial<ChatThreadDTO> & { id: string; projectId: string }): ChatThreadDTO {
  return {
    title: `Thread ${over.id}`,
    updatedAt: new Date(NOW).toISOString(),
    messages: [],
    ...over,
  };
}

const PROJECTS = [
  { id: "p_raya", name: "Raya campaign", pinnedAt: null },
  { id: "p_first", name: "My First Project", pinnedAt: null },
];

const THREADS: ChatThreadDTO[] = [
  thread({ id: "t_today", projectId: "p_raya", title: "Raya promo", updatedAt: new Date(NOW - 2 * 3_600_000).toISOString() }),
  thread({ id: "t_yesterday", projectId: "p_raya", title: "Kuih teaser", updatedAt: new Date(NOW - 1 * DAY).toISOString() }),
  thread({ id: "t_lastweek", projectId: "p_first", title: "Old brief", updatedAt: new Date(NOW - 4 * DAY).toISOString() }),
  thread({ id: "t_ancient", projectId: "p_first", title: "Very old", updatedAt: new Date(NOW - 40 * DAY).toISOString() }),
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function renderList(overrides: Partial<Parameters<typeof OttoThreadList>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(OttoThreadList, {
        projects: PROJECTS,
        threads: THREADS,
        activeProjectId: "p_raya",
        activeThreadId: "t_today",
        onSelectThread: () => {},
        onNewChat: () => {},
        now: NOW,
        ...overrides,
      }),
    );
  });
  return container;
}

/** 面板真的画出来的会话顺序。 */
function renderedThreadIds(el: HTMLElement): string[] {
  return [...el.querySelectorAll<HTMLElement>("[data-otto-thread-list-thread]")].map(
    (node) => node.getAttribute("data-otto-thread-list-thread")!,
  );
}

describe("同源同序 —— 面板列表与导轨读的是同一份模型", () => {
  it("画出来的顺序逐条等于 buildOttoNavEntries 给的顺序", async () => {
    const el = await renderList();

    // 期望值不是手写的一串 id,而是**模型自己**算出来的那一串 —— 手写就变成在核对自己。
    const expected = buildOttoNavEntries({
      projects: PROJECTS,
      sidebarThreads: THREADS,
      activeProjectId: "p_raya",
      activeThreadId: "t_today",
      projectLimit: OTTO_NAV_PROJECT_LIMIT,
      threadLimit: OTTO_NAV_THREAD_LIMIT,
    }).flatMap((entry) => (entry.kind === "project" ? entry.threads.map((t) => t.id) : [entry.thread.id]));

    expect(renderedThreadIds(el)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it("项目分组保留 —— 每个项目一格,名字是商家自己起的那个", async () => {
    const el = await renderList();
    const sections = [...el.querySelectorAll<HTMLElement>("[data-otto-thread-list-project]")];

    expect(sections.map((s) => s.getAttribute("data-otto-thread-list-project"))).toEqual(["p_raya", "p_first"]);
    expect(sections[0]!.textContent).toContain("Raya campaign");
    expect(sections[1]!.textContent).toContain("My First Project");
    // 会话画在它自己项目那一格里,不是拉平成一串。
    expect(renderedThreadIds(sections[0]!)).toEqual(["t_today", "t_yesterday"]);
  });

  it("上限只有一处作者 —— OttoNav 不许再自己写一份数字", () => {
    const source = readFileSync(path.join(WEB_ROOT, "components/otto/OttoNav.tsx"), "utf8");
    expect(source, "OttoNav 又自己定了一份上限 —— 两份列表迟早给出不同长度").not.toMatch(
      /const\s+(PROJECT_LIMIT|THREAD_LIMIT)\s*=/,
    );
    expect(source).toContain("OTTO_NAV_PROJECT_LIMIT");
    expect(source).toContain("OTTO_NAV_THREAD_LIMIT");
  });

  it("面板不自己建第二份列表模型 —— 它调的就是 buildOttoNavEntries", () => {
    const source = readFileSync(path.join(WEB_ROOT, "components/otto/panel/OttoThreadList.tsx"), "utf8");
    expect(source).toContain("buildOttoNavEntries");
    // 自己排序 / 自己按项目分桶 = 第二份模型。
    expect(source, "面板自己排了一次序 —— 那就是第二份列表模型").not.toMatch(/\.sort\(/);
  });
});

describe("按日期分组", () => {
  it("四档按本地日历天算", () => {
    expect(threadDateBucket(new Date(NOW - 3_600_000).toISOString(), NOW)).toBe("Today");
    expect(threadDateBucket(new Date(NOW - 1 * DAY).toISOString(), NOW)).toBe("Yesterday");
    expect(threadDateBucket(new Date(NOW - 4 * DAY).toISOString(), NOW)).toBe("Previous 7 days");
    expect(threadDateBucket(new Date(NOW - 40 * DAY).toISOString(), NOW)).toBe("Older");
    // 认不出来的时间戳落 Older,而不是被扔掉。
    expect(threadDateBucket("not a date", NOW)).toBe("Older");
  });

  it("分组只贴标签,不重排 —— 传进去什么顺序,出来还是什么顺序", () => {
    const ordered = [THREADS[3]!, THREADS[0]!, THREADS[1]!]; // 置顶那种情形:旧的排在前面
    const groups = groupThreadsByDate(ordered, NOW);

    expect(groups.flatMap((g) => g.threads.map((t) => t.id))).toEqual(ordered.map((t) => t.id));
    expect(groups.map((g) => g.bucket)).toEqual(["Older", "Today", "Yesterday"]);
  });

  it("面板把分档画成小标题", async () => {
    const el = await renderList();
    const buckets = [...el.querySelectorAll<HTMLElement>("[data-otto-thread-list-bucket]")].map((n) =>
      n.getAttribute("data-otto-thread-list-bucket"),
    );

    expect(buckets).toContain("Today");
    expect(buckets).toContain("Yesterday");
  });
});

describe("New chat", () => {
  it("列表顶上就有一颗,点得动", async () => {
    const onNewChat = vi.fn();
    const el = await renderList({ onNewChat });
    const button = el.querySelector<HTMLButtonElement>("[data-otto-thread-list-new]")!;

    expect(button).not.toBeNull();
    expect(button.textContent).toContain("New chat");

    await act(async () => button.click());
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("一条会话都没有时说实话,不摆一份假的历史", async () => {
    const el = await renderList({ threads: [], activeThreadId: null });

    expect(el.querySelector("[data-otto-thread-list-empty]")).not.toBeNull();
    expect(renderedThreadIds(el)).toEqual([]);
    // New chat 仍在 —— 没有历史不等于开不了新的一段。
    expect(el.querySelector("[data-otto-thread-list-new]")).not.toBeNull();
  });
});

describe("选一条会话", () => {
  it("交回去的是那一条会话本身(含它自己的 projectId)", async () => {
    const onSelectThread = vi.fn();
    const el = await renderList({ onSelectThread });

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-otto-thread-list-thread="t_lastweek"]')!.click();
    });

    expect(onSelectThread).toHaveBeenCalledTimes(1);
    expect(onSelectThread.mock.calls[0]![0]).toMatchObject({ id: "t_lastweek", projectId: "p_first" });
  });

  it("当前那一条标出来了", async () => {
    const el = await renderList();
    const active = el.querySelector<HTMLElement>('[data-otto-thread-list-thread="t_today"]')!;

    expect(active.getAttribute("aria-current")).toBe("true");
  });
});
