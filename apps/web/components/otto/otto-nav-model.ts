/**
 * otto-nav-model —— 会话/项目列表的**模型**(纯函数,没有 React)。
 *
 * 两个渲染器读同一份:今天的第二条导轨 `OttoNav.tsx`,以及 W2-8(#995)搬进 Otto 面板的
 * `panel/OttoThreadList.tsx`。两处画得不一样(导轨有改名/删除菜单,面板没有),但**分组与
 * 顺序**必须是同一份 —— 抄第二份出来,商家会在同一台机器上看到两份互相矛盾的历史。
 * 上限也在这里,原因相同。
 */
import type { ChatThreadDTO } from "@/lib/types";

export type OttoNavProjectMeta = { id: string; name: string; pinnedAt?: string | null };

/** 列表一次画几个项目 / 每个项目底下几条会话。两个渲染器共用,不各写一份。 */
export const OTTO_NAV_PROJECT_LIMIT = 6;
export const OTTO_NAV_THREAD_LIMIT = 2;

export type OttoNavEntry =
  | { kind: "project"; project: OttoNavProjectMeta; threads: ChatThreadDTO[]; defaultThread?: ChatThreadDTO }
  | { kind: "thread"; project: OttoNavProjectMeta; thread: ChatThreadDTO };

function visibleThreadsForProject(
  projectThreads: ChatThreadDTO[],
  projectId: string,
  activeProjectId: string,
  activeThreadId: string | null,
  threadLimit: number,
) {
  const visibleThreads = projectThreads.slice(0, threadLimit);
  const activeThread = projectId === activeProjectId && activeThreadId
    ? projectThreads.find((t) => t.id === activeThreadId)
    : undefined;
  if (activeThread && !visibleThreads.some((t) => t.id === activeThread.id)) {
    if (visibleThreads.length >= threadLimit) visibleThreads[visibleThreads.length - 1] = activeThread;
    else visibleThreads.push(activeThread);
  }
  return visibleThreads;
}

export function buildOttoNavEntries({
  projects,
  sidebarThreads,
  activeProjectId,
  activeThreadId,
  projectLimit,
  threadLimit,
}: {
  projects: OttoNavProjectMeta[];
  sidebarThreads: ChatThreadDTO[];
  activeProjectId: string;
  activeThreadId: string | null;
  projectLimit: number;
  threadLimit: number;
}): OttoNavEntry[] {
  const threadsByProject = new Map<string, ChatThreadDTO[]>();
  for (const t of sidebarThreads) {
    const arr = threadsByProject.get(t.projectId) ?? [];
    arr.push(t);
    threadsByProject.set(t.projectId, arr);
  }

  const projectIndex = new Map(projects.map((p, index) => [p.id, index]));
  const projectLastActivity = new Map<string, number>();
  for (const t of sidebarThreads) {
    const ts = Date.parse(t.updatedAt) || 0;
    projectLastActivity.set(t.projectId, Math.max(projectLastActivity.get(t.projectId) ?? 0, ts));
  }

  const visibleProjects = [...projects].sort((a, b) => {
    const aPinnedAt = a.pinnedAt ? Date.parse(a.pinnedAt) || 0 : 0;
    const bPinnedAt = b.pinnedAt ? Date.parse(b.pinnedAt) || 0 : 0;
    const pin = bPinnedAt - aPinnedAt;
    if (pin !== 0) return pin;
    if (a.pinnedAt && !b.pinnedAt) return -1;
    if (b.pinnedAt && !a.pinnedAt) return 1;
    if (a.id === activeProjectId && b.id !== activeProjectId) return -1;
    if (b.id === activeProjectId && a.id !== activeProjectId) return 1;
    const activity = (projectLastActivity.get(b.id) ?? 0) - (projectLastActivity.get(a.id) ?? 0);
    if (activity !== 0) return activity;
    return (projectIndex.get(a.id) ?? 0) - (projectIndex.get(b.id) ?? 0);
  }).slice(0, projectLimit);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  if (activeProject && !visibleProjects.some((p) => p.id === activeProject.id)) {
    if (visibleProjects.length >= projectLimit) visibleProjects[visibleProjects.length - 1] = activeProject;
    else visibleProjects.push(activeProject);
  }

  return visibleProjects.map((project) => {
    const projectThreads = threadsByProject.get(project.id) ?? [];
    const threads = visibleThreadsForProject(projectThreads, project.id, activeProjectId, activeThreadId, threadLimit);
    return { kind: "project" as const, project, threads };
  });
}

/** 日期分组的四档。English sentence case,与商家看到的一致。 */
export type ThreadDateBucket = "Today" | "Yesterday" | "Previous 7 days" | "Older";

/** 本地日历的「第几天」——用日历天而不是 24 小时,商家说的「昨天」是日历上的昨天。 */
function calendarDay(ms: number): number {
  const d = new Date(ms);
  return Math.floor(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
  );
}

/** 一条会话落在哪一档。看不懂的时间戳一律落 "Older" —— 不猜,也不把它扔掉。 */
export function threadDateBucket(updatedAt: string, now: number): ThreadDateBucket {
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return "Older";
  const days = calendarDay(now) - calendarDay(ts);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 days";
  return "Older";
}

/**
 * 按日期分组,**不改顺序**。
 *
 * 走的是「相邻同档合成一段」,不是「按档位重排」:传进来的顺序是 `buildOttoNavEntries` 定的
 * (置顶在前、其余按活跃度),重排会把置顶那条从它该在的位置上挪走。所以一个置顶的旧会话
 * 之后如果又出现今天的会话,标题会各自出现一次 —— 这是顺序被保住的代价,也是它的证据。
 */
export function groupThreadsByDate(
  threads: ChatThreadDTO[],
  now: number,
): { bucket: ThreadDateBucket; threads: ChatThreadDTO[] }[] {
  const groups: { bucket: ThreadDateBucket; threads: ChatThreadDTO[] }[] = [];
  for (const thread of threads) {
    const bucket = threadDateBucket(thread.updatedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.bucket === bucket) last.threads.push(thread);
    else groups.push({ bucket, threads: [thread] });
  }
  return groups;
}
