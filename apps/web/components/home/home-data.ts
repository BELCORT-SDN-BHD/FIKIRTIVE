/**
 * Home 五块的**形状与规则** —— 纯函数,零 I/O(换壳规格书 `docs/specs/wave2-shell.md` §4.1)。
 *
 * 为什么单独一层:Home 的每一个判断都是「这一块该不该出现、里面该写什么」,而那正是这一票
 * 最该被钉住的东西 —— 空账号看到的必须是**诚实的空**,不是假的满。判断留在渲染里就只能靠
 * 眼睛看,搬到这里就能拿真数据形状逐条证明(见 `lib/__tests__/home-page.test.ts`)。
 *
 * 输入类型刻意写成**结构型**而不是从 `lib/*-actions` 引进来:那些模块是 `"use server"`,
 * 而这一层不需要认识数据库,只需要认识「一行排期长什么样」。`ScheduledPostRow` /
 * `CampaignListRow` 结构上就满足这些形状,所以调用点一行转换都不用写。
 *
 * 日期、时间、状态词一律走**既有**的展示权威(`lib/schedule-view` / `lib/social-labels` /
 * `lib/campaign-lifecycle` / `lib/credit-format`),Home 不发明第二套写法。
 */

import { OTTO_GENERIC_GREETING_NAME, ottoGreetingName } from "@/lib/otto-greeting";
import { ottoOnboardingComplete, ottoOnboardingFacts } from "@/lib/otto-onboarding";
import { MY_TIME_ZONE } from "@/lib/my-date-format";
import { formatDayHeading, formatTime, partsInTz, statusPill } from "@/lib/schedule-view";
import { socialPlatformLabel } from "@/lib/social-labels";
import { CAMPAIGN_STATUS_BADGE, CAMPAIGN_STATUS_LABELS, isCampaignStatus } from "@/lib/campaign-lifecycle";

/* ── ① 开场 ──────────────────────────────────────────────────────────────────── */

/**
 * `Good morning, Aisha` —— 商家自己的名字,和商家自己的钟点。
 *
 * 钟点按**商家的时区**读(`MY_TIME_ZONE`),不是服务器的:生产容器多半跑 UTC,直接读
 * `getHours()` 会让吉隆坡早上 7 点的商家被问候一句 "Good evening"。时区用的是
 * `lib/my-date-format` 已经 pin 好的那一个,时间部件用的是排期面已经在用的 `partsInTz`
 * —— 两样都不是这一票新造的。
 *
 * 名字用 `ottoGreetingName`(Otto 前门用的同一把尺:多词取第一个词,邮箱地址永不进问候语)。
 * 解析不出名字时(`OTTO_GENERIC_GREETING_NAME` = "there")就**不带名字**:
 * "Good morning, there" 读起来像模板,而这一页最不该像的就是模板。
 */
export function homeGreeting(resolvedName: string, now: Date): string {
  const hour = partsInTz(now, MY_TIME_ZONE).hour;
  const timeOfDay = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = ottoGreetingName(resolvedName);
  return name && name !== OTTO_GENERIC_GREETING_NAME ? `${timeOfDay}, ${name}` : timeOfDay;
}

/* ── ② 接着做 ────────────────────────────────────────────────────────────────── */

export type HomeCanvas = {
  id: string;
  name: string;
  /** 服务端格好的日期串(`MY_DATE_FORMAT`),不是原始时间戳 —— 同 #949 A5。 */
  updatedLabel: string;
};

export type HomeThumb = {
  id: string;
  projectId: string;
  src: string;
  kind: "image" | "video";
  prompt: string;
};

/** 「接着做」里摆几张画布、几张缩略图。多了就不是「接着做」,是列表页(Library 与 Create
 *  各自有它们的完整列表,Home 只负责把人接回上次那一张)。 */
export const HOME_CANVAS_LIMIT = 5;
export const HOME_THUMB_LIMIT = 8;

/* ── ③ 接下来发什么 ──────────────────────────────────────────────────────────── */

/** 一行排期需要的字段 —— `ScheduledPostRow` 结构上就是它的超集。 */
export type ScheduledPostShape = {
  id: string;
  channel: string;
  caption: string;
  scheduledAt: Date;
  scheduledTz: string;
  status: string;
};

export type HomeUpcomingPost = {
  id: string;
  /** "Wed, Jul 10" —— 排期面同一个写法。 */
  dayLabel: string;
  /** "9:05 AM" —— 同上,按这条排期**自己的**时区读。 */
  timeLabel: string;
  channelLabel: string;
  statusLabel: string;
  caption: string;
};

/** 未来 7 天的窗口,给 `listScheduledPosts({from,to})`。含此刻:已经过去的时段不是
 *  「接下来发什么」。 */
export function upcomingWindow(now: Date): { from: string; to: string } {
  const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { from: now.toISOString(), to: to.toISOString() };
}

/** 已经发出去/取消掉的不属于「接下来发什么」。窗口本身已经按时间截过一次,这里只挑状态。 */
const UPCOMING_STATUSES: ReadonlySet<string> = new Set(["DRAFT", "SCHEDULED", "NEEDS_ATTENTION", "FAILED"]);

export const HOME_UPCOMING_LIMIT = 5;

export function upcomingPosts(rows: readonly ScheduledPostShape[]): HomeUpcomingPost[] {
  return rows
    .filter((row) => UPCOMING_STATUSES.has(row.status))
    .slice(0, HOME_UPCOMING_LIMIT)
    .map((row) => {
      const parts = partsInTz(row.scheduledAt, row.scheduledTz);
      return {
        id: row.id,
        dayLabel: formatDayHeading(parts),
        timeLabel: formatTime(parts),
        channelLabel: socialPlatformLabel(row.channel),
        statusLabel: statusPill(row.status).label,
        caption: row.caption,
      };
    });
}

/* ── ④ 进行中的战役 ──────────────────────────────────────────────────────────── */

/** 一条战役需要的字段 —— `CampaignListRow` 结构上就是它的超集。 */
export type CampaignShape = {
  id: string;
  name: string;
  goal: string;
  status: string;
};

export type HomeCampaign = {
  id: string;
  name: string;
  goal: string;
  statusLabel: string;
  badge: "outline" | "success" | "warning" | "destructive";
  /** 由调用方按导航权威源拼好递进来 —— 这一页不自己写第二份 `/campaign` 路径(§1.3)。 */
  href: string;
};

/** 收了工的战役(DONE / CANCELLED)不是「进行中」。草稿算 —— 它正在被计划,而徽章会照实
 *  说它是草稿,所以 Home 不必替商家判断哪一条「更重要」。 */
const CLOSED_CAMPAIGN_STATUSES: ReadonlySet<string> = new Set(["DONE", "CANCELLED"]);

export const HOME_CAMPAIGN_LIMIT = 3;

export function openCampaigns(rows: readonly CampaignShape[], campaignBaseHref: string): HomeCampaign[] {
  return rows
    .filter((row) => !CLOSED_CAMPAIGN_STATUSES.has(row.status))
    .slice(0, HOME_CAMPAIGN_LIMIT)
    .map((row) => ({
      id: row.id,
      name: row.name,
      goal: row.goal,
      statusLabel: isCampaignStatus(row.status) ? CAMPAIGN_STATUS_LABELS[row.status] : row.status,
      badge: isCampaignStatus(row.status) ? CAMPAIGN_STATUS_BADGE[row.status] : "warning",
      href: `${campaignBaseHref}/${row.id}`,
    }));
}

/* ── ⑤ 把 Otto 装备好 ────────────────────────────────────────────────────────── */

export type HomeEquipmentStep = {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  href: string;
};

/**
 * 装备清单 —— **只在没做完的时候出现**,做完就整块消失(规格书 §4.1 ⑤)。
 *
 * 两格都是这一页真读得到的事实:品牌记忆有没有(`listMemory`)、卖的东西有没有
 * (`listBrandRecords` 里 kind = product 的行)。做完与否由 `ottoOnboardingComplete`
 * 判,那是 #679 已经定下的规则,不在这里另写一遍。
 *
 * `ottoOnboardingFacts` 的另外两个输入(`dismissed` / `shopConversationCount`)在 Home 上
 * **没有对应的东西**:这块不是 #679 那张可关卡片(它没有关闭按钮,做完就消失),Home 也不读
 * 会话。所以两者传中性值,而门只看 `hasStuff` / `hasBrandMemory` 这两格 —— 也就是说,这块
 * 出不出现,只由上面那两条真数据决定,传进去的中性值动不了它。
 *
 * 「渠道连没连」那一格不在这里:它今天的实话由核心常量说(见 HomeView 的
 * `publishSurfaceCopy().why`),而不是一格商家点了也完不成的待办 —— 一个账号都连不上的时候,
 * 画一颗 Connect 按钮就是说大话。
 */
export function equipmentSteps(input: {
  brandMemoryCount: number;
  productCount: number;
  brandHref: string;
}): HomeEquipmentStep[] | null {
  const facts = ottoOnboardingFacts({
    dismissed: false,
    entityCount: input.productCount,
    brandMemoryCount: input.brandMemoryCount,
    shopConversationCount: 0,
  });
  if (ottoOnboardingComplete(facts)) return null;

  return [
    {
      key: "brand",
      label: "Teach Otto your brand",
      hint: "Voice, rules, audience — Otto uses it every time",
      done: facts.hasBrandMemory,
      href: input.brandHref,
    },
    {
      key: "products",
      label: "Add what you sell",
      hint: "Otto can only write about products it knows",
      done: facts.hasStuff,
      href: input.brandHref,
    },
  ];
}

/* ── 整页 ────────────────────────────────────────────────────────────────────── */

export type HomeData = {
  greeting: string;
  /** `creditsLabel()` 格好的余额。`null` = 这一刻读不出来 —— 那就照说读不出来,不编一个数。 */
  creditsLabel: string | null;
  billingHref: string;
  billingLabel: string;
  canvases: HomeCanvas[];
  thumbs: HomeThumb[];
  upcoming: HomeUpcomingPost[];
  campaigns: HomeCampaign[];
  /** `null` = 两件事都做完了,这块整个不出现。 */
  equipment: HomeEquipmentStep[] | null;
};
