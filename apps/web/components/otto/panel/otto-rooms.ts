/**
 * otto-rooms.ts —— 面板标题那颗按钮打开的**会话切换器**的模型(纯函数,没有 React)。
 *
 * 视觉与文案权威 = R22 原型 `fikirtive-prototype-r22.html` 的 `renderRooms()` /
 * `roomButton()`(L6710-6713)与 `.hist-note`(L681):搜索框 → Today / Recent 两组 →
 * 每一行「标题 + when · where」→ 一句尾注。
 *
 * 分档用的是 `otto-nav-model.ts` 的 `threadDateBucket`,不是另写一套日期判断:导轨与面板
 * 对「今天」的定义必须是同一个,否则同一条会话在两处会落在不同的组里。原型只有 Today /
 * Recent 两组,所以这里把四档折成两组 —— 折叠规则写在 `roomGroupOf` 上。
 */
import { MY_DATE_FORMAT } from "@/lib/my-date-format";
import type { ChatThreadDTO } from "@/lib/types";
import { threadDateBucket } from "@/components/otto/otto-nav-model";

/** 原型 L6712 的尾注,一字不改:画布里的对话不进这份列表,而不是被悄悄合并进来。 */
export const OTTO_ROOMS_NOTE = "Canvas conversations stay in their project and are excluded here.";

export type OttoRoomGroup = "Today" | "Recent";

/** 列表里的一行。`when · where` 就是原型那一行副标题的两截。 */
export type OttoRoom = {
  thread: ChatThreadDTO;
  /** 这条会话住在哪 —— 它自己的项目名。查不到项目就不编一个,给空串。 */
  where: string;
  when: string;
  group: OttoRoomGroup;
};

/** 四档折成原型的两组:今天的进 Today,其余(含读不懂的时间戳)进 Recent。 */
export function roomGroupOf(updatedAt: string, now: number): OttoRoomGroup {
  return threadDateBucket(updatedAt, now) === "Today" ? "Today" : "Recent";
}

/**
 * 一行副标题左边那截时间。
 *
 * 分辨率随距离下降 —— 刚刚的事要精确到分钟,上个月的事只要一个日期。超过一周就给
 * 商家时区里的真日期(`MY_DATE_FORMAT`),不再说「N 天前」:那种说法越久越难换算。
 * 读不懂的时间戳说 "Unknown",不猜一个。
 */
export function roomWhen(updatedAt: string, now: number): string {
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return "Unknown";
  const bucket = threadDateBucket(updatedAt, now);
  if (bucket === "Yesterday") return "Yesterday";
  if (bucket === "Today") {
    const minutes = Math.max(0, Math.round((now - ts) / 60_000));
    if (minutes < 1) return "Now";
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.round(minutes / 60)}h ago`;
  }
  if (bucket === "Previous 7 days") {
    const days = Math.max(2, Math.round((now - ts) / 86_400_000));
    return `${days}d ago`;
  }
  return MY_DATE_FORMAT.format(new Date(ts));
}

/**
 * 把会话摊成两组可以画的行。
 *
 * 顺序:置顶的在前,其余按最近活跃 —— 与导轨那份模型同一条排序意图(置顶优先、活跃次之),
 * 只是这里是**跨项目**的一条平列表,因为原型的切换器就是一条平列表。
 *
 * 搜索按标题匹配,大小写不敏感(原型 L6711 同一条)。搜不到就是两组都空,由渲染层说
 * 「没有匹配」——不在这里编一条占位的行。
 */
export function buildOttoRooms({
  threads,
  projects,
  query,
  now,
}: {
  threads: ChatThreadDTO[];
  projects: { id: string; name: string }[];
  query: string;
  now: number;
}): { today: OttoRoom[]; recent: OttoRoom[] } {
  const needle = query.trim().toLowerCase();
  const projectName = new Map(projects.map((project) => [project.id, project.name]));

  const rows = threads
    .filter((thread) => !needle || thread.title.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => {
      const aPinned = a.pinnedAt ? Date.parse(a.pinnedAt) || 0 : 0;
      const bPinned = b.pinnedAt ? Date.parse(b.pinnedAt) || 0 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    })
    .map<OttoRoom>((thread) => ({
      thread,
      where: projectName.get(thread.projectId) ?? "",
      when: roomWhen(thread.updatedAt, now),
      group: roomGroupOf(thread.updatedAt, now),
    }));

  return {
    today: rows.filter((row) => row.group === "Today"),
    recent: rows.filter((row) => row.group === "Recent"),
  };
}
