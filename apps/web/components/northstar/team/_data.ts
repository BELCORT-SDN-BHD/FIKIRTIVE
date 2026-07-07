/**
 * 北极星原型 · 团队协作区 — 区内派生示例数据(扩展层)
 *
 * 同一家店(Roti Bulan Bakery,KL),但这里是多席位协作:老板 + 一个小编 +
 * 一个只审批的合伙人 + 一个待接受邀请的兼职。全确定性字面量,零后台 import。
 *
 * 两个对象面:
 *  ① Membership 席位(红旗二 / G-01):seatType(CREATOR/APPROVER)+ orgRole
 *     (owner/admin/member)+ 邀请。计费按 seatType 数(双档)。
 *  ② ApprovalRequest(G-11 / 数据模型行 14):统一审批原语,payload hash 绑定,
 *     内容漂移即失效。团队审批队列 = 「小编做 → 老板批 → 才发布」。
 *
 * 依据:PAGE-INVENTORY 十·团队协作区;harmony-01 §五(席位)、§四④(审批一原语两表面)。
 */

/* ══════════════════════════════════════════════════════════════════════════
 * ① Membership 席位
 * ════════════════════════════════════════════════════════════════════════ */

export type SeatType = "CREATOR" | "APPROVER";
export type OrgRole = "owner" | "admin" | "member";
export type MemberStatus = "active" | "invited";

export interface Member {
  id: string;
  name: string;
  email: string;
  /** 头像用首字母(零外链) */
  initials: string;
  seatType: SeatType;
  orgRole: OrgRole;
  status: MemberStatus;
  /** 相对时间显示串;invited = 邀请发出时间 */
  lastActive: string;
  /** true = 就是当前登录的人(自己一行不能改自己的席位) */
  isSelf?: boolean;
}

export const MEMBERS: Member[] = [
  {
    id: "mb-01",
    name: "Aisyah Rahman",
    email: "aisyah@rotibulan.my",
    initials: "AR",
    seatType: "CREATOR",
    orgRole: "owner",
    status: "active",
    lastActive: "now",
    isSelf: true,
  },
  {
    id: "mb-02",
    name: "Farah Zulkifli",
    email: "farah@rotibulan.my",
    initials: "FZ",
    seatType: "CREATOR",
    orgRole: "member",
    status: "active",
    lastActive: "12m ago",
  },
  {
    id: "mb-03",
    name: "Idris Rahman",
    email: "idris@rotibulan.my",
    initials: "IR",
    seatType: "APPROVER",
    orgRole: "admin",
    status: "active",
    lastActive: "2h ago",
  },
  {
    id: "mb-04",
    name: "Nadia Lim",
    email: "nadia.lim@gmail.com",
    initials: "NL",
    seatType: "CREATOR",
    orgRole: "member",
    status: "invited",
    lastActive: "invited 2 days ago",
  },
];

/** 席位档位说明(G-01 双档计费的人话面) */
export const SEAT_META: Record<SeatType, { label: string; blurb: string }> = {
  CREATOR: {
    label: "Creator seat",
    blurb: "Full access. Makes content, plans campaigns, sends work for approval.",
  },
  APPROVER: {
    label: "Approver seat",
    blurb: "Reviews and approves. Can see everything and comment, but doesn't create or spend.",
  },
};

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** 权限矩阵(orgRole 能做什么;harmony-01 §五:一张可读表,不是散落 if) */
export interface PermissionRow {
  label: string;
  owner: boolean;
  admin: boolean;
  member: boolean;
}

export const PERMISSION_MATRIX: PermissionRow[] = [
  { label: "Make content and plan campaigns", owner: true, admin: true, member: true },
  { label: "Send work for approval", owner: true, admin: true, member: true },
  { label: "Approve and publish", owner: true, admin: true, member: false },
  { label: "Connect channels", owner: true, admin: true, member: false },
  { label: "Set up routines and rules", owner: true, admin: true, member: false },
  { label: "Manage members and seats", owner: true, admin: false, member: false },
  { label: "Top up and manage billing", owner: true, admin: false, member: false },
];

/** 计费口径(展示用:两档各多少席,零金额只显示 credits/席位数) */
export const SEAT_BILLING = {
  creatorSeats: MEMBERS.filter((m) => m.seatType === "CREATOR").length,
  approverSeats: MEMBERS.filter((m) => m.seatType === "APPROVER").length,
  invitedSeats: MEMBERS.filter((m) => m.status === "invited").length,
};

/* ══════════════════════════════════════════════════════════════════════════
 * ② ApprovalRequest(G-11:小编做 → 老板批 → 才发布)
 * ════════════════════════════════════════════════════════════════════════ */

export type ApprovalKind = "PUBLISH" | "SPEND" | "AD_LAUNCH" | "CONTENT";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "stale";

export interface ApprovalComment {
  author: string;
  initials: string;
  text: string;
  at: string;
}

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  title: string;
  /** 谁做的(乙方) */
  requestedBy: { name: string; initials: string };
  requestedAt: string;
  status: ApprovalStatus;
  /** payload hash(G7 模式:审批后内容漂移即失效)—— 展示成短串 */
  payloadHash: string;
  /** 内容被改过 → hash 失效,需重审(§四④) */
  stale?: boolean;
  /** 花费(仅 SPEND/AD_LAUNCH 有;§V5 credits) */
  spendCredits?: number;
  /** 预览用 payload:平台/时刻/媒体占位/正文 */
  preview: {
    channel?: string;
    when?: string;
    media?: string;
    caption?: string;
    /** 广告/花费类的关键行 */
    lines?: { label: string; value: string }[];
  };
  comments: ApprovalComment[];
}

export const APPROVAL_REQUESTS: ApprovalRequest[] = [
  {
    id: "ap-01",
    kind: "PUBLISH",
    title: "Fresh kaya croissants till 11am",
    requestedBy: { name: "Farah Zulkifli", initials: "FZ" },
    requestedAt: "18m ago",
    status: "pending",
    payloadHash: "9f2a-c71b",
    spendCredits: undefined,
    preview: {
      channel: "Instagram",
      when: "Tomorrow, 9:00am · Asia/Kuala_Lumpur",
      media: "IG post · 1080×1080",
      caption:
        "Fresh out of the oven: kaya butter croissants till 11am only. First 30 get a free kopi-O. See you at the shop 🥐",
    },
    comments: [
      { author: "Farah Zulkifli", initials: "FZ", text: "Kept it short. Ok to add the free kopi line?", at: "18m ago" },
    ],
  },
  {
    id: "ap-02",
    kind: "SPEND",
    title: "Merdeka box hero video · 6s 720p",
    requestedBy: { name: "Farah Zulkifli", initials: "FZ" },
    requestedAt: "40m ago",
    status: "pending",
    payloadHash: "1c88-4e0d",
    spendCredits: 40,
    preview: {
      media: "Reel · 9:16 · generating on approval",
      lines: [
        { label: "What", value: "Merdeka gift box hero video" },
        { label: "Length", value: "6 seconds, 720p" },
        { label: "Cost", value: "40 credits" },
      ],
      caption: "For the Merdeka week campaign. Farah wrote the brief, Otto generates it once you approve.",
    },
    comments: [],
  },
  {
    id: "ap-03",
    kind: "AD_LAUNCH",
    title: "Office lunch box · reach ad",
    requestedBy: { name: "Farah Zulkifli", initials: "FZ" },
    requestedAt: "1h ago",
    status: "pending",
    payloadHash: "77b0-a913",
    stale: true,
    spendCredits: undefined,
    preview: {
      channel: "Meta",
      lines: [
        { label: "Daily cap", value: "RM12 a day" },
        { label: "Run", value: "Jul 10 to Jul 17" },
        { label: "Audience", value: "Office workers, 2km around KLCC" },
      ],
      caption: "The caption was edited after this was sent for approval, so it needs another look before it can launch.",
    },
    comments: [
      { author: "Idris Rahman", initials: "IR", text: "Trim the daily cap to RM10 first.", at: "35m ago" },
      { author: "Farah Zulkifli", initials: "FZ", text: "Updated the copy and cap, resending.", at: "8m ago" },
    ],
  },
  {
    id: "ap-04",
    kind: "PUBLISH",
    title: "Weekend pre-orders open now",
    requestedBy: { name: "Farah Zulkifli", initials: "FZ" },
    requestedAt: "yesterday",
    status: "approved",
    payloadHash: "0a4d-6f21",
    preview: {
      channel: "Instagram",
      when: "Jul 10, 9:00am",
      media: "IG post · 1080×1080",
      caption: "Weekend pre-orders open now. Link in bio. Pre-order closes Friday 6pm.",
    },
    comments: [{ author: "Aisyah Rahman", initials: "AR", text: "Approved. Nice one.", at: "yesterday" }],
  },
  {
    id: "ap-05",
    kind: "CONTENT",
    title: "Kopi tiramisu menu card",
    requestedBy: { name: "Farah Zulkifli", initials: "FZ" },
    requestedAt: "2 days ago",
    status: "rejected",
    payloadHash: "b312-88ac",
    preview: {
      media: "Menu card · 1080×1350",
      caption: "Menu card for the new kopi-O tiramisu cup.",
    },
    comments: [
      { author: "Aisyah Rahman", initials: "AR", text: "Price is wrong, it's RM14 not RM12. Redo and resend.", at: "2 days ago" },
    ],
  },
];

export const APPROVAL_KIND_META: Record<ApprovalKind, { label: string; blurb: string }> = {
  PUBLISH: { label: "Publish", blurb: "A post going out on a channel" },
  SPEND: { label: "Spend", blurb: "A generation that uses credits" },
  AD_LAUNCH: { label: "Ad", blurb: "A paid ad going live" },
  CONTENT: { label: "Content", blurb: "A visual for the library" },
};

/* ── 演示用叙述条步骤(审批面 approval-heavy,有 Otto 铺面;成员面 dock only 无叙述) ── */
export const APPROVALS_LAND_STEPS = ["Reading the queue…", "Checking each request…"] as const;
