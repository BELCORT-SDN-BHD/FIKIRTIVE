/* @nsPage district="自动化区" page="routines" status="draft"
   sources="O-02+O-05 routine 授权模型;P1½-3;harmony-01 #6/§四⑤" approvedAt="" pr="" */
"use client";

/**
 * Routine 管理面 — 用户的「授权书」管理:定时自主 Otto。
 * 清单要件:routine 列表、四件套全部可见(范围声明 / 预算上限 / kill switch /
 *           事后摘要)、run 历史与花费。
 *
 * harmony-01 §四⑤:Routine 是授权对象,不是 cron 配置。四件套是字段,不是文档约定:
 *   ① 范围声明(can / cannot)  ② 预算上限(每次 + 每月)  ③ kill switch(即停)
 *   ④ 事后摘要(每次 run 留一行 + 花费)。超预算 = 数据库层拒绝(展示层说明它)。
 *
 * Otto 在场:routine 是 Otto 替你自主工作的授权,但这张页是「管理面」——
 *   开关/暂停是人的决定(§F7 INK,永不 coral);coral 只在 dock。
 *   预算是 spend 面(§V5:credits;kill switch 停用走 §FB6 destructive confirm 语气但可逆)。
 * 布局:List archetype,单列 880 卡片流(§L3);每张 routine 一张可展开卡。
 */

import * as React from "react";
import Link from "next/link";
import {
  Ban,
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  PauseCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, MockNote, OttoNarrationBar, PageHeader, StatCard } from "@/components/northstar/_shared";
import {
  DemoStates,
  InlineError,
  Landed,
  SkeletonBlock,
  type DemoState,
} from "@/components/northstar/automation/_bits";
import {
  AUTOMATION_SUMMARY,
  ROUTINES,
  ROUTINES_LAND_STEPS,
  type Routine,
  type RoutineRun,
} from "@/components/northstar/automation/_data";

/* ── 预算条:每月用量(§FB8 determinate,配 counter;非 Otto 工作 → INK 不 coral) ── */
function BudgetMeter({ used, cap }: { used: number; cap: number }) {
  const pct = cap === 0 ? 0 : Math.min(100, Math.round((used / cap) * 100));
  const near = pct >= 80;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">This month</span>
        <span className="font-mono text-xs font-medium tabular-nums text-foreground">
          {used} / {cap} cr
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full border border-border bg-background">
        <div
          className={cn("h-full rounded-full", near ? "bg-warning" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {near && (
        <p className="mt-1.5 text-xs text-warning-soft-foreground">
          Near the cap. Otto stops itself here. It never spends past it.
        </p>
      )}
    </div>
  );
}

const OUTCOME_META: Record<RoutineRun["outcome"], { label: string; variant: "success" | "warning" | "outline" }> = {
  done: { label: "Done", variant: "success" },
  held: { label: "Waiting for you", variant: "warning" },
  skipped: { label: "Skipped", variant: "outline" },
};

function RunRow({ run, last }: { run: RoutineRun; last: boolean }) {
  const meta = OUTCOME_META[run.outcome];
  const body = (
    <div className={cn("flex items-start gap-3 py-2.5", !last && "border-b border-border")}>
      <span className="w-20 shrink-0 pt-0.5 font-mono text-[11px] leading-[16px] text-muted-foreground">{run.at}</span>
      <span className="min-w-0 flex-1 text-[13px] leading-[19px] text-foreground">{run.summary}</span>
      <Badge variant={meta.variant} className="mt-px shrink-0">
        {meta.label}
      </Badge>
      <span className="w-16 shrink-0 pt-0.5 text-right font-mono text-[11px] leading-[16px] tabular-nums text-muted-foreground">
        {run.spentCredits > 0 ? `${run.spentCredits} cr` : "—"}
      </span>
    </div>
  );
  return run.href ? (
    <Link href={run.href} className="-mx-2 block rounded-[8px] px-2 hover:bg-accent/50">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}

function ScopeList({ items, kind }: { items: string[]; kind: "can" | "cannot" }) {
  const isCan = kind === "can";
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {isCan ? (
          <ShieldCheck className="size-3.5 text-success-soft-foreground" strokeWidth={2} />
        ) : (
          <Ban className="size-3.5 text-muted-foreground" strokeWidth={2} />
        )}
        <span className="font-mono text-[10px] leading-none font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {isCan ? "Otto may" : "Otto may never"}
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-[19px] text-foreground">
            <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/50" />
            <span className="min-w-0">{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoutineCard({
  routine,
  expanded,
  onToggleExpand,
  onRequestKill,
  onResume,
}: {
  routine: Routine;
  expanded: boolean;
  onToggleExpand: () => void;
  onRequestKill: () => void;
  onResume: () => void;
}) {
  const active = routine.status === "active";
  const heldRun = routine.runs.find((r) => r.outcome === "held");
  return (
    <article className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
      {/* 头:名称 + 状态 + kill switch */}
      <div className="flex flex-wrap items-start gap-3 p-5">
        <span
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[12px]",
            active ? "bg-brand-soft" : "bg-secondary",
          )}
        >
          <OttoAvatar size={22} mood={active ? "idle" : "waiting"} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{routine.name}</h2>
            {active ? <Badge variant="success">Active</Badge> : <Badge variant="outline">Paused</Badge>}
          </div>
          <p className="mt-1 max-w-[620px] text-[13px] leading-[19px] text-muted-foreground">{routine.purpose}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" strokeWidth={2} />
              {routine.cadence}
            </span>
            <span className="text-xs text-muted-foreground">
              Next · <span className="text-foreground">{active ? routine.nextRunAt : "paused"}</span>
            </span>
          </div>
        </div>

        {/* kill switch —— 显式停用键(§F7 destructive 语气:停用前问,可逆) */}
        <div className="flex shrink-0 items-center">
          {active ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onRequestKill}
              className="text-error-soft-foreground hover:bg-error-soft hover:text-error-soft-foreground"
            >
              <PauseCircle strokeWidth={2} />
              Pause now
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={onResume}>
              <Check strokeWidth={2} />
              Resume
            </Button>
          )}
        </div>
      </div>

      {/* 有待批产出时的提示条(held run deep-link) */}
      {active && heldRun?.href && (
        <Link
          href={heldRun.href}
          className="flex items-center gap-2 border-t border-border bg-warning-soft/40 px-5 py-2.5 hover:bg-warning-soft/60"
        >
          <CircleAlert className="size-4 shrink-0 text-warning-soft-foreground" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{heldRun.summary}</span>
          <span className="shrink-0 text-[13px] font-semibold text-foreground">Review</span>
        </Link>
      )}

      {/* 四件套之②③ 常驻可见:预算上限 + 最近一次 */}
      <div className="grid gap-4 border-t border-border p-5 sm:grid-cols-2">
        <div>
          <div className="flex items-center gap-1.5 pb-2">
            <Wallet className="size-3.5 text-muted-foreground" strokeWidth={2} />
            <span className="font-mono text-[10px] leading-none font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Budget cap
            </span>
          </div>
          <BudgetMeter used={routine.budget.usedThisMonthCredits} cap={routine.budget.perMonthCredits} />
          <p className="mt-2 text-xs text-muted-foreground">
            Up to <span className="tabular-nums text-foreground">{routine.budget.perRunCredits} credits</span> each run.
          </p>
        </div>
        <div>
          <div className="flex items-center gap-1.5 pb-2">
            <Sparkles className="size-3.5 text-muted-foreground" strokeWidth={2} />
            <span className="font-mono text-[10px] leading-none font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Last run
            </span>
          </div>
          {routine.runs[0] ? (
            <>
              <p className="text-[13px] leading-[19px] text-foreground">{routine.runs[0].summary}</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {routine.runs[0].at} ·{" "}
                {routine.runs[0].spentCredits > 0 ? `${routine.runs[0].spentCredits} cr` : "no spend"}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">Hasn't run yet.</p>
          )}
        </div>
      </div>

      {/* 展开:四件套之①④ 范围声明 + run 历史 */}
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 border-t border-border px-5 py-3 text-left text-[13px] font-semibold text-foreground hover:bg-accent/50"
      >
        <span className="flex-1">{expanded ? "Hide the details" : "What Otto may do, and every run"}</span>
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform duration-200", expanded && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {expanded && (
        <div className="border-t border-border p-5">
          {/* ① 范围声明 */}
          <div className="grid gap-5 sm:grid-cols-2">
            <ScopeList items={routine.scope.can} kind="can" />
            <ScopeList items={routine.scope.cannot} kind="cannot" />
          </div>

          {/* ④ 事后摘要:run 历史与花费 */}
          <div className="mt-5 border-t border-border pt-4">
            <div className="flex items-center justify-between pb-1">
              <span className="font-mono text-[10px] leading-none font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                Run history
              </span>
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {routine.runs.length} runs
              </span>
            </div>
            {routine.runs.map((run, i) => (
              <RunRow key={run.id} run={run} last={i === routine.runs.length - 1} />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function RoutineSkeleton({ shimmer = true }: { shimmer?: boolean }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-card p-5">
      <div className="flex gap-3">
        <SkeletonBlock className="size-9 shrink-0" shimmer={shimmer} />
        <div className="flex-1">
          <SkeletonBlock className="h-5 w-40" shimmer={shimmer} />
          <SkeletonBlock className="mt-2 h-4 w-3/4" shimmer={false} />
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <SkeletonBlock className="h-14 w-full" shimmer={false} />
        <SkeletonBlock className="h-14 w-full" shimmer={false} />
      </div>
    </div>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("default");
  const [landed, setLanded] = React.useState(false);
  const [routines, setRoutines] = React.useState<Routine[]>(() => ROUTINES.map((r) => ({ ...r })));
  const [expandedId, setExpandedId] = React.useState<string | null>(ROUTINES[0]!.id);
  const [killId, setKillId] = React.useState<string | null>(null);

  const isLoading = demo === "loading";
  const isEmpty = demo === "empty";
  const isError = demo === "error";
  const show = landed && !isLoading && !isEmpty && !isError;

  const killTarget = routines.find((r) => r.id === killId) ?? null;

  function pause(id: string) {
    setRoutines((prev) => prev.map((r) => (r.id === id ? { ...r, status: "paused", nextRunAt: null } : r)));
    setKillId(null);
  }
  function resume(id: string) {
    setRoutines((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, status: "active", nextRunAt: ROUTINES.find((o) => o.id === id)?.nextRunAt ?? "soon" } : r,
      ),
    );
  }

  const activeCount = routines.filter((r) => r.status === "active").length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Routines"
        subtitle="Standing jobs you let Otto run on a schedule. Every one has a budget cap and a kill switch."
        actions={
          <Button size="sm" disabled={!show}>
            <Plus strokeWidth={2} />
            New routine
          </Button>
        }
      />

      {/* 数据一行(§D3) */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active" value={show ? `${activeCount}/${routines.length}` : "—"} />
        <StatCard
          label="Spent this month"
          value={show ? String(AUTOMATION_SUMMARY.spentThisMonthCredits) : "—"}
          delta={{ dir: "flat", text: `of ${AUTOMATION_SUMMARY.monthlyCapCredits} capped` }}
        />
        <StatCard label="Runs this month" value={show ? "9" : "—"} delta={{ dir: "flat", text: "1 waiting for you" }} />
        <StatCard label="Rules on" value={String(AUTOMATION_SUMMARY.activeRules)} delta={{ dir: "flat", text: "in Rules" }} />
      </div>

      {/* 授权模型一句话:这是授权书,不是配置(harmony-01 §四⑤) */}
      <div className="mt-6 flex items-start gap-3 rounded-[14px] border border-border bg-secondary/50 px-4 py-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        <p className="text-[13px] leading-[19px] text-foreground">
          A routine is a note you sign that says what Otto may do while you're away. Otto stays inside the budget and
          scope you set, holds anything risky for your approval, and you can stop any routine the moment you want.
        </p>
      </div>

      {/* 工具行:叙述条 */}
      <div className="mt-6 flex items-center gap-3">
        <p className="text-xs text-muted-foreground">Pausing takes effect right away.</p>
        <div className="flex-1" />
        {!landed && !isEmpty && !isError && (
          <OttoNarrationBar key="landing" steps={ROUTINES_LAND_STEPS} stepMs={1100} onSettle={() => setLanded(true)} />
        )}
      </div>

      {/* 主体 */}
      <div className="mt-4 flex flex-col gap-4">
        {isError ? (
          <div className="rounded-[var(--radius-card)] border border-border bg-card">
            <InlineError text="Couldn't load your routines. Try again." onRetry={() => setDemo("default")} />
          </div>
        ) : isEmpty ? (
          <div className="flex rounded-[var(--radius-card)] border border-border bg-card">
            <EmptyState
              icon={Sparkles}
              title="No routines yet"
              body="Set one up or ask Otto to draft your week's posts every Monday, held for your review."
              action={
                <Button size="sm">
                  <Plus strokeWidth={2} />
                  New routine
                </Button>
              }
            />
          </div>
        ) : !show ? (
          <>
            <RoutineSkeleton />
            <RoutineSkeleton shimmer={false} />
          </>
        ) : (
          routines.map((r, i) => (
            <Landed key={r.id} delayMs={(i % 4) * 90}>
              <RoutineCard
                routine={r}
                expanded={expandedId === r.id}
                onToggleExpand={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
                onRequestKill={() => setKillId(r.id)}
                onResume={() => resume(r.id)}
              />
            </Landed>
          ))
        )}
      </div>

      {/* kill switch confirm(§FB6:可逆 → tier 2 语气但不需要 type-to-confirm;
          Otto 见证危险,coral 永不上色危险本身) */}
      <Dialog open={killTarget != null} onOpenChange={(open) => !open && setKillId(null)}>
        <DialogContent className="max-w-[min(440px,calc(100vw-2rem))]">
          {killTarget && (
            <>
              <div className="flex items-center gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-[16px] bg-brand-soft">
                  <OttoAvatar size={34} mood="warning" />
                </span>
                <DialogHeader className="space-y-1 text-left">
                  <DialogTitle>Pause this routine?</DialogTitle>
                  <DialogDescription>{killTarget.name}</DialogDescription>
                </DialogHeader>
              </div>
              <div className="mt-4 rounded-[14px] bg-secondary/70 p-4">
                <p className="text-[13px] font-semibold text-foreground">What happens</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {[
                    "Otto stops running this routine right away.",
                    "Nothing already waiting for your review is lost.",
                    "You can resume it any time. No credits are spent to pause.",
                  ].map((t) => (
                    <li key={t} className="flex gap-2 text-[13px] leading-[19px] text-muted-foreground">
                      <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <DialogFooter className="mt-6">
                <Button variant="secondary" size="sm" onClick={() => setKillId(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" onClick={() => pause(killTarget.id)}>
                  <X strokeWidth={2} />
                  Pause routine
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/automation/routines" />
      <DemoStates
        value={demo}
        onChange={(s) => {
          setDemo(s);
          if (s === "default") setLanded(true);
          if (s === "loading") setLanded(false);
        }}
      />
    </div>
  );
}
