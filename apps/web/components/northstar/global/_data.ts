/**
 * 北极星原型 · 全局横切区 — 区内示例数据(全部从共享 _mock 派生或引用)
 *
 * 规矩:城级数据只有一份(../_mock.ts);本文件只做全局区页面需要的
 * 组合视图(Otto 聊天 thread / 搜索语料 / 审批队列),不另造一座城。
 */

import {
  NS_ASSETS,
  NS_BRAND,
  NS_CAMPAIGN,
  NS_CAMPAIGN_ENTRIES,
  NS_OTTO_ACTIONS,
  NS_PRODUCTS,
  type NsOttoAction,
} from "../_mock";

export { NS_BRAND, NS_CAMPAIGN, NS_CAMPAIGN_ENTRIES, NS_OTTO_ACTIONS, NS_PRODUCTS, NS_ASSETS };
export type { NsOttoAction };

// ── Otto 聊天 thread(全部卡种一次演齐:GEN/PACK/RESEARCH/STORYBOARD/META/CAMPAIGN)──
export type NsChatCardKind = "gen" | "pack" | "research" | "storyboard" | "meta" | "campaign";

export interface NsChatMessage {
  id: string;
  role: "user" | "otto";
  text?: string;
  /** 已完成的命名思考子步骤(GOAL H0) */
  substeps?: string[];
  card?: NsChatCardKind;
  approval?: boolean;
  error?: boolean;
}

export interface NsChatThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: NsChatMessage[];
}

export const NS_CHAT_THREADS: NsChatThread[] = [
  {
    id: "th-merdeka",
    title: "Merdeka gift box campaign",
    updatedAt: "9:14am",
    messages: [
      {
        id: "tm-01",
        role: "user",
        text: `Plan a campaign for our ${NS_PRODUCTS[5].name}. Budget around ${NS_CAMPAIGN.budgetCredits} credits.`,
      },
      {
        id: "tm-02",
        role: "otto",
        substeps: ["Thinking", "Reading your brand memory", "Searching Merdeka trends", "Drafting the plan"],
        text: "I looked at what worked for bakeries last Merdeka before planning anything. Here is the research.",
        card: "research",
      },
      {
        id: "tm-03",
        role: "otto",
        text: `Based on that, here is a 7 post campaign for ${NS_CAMPAIGN.period.replace(" to ", " until ")}. Every post is a draft until you approve it.`,
        card: "campaign",
      },
      {
        id: "tm-04",
        role: "otto",
        approval: true,
      },
    ],
  },
  {
    id: "th-photos",
    title: "Gift box product shots",
    updatedAt: "Yesterday",
    messages: [
      { id: "tp-01", role: "user", text: `Make hero shots of the ${NS_PRODUCTS[5].name} for Instagram.` },
      {
        id: "tp-02",
        role: "otto",
        substeps: ["Thinking", "Reading your brand memory", "Generating 4 images"],
        text: "Done. 4 hero shots of the gift box, warm bakery light, ribbon in frame. They are saved to your Library.",
        card: "gen",
      },
      { id: "tp-03", role: "user", text: "Great. Turn the best one into a full content pack." },
      {
        id: "tp-04",
        role: "otto",
        substeps: ["Thinking", "Sizing for each platform", "Writing captions"],
        text: "Here is the pack you approved earlier today. One visual, six platform ready variants.",
        card: "pack",
      },
      { id: "tp-05", role: "user", text: "Build the Meta ad draft too." },
      {
        id: "tp-06",
        role: "otto",
        substeps: ["Thinking", "Reading your ad performance", "Building the draft"],
        text: "Ad draft is built and parked. Nothing runs and nothing is charged until you turn it on in Ads.",
        card: "meta",
      },
    ],
  },
  {
    id: "th-reel",
    title: "Croissant reel storyboard",
    updatedAt: "Mon",
    messages: [
      { id: "tr-01", role: "user", text: "Storyboard a 15s reel: how we fold 200 croissants before sunrise." },
      {
        id: "tr-02",
        role: "otto",
        substeps: ["Thinking", "Breaking the story into scenes", "Laying out 4 frames"],
        text: "4 scenes, dark kitchen to golden tray. Steps 1 to 3 cost nothing. Rendering the final reel is the only paid step.",
        card: "storyboard",
      },
      {
        id: "tr-03",
        role: "otto",
        error: true,
        text: "Couldn't render the preview. You weren't charged. Try again.",
      },
    ],
  },
];

// ── 全局搜索语料(GOAL A3 范围:Projects / History / Chat,不发明全站对象)──
export type NsSearchGroup = "Projects" | "History" | "Chat";

export interface NsSearchItem {
  id: string;
  group: NsSearchGroup;
  title: string;
  meta: string;
  href: string;
}

export const NS_SEARCH_ITEMS: NsSearchItem[] = [
  // Projects
  {
    id: "sp-01",
    group: "Projects",
    title: NS_CAMPAIGN.name,
    meta: `Campaign · ${NS_CAMPAIGN.period}`,
    href: "/northstar/campaign/calendar",
  },
  {
    id: "sp-02",
    group: "Projects",
    title: "Weekly bakes evergreen",
    meta: "Project · 12 items",
    href: "/northstar/create/canvas",
  },
  {
    id: "sp-03",
    group: "Projects",
    title: "Ramadan pre-order teasers",
    meta: "Project · archived",
    href: "/northstar/create/canvas",
  },
  // History(生成历史 = 共享资产表)
  ...NS_ASSETS.map((a, i) => ({
    id: `sh-${i + 1}`,
    group: "History" as const,
    title: a.title,
    meta: `${a.kind === "image" ? "Image" : a.kind === "video" ? "Video" : "Storyboard"} · ${a.createdAt}${a.credits > 0 ? ` · ${a.credits} credits` : ""}`,
    href: "/northstar/assets/library",
  })),
  // Chat
  ...NS_CHAT_THREADS.map((t, i) => ({
    id: `sc-${i + 1}`,
    group: "Chat" as const,
    title: t.title,
    meta: `Chat · ${t.updatedAt}`,
    href: "/northstar/global/otto-chat",
  })),
];

// ── 审批队列(ApprovalRequest 一个原语两个表面:通知中心 + dock/聊天同源)──
export interface NsApprovalRequest {
  id: string;
  title: string;
  detail: string;
  credits?: number;
  impacts: string[];
  requestedAt: string;
  /** generation = 花钱生成(Otto 干活,coral);schedule = 排期确认(人的动作,INK) */
  kind: "generation" | "schedule";
}

export const NS_APPROVALS: NsApprovalRequest[] = [
  {
    id: "ap-01",
    title: "Generate 3 Merdeka videos",
    detail: `For ${NS_CAMPAIGN.name} · entries 1, 3 and 6 of the calendar`,
    credits: 120,
    impacts: [
      "Creates 3 videos in your Library",
      "Uses 120 credits from your balance",
      "Nothing is posted until you schedule it",
    ],
    requestedAt: "12m ago",
    kind: "generation",
  },
  {
    id: "ap-02",
    title: "Schedule 2 approved posts",
    detail: "Kaya croissant post and kopi tiramisu post",
    impacts: [
      "Posts go out Tue 9:00am and Wed 12:30pm (Kuala Lumpur time)",
      "You can unschedule any time before they publish",
    ],
    requestedAt: "1h ago",
    kind: "schedule",
  },
];
