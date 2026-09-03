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
 *   · 日界按浏览者自己的时区算,不按 UTC —— 见 `LibraryTimeZone`。
 *
 * 放在 `lib/` 而不是组件里,是为了让这两条规则能在没有 DOM 的情况下被直接钉住。
 */
import type { LibraryItem } from "./library-actions";

/**
 * `/library` 的一级视图 —— 与已批准设计的 `patterns/library/model.ts` 的 `LIBRARY_VIEWS`
 * **逐格一致**(顺序也一致)。
 *
 * seg2a 那一票只画得出三格:`Favorites` 与 `Collections` 当时在后端没有对象。段②的第②③刀
 * 把它们建起来了(`Favorite` / `Collection` / `CollectionItem` 三张表与
 * `lib/library-favorites.ts`、`lib/library-collections.ts` 的动作层),所以这两格按前端规则
 * 第①条回到导航上 —— 有真实能力才出现,现在有了。
 */
export const LIBRARY_VIEWS = [
  { value: "history", label: "Generation history" },
  { value: "uploads", label: "Uploads" },
  { value: "favorites", label: "Favorites" },
  { value: "collections", label: "Collections" },
  { value: "elements", label: "Elements" },
] as const;

export type LibraryView = (typeof LIBRARY_VIEWS)[number]["value"];

/** 地址里的 `?view=` —— 认不出来的值一律落回默认那一格,不 404、也不画空白。 */
export function parseLibraryView(raw: string | undefined): LibraryView {
  return LIBRARY_VIEWS.some((item) => item.value === raw) ? (raw as LibraryView) : "history";
}

/**
 * 一个时间组:标题(Today / Yesterday / August 2026)加落在里面的行。
 *
 * 泛型是段②后加的:收藏与合集成员画的是同一张网格,而它们的行不是 `LibraryItem`
 * 而是 `LibrarySubjectItem`。分组只用到 `createdAt` 一列,所以按「有创建时间的东西」
 * 收口 —— 而不是复制第二份分组函数。
 */
export type LibraryGroup<T extends { createdAt: string } = LibraryItem> = {
  key: string;
  label: string;
  items: T[];
};

/**
 * 日界按哪个时区算 —— 一个 IANA 时区名(`"Asia/Kuala_Lumpur"`、`"UTC"`)。
 *
 * 权威是**浏览者自己的钟**。商家在马来西亚(UTC+8)凌晨 02:00 做的东西,在 UTC 那边还停在
 * 前一天 18:00 —— 按 UTC 分组会把商家「今天早上刚做的」标成 Yesterday,并且被
 * `Date created / Today` 筛选整组排除掉。那不是「时区口径不同」,那是屏幕上写了一句假话。
 *
 * 服务端渲染的第一帧不知道浏览器在哪个时区,只能先传 `"UTC"`;`LibraryView` 挂载后用
 * React 自己的服务端/客户端快照机制(`useSyncExternalStore`)换成
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` 再算一次 —— 两端第一帧的文字因此
 * 一致,不会 hydration mismatch。
 *
 * **为什么收一个时区名,而不是 `Date` 的本地取值器。** 本地取值器读的是进程时区,在浏览器
 * 里正确,却让这条规则在测试里钉不住:跑测试的机器在 UTC+8 就永远绿,在 UTC(CI 就是)
 * 则 "utc" 与 "local" 根本没有区别 —— 而运行中改进程时区在 vitest 里是空操作(本轮实测:
 * 改了之后断言纹丝不动)。靠机器碰巧在哪个时区才绿的围栏等于没有围栏,所以时区是显式
 * 传进来的一个值。
 */
export type LibraryTimeZone = string;

/** 界面只有英文一种写法(原来的代码也写死 `"en-US"`),一张表比一次 Intl 调用直接。 */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * 带**显式 timeZone** 的 formatter 才是安全的:不带 timeZone 的那种会把构造那一刻的
 * 进程时区焊死在里面(Node 22 实测),于是「按浏览者的钟算」在它身上就是假的。
 * 按时区名缓存,因为一屏要按行调用几十上百次。
 */
const ZONE_FORMATS = new Map<string, { day: Intl.DateTimeFormat; clock: Intl.DateTimeFormat }>();
function zoneFormats(timeZone: LibraryTimeZone) {
  let formats = ZONE_FORMATS.get(timeZone);
  if (!formats) {
    formats = {
      // en-CA 的日期就是 `YYYY-MM-DD`,可以直接当排序键与相等键用。
      day: new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      }),
      clock: new Intl.DateTimeFormat("en-CA", {
        timeZone, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }),
    };
    ZONE_FORMATS.set(timeZone, formats);
  }
  return formats;
}

/** 那一刻在 `timeZone` 的钟上是哪一天,`YYYY-MM-DD`。 */
function dayKey(at: Date, timeZone: LibraryTimeZone): string {
  return zoneFormats(timeZone).day.format(at);
}

/** `YYYY-MM-DD` 的前一天。按日历退一天,不减 24 小时 —— 夏令时那天只有 23 小时。 */
function previousDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/** `timeZone` 在 `at` 这一刻的 UTC 偏移(毫秒)。 */
function zoneOffsetMs(at: Date, timeZone: LibraryTimeZone): number {
  const parts: Record<string, number> = {};
  for (const part of zoneFormats(timeZone).clock.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  // 把「那一刻在 timeZone 的钟面读数」当成 UTC 读一次,与真实时刻的差就是偏移。
  const asUtc = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour % 24, parts.minute, parts.second,
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** `now` 那一天在 `timeZone` 的 00:00,是**哪一个真实时刻**。 */
function startOfDayInstant(now: Date, timeZone: LibraryTimeZone): Date {
  const [year, month, day] = dayKey(now, timeZone).split("-").map(Number);
  // 先把本地 00:00 的读数当成 UTC 猜一次,再把那一刻的偏移减掉。
  const guess = Date.UTC(year, month - 1, day);
  return new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
}

/**
 * 一行属于哪个时间组。README §3.1 的原话是「例如 Today / Yesterday / August 2026」——
 * 前两组是相对今天的,再往前一律按月,所以库里放多久都不会撞上夹具那三个常量的天花板。
 */
export function libraryTimeGroupLabel(
  createdAtIso: string,
  now: Date,
  timeZone: LibraryTimeZone,
): string {
  const at = new Date(createdAtIso);
  if (Number.isNaN(at.getTime())) return "Earlier";
  const day = dayKey(at, timeZone);
  const today = dayKey(now, timeZone);
  if (day === today) return "Today";
  if (day === previousDay(today)) return "Yesterday";
  const [year, month] = day.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * `Date created` 筛选的起点(`Today` / `Last 7 days`),ISO 或 `undefined`(= `Any time`)。
 *
 * 和分组共用同一个日界 —— 两处各写一份,就会出现「分组说 Today、筛选说今天没有」这种
 * 自相矛盾的屏幕。之前这里按 UTC 取当天 00:00,UTC+8 的商家凌晨做的东西因此被整批筛掉。
 *
 * `Last 7 days` 是一个滚动的 168 小时窗口,与时区无关。
 */
export function librarySinceForDateFilter(
  date: "all" | "today" | "week",
  now: Date,
  timeZone: LibraryTimeZone,
): string | undefined {
  if (date === "all") return undefined;
  if (date === "today") return startOfDayInstant(now, timeZone).toISOString();
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 按时间组切开,**保持传进来的顺序** —— 排序权威是服务端的 `orderBy`,这里不再排第二次
 * (排两次就有两个真相,而分页只认服务端那一个)。
 */
export function groupLibraryItems<T extends { createdAt: string }>(
  items: readonly T[],
  now: Date,
  timeZone: LibraryTimeZone,
): LibraryGroup<T>[] {
  const groups: LibraryGroup<T>[] = [];
  const byLabel = new Map<string, LibraryGroup<T>>();
  for (const item of items) {
    const label = libraryTimeGroupLabel(item.createdAt, now, timeZone);
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
