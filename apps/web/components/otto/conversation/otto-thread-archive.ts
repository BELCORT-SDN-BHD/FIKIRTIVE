/**
 * otto-thread-archive.ts —— 面板那张会话表存在哪、别处怎么往里加一条。
 *
 * Founder 2026-08-26 裁决第 1/2 条:creation 对话与非画布 Otto 对话是**分开的线程**,但
 * 同列在一张表里。全屏创作对话开在 Library 那扇门里,而那张表由 `OttoPanelHost` 持有 ——
 * 两处不在同一棵组件树上,所以交接只能走存档。
 *
 * 键名因此必须只有一个出处:写的人和读的人不在同一个文件里,少对上一个字节,商家做完
 * 一整场创作回头去面板找,那条线程就是不在那儿,而且没有任何一处会报错(Quick create →
 * 画布那条路当年付过同一笔学费,见 `r22-canvas-fixture.ts` 顶部那段)。
 */
import type { ChatThreadDTO } from "@/lib/types";

/** 面板会话表的存档键(后面还要接一个 workspace id)。 */
export const OTTO_PANEL_FIXTURE_KEY = "r22:otto-panel:v1";

export function ottoPanelFixtureStorageKey(workspaceId: string): string {
  return `${OTTO_PANEL_FIXTURE_KEY}:${workspaceId}`;
}

type Stored = { projects?: unknown; threads?: ChatThreadDTO[]; activeThreadId?: string | null };

/**
 * 往那张表最前面加一条线程。
 *
 * 幂等靠 `id`:同一条 creation 线程再送一遍(商家关掉全屏又开一次)不该在列表里多出一行。
 * 已经有那条 id 时**改写**它 —— 一场创作是一条会长的线程,不是每答一句就新开一行。
 *
 * 存档还没建起来时(商家还没开过面板)什么都不做并返回 false:凭空造一张表出来,会把
 * 面板自己那份种子(两条样例会话)顶掉,商家一开面板就发现别的东西不见了。
 */
export function upsertOttoFixtureThread(workspaceId: string, thread: ChatThreadDTO): boolean {
  try {
    const key = ottoPanelFixtureStorageKey(workspaceId);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return false;
    const stored = JSON.parse(raw) as Stored;
    const threads = stored.threads ?? [];
    const at = threads.findIndex((row) => row.id === thread.id);
    const next = at === -1 ? [thread, ...threads] : threads.map((row, index) => (index === at ? thread : row));
    window.sessionStorage.setItem(key, JSON.stringify({ ...stored, threads: next }));
    return true;
  } catch {
    return false;
  }
}
