/**
 * 北极星原型 — CRM 区示例数据(基于共享 _mock 的场景:Roti Bulan Bakery,KL)
 *
 * 共享 mock 模块(components/northstar/_mock.ts)只有 5 位联系人的浅档案;
 * 本文件是 CRM 区的补充口径:同一批客户(ct-01…ct-05 原样引用)+ 深档案字段。
 * 口径全部来自 harmony-01 数据模型:
 *   #7  Contact / ContactIdentity — 多渠道身份合并靠 Identity 表,不靠猜;
 *       `(ownerId, channel, externalId)` 唯一;首触 campaign 记在 identity 上
 *   #12 Deal / PipelineConfig — 名称/contactId/阶段/金额/币种;阶段按 org 可配
 *   #13 Segment — 人话描述 → 确定性规则编译(宪法 10)+ 物化成员表
 *   §四② 字段变更留痕复用 ActionEvent;判决 7-9 勿扰名单硬约束
 * 全部确定性数据,零 Date.now / 零随机;不发明清单外的对象。
 */

import { NS_CONTACTS, type NsContact } from "@/components/northstar/_mock";

/* ── 渠道口径(CRM 只有入站消息渠道:WA / IG / FB) ─────────────────────── */
export type CrmChannel = "whatsapp" | "instagram" | "facebook";

export const CRM_CHANNELS: Record<CrmChannel, { short: string; label: string }> = {
  whatsapp: { short: "WA", label: "WhatsApp" },
  instagram: { short: "IG", label: "Instagram" },
  facebook: { short: "FB", label: "Facebook" },
};

/* ── ContactIdentity(harmony-01 #7:一人多渠道身份,合并留审计) ─────────── */
export interface CrmIdentity {
  channel: CrmChannel | "email";
  /** externalId:waPhone / igHandle / fbPsid / email */
  externalId: string;
  addedAt: string;
  /** 首触 campaign 记在 identity 上(归因) */
  firstTouchCampaign?: string;
  /** 合并审计:此身份是从哪条重复档案合并过来的 */
  mergedFrom?: string;
}

/* ── consent / 勿扰(判决 7-9:硬约束,自动化跳过勿扰联系人) ─────────────── */
export type ConsentState = "granted" | "declined" | "pending";

export interface CrmConsent {
  marketing: ConsentState;
  /** 同意来源(哪次对话 / 哪张表单) */
  source: string;
  at: string;
}

/* ── 时间线(对话 / 订单 / 字段变更 ActionEvent / 合并 / consent) ─────────── */
export type CrmEventKind = "message" | "order" | "field-change" | "merge" | "consent" | "campaign";

export interface CrmEvent {
  id: string;
  kind: CrmEventKind;
  at: string; // "2026-07-06 · 2:40 pm" 显示口径
  channel?: CrmChannel;
  /** 一句话事件内容 */
  text: string;
  /** 字段变更留痕(复用 ActionEvent):谁改的 */
  by?: "owner" | "otto" | "system";
  /** field-change 专用:field · old → new */
  change?: { field: string; from: string; to: string };
}

/* ── 深档案 ────────────────────────────────────────────────────────────── */
export interface CrmContact extends NsContact {
  identities: CrmIdentity[];
  consent: CrmConsent;
  ordersCount: number;
  /** 归档时间线,新的在前 */
  events: CrmEvent[];
  note?: string;
}

/** 共享 5 位联系人的深档案 + CRM 区补充的 7 位(同店场景,确定性) */
const EXTRA_CONTACTS: NsContact[] = [
  { id: "ct-06", name: "Sarah Lim", channels: ["instagram"], lastSeen: "2026-07-03", tags: ["new"], doNotDisturb: false, totalOrdersMyr: 42 },
  { id: "ct-07", name: "Kumar Selvam", channels: ["whatsapp", "facebook"], lastSeen: "2026-07-02", tags: ["catering"], doNotDisturb: false, totalOrdersMyr: 890 },
  { id: "ct-08", name: "Chong Wei Kit", channels: ["facebook"], lastSeen: "2026-06-24", tags: ["regular"], doNotDisturb: true, totalOrdersMyr: 265 },
  { id: "ct-09", name: "Farah Aziz", channels: ["whatsapp"], lastSeen: "2026-07-06", tags: ["office orders"], doNotDisturb: false, totalOrdersMyr: 512 },
  { id: "ct-10", name: "Daniel Oh", channels: ["instagram", "whatsapp"], lastSeen: "2026-07-01", tags: ["new"], doNotDisturb: false, totalOrdersMyr: 96 },
  { id: "ct-11", name: "Grace Foo", channels: ["whatsapp"], lastSeen: "2026-06-28", tags: ["wholesale"], doNotDisturb: false, totalOrdersMyr: 1660 },
  { id: "ct-12", name: "Azlan Hashim", channels: ["facebook", "instagram"], lastSeen: "2026-06-20", tags: ["regular"], doNotDisturb: false, totalOrdersMyr: 210 },
];

const IDENTITY_BOOK: Record<string, CrmIdentity[]> = {
  "ct-01": [
    { channel: "whatsapp", externalId: "+60 12-338 4021", addedAt: "2026-03-14", firstTouchCampaign: "Raya cookie drop" },
    { channel: "instagram", externalId: "@meiling.eats", addedAt: "2026-04-02", mergedFrom: "Duplicate 'Mei Ling T.' profile" },
    { channel: "email", externalId: "meiling.tan@gmail.com", addedAt: "2026-05-19" },
  ],
  "ct-02": [
    { channel: "whatsapp", externalId: "+60 16-770 2218", addedAt: "2026-01-08", firstTouchCampaign: "Wholesale open day" },
  ],
  "ct-03": [
    { channel: "instagram", externalId: "@priya.bakes.kl", addedAt: "2026-07-01", firstTouchCampaign: "Merdeka week bakes" },
  ],
  "ct-04": [
    { channel: "facebook", externalId: "psid:24401183", addedAt: "2026-02-11", firstTouchCampaign: "CNY hamper promo" },
    { channel: "whatsapp", externalId: "+60 17-204 8873", addedAt: "2026-02-15" },
  ],
  "ct-05": [
    { channel: "whatsapp", externalId: "+60 13-559 1104", addedAt: "2026-05-22", firstTouchCampaign: "Kaya croissant launch" },
  ],
  "ct-06": [
    { channel: "instagram", externalId: "@sarahlim.kl", addedAt: "2026-07-03", firstTouchCampaign: "Merdeka week bakes" },
  ],
  "ct-07": [
    { channel: "whatsapp", externalId: "+60 19-882 3345", addedAt: "2026-03-30", firstTouchCampaign: "Wholesale open day" },
    { channel: "facebook", externalId: "psid:99120467", addedAt: "2026-04-12" },
  ],
  "ct-08": [
    { channel: "facebook", externalId: "psid:55834092", addedAt: "2026-01-25", firstTouchCampaign: "CNY hamper promo" },
  ],
  "ct-09": [
    { channel: "whatsapp", externalId: "+60 12-664 9082", addedAt: "2026-06-02", firstTouchCampaign: "Kaya croissant launch" },
  ],
  "ct-10": [
    { channel: "instagram", externalId: "@danieloh.makan", addedAt: "2026-06-18", firstTouchCampaign: "Merdeka week bakes" },
    { channel: "whatsapp", externalId: "+60 11-2408 7754", addedAt: "2026-06-30", mergedFrom: "Duplicate 'Daniel' WhatsApp profile" },
  ],
  "ct-11": [
    { channel: "whatsapp", externalId: "+60 18-336 5520", addedAt: "2026-02-19", firstTouchCampaign: "Wholesale open day" },
  ],
  "ct-12": [
    { channel: "facebook", externalId: "psid:31958274", addedAt: "2026-04-08", firstTouchCampaign: "Raya cookie drop" },
    { channel: "instagram", externalId: "@azlan.h", addedAt: "2026-05-14" },
  ],
};

const CONSENT_BOOK: Record<string, CrmConsent> = {
  "ct-01": { marketing: "granted", source: "WhatsApp opt-in reply", at: "2026-03-14" },
  "ct-02": { marketing: "granted", source: "Wholesale order form", at: "2026-01-08" },
  "ct-03": { marketing: "pending", source: "Awaiting opt-in reply", at: "2026-07-01" },
  "ct-04": { marketing: "declined", source: "Asked to stop promos in chat", at: "2026-06-30" },
  "ct-05": { marketing: "granted", source: "WhatsApp opt-in reply", at: "2026-05-22" },
  "ct-06": { marketing: "pending", source: "Awaiting opt-in reply", at: "2026-07-03" },
  "ct-07": { marketing: "granted", source: "Catering enquiry form", at: "2026-03-30" },
  "ct-08": { marketing: "declined", source: "Unsubscribed from broadcast", at: "2026-06-24" },
  "ct-09": { marketing: "granted", source: "WhatsApp opt-in reply", at: "2026-06-02" },
  "ct-10": { marketing: "granted", source: "Instagram story reply", at: "2026-06-18" },
  "ct-11": { marketing: "granted", source: "Wholesale order form", at: "2026-02-19" },
  "ct-12": { marketing: "granted", source: "Facebook comment opt-in", at: "2026-04-08" },
};

/** 时间线:只给档案页会展示的 3 位写全量;其余给 2-3 条基本事件 */
const EVENT_BOOK: Record<string, CrmEvent[]> = {
  "ct-01": [
    { id: "ev-0101", kind: "message", channel: "whatsapp", at: "2026-07-07 · 8:15 am", text: "Confirmed Friday office order: 20 kaya butter croissants, RM170.", by: "otto" },
    { id: "ev-0102", kind: "field-change", at: "2026-07-06 · 4:02 pm", text: "Tag added", by: "owner", change: { field: "tags", from: "regular", to: "regular · office orders" } },
    { id: "ev-0103", kind: "order", at: "2026-06-27 · 11:30 am", text: "Order fulfilled: pandan gula melaka cake · RM88." },
    { id: "ev-0104", kind: "merge", at: "2026-04-02 · 9:12 am", text: "Merged duplicate 'Mei Ling T.' Instagram profile into this contact.", by: "owner" },
    { id: "ev-0105", kind: "consent", at: "2026-03-14 · 10:05 am", text: "Marketing consent granted via WhatsApp opt-in reply." },
    { id: "ev-0106", kind: "campaign", at: "2026-03-14 · 9:58 am", text: "First touch: Raya cookie drop campaign (WhatsApp click-to-chat ad)." },
  ],
  "ct-04": [
    { id: "ev-0401", kind: "field-change", at: "2026-06-30 · 5:44 pm", text: "Do not disturb switched on", by: "owner", change: { field: "doNotDisturb", from: "off", to: "on" } },
    { id: "ev-0402", kind: "consent", at: "2026-06-30 · 5:41 pm", text: "Marketing consent declined: asked to stop promos in chat." },
    { id: "ev-0403", kind: "message", channel: "whatsapp", at: "2026-06-30 · 5:38 pm", text: "\"Please stop sending promo messages, I will order when I need.\"" },
    { id: "ev-0404", kind: "order", at: "2026-06-12 · 2:10 pm", text: "Order fulfilled: catering set for 40 pax · RM720." },
    { id: "ev-0405", kind: "campaign", at: "2026-02-11 · 1:20 pm", text: "First touch: CNY hamper promo (Facebook ad comment)." },
  ],
  "ct-02": [
    { id: "ev-0201", kind: "message", channel: "whatsapp", at: "2026-07-05 · 2:20 pm", text: "\"Boss, next week same order, 60 boxes.\"" },
    { id: "ev-0202", kind: "order", at: "2026-06-28 · 9:00 am", text: "Order fulfilled: 60 wholesale boxes · RM540." },
    { id: "ev-0203", kind: "field-change", at: "2026-05-02 · 3:15 pm", text: "Tag added", by: "otto", change: { field: "tags", from: "—", to: "wholesale" } },
    { id: "ev-0204", kind: "campaign", at: "2026-01-08 · 10:00 am", text: "First touch: Wholesale open day (walk-in, number saved to WhatsApp)." },
  ],
};

const DEFAULT_EVENTS = (c: NsContact): CrmEvent[] => [
  { id: `ev-${c.id}-1`, kind: "message", channel: c.channels[0], at: `${c.lastSeen} · 11:00 am`, text: "Last conversation on record." },
  { id: `ev-${c.id}-2`, kind: "consent", at: `${CONSENT_BOOK[c.id]?.at ?? c.lastSeen} · 10:00 am`, text: `Marketing consent: ${CONSENT_BOOK[c.id]?.marketing ?? "pending"} (${CONSENT_BOOK[c.id]?.source ?? "no source"}).` },
];

export const CRM_CONTACTS: CrmContact[] = [...NS_CONTACTS, ...EXTRA_CONTACTS].map((c) => ({
  ...c,
  identities: IDENTITY_BOOK[c.id] ?? [],
  consent: CONSENT_BOOK[c.id] ?? { marketing: "pending", source: "No consent recorded", at: c.lastSeen },
  ordersCount: Math.max(1, Math.round(c.totalOrdersMyr / 95)),
  events: EVENT_BOOK[c.id] ?? DEFAULT_EVENTS(c),
  note: c.id === "ct-01" ? "Prefers pickup at Bangsar outlet. Office orders land Fridays." : undefined,
}));

export function crmContact(id: string): CrmContact {
  return CRM_CONTACTS.find((c) => c.id === id) ?? CRM_CONTACTS[0];
}

/** Otto 模拟着陆用:一位刚从 WhatsApp 对话进来的新联系人(联系人自动进来的演示) */
export const CRM_INCOMING_CONTACT: CrmContact = {
  id: "ct-13",
  name: "Yusof Ramli",
  channels: ["whatsapp"],
  lastSeen: "2026-07-07",
  tags: ["new"],
  doNotDisturb: false,
  totalOrdersMyr: 0,
  identities: [
    { channel: "whatsapp", externalId: "+60 14-902 6617", addedAt: "2026-07-07", firstTouchCampaign: "Merdeka week bakes" },
  ],
  consent: { marketing: "pending", source: "Awaiting opt-in reply", at: "2026-07-07" },
  ordersCount: 0,
  events: [
    { id: "ev-1301", kind: "message", channel: "whatsapp", at: "2026-07-07 · 9:41 am", text: "\"Hi, saw your Merdeka box ad. Can deliver to Shah Alam?\"" },
    { id: "ev-1302", kind: "campaign", at: "2026-07-07 · 9:41 am", text: "First touch: Merdeka week bakes (WhatsApp click-to-chat ad)." },
  ],
};

/* ── Segment(harmony-01 #13:人话 → 确定性规则 → 物化成员表) ────────────── */
export interface CrmRule {
  field: string;
  op: string;
  value: string;
}

export interface CrmSegment {
  id: string;
  name: string;
  /** 用户的人话描述(编译输入) */
  description: string;
  /** 编译产物:可读的确定性规则(AND 连接;不是节点画布) */
  rules: CrmRule[];
  memberIds: string[];
  /** 谁在用这个分群(broadcast / 自动化共用) */
  usedBy: { kind: "broadcast" | "automation"; name: string }[];
  lastCompiled: string;
}

export const CRM_SEGMENTS: CrmSegment[] = [
  {
    id: "seg-01",
    name: "Regulars worth RM300+",
    description: "Customers who ordered more than RM300 in total and messaged us in the last 30 days.",
    rules: [
      { field: "Total orders", op: "is at least", value: "RM 300" },
      { field: "Last seen", op: "is within", value: "30 days" },
      { field: "Do not disturb", op: "is", value: "off" },
    ],
    memberIds: ["ct-01", "ct-02", "ct-05", "ct-09", "ct-11"],
    usedBy: [
      { kind: "broadcast", name: "Merdeka pre-order blast" },
      { kind: "automation", name: "Monthly thank-you voucher" },
    ],
    lastCompiled: "2026-07-07 · 6:00 am",
  },
  {
    id: "seg-02",
    name: "Catering and wholesale",
    description: "Anyone tagged catering or wholesale, for bulk-order announcements.",
    rules: [
      { field: "Tags", op: "include any of", value: "catering · wholesale" },
      { field: "Do not disturb", op: "is", value: "off" },
    ],
    memberIds: ["ct-02", "ct-07", "ct-11"],
    usedBy: [{ kind: "broadcast", name: "Bulk order price update" }],
    lastCompiled: "2026-07-07 · 6:00 am",
  },
  {
    id: "seg-03",
    name: "New this month",
    description: "Contacts whose first touch was within the last 30 days, to send a welcome treat.",
    rules: [
      { field: "First seen", op: "is within", value: "30 days" },
      { field: "Marketing consent", op: "is", value: "granted or pending" },
      { field: "Do not disturb", op: "is", value: "off" },
    ],
    memberIds: ["ct-03", "ct-06", "ct-10"],
    usedBy: [{ kind: "automation", name: "Welcome message · day 2" }],
    lastCompiled: "2026-07-07 · 6:00 am",
  },
  {
    id: "seg-04",
    name: "Quiet 60 days",
    description: "Good customers we have not heard from in 60 days, for a win-back nudge.",
    rules: [
      { field: "Total orders", op: "is at least", value: "RM 100" },
      { field: "Last seen", op: "is older than", value: "60 days" },
      { field: "Do not disturb", op: "is", value: "off" },
    ],
    memberIds: [],
    usedBy: [{ kind: "automation", name: "Win-back reminder" }],
    lastCompiled: "2026-07-07 · 6:00 am",
  },
];

/** 「新分群」编译演示的确定性结果(输入人话 → 这套规则 + 成员) */
export const CRM_COMPILE_DEMO = {
  description: "Office crowd who order croissants and were active this month",
  rules: [
    { field: "Tags", op: "include any of", value: "office orders" },
    { field: "Last seen", op: "is within", value: "30 days" },
    { field: "Do not disturb", op: "is", value: "off" },
  ] as CrmRule[],
  memberIds: ["ct-01", "ct-09"],
};

/* ── Deal / PipelineConfig(harmony-01 #12:SMB-lite,阶段按 org 可配) ────── */
export interface CrmStage {
  id: string;
  name: string;
}

/** PipelineConfig:烘焙坊的大单管道(咨询 → 报价 → 确认 → 交付) */
export const CRM_PIPELINE: CrmStage[] = [
  { id: "st-1", name: "New enquiry" },
  { id: "st-2", name: "Quote sent" },
  { id: "st-3", name: "Confirmed" },
  { id: "st-4", name: "Fulfilled" },
];

export interface CrmDeal {
  id: string;
  name: string;
  contactId: string;
  stageId: string;
  amountMyr: number;
  currency: "MYR";
  expected: string; // 预计成交/交付日
  daysInStage: number;
}

export const CRM_DEALS: CrmDeal[] = [
  { id: "dl-01", name: "Shah Alam office · Merdeka boxes", contactId: "ct-09", stageId: "st-1", amountMyr: 680, currency: "MYR", expected: "2026-08-20", daysInStage: 1 },
  { id: "dl-02", name: "Birthday cake · 2 tier pandan", contactId: "ct-10", stageId: "st-1", amountMyr: 240, currency: "MYR", expected: "2026-07-18", daysInStage: 3 },
  { id: "dl-03", name: "Kopitiam chain · weekly trial", contactId: "ct-12", stageId: "st-1", amountMyr: 1200, currency: "MYR", expected: "2026-08-01", daysInStage: 6 },
  { id: "dl-04", name: "Law firm · Friday pastry run", contactId: "ct-01", stageId: "st-2", amountMyr: 850, currency: "MYR", expected: "2026-07-24", daysInStage: 2 },
  { id: "dl-05", name: "Wedding dessert table · 120 pax", contactId: "ct-06", stageId: "st-2", amountMyr: 2400, currency: "MYR", expected: "2026-09-12", daysInStage: 5 },
  { id: "dl-06", name: "Wholesale restock · 60 boxes", contactId: "ct-02", stageId: "st-3", amountMyr: 540, currency: "MYR", expected: "2026-07-14", daysInStage: 1 },
  { id: "dl-07", name: "Team offsite · kuih platters", contactId: "ct-07", stageId: "st-3", amountMyr: 960, currency: "MYR", expected: "2026-07-21", daysInStage: 4 },
  { id: "dl-08", name: "Cafe partnership · standing order", contactId: "ct-11", stageId: "st-4", amountMyr: 1660, currency: "MYR", expected: "2026-07-02", daysInStage: 5 },
  { id: "dl-09", name: "PTA fundraiser · cookie packs", contactId: "ct-05", stageId: "st-4", amountMyr: 320, currency: "MYR", expected: "2026-06-30", daysInStage: 7 },
];
