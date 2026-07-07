"use client";

/**
 * 审批 —— 需要一个人拍板的事:花额度生成(coral,Otto 会干活)或排期发帖(INK,人的动作)。
 * 每条审批都能点开「被审的东西」:生成 → campaign 提案卡;排期 → schedule 计划。
 * 批准后卡片走一次 coral sweep(§8a,仅生成类;排期类是 INK,不带 coral)。
 * §FB5 影响清单先讲清「会发生什么」再让人点。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, PageHeader } from "@/components/northstar/_shared";
import { NS_APPROVALS, type NsApprovalRequest } from "@/components/northstar/global/_data";
import { ACCOUNT_OPS_BASE as BASE, TeamNav, Card, useSweep } from "./kit";

type Decision = "pending" | "approved" | "declined";

/** 被审对象的去处:生成 → 活动提案卡;排期 → 排期计划 */
const REVIEW_HREF: Record<NsApprovalRequest["kind"], { href: string; label: string }> = {
  generation: { href: `${BASE}/campaign/proposal-card`, label: "View the campaign" },
  schedule: { href: `${BASE}/schedule/plan`, label: "View the posts" },
};

function ApprovalCard({ req }: { req: NsApprovalRequest }) {
  const [decision, setDecision] = React.useState<Decision>("pending");
  const [pending, setPending] = React.useState(false);
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
    }, 600);
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
            <Badge variant={decision === "approved" ? "success" : "outline"}>
              {decision === "approved" ? (isGen ? "Approved · generating" : "Approved · scheduled") : "Declined"}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
}

export function TeamApprovals() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Approvals"
        subtitle="The queue of things that need a person. Nothing spends or publishes until you approve it."
        actions={<TeamNav />}
      />

      {NS_APPROVALS.length === 0 ? (
        <EmptyState
          icon={Check}
          title="All caught up"
          body="No approvals waiting. Otto will queue anything that needs your call here."
          className="mt-6"
        />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3">
          {NS_APPROVALS.map((req) => (
            <ApprovalCard key={req.id} req={req} />
          ))}
        </div>
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
