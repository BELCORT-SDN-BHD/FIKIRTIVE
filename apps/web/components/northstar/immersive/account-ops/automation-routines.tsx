"use client";

/**
 * 例程 —— 固定节奏的多步动作序列(每日开店、每周计划、活动收尾)。
 * 授权四件套(O-02+O-05,「自动的手 + 有闸的钱包」):每张卡把四件信任机制摆上台面 ——
 *   ① 预算上限:本月已用 / 上限进度条(常驻,花钱一眼可见)
 *   ② kill switch:顶部开关即急停闸(常驻,一点就停,Otto 半路收手)
 *   ③ 范围声明:展开后的 chips,讲清这条例程被允许碰什么(展开)
 *   ④ 事后摘要 / run 历史:最近几次跑了什么、花了多少(展开)
 * 新建走同一四件套向导(名称/节奏/首步 + 花费上限 + 范围)。
 * 交叉链接:例程步骤里的产出 → schedule / analytics;想要单条触发 → rules。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
  budget: string;
  scope: string;
}

const EMPTY_DRAFT: RoutineDraft = { name: "", cadence: "", step: "", budget: "", scope: "" };

/** 本月预算进度条(§D 数据面:credits 永远是 credits,近上限转 warning;coral 不用于此) */
function BudgetMeter({ spent, cap }: { spent: number; cap: number }) {
  if (cap <= 0) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">No spend</span> · this routine never uses credits
      </p>
    );
  }
  const pct = Math.min(100, Math.round((spent / cap) * 100));
  const near = pct >= 80;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Spend cap this month</span>
        <span
          className={cn(
            "font-mono text-[11px] leading-[14px] font-medium tabular-nums",
            near ? "text-warning-soft-foreground" : "text-foreground",
          )}
        >
          {spent} / {cap} credits
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={spent}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-label="Spend used this month"
        className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", near ? "bg-warning-soft-foreground" : "bg-foreground")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function RoutineCard({
  routine,
  onToggle,
}: {
  routine: NsRoutine;
  onToggle: (v: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const enabled = routine.enabled;
  const recentRuns = routine.runs.slice(0, 3);

  return (
    <Card className="p-4">
      {/* 头:名称 + 节奏 + kill switch(常驻急停闸) */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{routine.name}</h3>
          <p className="mt-0.5 font-mono text-[11px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
            {routine.cadence}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Switch checked={enabled} onCheckedChange={onToggle} aria-label={`Kill switch for ${routine.name}`} />
          <span className="font-mono text-[10px] leading-[12px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
            Kill switch
          </span>
        </div>
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

      {/* 预算上限:常驻,花钱一眼可见 */}
      <div className="mt-3 border-t border-border pt-3">
        <BudgetMeter spent={routine.spentThisMonth} cap={routine.budgetCapCredits} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {enabled ? `Next run · ${routine.nextRun}` : "Paused"}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto flex items-center gap-1 text-xs font-semibold text-foreground hover:underline"
        >
          {open ? "Hide details" : "Scope and history"}
          <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} strokeWidth={2} />
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-4 border-t border-border pt-3">
          {/* 范围声明 chips */}
          <div>
            <p className="text-xs font-medium text-muted-foreground">What it’s allowed to do</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {routine.scope.map((s, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* 事后摘要 / run 历史 */}
          <div>
            <p className="text-xs font-medium text-muted-foreground">Recent runs</p>
            {recentRuns.length === 0 ? (
              <p className="mt-1.5 text-[13px] leading-[18px] text-muted-foreground">
                Hasn’t run yet. The summary of each run shows up here.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {recentRuns.map((run, i) => (
                  <li key={i} className="flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
                        {run.at}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] leading-[14px] font-medium tabular-nums text-muted-foreground">
                        {run.spent > 0 ? `${run.spent} credits` : "No spend"}
                      </span>
                    </div>
                    <span className="text-[13px] leading-[18px] text-foreground">{run.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button variant="ghost" size="sm" className="-ml-2 self-start" asChild>
            <Link href={`${BASE}/schedule/plan`}>
              See what it lines up
              <ArrowRight strokeWidth={2} />
            </Link>
          </Button>
        </div>
      )}
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
    const budget = Math.max(0, Math.round(Number(draft.budget) || 0));
    const scope = draft.scope
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    addRoutine({
      name: draft.name.trim(),
      cadence: draft.cadence.trim(),
      step: draft.step.trim(),
      scope,
      budgetCapCredits: budget,
    });
    toast("Routine created", {
      description: budget > 0 ? `Capped at ${budget} credits a month. Flip the kill switch any time.` : "It never spends. Flip the kill switch any time.",
    });
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
            <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
              <Plus strokeWidth={2} />
              New routine
            </Button>
          </>
        }
      />

      {/* 授权四件套一句话解释(把「有闸的钱包」摆到台面上) */}
      <div className="mt-6 flex items-start gap-2.5 rounded-[14px] border border-border bg-secondary/50 px-4 py-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          Every routine has a monthly spend cap, a kill switch, a plain-English scope, and a run history — so you always
          know what the automation touched and what it cost.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
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
              A named rhythm and its first step — plus a spend cap and a scope, so it runs with a leash.
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
            {/* 四件套向导:花费上限 + 范围声明 */}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                Spend cap <span className="font-normal text-muted-foreground">— credits per month (0 = never spends)</span>
              </span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={draft?.budget ?? ""}
                onChange={(e) => setDraft((d) => (d ? { ...d, budget: e.target.value } : d))}
                placeholder="200"
                className="h-11 w-full rounded-[10px] border border-border bg-background px-3.5 text-[15px] leading-[22px] text-foreground outline-none transition-colors duration-[120ms] placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                Scope <span className="font-normal text-muted-foreground">— what it may touch, comma separated</span>
              </span>
              <input
                type="text"
                value={draft?.scope ?? ""}
                onChange={(e) => setDraft((d) => (d ? { ...d, scope: e.target.value } : d))}
                placeholder="Read chats, Post one story, Flag for you"
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
