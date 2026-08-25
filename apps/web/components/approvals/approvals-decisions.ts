/**
 * approvals-decisions.ts —— 一次决策对这份列表做了什么。纯函数,没有 React、没有计时器。
 *
 * 拆出来的理由是 ④ **版本循环**:一次 revise 不是「把这条改成 rejected」,它是
 *   · 旧卡 → `superseded`,带上指向新卡的链接;
 *   · 同一条目的 **V2** 回到 Needs review,带 What changed 与「已结清」的旧意见。
 * 这两步必须原子地发生在同一次 `setItems` 里,否则中间那一帧屏幕上既没有旧卡也没有新卡。
 * 写成纯函数之后,这件事可以被直接测,不必先渲染一整个收件箱。
 *
 * 里面没有 `Date.now()`:fixture 的身份必须是 deterministic 的(仓库既有纪律,
 * `r22-extended-surfaces.test.ts` 的 fixture fence 逐条钉过这一类不稳定 id)。
 */

import {
  REVISION_CHANGES,
  reviseRecipient,
  type ApprovalItem,
  type ApprovalReason,
  type ApprovalResolution,
  type ApprovalStatus,
} from "./approvals-fixture";

export type DecisionKind = "approve" | "reject" | "revise" | "handled" | "superseded" | "canceled";

export type PendingDecision = {
  ids: string[];
  kind: DecisionKind;
  reason?: string;
  note?: string;
  /** ② 单卡批准之后焦点该落到哪一张。批量与改版不带这个值。 */
  focusAfter?: string | null;
};

const RESULT: Record<DecisionKind, { status: ApprovalStatus; resolution: ApprovalResolution; label: string }> = {
  approve: { status: "approved", resolution: "approved", label: "Approved by Nicks" },
  handled: { status: "approved", resolution: "approved", label: "Marked handled by Nicks" },
  reject: { status: "rejected", resolution: "rejected", label: "Rejected by Nicks" },
  superseded: { status: "rejected", resolution: "superseded", label: "Superseded by a newer request" },
  canceled: { status: "rejected", resolution: "canceled", label: "Canceled before approval" },
  revise: { status: "rejected", resolution: "superseded", label: "Revise asked by Nicks" },
};

function withReason(label: string, reason?: string): string {
  return reason ? `${label} · just now · ${reason}` : `${label} · just now`;
}

/** ④ 同一条目的下一个版本。id 从**第一版**派生,所以循环跑第二轮也不会撞。 */
export function nextVersionOf(item: ApprovalItem, reason: string, note: string): ApprovalItem {
  const version = (item.version ?? 1) + 1;
  const rootId = item.rootId ?? item.id;
  const id = `${rootId}-v${version}`;
  const recipient = reviseRecipient(item);
  const changed = REVISION_CHANGES[reason as ApprovalReason] ?? REVISION_CHANGES["Something else"];
  return {
    ...item,
    id,
    rootId,
    version,
    status: "waiting",
    resolution: undefined,
    decision: undefined,
    supersededBy: undefined,
    whatChanged: changed,
    settledFeedback: note ? `${reason} — ${note}` : reason,
    timeline: [
      ...(item.timeline ?? []),
      { id: `${id}-asked`, label: `Revise asked by Nicks`, when: "just now", detail: note ? `${reason} — ${note}` : reason },
      { id: `${id}-made`, label: `Version ${version} produced by ${recipient}`, when: "just now", detail: changed },
    ],
  };
}

/** 一次决策落到列表上的全部效果。旧卡与新卡在同一次返回里就位。 */
export function applyDecision(current: ApprovalItem[], pending: PendingDecision): ApprovalItem[] {
  const targets = new Set(pending.ids);
  const result = RESULT[pending.kind];
  const next: ApprovalItem[] = [];
  for (const item of current) {
    if (!targets.has(item.id)) {
      next.push(item);
      continue;
    }
    const child = pending.kind === "revise" ? nextVersionOf(item, pending.reason ?? "", pending.note ?? "") : null;
    const label = pending.kind === "revise" ? `Sent to ${reviseRecipient(item)} for a revise by Nicks` : result.label;
    next.push({
      ...item,
      status: result.status,
      resolution: result.resolution,
      decision: withReason(label, pending.reason),
      supersededBy: child?.id,
      timeline: [
        ...(item.timeline ?? []),
        { id: `${item.id}-${pending.kind}`, label, when: "just now", detail: pending.reason },
      ],
    });
    if (child) next.push(child);
  }
  return next;
}

/** 决策回执。「Fixture state only」这一族措辞不动 —— 它是这一面唯一的诚实声明。 */
export function decisionNotice(pending: PendingDecision): string {
  const count = pending.ids.length;
  if (pending.kind === "revise") return `${count} sent back for a revise. A new version is in Needs review. Fixture state only.`;
  if (pending.kind === "approve" || pending.kind === "handled") return `${count} approved. Fixture state only.`;
  if (pending.kind === "superseded") return `${count} superseded. Fixture state only.`;
  if (pending.kind === "canceled") return `${count} canceled. Fixture state only.`;
  return `${count} rejected. Fixture state only.`;
}
