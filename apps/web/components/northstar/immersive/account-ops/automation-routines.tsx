"use client";

/**
 * 例程 —— 固定节奏的多步动作序列(每日开店、每周计划、活动收尾)。
 * 每步是一句白话;§F7 即时开关启用/暂停;下一次运行时间给个确定性标签。
 * 交叉链接:例程步骤里的产出 → schedule / analytics;想要单条触发 → rules。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/northstar/_shared";
import { ACCOUNT_OPS_BASE as BASE, AutomationNav, Card } from "./kit";
import { NS_ROUTINES, type NsRoutine } from "./data";

function RoutineCard({
  routine,
  enabled,
  onToggle,
}: {
  routine: NsRoutine;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{routine.name}</h3>
          <p className="mt-0.5 font-mono text-[11px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
            {routine.cadence}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label={`Enable ${routine.name}`} />
      </div>

      <ol className="mt-3 space-y-1.5">
        {routine.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full bg-secondary">
              <Check className="size-2.5 text-muted-foreground" strokeWidth={2.5} />
            </span>
            <span className="min-w-0 text-[13px] leading-[18px] text-foreground">{step}</span>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">
          {enabled ? `Next run · ${routine.nextRun}` : "Paused"}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto" asChild>
          <Link href={`${BASE}/schedule/plan`}>
            See what it lines up
            <ArrowRight strokeWidth={2} />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

export function AutomationRoutines() {
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(NS_ROUTINES.map((r) => [r.id, r.enabled])),
  );

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Routines"
        subtitle="Set the rhythm once. Otto runs the steps and leaves the decisions to you."
        actions={
          <>
            <AutomationNav />
            <Button size="sm">
              <Plus strokeWidth={2} />
              New routine
            </Button>
          </>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        {NS_ROUTINES.map((r) => (
          <RoutineCard key={r.id} routine={r} enabled={enabled[r.id]} onToggle={(v) => setEnabled((s) => ({ ...s, [r.id]: v }))} />
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Prefer a single trigger over a sequence? Add a{" "}
        <Link href={`${BASE}/automation/rules`} className="font-semibold text-foreground hover:underline">
          rule
        </Link>
        .
      </p>
    </div>
  );
}
