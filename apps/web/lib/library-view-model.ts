/**
 * Library 展示层的纯函数(前端基线规格 `docs/specs/frontend-baseline.md` §7.1 段②)。
 *
 * 已批准的 Library 设计把网格按时间分组、每格给一个可读的名字。夹具
 * (`design-system/patterns/library/fixtures.ts`)把这两样**写死**成三个常量组和一个
 * `title` 字段 —— 那是评审用的假数据,生产里两样都得从真列算出来:
 *   · 分组来自 `Generation.createdAt`,不是夹具的 `group` 字符串
 *     (backend-handoff-contract.md §8.3②「时间分组从真实 created time 计算」);
 *   · 名字来自真实存在的列 —— 上传有 `Asset.originalFilename`,引擎产物只有 `promptText`。
 *     两样都没有的行**不编名字**,写 "Untitled";夹具那种人写的标题在生产里根本不存在。
 *
 * 放在 `lib/` 而不是组件里,是为了让这两条规则能在没有 DOM 的情况下被直接钉住。
 */
import type { LibraryItem } from "./library-actions";

/**
 * 本轮 `/library` 画得出来的一级视图。
 *
 * 已批准设计有五个(`patterns/library/model.ts` 的 `LIBRARY_VIEWS`);`Favorites` 与
 * `Collections` 两格今天在后端没有对象 —— cross-object favorite 与 Collection/membership
 * 都还没有 schema 与动作(backend-handoff-contract.md §7 的「未具备」两行)。前端规则第①条:
 * 没有真实能力的入口不出现,所以这张表是三格,而不是画五格再让两格点不动。
 */
export const LIBRARY_VIEWS = [
  { value: "history", label: "Generation history" },
  { value: "uploads", label: "Uploads" },
  { value: "elements", label: "Elements" },
] as const;

export type LibraryView = (typeof LIBRARY_VIEWS)[number]["value"];

/** 地址里的 `?view=` —— 认不出来的值一律落回默认那一格,不 404、也不画空白。 */
export function parseLibraryView(raw: string | undefined): LibraryView {
  return LIBRARY_VIEWS.some((item) => item.value === raw) ? (raw as LibraryView) : "history";
}

/** 一个时间组:标题(Today / Yesterday / August 2026)加落在里面的行。 */
export type LibraryGroup = { key: string; label: string; items: LibraryItem[] };

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** 同一天?按 UTC 比 —— 服务端与浏览器算出同一个答案,刷新前后分组不跳。 */
function sameUtcDay(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

/**
 * 一行属于哪个时间组。README §3.1 的原话是「例如 Today / Yesterday / August 2026」——
 * 前两组是相对今天的,再往前一律按月,所以库里放多久都不会撞上夹具那三个常量的天花板。
 */
export function libraryTimeGroupLabel(createdAtIso: string, now: Date): string {
  const at = new Date(createdAtIso);
  if (Number.isNaN(at.getTime())) return "Earlier";
  if (sameUtcDay(at, now)) return "Today";
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (sameUtcDay(at, yesterday)) return "Yesterday";
  return MONTH_LABEL.format(at);
}

/**
 * 按时间组切开,**保持传进来的顺序** —— 排序权威是服务端的 `orderBy`,这里不再排第二次
 * (排两次就有两个真相,而分页只认服务端那一个)。
 */
export function groupLibraryItems(items: readonly LibraryItem[], now: Date): LibraryGroup[] {
  const groups: LibraryGroup[] = [];
  const byLabel = new Map<string, LibraryGroup>();
  for (const item of items) {
    const label = libraryTimeGroupLabel(item.createdAt, now);
    let group = byLabel.get(label);
    if (!group) {
      group = { key: label.toLowerCase().replaceAll(" ", "-"), label, items: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/**
 * 一格上写什么名字。上传写商家自己的文件名,引擎产物写它的提示词(截断),两样都没有就
 * 说 "Untitled" —— 绝不拿 id、URL 或来源当名字冒充。
 */
export function libraryItemTitle(item: Pick<LibraryItem, "filename" | "prompt">): string {
  const filename = item.filename.trim();
  if (filename) return filename;
  const prompt = item.prompt.trim();
  if (!prompt) return "Untitled";
  return prompt.length > 72 ? `${prompt.slice(0, 71)}…` : prompt;
}

/** `0:08`。没有真实时长的视频不显示假时长。 */
export function libraryDurationLabel(item: Pick<LibraryItem, "durationS">): string | null {
  if (item.durationS == null || !Number.isFinite(item.durationS)) return null;
  const total = Math.max(0, Math.round(item.durationS));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
