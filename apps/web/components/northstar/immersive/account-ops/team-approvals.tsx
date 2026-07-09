"use client";

/**
 * 审批 —— 需要一个人拍板的事:花额度生成(coral,Otto 会干活)或排期发帖(INK,人的动作)。
 * 每条审批都能点开「被审的东西」:生成 → campaign 提案卡;排期 → schedule 计划。
 * 批准后卡片走一次 coral sweep(§8a,仅生成类;排期类是 INK,不带 coral)。
 * §FB5 影响清单先讲清「会发生什么」再让人点。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, CornerUpLeft, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, PageHeader } from "@/components/northstar/_shared";
import { type NsApprovalRequest } from "@/components/northstar/global/_data";
import { approveRequest, pendingApprovals, returnApproval, useStore } from "../_store";
import { ACCOUNT_OPS_BASE as BASE, TeamNav, Card, useSweep } from "./kit";

type Decision = "pending" | "approved" | "declined" | "returned";
type QueueFilter = "all" | "generation" | "schedule";

// 落定后留一拍展示回执,再提交进共享 store(单一源:队列全城缩短、花钱联动)
const SETTLE_MS = 1600;

/** 被审对象的去处:生成 → 活动提案卡;排期 → 排期计划 */
const REVIEW_HREF: Record<NsApprovalRequest["kind"], { href: string; label: string }> = {
  generation: { href: `${BASE}/campaign/proposal-card`, label: "View the campaign" },
  schedule: { href: `${BASE}/schedule/plan`, label: "View the posts" },
};

function ApprovalCard({ req }: { req: NsApprovalRequest }) {
  const [decision, setDecision] = React.useState<Decision>("pending");
  const [pending, setPending] = React.useState(false);
  // [wave-b] 审批加「退回并留言」:开一个内联留言框,让老板说清改哪再退回给小编。
  const [returning, setReturning] = React.useState(false);
  const [note, setNote] = React.useState("");
  const sweep = useSweep();
  const isGen = req.kind === "generation";
  const review = REVIEW_HREF[req.kind];

  const decide = (d: "approved" | "declined") => {
    setPending(true);
    window.setTimeout(() => {
      setDecision(d);
      setPending(false);
      // 生成类批准 = Otto 开始干活 → coral sweep;排期/拒绝不带 coral
      if (d === "approved" && isGen) sweep.fire();
      // toast 回执:批/驳都给一句人话(§FB toast)
      if (d === "approved") {
        toast(isGen ? "Approved · Otto is generating" : "Approved · scheduled", { description: req.title });
      } else {
        toast("Declined · sent back", { description: req.title });
      }
      // 落定后提交进共享 store:队列全城缩短(通知页同步)、生成类真扣额度(全城联动)
      window.setTimeout(() => approveRequest(req.id, d === "approved" ? "approve" : "decline"), SETTLE_MS);
    }, 600);
  };

  const sendBack = () => {
    setDecision("returned");
    setReturning(false);
    toast("Sent back for changes", { description: note.trim() ? `“${note.trim()}”` : req.title });
    // 落定后提交进共享 store:退回 = 移出队列 + 带 note 的事件(小编那头读作 needs changes)
    window.setTimeout(() => returnApproval(req.id, note), SETTLE_MS);
  };

  return (
    <Card className="overflow-hidden" style={decision === "approved" && isGen ? sweep.style : undefined}>
      <div className="flex items-start gap-3 p-4">
        {isGen ? (
          <OttoAvatar size={28} mood={decision === "approved" ? "success" : "waiting"} className="mt-0.5 shrink-0" />
        ) : (
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
            <Check className="size-4 text-muted-foreground" strokeWidth={2} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{req.title}</h3>
            {isGen ? (
              <Badge variant="warning">Needs approval · spend</Badge>
            ) : (
              <Badge variant="info">Needs approval · schedule</Badge>
            )}
            <span className="ml-auto text-xs text-muted-foreground">{req.requestedAt}</span>
          </div>
          <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{req.detail}</p>
        </div>
      </div>

      {/* 影响清单(§FB5:先讲会发生什么) */}
      <div className="border-t border-border bg-secondary/40 px-4 py-3">
        <ul className="space-y-1">
          {req.impacts.map((impact, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] leading-[18px] text-foreground">
              <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground" />
              <span className="min-w-0">{impact}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={review.href}>
            {review.label}
            <ArrowRight strokeWidth={2} />
          </Link>
        </Button>
        {typeof req.credits === "number" && (
          <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground tabular-nums">
            ~{req.credits} credits
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {decision === "pending" ? (
            <>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => setReturning((v) => !v)}>
                <CornerUpLeft strokeWidth={2} />
                Send back
              </Button>
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => decide("declined")}>
                <X strokeWidth={2} />
                Decline
              </Button>
              <Button variant={isGen ? "brand" : "default"} size="sm" disabled={pending} onClick={() => decide("approved")}>
                <Check strokeWidth={2} />
                {pending ? "Working…" : "Approve"}
              </Button>
            </>
          ) : (
            <Badge
              variant={decision === "approved" ? "success" : decision === "returned" ? "warning" : "outline"}
            >
              {decision === "approved"
                ? isGen
                  ? "Approved · generating"
                  : "Approved · scheduled"
                : decision === "returned"
                  ? "Sent back · needs changes"
                  : "Declined"}
            </Badge>
          )}
        </div>
      </div>

      {/* 退回留言框:说清改哪一处,退回给原提交人(不直接拒绝重来) */}
      {returning && decision === "pending" && (
        <div className="flex flex-col gap-2 border-t border-border bg-secondary/30 px-4 py-3">
          <label className="text-xs font-semibold text-foreground" htmlFor={`note-${req.id}`}>
            What should they change?
          </label>
          <textarea
            id={`note-${req.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. Swap the hero photo and soften the caption — then resend."
            className="w-full resize-none rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] leading-[18px] text-foreground outline-none transition-colors duration-[120ms] placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReturning(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={sendBack}>
              <CornerUpLeft strokeWidth={2} />
              Send back
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function TeamApprovals() {
  useStore(); // 订阅共享 store:审批队列的单一源(通知页 / 首页数字同源)
  const queue = pendingApprovals();
  const scheduleWaiting = queue.filter((r) => r.kind === "schedule").length;
  // [wave-b] 审批队列筛选(按类型):老板一天批很多单,先看花钱的或先看排期的
  const [filter, setFilter] = React.useState<QueueFilter>("all");
  const genCount = queue.filter((r) => r.kind === "generation").length;
  const shown = filter === "all" ? queue : queue.filter((r) => r.kind === filter);
  const FILTERS: { value: QueueFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: queue.length },
    { value: "generation", label: "Spend", count: genCount },
    { value: "schedule", label: "Schedule", count: scheduleWaiting },
  ];
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Approvals"
        subtitle="The queue of things that need a person. Nothing spends or publishes until you approve it."
        actions={<TeamNav />}
      />

      {/* Editor 视角提示条:让老板看见小编那头看到的是什么(「你的排期已送审」) */}
      {scheduleWaiting > 0 && (
        <div className="mt-6 flex items-start gap-2.5 rounded-[14px] border border-info-soft bg-info-soft/40 px-4 py-3">
          <Send className="mt-0.5 size-4 shrink-0 text-info-soft-foreground" strokeWidth={2} />
          <p className="text-[13px] leading-[18px] text-foreground">
            <span className="font-semibold">From your editor’s side:</span> their post reads{" "}
            <span className="font-medium">“Sent for approval”</span> and won’t publish until you tap approve.
            {scheduleWaiting === 1 ? " One is waiting now." : ` ${scheduleWaiting} are waiting now.`}
          </p>
        </div>
      )}

      {queue.length === 0 ? (
        <EmptyState
          icon={Check}
          title="All caught up"
          body="No approvals waiting. Otto will queue anything that needs your call here."
          className="mt-6"
        />
      ) : (
        <>
          <div role="tablist" aria-label="Filter approvals" className="mt-6 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => {
              const active = filter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.value)}
                  className={
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-ring " +
                    (active
                      ? "border-primary bg-secondary text-foreground ring-[2px] ring-ring/40"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  {f.label}
                  <span className="tabular-nums text-muted-foreground">{f.count}</span>
                </button>
              );
            })}
          </div>
          {shown.length === 0 ? (
            <EmptyState
              icon={Check}
              title="Nothing here"
              body="No approvals of this type right now. Switch the filter to see the rest."
              className="mt-4"
            />
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3">
              {shown.map((req) => (
                <ApprovalCard key={req.id} req={req} />
              ))}
            </div>
          )}
        </>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Set who can approve on your own in{" "}
        <Link href={`${BASE}/team/members`} className="font-semibold text-foreground hover:underline">
          members
        </Link>
        .
      </p>
    </div>
  );
}
