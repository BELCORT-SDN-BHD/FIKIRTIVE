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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/northstar/_shared";
import { addRoutine, routines, toggleRoutine, useStore } from "../_store";
import { ACCOUNT_OPS_BASE as BASE, AutomationNav, Card } from "./kit";
import { type NsRoutine } from "./data";

interface RoutineDraft {
  name: string;
  cadence: string;
  step: string;
}

function RoutineCard({
  routine,
  onToggle,
}: {
  routine: NsRoutine;
  onToggle: (v: boolean) => void;
}) {
  const enabled = routine.enabled;
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
  useStore();
  const list = routines();

  const [draft, setDraft] = React.useState<RoutineDraft | null>(null);
  const canSave = draft ? draft.name.trim() && draft.cadence.trim() && draft.step.trim() : false;

  const save = () => {
    if (!draft || !canSave) return;
    addRoutine({ name: draft.name.trim(), cadence: draft.cadence.trim(), step: draft.step.trim() });
    setDraft(null);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Routines"
        subtitle="Set the rhythm once. Otto runs the steps and leaves the decisions to you."
        actions={
          <>
            <AutomationNav />
            <Button size="sm" onClick={() => setDraft({ name: "", cadence: "", step: "" })}>
              <Plus strokeWidth={2} />
              New routine
            </Button>
          </>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        {list.map((r) => (
          <RoutineCard key={r.id} routine={r} onToggle={(v) => toggleRoutine(r.id, v)} />
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Prefer a single trigger over a sequence? Add a{" "}
        <Link href={`${BASE}/automation/rules`} className="font-semibold text-foreground hover:underline">
          rule
        </Link>
        .
      </p>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New routine</DialogTitle>
            <DialogDescription>
              A named rhythm, a cadence, and a first step. Otto runs it and leaves the decisions to you.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">Name</span>
              <input
                type="text"
                value={draft?.name ?? ""}
                onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                placeholder="Morning open"
                className="h-11 w-full rounded-[10px] border border-border bg-background px-3.5 text-[15px] leading-[22px] text-foreground outline-none transition-colors duration-[120ms] placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">Cadence</span>
              <input
                type="text"
                value={draft?.cadence ?? ""}
                onChange={(e) => setDraft((d) => (d ? { ...d, cadence: e.target.value } : d))}
                placeholder="Daily · 7:30 am"
                className="h-11 w-full rounded-[10px] border border-border bg-background px-3.5 text-[15px] leading-[22px] text-foreground outline-none transition-colors duration-[120ms] placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">First step</span>
              <input
                type="text"
                value={draft?.step ?? ""}
                onChange={(e) => setDraft((d) => (d ? { ...d, step: e.target.value } : d))}
                placeholder="Check overnight chats"
                className="h-11 w-full rounded-[10px] border border-border bg-background px-3.5 text-[15px] leading-[22px] text-foreground outline-none transition-colors duration-[120ms] placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canSave} onClick={save}>
              Create routine
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
