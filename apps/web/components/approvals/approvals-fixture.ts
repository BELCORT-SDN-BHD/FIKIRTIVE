/**
 * approvals-fixture.ts —— Approvals 这一面的**数据与类型**,一个 React 节点都没有。
 *
 * 拆出来的理由不是「文件太长」,是这一面从一张卡长成了八件事(三态动作、先选后批、
 * 卡内双页签、版本循环、阻断芯片、钱贴动作、审计时间线、独立审批到期)。八件里有七件
 * 需要**同一条目上的更多事实**;把事实与画法写在同一个文件里,画法每改一次都要重读
 * 一遍数据,而 `otto-pronoun-consistency` 的变体扫描也会因为条件分支暴涨直接超上限。
 *
 * 这里的每一条都是 fixture:零后端、零 provider、零积分。商家屏幕上出现的每一个数字
 * 都必须能从这份数据里指出出处 —— 卡上没有一处硬写的「2 due today」或「16 credits」。
 */

export type ApprovalStatus = "waiting" | "approved" | "rejected";
export type ApprovalGroup = "today" | "week" | "none";
export type ApprovalResolution = "approved" | "rejected" | "superseded" | "canceled";
export type ApprovalDetailTab = "preview" | "brief";

/**
 * v2 稿②:媒体按**真实比例**出现在卡上。以前每张图都被裁成 46×58 的小方块 —— 那是
 * 铬的尺寸,不是内容的尺寸,商家看不出这条竖版会在 Instagram 上占多高。
 */
export type ApprovalRatio = "4:5" | "1:1" | "9:16" | "1.91:1";

/** 稿②:卡面那一条媒体带里的一格。没有 `image` 就是「还没做出来」,画虚线占位、不可点。 */
export type ApprovalMedia = {
  image?: string;
  ratio: ApprovalRatio;
  /** 点开审阅层时看哪一条 `previews`。占位格没有成品可看,所以不带这个值。 */
  previewIndex?: number;
};

/** 稿①:meta 行最左边那枚频道图标。 */
export type ApprovalChannel = "instagram" | "facebook";

/** ③ 逐平台预览:同一条内容在每个平台上的成品形态。 */
export type ApprovalPlatformPreview = {
  platform: string;
  image?: string;
  caption: string;
  fit: string;
  /** 稿:审阅层的 meta 行写「平台 · 时段」,预览卡头也是这两件事。 */
  slot?: string;
  /** 稿:审阅层的画框按这个比例开,不是一律 4:5。 */
  ratio?: ApprovalRatio;
};

/** ③ Source brief:Otto 依据什么做的。 */
export type ApprovalBrief = {
  routine: string;
  promptGist: string;
  cost: string;
};

/** ⑦ 单人审计时间线的一条事件。 */
export type ApprovalTimelineEvent = {
  id: string;
  label: string;
  when: string;
  detail?: string;
};

/** ⑤ 阻断:这张卡今天批不了,以及去哪儿修。 */
export type ApprovalBlocker = {
  chip: string;
  why: string;
  fixContext: string;
};

export type ApprovalItem = {
  id: string;
  title: string;
  origin: string;
  source: "otto" | "team";
  cost: number;
  status: ApprovalStatus;
  group?: ApprovalGroup;
  when?: string;
  detail: string;
  /**
   * 稿②:**帖子自己的字**。卡面上最大的那一行,商家的内容当主角。
   *
   * v1 的卡头写的是 `title`(「Candle care tip for the pandan range」)—— 那是我们给这条
   * 东西起的名字,不是关注者会读到的那句话。批一条帖子却看不到帖子,是这一面最贵的一处错。
   * `title` 没有删:勾选框与详情页签仍然用它当无障碍名字(读屏的人需要一个短名字来区分卡)。
   */
  caption: string;
  /** 稿②:caption 下面那一句「这条为什么长这样」。没有就不画。 */
  note?: string;
  /** 稿①:频道图标。 */
  channel?: ApprovalChannel;
  /** 稿②:带比例的媒体带。与 `images` 同一批图,多的只是每张的真实比例。 */
  media?: ApprovalMedia[];
  /** 稿:审阅层右栏那句问句(「Approve all 4 posts?」)。 */
  ask?: string;
  /**
   * 下面这四条是 v1 皮画卡面用的,v2 皮不再读它们,字段与数据都原样留着:
   *   · `images` / `moreImages` / `pendingImage` —— 卡面改由 `media` 画(同一批图,多了比例);
   *   · `previousTime` / `nextTime` —— 改期卡的前后时间点现在写在 `note` 那句话里。
   * 留着是因为它们仍然是这条目上成立的事实,删掉等于顺手改了别人的数据契约。
   */
  images?: string[];
  moreImages?: number;
  pendingImage?: boolean;
  sources?: string[];
  previousTime?: string;
  nextTime?: string;
  decision?: string;
  resolution?: ApprovalResolution;
  openLabel?: string;
  openHref?: string;
  /** ① 谁来改。团队来源的卡收件人是那位成员,不是 Otto。 */
  reviseTarget?: string;
  /** ⑥ 批准之后会发生什么 —— 贴在动作旁边,不是埋在详情里。 */
  consequence?: string;
  /** ⑧ 审批到期,与 slot 时间彼此独立。 */
  decideBy?: string;
  /** ⑧ 距离 `decideBy` 还剩几小时。临期与否由它派生,不是各卡自己写一个布尔。 */
  decideByHours?: number;
  /** ⑤ */
  blocker?: ApprovalBlocker;
  /** ④ 版本号。V1 不写,改版之后的新卡从 2 起。 */
  version?: number;
  /** ④ 同一条目的第一版 id —— 版本循环跑第二轮时 id 才不会互相踩。 */
  rootId?: string;
  /** ④ What changed:新版本相对上一版改了什么。 */
  whatChanged?: string;
  /** ④ 旧意见,以「已结清」的样子随新卡可见。 */
  settledFeedback?: string;
  /** ④ 旧卡指向新卡。 */
  supersededBy?: string;
  /** ③ */
  previews?: ApprovalPlatformPreview[];
  /** ③ */
  brief?: ApprovalBrief;
  /** ⑦ */
  timeline?: ApprovalTimelineEvent[];
};

export const FIXTURE_STATE_KEY = "fikirtive.r22.approvals.state.v1";

/** ⑧ 剩这么多小时之内算临期,卡上升警示样式。一个阈值,不是每张卡各写一遍。 */
export const DECIDE_BY_URGENT_HOURS = 4;

/** ④ 改版的 fixture 延时。比决策那 260ms 长,因为屏幕上真的多出一张新卡。 */
export const REVISE_DELAY_MS = 900;
export const DECISION_DELAY_MS = 260;

export const REASONS = [
  "Doesn't sound like us",
  "Wrong facts or price",
  "Image looks off",
  "Breaks a rule I set",
  "Something else",
] as const;

export type ApprovalReason = (typeof REASONS)[number];

/**
 * ④ 每个理由对应「新版本改了什么」的一句话。
 *
 * 这是 fixture 的 deterministic 部分:同一个理由永远得到同一句 What changed,
 * 不掷骰子、不带时间戳 —— 屏幕上那句话必须指得出出处。
 */
export const REVISION_CHANGES: Record<ApprovalReason, string> = {
  "Doesn't sound like us": "Rewritten in the brand voice saved in Otto IQ.",
  "Wrong facts or price": "Product facts and prices re-checked against your product list.",
  "Image looks off": "New image from the same prompt, with the product centred.",
  "Breaks a rule I set": "Rewritten to keep the rule you set.",
  "Something else": "Redone from the note you left.",
};

export const GROUPS: Array<{ id: ApprovalGroup; label: string; time?: string }> = [
  { id: "today", label: "Due today", time: "times in GMT+8" },
  { id: "week", label: "This week" },
  { id: "none", label: "No deadline" },
];

export const FIXTURE_ITEMS: ApprovalItem[] = [
  {
    id: "i1",
    title: "Candle care tip for the pandan range",
    origin: "Otto · Weekday mornings",
    source: "otto",
    cost: 0,
    status: "waiting",
    group: "today",
    when: "Today 09:00",
    detail: "Instagram · 1 post",
    channel: "instagram",
    caption: "Trim the wick to 5mm before every burn. Your pandan candle keeps its scent twice as long.",
    ask: "Approve this post?",
    media: [{ image: "/fixtures/r22-canvas/art-3.jpg", ratio: "4:5", previewIndex: 0 }],
    images: ["/fixtures/r22-canvas/art-3.jpg"],
    sources: ["candle scent list", "no discounts before Oct 25"],
    openLabel: "Open in campaign",
    openHref: "/campaign?fixture=r22",
    consequence: "Approving schedules 1 post, held in Schedule until a channel is connected.",
    decideBy: "Today 08:00",
    decideByHours: 2,
    previews: [
      {
        platform: "Instagram",
        slot: "Today 09:00",
        ratio: "4:5",
        image: "/fixtures/r22-canvas/art-3.jpg",
        caption: "Trim the wick to 5mm before every burn. Your pandan candle keeps its scent twice as long.",
        fit: "Portrait 4:5. Caption 118 characters, one screen, no cut.",
      },
    ],
    brief: {
      routine: "Weekday mornings · runs 09:00, Monday to Friday",
      promptGist: "One care tip per week for the pandan range, written for people who bought a candle before.",
      cost: "Free to schedule · no generation was needed",
    },
    timeline: [
      { id: "i1-t1", label: "Created by Otto · Weekday mornings", when: "Today 06:10" },
      { id: "i1-t2", label: "Edited by Otto", when: "Today 06:12", detail: "Shortened the caption to fit one screen." },
    ],
  },
  {
    id: "i2",
    title: "Deepavali gift set · 4 posts",
    origin: "Otto · Weekend routine",
    source: "otto",
    cost: 0,
    status: "waiting",
    group: "today",
    when: "Today 18:00",
    detail: "Instagram, Facebook · 4 posts",
    channel: "instagram",
    caption: "The Deepavali gift set is ready. Three scents, one box, wrapped by hand.",
    note: "Facebook carries the same words plus the workshop name. Two of these four posts hold the Sat 10:00 slot.",
    ask: "Approve all 4 posts?",
    media: [
      { image: "/fixtures/r22-canvas/art-2.jpg", ratio: "4:5", previewIndex: 0 },
      { image: "/fixtures/r22-canvas/art-3.jpg", ratio: "4:5", previewIndex: 1 },
      { image: "/fixtures/r22-canvas/art-4.jpg", ratio: "4:5", previewIndex: 2 },
      { image: "/fixtures/r22-canvas/art-1.jpg", ratio: "1.91:1", previewIndex: 3 },
    ],
    images: [
      "/fixtures/r22-canvas/art-2.jpg",
      "/fixtures/r22-canvas/art-1.jpg",
      "/fixtures/r22-canvas/art-4.jpg",
      "/fixtures/r22-canvas/art-3.jpg",
    ],
    moreImages: 2,
    sources: ["Deepavali gift set", "no discounts before Oct 25"],
    openLabel: "Open in campaign",
    openHref: "/campaign?fixture=r22",
    consequence: "Approving schedules 4 posts, held in Schedule until a channel is connected.",
    decideBy: "Today 17:00",
    decideByHours: 9,
    /** 稿:4 个帖子就有 4 条预览 —— 卡面那 4 格与审阅层的 4 张是同一批,一格对一条。 */
    previews: [
      {
        platform: "Instagram",
        slot: "Today 18:00",
        ratio: "4:5",
        image: "/fixtures/r22-canvas/art-2.jpg",
        caption: "The Deepavali gift set is ready. Three scents, one box, wrapped by hand.",
        fit: "Portrait 4:5. First two lines show before “more”.",
      },
      {
        platform: "Instagram",
        slot: "Sat 10:00",
        ratio: "4:5",
        image: "/fixtures/r22-canvas/art-3.jpg",
        caption: "Pandan, coconut, gula melaka. The three scents in the Deepavali box.",
        fit: "Portrait 4:5. Holds the Sat 10:00 slot.",
      },
      {
        platform: "Instagram",
        slot: "Sat 10:00",
        ratio: "4:5",
        image: "/fixtures/r22-canvas/art-4.jpg",
        caption: "Every box is wrapped by hand in Bangsar, the night before it ships.",
        fit: "Portrait 4:5. Holds the Sat 10:00 slot.",
      },
      {
        platform: "Facebook",
        slot: "Today 18:00",
        ratio: "1.91:1",
        image: "/fixtures/r22-canvas/art-1.jpg",
        caption: "The Deepavali gift set is ready. Three scents, one box, wrapped by hand in Bangsar.",
        fit: "Landscape 1.91:1. Link preview off.",
      },
    ],
    brief: {
      routine: "Weekend routine · runs Saturday 10:00",
      promptGist: "Launch the Deepavali gift set across both channels, keeping the no-discount rule until Oct 25.",
      cost: "Free to schedule · the four images were made in Canvas earlier",
    },
    timeline: [
      { id: "i2-t1", label: "Created by Otto · Weekend routine", when: "Yesterday 21:40" },
      { id: "i2-t2", label: "Edited by Otto", when: "Yesterday 21:44", detail: "Split one post into four so each scent gets its own slot." },
    ],
  },
  {
    id: "i3",
    title: "Make 4 more Deepavali variants",
    origin: "Otto · Weekend routine",
    source: "otto",
    cost: 16,
    status: "waiting",
    group: "week",
    when: "Before Sat 09:00",
    detail: "Instagram · 4 images",
    channel: "instagram",
    caption: "Four more scent variants of the Deepavali set, shot in the same light as the first four.",
    note: "Nothing is made until this is approved, so there is nothing to look at yet.",
    ask: "Approve making 4 images?",
    /** 稿:唯一一处「图片说话而不是给你看」的地方 —— 四格全是虚线占位,一格也点不开。 */
    media: [
      { ratio: "4:5" },
      { ratio: "4:5" },
      { ratio: "4:5" },
      { ratio: "4:5" },
    ],
    pendingImage: true,
    sources: ["candle scent list"],
    openLabel: "See the credit ledger",
    openHref: "/settings?section=billing&fixture=r22",
    consequence: "Approving makes 4 images and 16 credits leave your balance.",
    decideBy: "Fri 18:00",
    decideByHours: 30,
    blocker: {
      chip: "Over weekly credit cap",
      why: "The Weekend routine has 8 credits left this week and this batch needs 16, so nothing can be made until the cap or the batch changes.",
      fixContext: "Raise the weekly credit cap for the Weekend routine, or cut this batch to 2 images",
    },
    previews: [
      {
        platform: "Instagram",
        slot: "before Sat 09:00",
        ratio: "4:5",
        caption: "Four more scent variants of the Deepavali set, shot in the same light as the first four.",
        fit: "Portrait 4:5. Nothing is made until this is approved.",
      },
    ],
    brief: {
      routine: "Weekend routine · runs Saturday 10:00",
      promptGist: "Four more variants of the Deepavali set so each scent has its own image.",
      cost: "16 credits. 4 credits per image, charged when the images are made.",
    },
    timeline: [
      { id: "i3-t1", label: "Created by Otto · Weekend routine", when: "Yesterday 21:46" },
      { id: "i3-t2", label: "Held by the weekly credit cap", when: "Yesterday 21:46", detail: "8 credits left this week, 16 needed." },
    ],
  },
  {
    id: "i4",
    title: "Restock note for the pandan candle",
    origin: "Aiman · draft",
    source: "team",
    cost: 0,
    status: "waiting",
    group: "week",
    when: "Thu 17:00",
    detail: "Facebook · 1 post",
    channel: "facebook",
    caption: "The pandan candle is back in stock this Thursday. Same batch size as last month.",
    ask: "Approve this post?",
    media: [{ image: "/fixtures/r22-canvas/art-4.jpg", ratio: "1.91:1", previewIndex: 0 }],
    images: ["/fixtures/r22-canvas/art-4.jpg"],
    sources: ["pandan candle"],
    openLabel: "Open in schedule",
    openHref: "/schedule?fixture=r22",
    reviseTarget: "Aiman",
    consequence: "Approving schedules 1 post, held in Schedule until a channel is connected.",
    decideBy: "Thu 12:00",
    decideByHours: 26,
    previews: [
      {
        platform: "Facebook",
        slot: "Thu 17:00",
        ratio: "1.91:1",
        image: "/fixtures/r22-canvas/art-4.jpg",
        caption: "The pandan candle is back in stock this Thursday. Same batch size as last month.",
        fit: "Landscape 1.91:1. Link preview off.",
      },
    ],
    brief: {
      routine: "Written by Aiman, not by a routine",
      promptGist: "Tell people the pandan candle is back, without promising a date the workshop cannot keep.",
      cost: "Free to schedule · no generation was needed",
    },
    timeline: [
      { id: "i4-t1", label: "Created by Aiman", when: "Mon 14:20" },
      { id: "i4-t2", label: "Edited by Aiman", when: "Mon 14:35", detail: "Removed the exact restock count." },
    ],
  },
  {
    id: "i5",
    title: "Move Friday's post to Saturday",
    origin: "Otto · Weekday mornings",
    source: "otto",
    cost: 0,
    status: "waiting",
    group: "none",
    when: "Sat 09:00",
    previousTime: "Fri 10:00",
    nextTime: "Sat 09:00",
    detail: "Instagram · 1 post",
    channel: "instagram",
    caption: "Weekend market. The candles are at the Bangsar stall from 10 in the morning.",
    /** 稿:改期卡的那一句 —— 前后两个时间点都在这句话里,不必另画一条 from → to。 */
    note: "Moving from Fri 10:00 to Sat 09:00 because Friday is a public holiday. The post itself does not change.",
    ask: "Approve moving this post?",
    media: [{ image: "/fixtures/r22-canvas/art-1.jpg", ratio: "4:5", previewIndex: 0 }],
    images: ["/fixtures/r22-canvas/art-1.jpg"],
    sources: ["public holidays"],
    openLabel: "Open in schedule",
    openHref: "/schedule?fixture=r22",
    consequence: "Approving moves 1 scheduled post. Nothing is made and nothing is spent.",
    decideBy: "Thu 20:00",
    decideByHours: 34,
    previews: [
      {
        platform: "Instagram",
        slot: "Sat 09:00",
        ratio: "4:5",
        image: "/fixtures/r22-canvas/art-1.jpg",
        caption: "Weekend market. The candles are at the Bangsar stall from 10 in the morning.",
        fit: "Unchanged. This decision only moves the slot.",
      },
    ],
    brief: {
      routine: "Weekday mornings · runs 09:00, Monday to Friday",
      promptGist: "Friday is a public holiday, so the slot moves to the next morning people are online.",
      cost: "Free · moving a slot spends nothing",
    },
    timeline: [
      { id: "i5-t1", label: "Created by Otto · Weekday mornings", when: "Today 06:15" },
    ],
  },
  {
    id: "h1",
    title: "Weekend market reminder",
    origin: "Otto · Weekend routine",
    source: "otto",
    cost: 0,
    status: "approved",
    when: "Sat 10:00",
    detail: "Instagram · Scheduled",
    channel: "instagram",
    caption: "The candles are at the Bangsar market stall this Saturday, from 10 in the morning.",
    note: "Held in Schedule until a channel is connected.",
    media: [{ image: "/fixtures/r22-canvas/art-2.jpg", ratio: "1:1", previewIndex: 0 }],
    images: ["/fixtures/r22-canvas/art-2.jpg"],
    decision: "Approved by Nicks · today 08:42",
    resolution: "approved",
    previews: [
      {
        platform: "Instagram",
        slot: "Sat 10:00",
        ratio: "1:1",
        image: "/fixtures/r22-canvas/art-2.jpg",
        caption: "The candles are at the Bangsar market stall this Saturday, from 10 in the morning.",
        fit: "Square 1:1. Caption 96 characters.",
      },
    ],
    brief: {
      routine: "Weekend routine · runs Saturday 10:00",
      promptGist: "Remind people which market stall the candles are at this weekend.",
      cost: "Free to schedule · no generation was needed",
    },
    timeline: [
      { id: "h1-t1", label: "Created by Otto · Weekend routine", when: "Today 07:55" },
      { id: "h1-t2", label: "Approved by Nicks", when: "Today 08:42" },
    ],
  },
  {
    id: "h2",
    title: "Soy wax restock · 2 posts",
    origin: "Otto · Weekday mornings",
    source: "otto",
    cost: 8,
    status: "approved",
    when: "Mon 09:00",
    detail: "Instagram · 2 posts · Scheduled",
    channel: "instagram",
    caption: "Soy wax is back. Pandan and coconut, both in the shop from Monday morning.",
    note: "Held in Schedule until a channel is connected.",
    media: [
      { image: "/fixtures/r22-canvas/art-4.jpg", ratio: "4:5", previewIndex: 0 },
      { image: "/fixtures/r22-canvas/art-1.jpg", ratio: "4:5", previewIndex: 1 },
    ],
    images: ["/fixtures/r22-canvas/art-4.jpg", "/fixtures/r22-canvas/art-1.jpg"],
    decision: "Approved by Nicks · Mon 07:55 · see the 8 credits in the ledger",
    resolution: "approved",
    previews: [
      {
        platform: "Instagram",
        slot: "Mon 09:00",
        ratio: "4:5",
        image: "/fixtures/r22-canvas/art-4.jpg",
        caption: "Soy wax is back. Pandan and coconut, both in the shop from Monday morning.",
        fit: "Portrait 4:5. Caption 88 characters.",
      },
      {
        platform: "Instagram",
        slot: "Mon 09:30",
        ratio: "4:5",
        image: "/fixtures/r22-canvas/art-1.jpg",
        caption: "Coconut soy wax, poured on Sunday, on the shelf by Monday.",
        fit: "Portrait 4:5. Caption 74 characters.",
      },
    ],
    brief: {
      routine: "Weekday mornings · runs 09:00, Monday to Friday",
      promptGist: "Two posts about the soy wax restock, one for each scent that came back.",
      cost: "8 credits. 4 credits per image.",
    },
    timeline: [
      { id: "h2-t1", label: "Created by Otto · Weekday mornings", when: "Mon 06:10" },
      { id: "h2-t2", label: "Approved by Nicks", when: "Mon 07:55", detail: "8 credits charged when the images were made." },
    ],
  },
  {
    id: "h3",
    title: "Discount teaser for the gift set",
    origin: "Otto · Weekend routine",
    source: "otto",
    cost: 0,
    status: "rejected",
    detail: "Instagram · Version 1",
    channel: "instagram",
    caption: "Deepavali bundle. A little off the full price if you order before the weekend.",
    note: "Otto remade this one, and version 2 is waiting in Needs review. This version was never scheduled.",
    media: [{ image: "/fixtures/r22-canvas/art-2.jpg", ratio: "1:1", previewIndex: 0 }],
    images: ["/fixtures/r22-canvas/art-2.jpg"],
    decision: "Sent to Otto for a revise by Nicks · yesterday 17:10 · Breaks a rule I set",
    resolution: "superseded",
    previews: [
      {
        platform: "Instagram",
        slot: "Sat 10:00",
        ratio: "1:1",
        image: "/fixtures/r22-canvas/art-2.jpg",
        caption: "Deepavali bundle. A little off the full price if you order before the weekend.",
        fit: "Square 1:1. This version was never scheduled.",
      },
    ],
    /**
     * ④ 判官 r1 [P2]:这一条是版本循环**唯一一条种子实例**,所以它必须与
     * `applyDecision` / `nextVersionOf` 跑出来的那一对长得一模一样 —— 旧卡带
     * `supersededBy` 指向新卡(卡面才画得出 See the new version),新卡真的在
     * Needs review 里(下面那条 `h3-v2`)。上一版只有卡面那句「a new version is in
     * Needs review」,没有 `supersededBy`、也没有对应的 V2 卡:商家点进 Sent back
     * 第一眼看到的就是一句当场证伪的话。
     *
     * 时间线也照那条代码路径:「Version 2 produced by Otto」是**新卡**的事件
     * (`nextVersionOf` 把它追加在子卡上),旧卡只记到「Revise asked by Nicks」。
     */
    supersededBy: "h3-v2",
    timeline: [
      { id: "h3-t1", label: "Created by Otto · Weekend routine", when: "Yesterday 16:40" },
      { id: "h3-t2", label: "Revise asked by Nicks", when: "Yesterday 17:10", detail: "Breaks a rule I set" },
    ],
  },
  {
    /** ④ h3 的 V2 —— 形状与 `nextVersionOf` 的产物逐字段对齐(id 从 rootId 派生、
     *  带 What changed 与「已结清」的旧意见、时间线接在 V1 的后面)。 */
    id: "h3-v2",
    rootId: "h3",
    version: 2,
    title: "Discount teaser for the gift set",
    origin: "Otto · Weekend routine",
    source: "otto",
    cost: 0,
    status: "waiting",
    group: "week",
    when: "Sat 10:00",
    detail: "Instagram · 1 post",
    channel: "instagram",
    caption: "The Deepavali gift set is wrapped by hand. Full price until Oct 25, then the festive bundle opens.",
    ask: "Approve this post?",
    media: [{ image: "/fixtures/r22-canvas/art-2.jpg", ratio: "1:1", previewIndex: 0 }],
    images: ["/fixtures/r22-canvas/art-2.jpg"],
    sources: ["Deepavali gift set", "no discounts before Oct 25"],
    openLabel: "Open in campaign",
    openHref: "/campaign?fixture=r22",
    consequence: "Approving schedules 1 post, held in Schedule until a channel is connected.",
    decideBy: "Fri 12:00",
    decideByHours: 24,
    whatChanged: REVISION_CHANGES["Breaks a rule I set"],
    settledFeedback: "Breaks a rule I set — “no discounts before Oct 25”",
    previews: [
      {
        platform: "Instagram",
        slot: "Sat 10:00",
        ratio: "1:1",
        image: "/fixtures/r22-canvas/art-2.jpg",
        caption: "The Deepavali gift set is wrapped by hand. Full price until Oct 25, then the festive bundle opens.",
        fit: "Square 1:1. Caption 104 characters.",
      },
    ],
    brief: {
      routine: "Weekend routine · runs Saturday 10:00",
      promptGist: "Tease the gift set without naming a discount, because the no-discount rule runs until Oct 25.",
      cost: "Free to schedule · the image was made in Canvas earlier",
    },
    timeline: [
      { id: "h3-t1", label: "Created by Otto · Weekend routine", when: "Yesterday 16:40" },
      { id: "h3-t2", label: "Revise asked by Nicks", when: "Yesterday 17:10", detail: "Breaks a rule I set" },
      { id: "h3-v2-made", label: "Version 2 produced by Otto", when: "Yesterday 17:12", detail: REVISION_CHANGES["Breaks a rule I set"] },
    ],
  },
];

/** ⑧ 临期与否只有这一处判定 —— 卡不自己算,测试也钉这一个函数。 */
export function isDecideByUrgent(item: ApprovalItem): boolean {
  return item.decideByHours !== undefined && item.decideByHours <= DECIDE_BY_URGENT_HOURS;
}

/** ① 这张卡的改版收件人。团队来源是那位成员,其余都是 Otto。 */
export function reviseRecipient(item: ApprovalItem): string {
  return item.reviseTarget ?? "Otto";
}

/**
 * ⑥ 金额的说法,只有这一处。
 *
 * 稿的裁定:写 `16 credits`,不写 `16 cr`。「cr」是我们内部的简写,商家的余额单位是
 * credits —— 屏幕上少两个字母,换来的是一个要猜的缩写。单数写 `1 credit`。
 */
export function credits(amount: number): string {
  return `${amount} ${amount === 1 ? "credit" : "credits"}`;
}

/** ⑥ 贴在动作上的那一截(`Approve · 16 credits`)。0 不写「0 credits」,那是假精确。 */
export function creditSuffix(cost: number): string {
  return cost > 0 ? ` · ${credits(cost)}` : "";
}

/** 稿②:比例到 css 类。四个比例是稿里点名的四个,不是任意值。 */
export function ratioClass(ratio: ApprovalRatio): string {
  if (ratio === "1:1") return "is-1x1";
  if (ratio === "9:16") return "is-9x16";
  if (ratio === "1.91:1") return "is-191x1";
  return "is-4x5";
}
