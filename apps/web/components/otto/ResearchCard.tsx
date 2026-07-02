"use client";
import React from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseResearchCardPayload, RESEARCH_TIER_LABELS } from "@/lib/research-card";

export interface ResearchCardProps {
  /** The durable RESEARCH_CARD message id. Accepted but UNUSED in S2 — reserved for S3,
   *  which wires the real approve→reserve spend against this cardId. Do not remove. */
  cardId: string;
  payload: unknown;
}

/** Otto 的深度研究计划卡(RESEARCH_CARD)。样式镜像 OttoActionPlanCard(审批卡外观)。
 *  S2 = 纯渲染 $0:显示 topic / 深度档 / 子问题 / 预估 credits + 状态区。
 *  "Approve & run" 是 planned 态的**禁用占位**(S3 才接真 reserve/spend);本组件绝不花钱。 */
export function ResearchCard({ payload }: ResearchCardProps) {
  const view = parseResearchCardPayload(payload);
  const tierLabel = RESEARCH_TIER_LABELS[view.tier];

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="gb leading-[1.5]" style={{ maxWidth: 480 }}>
      <div className="rounded-[18px] border border-border bg-secondary p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <Search size={20} className="text-foreground" />
          <span className="font-bold text-[0.8125rem] text-foreground">
            {view.topic || "Research"}
          </span>
          {/* tier badge */}
          <span className="ml-auto text-[0.75rem] font-semibold px-[7px] py-[2px] rounded-full bg-card text-muted-foreground">
            {tierLabel}
          </span>
        </div>

        {/* Goal */}
        {view.goal && (
          <div className="text-[0.875rem] text-muted-foreground mb-4">{view.goal}</div>
        )}

        {/* Sub-questions */}
        {view.questions.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {view.questions.map((q, i) => (
              <div
                key={i}
                className="bg-card rounded-[14px] text-[0.8125rem] text-foreground"
                style={{ padding: "10px 12px" }}
              >
                {q}
              </div>
            ))}
          </div>
        )}

        {/* Estimated credits */}
        <div className="pt-3 border-t border-border mb-4">
          <span className="text-[0.75rem] text-muted-foreground">
            Estimated {view.estimatedCredits} credits
          </span>
        </div>

        {/* Status area */}
        {view.status === "planned" ? (
          <div className="flex flex-col gap-2">
            {/* S2 placeholder ONLY — DISABLED, no onClick, no spend. S3 wires approve→reserve. */}
            <Button variant="default" disabled>
              Approve &amp; run
            </Button>
            <span className="text-[0.75rem] text-muted-foreground/70">Runs in the next step</span>
          </div>
        ) : view.status === "running" ? (
          <div className="text-[0.875rem] text-muted-foreground">Researching…</div>
        ) : (
          <div className="text-[0.875rem] text-muted-foreground">Report ready below</div>
        )}
      </div>
    </div>
  );
}

export default ResearchCard;
