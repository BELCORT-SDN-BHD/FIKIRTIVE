"use client";

/**
 * 规则 —— when → then 的自动化。花额度的规则用 coral 小点提示(§O:coral = Otto 会干活),
 * 只回复/安排的不带 coral。§F7 即时开关(花钱的规则关时不确认,开时才是花钱动作 → 这里
 * 开关只是「启用规则」,真正花钱仍走每次的审批,故即时生效安全)。
 * 交叉链接:规则命中的动作 → schedule / inbox;想要更长的动作序列 → routines。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { PageHeader } from "@/components/northstar/_shared";
import { ACCOUNT_OPS_BASE as BASE, AutomationNav, Card } from "./kit";
import { NS_RULES, type NsRule } from "./data";

function RuleCard({
  rule,
  enabled,
  onToggle,
}: {
  rule: NsRule;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{rule.name}</h3>
            {rule.costs && (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-soft bg-brand-soft/50 px-2 py-0.5 text-[11px] font-medium text-brand-soft-foreground">
                <OttoAvatar size={12} mood="idle" />
                Uses credits
              </span>
            )}
          </div>
          <dl className="mt-2 space-y-1.5">
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 font-mono text-[11px] leading-[18px] font-medium tracking-[0.06em] text-muted-foreground uppercase">When</dt>
              <dd className="min-w-0 text-[13px] leading-[18px] text-foreground">{rule.when}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 font-mono text-[11px] leading-[18px] font-medium tracking-[0.06em] text-muted-foreground uppercase">Then</dt>
              <dd className="min-w-0 text-[13px] leading-[18px] text-foreground">{rule.then}</dd>
            </div>
          </dl>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label={`Enable ${rule.name}`} />
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {enabled ? `Ran ${rule.runsThisWeek}× this week` : "Paused"}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto" asChild>
          <Link href={`${BASE}/inbox/shared`}>
            See activity
            <ArrowRight strokeWidth={2} />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

export function AutomationRules() {
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(NS_RULES.map((r) => [r.id, r.enabled])),
  );

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Automation"
        subtitle="Small rules that run themselves. Anything that spends still waits for your tap."
        actions={
          <>
            <AutomationNav />
            <Button size="sm">
              <Plus strokeWidth={2} />
              New rule
            </Button>
          </>
        }
      />

      {/* Otto 建议条(本屏唯一 coral statement;把预填送不进这里,给个真去处) */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-[18px] border border-brand-soft bg-brand-soft/50 px-4 py-3.5">
        <OttoAvatar size={28} mood="helpful" />
        <p className="min-w-0 flex-1 basis-64 text-[13px] leading-[1.45] text-brand-soft-foreground">
          You reply to most WhatsApp order questions the same way. Want a rule for that?
        </p>
        <Button variant="brand" size="sm">
          <Sparkles strokeWidth={2} />
          Draft a rule
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3">
        {NS_RULES.map((r) => (
          <RuleCard key={r.id} rule={r} enabled={enabled[r.id]} onToggle={(v) => setEnabled((s) => ({ ...s, [r.id]: v }))} />
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Want a multi-step sequence instead of one rule? Set up a{" "}
        <Link href={`${BASE}/automation/routines`} className="font-semibold text-foreground hover:underline">
          routine
        </Link>
        .
      </p>
    </div>
  );
}
