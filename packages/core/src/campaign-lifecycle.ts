/**
 * campaign-lifecycle — the ONE campaign status table (#710).
 *
 * A plain module on purpose: the server action that enforces these rules and the page that
 * offers them as buttons must read the SAME table. Two hand-kept copies is how a UI comes to
 * advertise a move the server refuses (or, as #710 reported, how two of the four persisted
 * statuses came to have no route from the interface at all).
 *
 * The statuses themselves are not invented here — they are the four `Campaign.status` already
 * documented in schema.prisma. What was missing was any path between them.
 *
 * **C7 —— 它从 `apps/web/lib/` 搬到 core,一个字未改。** 搬家的理由是这张表当时只有商家那
 * 一面读得到:Otto 够不着 `apps/web`,于是 `packages/otto` 里长出了**第三、第四份**手抄
 * 词汇(`skills/plan-campaign.ts` 的参数 enum 与 `context.ts` 的 Campaign 端口类型),而且
 * 转移表对助手完全不可见 —— Otto 说得出四个状态名,却不知道哪个动作是合法的。
 * core 是「跨包共用的产品事实」该待的地方(messaging-status、schedule-draft、navigation
 * 都在这儿),所以这张表也搬过来:web 与 otto 从此读同一份。
 */

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "DONE", "CANCELLED"] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  DONE: "Done",
  CANCELLED: "Canceled",
};

/** Badge colour per status, shared by the list card and the detail header. The list already
 *  knew all four; the detail header only knew "active or not", which was invisible while two
 *  of the four statuses were unreachable — and would have started lying the moment they were. */
export const CAMPAIGN_STATUS_BADGE: Record<CampaignStatus, "outline" | "success" | "warning" | "destructive"> = {
  DRAFT: "warning",
  ACTIVE: "success",
  DONE: "outline",
  CANCELLED: "destructive",
};

/**
 * Where a campaign may go from where it is.
 *
 * Every closing move has a way back. #710 is a one-way-door bug, and a lifecycle whose end
 * states were terminal would be the same bug wearing a nicer face: a merchant who marked the
 * wrong campaign Done would again be stuck with a card they cannot correct.
 */
const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["DONE", "CANCELLED"],
  DONE: ["ACTIVE"],
  CANCELLED: ["ACTIVE"],
};

/** Statuses whose name / goal / dates a merchant may still edit. A closed campaign is a
 *  record of what happened; reopening it to active is the deliberate step before changing it. */
const EDITABLE_STATUSES: ReadonlySet<CampaignStatus> = new Set<CampaignStatus>(["DRAFT", "ACTIVE"]);

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === "string" && (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

export function nextCampaignStatuses(from: CampaignStatus): readonly CampaignStatus[] {
  return CAMPAIGN_TRANSITIONS[from];
}

export function canMoveCampaign(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

export function canEditCampaignDetails(status: CampaignStatus): boolean {
  return EDITABLE_STATUSES.has(status);
}
