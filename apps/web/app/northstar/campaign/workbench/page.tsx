/* @nsPage district="Campaign 区" page="workbench" status="draft"
   sources="campaign spec §5.1;第四批判决(专属工作台「要」)" approvedAt="" pr="" */
"use client";

/**
 * Campaign 工作台(结构化入口)— 填表即可发起策划,不用会「聊天 prompt」。
 * 清单要件:四项表单(目标 / 周期 / 预算 / 平台)+ 按钮与 Otto 走同一动作层(O-12)。
 * 交互:提交 → 叙述条(Otto 干活)→ 提案 ready 卡落地(§8b landing + §8a sweep)。
 * 表单规矩:§F1 解剖 / §F4 提交时全验 + 永不禁用提交 / §F10 Otto 干活时字段 readOnly。
 */

import * as React from "react";
import Link from "next/link";
import { CalendarRange, Check, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { MockNote, OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import { NS_BRAND, NS_CAMPAIGN, NS_CAMPAIGN_ENTRIES } from "@/components/northstar/_mock";
import { BACKUP_IDEAS, CAMPAIGN_TOTAL_EST, PLATFORM_META } from "@/components/northstar/campaign/_data";
import { DemoStates, Landed, fmtCredits, type DemoState } from "@/components/northstar/campaign/_bits";

const PLATFORM_KEYS = ["instagram", "facebook", "tiktok", "x"] as const;

const PLAN_STEPS = [
  "Checking your trend archive…",
  "Reading your brand memory…",
  "Drafting the content calendar…",
  "Estimating credits…",
] as const;

type Phase = "idle" | "planning" | "ready";

interface FieldErrors {
  goal?: string;
  period?: string;
  budget?: string;
  platforms?: string;
}

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("default");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [goal, setGoal] = React.useState("Drive pre-orders for the Merdeka gift box");
  const [start, setStart] = React.useState("2026-08-24");
  const [end, setEnd] = React.useState("2026-08-31");
  const [budget, setBudget] = React.useState("320");
  const [platforms, setPlatforms] = React.useState<Set<string>>(new Set(["instagram", "facebook", "tiktok"]));
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const busy = phase === "planning";

  function togglePlatform(key: string) {
    if (busy) return;
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setErrors((e) => ({ ...e, platforms: undefined }));
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!goal.trim()) next.goal = "Describe what this campaign should achieve.";
    if (!start || !end || end < start) next.period = "Pick a start date and an end date after it.";
    const b = Number(budget);
    if (!budget.trim() || !Number.isFinite(b) || b <= 0 || !Number.isInteger(b))
      next.budget = "Enter a non-zero whole number of credits.";
    if (platforms.size === 0) next.platforms = "Pick at least one platform.";
    return next;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || phase === "ready") return;
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setPhase("planning");
  }

  const showError = demo === "error";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Campaign workbench"
        subtitle="Fill four fields and Otto plans the whole campaign. No prompt writing needed."
        meta={["C line · phase 1"]}
      />

      {/* 叙述条:钉在被作用面的顶部(§8c),一屏一条 */}
      {busy && (
        <OttoNarrationBar
          key="planning"
          steps={PLAN_STEPS}
          stepMs={1300}
          counter
          onSettle={() => setPhase("ready")}
          className="mt-6"
        />
      )}

      {/* 表单级错误 chip(§F4 ⑥,演示态) */}
      {showError && (
        <div
          role="alert"
          className="mt-6 rounded-[14px] bg-error-soft px-4 py-3 text-[13px] leading-[18px] font-medium text-error-soft-foreground"
        >
          Couldn&apos;t reach Otto to start planning. Your form is untouched. Try again.
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className={cn("mt-6", busy && "opacity-100")}>
        <Card className="gap-5">
          {/* 目标 */}
          <div>
            <label htmlFor="camp-goal" className="text-[13px] leading-[18px] font-semibold text-foreground">
              Goal
            </label>
            <Textarea
              id="camp-goal"
              value={goal}
              readOnly={busy}
              onChange={(e) => {
                setGoal(e.target.value);
                if (errors.goal) setErrors((er) => ({ ...er, goal: undefined }));
              }}
              placeholder="e.g. Drive pre-orders for the Merdeka gift box"
              aria-invalid={errors.goal ? true : undefined}
              className="mt-2 min-h-16 rounded-[14px] border-input bg-card"
            />
            {errors.goal ? (
              <p role="alert" className="mt-2 text-[13px] leading-[18px] font-medium text-error-soft-foreground">
                {errors.goal}
              </p>
            ) : (
              <p className="mt-2 text-xs font-medium text-muted-foreground">
                What should this campaign achieve? Otto plans everything around it.
              </p>
            )}
          </div>

          {/* 周期 */}
          <div>
            <span className="text-[13px] leading-[18px] font-semibold text-foreground">Period</span>
            <div className="mt-2 flex gap-3">
              <div className="flex-1">
                <label htmlFor="camp-start" className="text-xs font-medium text-muted-foreground">
                  Start
                </label>
                <Input
                  id="camp-start"
                  type="date"
                  value={start}
                  readOnly={busy}
                  onChange={(e) => {
                    setStart(e.target.value);
                    if (errors.period) setErrors((er) => ({ ...er, period: undefined }));
                  }}
                  aria-invalid={errors.period ? true : undefined}
                  className="mt-1"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="camp-end" className="text-xs font-medium text-muted-foreground">
                  End
                </label>
                <Input
                  id="camp-end"
                  type="date"
                  value={end}
                  readOnly={busy}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    if (errors.period) setErrors((er) => ({ ...er, period: undefined }));
                  }}
                  aria-invalid={errors.period ? true : undefined}
                  className="mt-1"
                />
              </div>
            </div>
            {errors.period ? (
              <p role="alert" className="mt-2 text-[13px] leading-[18px] font-medium text-error-soft-foreground">
                {errors.period}
              </p>
            ) : (
              <p className="mt-2 text-xs font-medium text-muted-foreground">A few days to a few months.</p>
            )}
          </div>

          {/* 预算 */}
          <div>
            <label htmlFor="camp-budget" className="text-[13px] leading-[18px] font-semibold text-foreground">
              Budget
            </label>
            <div className="relative mt-2">
              <Input
                id="camp-budget"
                inputMode="numeric"
                value={budget}
                readOnly={busy}
                onChange={(e) => {
                  setBudget(e.target.value);
                  if (errors.budget) setErrors((er) => ({ ...er, budget: undefined }));
                }}
                placeholder="320"
                aria-invalid={errors.budget ? true : undefined}
                className="pr-20 tabular-nums"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center border-l border-border pl-3 text-sm text-muted-foreground">
                credits
              </span>
            </div>
            {errors.budget ? (
              <p role="alert" className="mt-2 text-[13px] leading-[18px] font-medium text-error-soft-foreground">
                {errors.budget}
              </p>
            ) : (
              <p className="mt-2 text-xs font-medium text-muted-foreground">
                Otto keeps the plan inside this cap. Your balance · {NS_BRAND.creditBalance.toLocaleString("en-MY")}{" "}
                credits.
              </p>
            )}
          </div>

          {/* 平台 */}
          <div>
            <span className="text-[13px] leading-[18px] font-semibold text-foreground">Platforms</span>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Platforms">
              {PLATFORM_KEYS.map((key) => {
                const on = platforms.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => togglePlatform(key)}
                    aria-pressed={on}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors duration-[120ms]",
                      on
                        ? "border-transparent bg-secondary font-semibold text-foreground"
                        : "border-border bg-card font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {on && <Check className="size-3.5" strokeWidth={2.5} />}
                    {PLATFORM_META[key].label}
                  </button>
                );
              })}
            </div>
            {errors.platforms ? (
              <p role="alert" className="mt-2 text-[13px] leading-[18px] font-medium text-error-soft-foreground">
                {errors.platforms}
              </p>
            ) : (
              <p className="mt-2 text-xs font-medium text-muted-foreground">
                Where the campaign publishes. X pricing differs per post.
              </p>
            )}
          </div>

          {/* 提交行 */}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <p className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
              Starts a plan draft. Research and Otto time meter as they run, about 5 to 15 credits. Nothing is
              generated or published yet.
            </p>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Planning…" : "Start planning"}
            </Button>
          </div>
        </Card>
      </form>

      {/* 与 Otto 同一动作层(O-12)注记 */}
      <p className="mt-3 px-1 text-xs text-muted-foreground">
        This form and the chat entry land on the same action. Otto in chat fills the same four fields.
      </p>

      {/* 提案 ready 卡:Otto 落卡(§8b + §8a) */}
      {phase === "ready" && (
        <Landed sweep className="mt-6 rounded-[var(--radius-card)]">
          <Card className="gap-4">
            <div className="flex items-center gap-3">
              <OttoAvatar size={26} mood="helpful" />
              <div className="min-w-0">
                <div className="text-lg font-semibold tracking-[-0.012em] text-foreground">Proposal ready</div>
                <p className="text-sm text-muted-foreground">
                  {NS_CAMPAIGN.name} · {NS_CAMPAIGN_ENTRIES.length} posts · Aug 24 to 31 · estimated{" "}
                  {fmtCredits(CAMPAIGN_TOTAL_EST)}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-[14px] bg-secondary/70 px-4 py-3">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
              <p className="text-[13px] leading-[18px] text-muted-foreground">
                {BACKUP_IDEAS.length} backup ideas didn&apos;t make the calendar. They&apos;re saved in your{" "}
                <Link href="/northstar/create/ideas" className="font-semibold text-foreground underline-offset-2 hover:underline">
                  Ideas list
                </Link>
                .
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button asChild variant="ghost" size="sm">
                <Link href="/northstar/campaign/proposal-card">Open proposal card</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/northstar/campaign/calendar">
                  <CalendarRange strokeWidth={2} />
                  Review in calendar
                </Link>
              </Button>
            </div>
          </Card>
        </Landed>
      )}

      <MockNote path="/northstar/campaign/workbench" />
      <DemoStates
        value={demo}
        onChange={(s) => {
          setDemo(s);
          if (s === "default") setPhase("idle");
          if (s === "loading") setPhase("planning");
          if (s === "error") setPhase("idle");
        }}
        states={["default", "loading", "error"]}
      />
    </div>
  );
}
