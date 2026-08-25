"use client";

/**
 * ApprovalTimeline.tsx —— ⑦ 单人审计时间线。
 *
 * 一人商家没有第二个审批人,所以这条线不是「谁批过谁」的会签记录,它回答的是
 * 「这条东西怎么走到我面前的」:谁做的 → 改过什么 → 我怎么决定的 → 版本怎么长的。
 * 没有历史时说没有,不画一条空线假装有据可查。
 */

import type { ApprovalTimelineEvent } from "./approvals-fixture";

export function ApprovalTimeline({ events }: { events?: ApprovalTimelineEvent[] }) {
  if (!events?.length) {
    return <p className="r22-approvals-brief-note">No history is recorded for this item in this fixture.</p>;
  }
  return (
    <ol className="r22-approvals-timeline">
      {events.map((event) => (
        <li key={event.id}>
          <b>{event.label}</b>
          <span>{event.when}</span>
          {event.detail ? <p>{event.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export default ApprovalTimeline;
