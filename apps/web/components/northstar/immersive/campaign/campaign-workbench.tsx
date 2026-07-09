"use client";

/**
 * Campaign 工作台(结构化入口)—— 填四项表单即发起策划,不用会写 prompt。
 * 与 Otto 同一动作层(O-12):提交 → proposeCampaign(存草稿 + 单流落一轮往来)→ 叙述条 → 提案 ready 卡。
 * §F4 全验永不禁用提交;§F10 Otto 干活时字段 readOnly。
 * Wave B:节庆预填(#7,读 ?goal=)、层级归属(#11)、发送频控(#26)、playbook 模板(#6/#12/#23/#24/#25)。
 *
 * 铁律:纯 client、零后台 import;credits 永远是 credits;coral 只属于 Otto(叙述条/ready 卡 avatar)。
 */

import * as React from "react";
import Link from "next/link";
import { CalendarRange, Check, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { PageHeader, OttoNarrationBar } from "@/components/northstar/_shared";
import { NS_BRAND, NS_CAMPAIGN_ENTRIES, NS_CAMPAIGNS } from "@/components/northstar/_mock";
import { applyCampaignTemplate, deriveCampaignName, proposeCampaign } from "../_store";
import { OttoAssist } from "../otto-assist";
import { useQueryParam } from "../_kit";
import { CAMP_BASE as BASE, CampaignNav, fmtCredits } from "./kit";

const PLATFORM_KEYS = ["instagram", "facebook", "tiktok", "x"] as const;
const PLATFORM_LABEL: Record<(typeof PLATFORM_KEYS)[number], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X",
};

const PLAN_STEPS = [
  "Checking your trend archive…",
  "Reading your brand memory…",
  "Drafting the content calendar…",
  "Estimating credits…",
] as const;

// [wave-b] Campaign 模板库 playbook(#6 复制上次 · #12 沉睡唤醒 · #23 email · #24 落地页 · #25 nurture)
const PLAYBOOKS: { label: string; goal: string; note?: string }[] = [
  { label: "Repeat last campaign", goal: "Repeat the Raya open house gift boxes" },
  { label: "Win back dormant customers", goal: "Win back customers who haven't ordered in a while" },
  { label: "Email blast", goal: "Email our regulars about this week's bakes", note: "coming" },
  { label: "Landing page + form", goal: "Collect pre-orders on a one-page link", note: "coming" },
  { label: "Nurture sequence", goal: "Welcome new customers with 3 messages" },
];

const CAMPAIGN_TOTAL_EST = NS_CAMPAIGN_ENTRIES.reduce((s, e) => s + e.estCredits, 0);

type Phase = "idle" | "planning" | "ready";
interface FieldErrors {
  goal?: string;
  period?: string;
  budget?: string;
  platforms?: string;
}

export function CampaignWorkbench() {
  const prefillGoal = useQueryParam("goal");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [goal, setGoal] = React.useState(prefillGoal ?? "Drive pre-orders for the Merdeka gift box");
  const [start, setStart] = React.useState("2026-08-24");
  const [end, setEnd] = React.useState("2026-08-31");
  const [budget, setBudget] = React.useState("320");
  const [platforms, setPlatforms] = React.useState<Set<string>>(new Set(["instagram", "facebook", "tiktok"]));
  const [theme, setTheme] = React.useState(""); // #11 层级
  const [freqCap, setFreqCap] = React.useState("2"); // #26 频控
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
    // O-12:同一动作层 —— 存草稿 + 单流落一轮往来(proposal-card 读草稿真实呈现)
    proposeCampaign({ goal: goal.trim(), start, end, budgetCredits: Number(budget), platforms: [...platforms] });
    // goal 换模板:唤回/复购/新客三套帖差异化(proposal/calendar/pack 读同一份 campaignEntries)
    applyCampaignTemplate(goal.trim());
    setPhase("planning");
  }

  // 预算实物换算(STALL #43:把抽象 credit 立刻锚成「几条帖」)。视频 ~40 / 图 ~12,取中值 ~24。
  const budgetNum = Number(budget);
  const budgetPosts = Number.isFinite(budgetNum) && budgetNum > 0 ? Math.round(budgetNum / 24) : 0;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Campaign workbench"
        subtitle="Fill four fields and Otto plans the whole campaign. No prompt writing needed."
        actions={<CampaignNav />}
      />

      {busy && (
        <OttoNarrationBar key="planning" steps={PLAN_STEPS} stepMs={1300} counter onSettle={() => setPhase("ready")} className="mt-6" />
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6">
        <div className="flex flex-col gap-5 rounded-[18px] border border-border bg-card p-5">
          {/* §O7 就地 Otto 帮我(STALL #26:不用会写 prompt,零打字也能填 goal 起一个) */}
          <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
            <p className="min-w-0 text-[13px] text-muted-foreground">Not sure what to write? Otto can start one for you.</p>
            <OttoAssist
              zone="Campaign"
              entityLabel="Campaign workbench"
              formState={{ goal, start, end, budget, platforms: [...platforms] }}
              label="Ask Otto"
              intents={[
                { id: "bestseller", label: "Start one around my bestseller", prompt: "Start a campaign around my best-selling product.", reply: "Your Merdeka gift box is your proven seller — here's a pre-order launch aimed at 100 boxes. I filled the goal in for you.", apply: { summary: "Fill in a Merdeka gift-box pre-order goal", patch: { goal: "Drive pre-orders for the Merdeka gift box" } } },
                { id: "repeat", label: "Repeat what sold best last week", prompt: "Base a campaign on whatever sold best last week.", reply: "Your weekday office orders are pacing well — here's a repeat plan to defend that rhythm. Goal filled in.", apply: { summary: "Fill in a repeat office-orders goal", patch: { goal: "Repeat the weekday office orders" } } },
                { id: "winback", label: "Win back quiet customers", prompt: "Win back customers who've gone quiet.", reply: "You've got about RM5,510 of dormant value — here's a ranked win-back sequence. Goal filled in.", apply: { summary: "Fill in a win-back goal", patch: { goal: "Win back customers who haven't ordered in a while" } } },
              ]}
              onApply={(apply) => {
                const g = apply.patch.goal;
                if (typeof g === "string") {
                  setGoal(g);
                  setPhase("idle");
                  setErrors((er) => ({ ...er, goal: undefined }));
                }
              }}
            />
          </div>
          {/* 目标 */}
          <div>
            <label htmlFor="camp-goal" className="text-[13px] font-semibold text-foreground">Goal</label>
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
            <p className={cn("mt-2 text-xs font-medium", errors.goal ? "text-error-soft-foreground" : "text-muted-foreground")}>
              {errors.goal ?? "What should this campaign achieve? Otto plans everything around it."}
            </p>
          </div>

          {/* 周期 */}
          <div>
            <span className="text-[13px] font-semibold text-foreground">Period</span>
            <div className="mt-2 flex gap-3">
              <div className="flex-1">
                <label htmlFor="camp-start" className="text-xs font-medium text-muted-foreground">Start</label>
                <Input id="camp-start" type="date" value={start} readOnly={busy} onChange={(e) => { setStart(e.target.value); setErrors((er) => ({ ...er, period: undefined })); }} className="mt-1" />
              </div>
              <div className="flex-1">
                <label htmlFor="camp-end" className="text-xs font-medium text-muted-foreground">End</label>
                <Input id="camp-end" type="date" value={end} readOnly={busy} onChange={(e) => { setEnd(e.target.value); setErrors((er) => ({ ...er, period: undefined })); }} className="mt-1" />
              </div>
            </div>
            <p className={cn("mt-2 text-xs font-medium", errors.period ? "text-error-soft-foreground" : "text-muted-foreground")}>
              {errors.period ?? "A few days to a few months."}
            </p>
          </div>

          {/* 预算 */}
          <div>
            <label htmlFor="camp-budget" className="text-[13px] font-semibold text-foreground">Budget</label>
            <div className="relative mt-2">
              <Input id="camp-budget" inputMode="numeric" value={budget} readOnly={busy} onChange={(e) => { setBudget(e.target.value); setErrors((er) => ({ ...er, budget: undefined })); }} placeholder="320" aria-invalid={errors.budget ? true : undefined} className="pr-20 tabular-nums" />
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center border-l border-border pl-3 text-sm text-muted-foreground">credits</span>
            </div>
            <p className={cn("mt-2 text-xs font-medium", errors.budget ? "text-error-soft-foreground" : "text-muted-foreground")}>
              {errors.budget ?? (budgetPosts > 0
                ? `≈ about ${budgetPosts} posts (video ~40 · image ~12). Otto keeps the plan inside this cap. Your balance · ${NS_BRAND.creditBalance.toLocaleString("en-MY")} credits.`
                : `Otto keeps the plan inside this cap. Your balance · ${NS_BRAND.creditBalance.toLocaleString("en-MY")} credits.`)}
            </p>
          </div>

          {/* 平台 */}
          <div>
            <span className="text-[13px] font-semibold text-foreground">Platforms</span>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Platforms">
              {PLATFORM_KEYS.map((key) => {
                const on = platforms.has(key);
                return (
                  <button key={key} type="button" onClick={() => togglePlatform(key)} aria-pressed={on} className={cn("ns-pressable inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px]", on ? "border-transparent bg-secondary font-semibold text-foreground" : "border-border bg-card font-medium text-muted-foreground hover:text-foreground")}>
                    {on && <Check className="size-3.5" strokeWidth={2.5} />}
                    {PLATFORM_LABEL[key]}
                  </button>
                );
              })}
            </div>
            <p className={cn("mt-2 text-xs font-medium", errors.platforms ? "text-error-soft-foreground" : "text-muted-foreground")}>
              {errors.platforms ?? "Where the campaign publishes."}
            </p>
          </div>

          {/* Wave B:层级(#11)+ 频控(#26) */}
          <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <div>
              {/* [wave-b] Campaign 层级(2 层封顶) */}
              <label htmlFor="camp-theme" className="text-[13px] font-semibold text-foreground">Part of a bigger theme?</label>
              <select
                id="camp-theme"
                value={theme}
                disabled={busy}
                onChange={(e) => setTheme(e.target.value)}
                className="mt-2 h-9 w-full rounded-[10px] border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <option value="">Standalone</option>
                <option value="festive">2026 festive season</option>
                <option value="growth">Weekday growth</option>
              </select>
              <p className="mt-1.5 text-xs text-muted-foreground">Optional. Groups campaigns under one theme, two levels deep.</p>
            </div>
            <div>
              {/* [wave-b] 发送频控规则(每人每周最多 N 条) */}
              <label htmlFor="camp-freq" className="text-[13px] font-semibold text-foreground">Message cap</label>
              <div className="relative mt-2">
                <Input id="camp-freq" inputMode="numeric" value={freqCap} disabled={busy} onChange={(e) => setFreqCap(e.target.value)} className="pr-24 tabular-nums" />
                <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center border-l border-border pl-3 text-xs text-muted-foreground">/ week</span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">Keep from over-messaging: max per person each week.</p>
            </div>
          </div>

          {/* 提交行 */}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <p className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
              Starts a plan draft. Research and Otto time meter as they run, about 5 to 15 credits. Nothing is generated or published yet.
            </p>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Planning…" : "Start planning"}
            </Button>
          </div>
        </div>
      </form>

      <p className="mt-3 px-1 text-xs text-muted-foreground">
        This form and the chat entry land on the same action. Otto in chat fills the same four fields.
      </p>

      {/* Playbook 模板(#6/#12/#23/#24/#25) */}
      <section className="mt-6 rounded-[18px] border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">Or start from a playbook</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PLAYBOOKS.map((p) =>
            p.note === "coming" ? (
              <span key={p.label} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
                {p.label} <span className="font-mono text-[10px] uppercase">soon</span>
              </span>
            ) : (
              <button key={p.label} type="button" onClick={() => { setGoal(p.goal); setPhase("idle"); setErrors((er) => ({ ...er, goal: undefined })); }} className="ns-pressable inline-flex items-center rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent">
                {p.label}
              </button>
            ),
          )}
        </div>
        {/* STALL #18 冷启动诚实标注:依赖过往数据的 playbook,首次用会更空 */}
        <p className="mt-3 text-xs text-muted-foreground">
          Repeat and win-back use what past campaigns learned — they get sharper after your first campaign runs.
        </p>
      </section>

      {/* 提案 ready 卡 */}
      {phase === "ready" && (
        <div className="mt-6 flex flex-col gap-4 rounded-[18px] border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <OttoAvatar size={26} mood="helpful" />
            <div className="min-w-0">
              <div className="text-lg font-semibold tracking-[-0.012em] text-foreground">Proposal ready</div>
              <p className="text-sm text-muted-foreground">
                {deriveCampaignName(goal)} · {NS_CAMPAIGN_ENTRIES.length} posts · estimated {fmtCredits(CAMPAIGN_TOTAL_EST)}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-[14px] bg-secondary/70 px-4 py-3">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              Backup ideas that didn&apos;t make the calendar are saved in your{" "}
              <Link href={`${BASE}/create/ideas`} className="font-semibold text-foreground underline-offset-2 hover:underline">Ideas list</Link>.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href={`${BASE}/campaign/proposal-card`}>Open proposal card</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`${BASE}/campaign/calendar`}>
                <CalendarRange strokeWidth={2} />
                Review in calendar
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* 已有 campaign 快捷回容器 */}
      <div className="mt-6 flex flex-wrap gap-2">
        {NS_CAMPAIGNS.map((c) => (
          <Link key={c.id} href={`${BASE}/campaign/detail?id=${c.id}`} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            {c.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
