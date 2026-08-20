/** ScheduledPost 状态机 —— 纯 helper,无副作用(spec §四D)。
 *  发布 worker(切片 2)与 server actions 共用同一份合法转移表,
 *  所有非法转移一律拒绝。状态是 code-side 常量元组(镜像 org-roles.ts):
 *  加/减状态只改这里,不需迁移。DB 侧值必须与此保持一致。
 *
 *  转移图(spec §四D):
 *    DRAFT            → SCHEDULED (owner 批准,approvedAt 由调用方置)
 *    DRAFT/SCHEDULED  → CANCELLED (owner 取消)
 *    SCHEDULED        → PUBLISHING (切片 2 scheduler claim)
 *    PUBLISHING       → PUBLISHED  (发布成功,metaPostId 由调用方置)
 *    PUBLISHING       → NEEDS_ATTENTION (瞬时失败重试上限 / reminder)
 *    PUBLISHING       → FAILED     (硬失败)
 *    NEEDS_ATTENTION/FAILED → SCHEDULED (owner 重新入队) | CANCELLED
 *  终态:PUBLISHED、CANCELLED —— 出度为空。 */
export const SCHEDULED_POST_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "NEEDS_ATTENTION",
  "CANCELLED",
] as const;
export type ScheduledPostStatus = (typeof SCHEDULED_POST_STATUSES)[number];

/** 合法后继表。缺席的 (from,to) 组合即非法。终态映射到空数组。 */
const TRANSITIONS: Record<ScheduledPostStatus, readonly ScheduledPostStatus[]> = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["PUBLISHING", "CANCELLED"],
  PUBLISHING: ["PUBLISHED", "NEEDS_ATTENTION", "FAILED"],
  NEEDS_ATTENTION: ["SCHEDULED", "CANCELLED"],
  FAILED: ["SCHEDULED", "CANCELLED"],
  PUBLISHED: [],
  CANCELLED: [],
};

/** from → to 是否合法。非法(含自→自、终态出边、跳步)一律 false。 */
export function canTransition(from: ScheduledPostStatus, to: ScheduledPostStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
