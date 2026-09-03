/**
 * Library 展示层的纯函数(前端基线规格 `docs/specs/frontend-baseline.md` §7.1 段②)。
 *
 * 已批准的 Library 设计把网格按时间分组、每格给一个可读的名字。夹具
 * (`design-system/patterns/library/fixtures.ts`)把这两样**写死**成三个常量组和一个
 * `title` 字段 —— 那是评审用的假数据,生产里两样都得从真列算出来:
 *   · 分组来自 `Generation.createdAt`,不是夹具的 `group` 字符串
 *     (backend-handoff-contract.md §8.3②「时间分组从真实 created time 计算」);
 *   · 名字来自真实存在的列 —— 上传写 `Asset.originalFilename`,引擎产物写 `promptText`
 *     (引擎产物**也有** originalFilename,但那是我们自己的存储键 `gen-<ulid>.mp4`,不是名字);
 *     两样都没有的行**不编名字**,写 "Untitled";夹具那种人写的标题在生产里根本不存在。
 *   · 日界按浏览者本地时区算,不按 UTC —— 见 `LibraryDayZone`。
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

/**
 * 日界按谁的钟算。
 *
 * 权威是**浏览者本地的钟**("local")。商家在马来西亚(UTC+8)凌晨 02:00 做的东西,在 UTC
 * 那边还停在前一天 18:00 —— 按 UTC 分组会把商家「今天早上刚做的」标成 Yesterday,并且被
 * `Date created / Today` 筛选整组排除掉。那不是「时区口径不同」,那是屏幕上写了一句假话。
 *
 * 服务端渲染的第一帧不知道浏览器在哪个时区,只能先按 "utc" 画;`LibraryView` 挂载后用
 * React 自己的服务端/客户端快照机制(`useSyncExternalStore`)换成 "local" 再算一次 ——
 * 两端第一帧的文字因此一致,不会 hydration mismatch。
 */
export type LibraryDayZone = "utc" | "local";

/**
 * 月份名写死一张表,不用 `Intl.DateTimeFormat`。
 *
 * 一个在模块加载时构造出来的 `Intl.DateTimeFormat` 会把当时的时区**焊死**在里面(Node 22
 * 实测:进程的时区设置改了之后,`Date` 的本地取值器跟着变,预构造的 formatter 不跟),
 * 于是「按本地时区算」这条规则在它身上就是假的。界面本来就只有英文一种写法
 * (原来的代码也是写死 `"en-US"`),所以一张表比一个会骗人的 formatter 诚实。
 */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** 这一刻所在那一天的 00:00(按 `zone` 的钟)。 */
function startOfDay(at: Date, zone: LibraryDayZone): number {
  return zone === "utc"
    ? Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
    : new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/** `August 2026` —— 按 `zone` 的钟取月与年。 */
function monthLabel(at: Date, zone: LibraryDayZone): string {
  return zone === "utc"
    ? `${MONTH_NAMES[at.getUTCMonth()]} ${at.getUTCFullYear()}`
    : `${MONTH_NAMES[at.getMonth()]} ${at.getFullYear()}`;
}

/**
 * 一行属于哪个时间组。README §3.1 的原话是「例如 Today / Yesterday / August 2026」——
 * 前两组是相对今天的,再往前一律按月,所以库里放多久都不会撞上夹具那三个常量的天花板。
 *
 * 「昨天」从今天的 00:00 往回退 12 小时再取那一天的开头,而不是从 `now` 减 24 小时:
 * 夏令时那两天一天只有 23 小时,减 24 小时会退过头或退不到。
 */
export function libraryTimeGroupLabel(createdAtIso: string, now: Date, zone: LibraryDayZone): string {
  const at = new Date(createdAtIso);
  if (Number.isNaN(at.getTime())) return "Earlier";
  const today = startOfDay(now, zone);
  const day = startOfDay(at, zone);
  if (day === today) return "Today";
  if (day === startOfDay(new Date(today - 12 * 60 * 60 * 1000), zone)) return "Yesterday";
  return monthLabel(at, zone);
}

/**
 * `Date created` 筛选的起点(`Today` / `Last 7 days`),ISO 或 `undefined`(= `Any time`)。
 *
 * 和分组共用上面那一个 `startOfDay` —— 两处各写一份日界,就会出现「分组说 Today、筛选说
 * 今天没有」这种自相矛盾的屏幕。之前这里按 UTC 取当天 00:00,UTC+8 的商家凌晨做的东西
 * 因此被 `Today` 整批筛掉。
 *
 * `Last 7 days` 是一个滚动的 168 小时窗口,与时区无关。
 */
export function librarySinceForDateFilter(
  date: "all" | "today" | "week",
  now: Date,
  zone: LibraryDayZone,
): string | undefined {
  if (date === "all") return undefined;
  if (date === "today") return new Date(startOfDay(now, zone)).toISOString();
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 按时间组切开,**保持传进来的顺序** —— 排序权威是服务端的 `orderBy`,这里不再排第二次
 * (排两次就有两个真相,而分页只认服务端那一个)。
 */
export function groupLibraryItems(
  items: readonly LibraryItem[],
  now: Date,
  zone: LibraryDayZone,
): LibraryGroup[] {
  const groups: LibraryGroup[] = [];
  const byLabel = new Map<string, LibraryGroup>();
  for (const item of items) {
    const label = libraryTimeGroupLabel(item.createdAt, now, zone);
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
 * 一格上写什么名字。
 *
 * **只有商家自己上传的文件**才有名字可写(`Asset.originalFilename`)。引擎产物在真库里也带
 * 一个 `originalFilename`,但那是我们自己生成的存储键 —— 实测(共享 dev 库):
 * `GENERATED | gen-01M1HNK1FT8YQ9HF3ZY9YM917K.mp4 | Steam curling off a jar of pandan kaya…`。
 * 把它写到格子上,商家看到的就是一串机器码,而不是自己当时说的那句话。所以引擎产物一律
 * 写提示词(截断),两样都没有才说 "Untitled" —— 绝不拿 id、存储键、URL 或来源冒充名字。
 */
export function libraryItemTitle(item: Pick<LibraryItem, "source" | "filename" | "prompt">): string {
  const filename = item.source === "upload" ? item.filename.trim() : "";
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
