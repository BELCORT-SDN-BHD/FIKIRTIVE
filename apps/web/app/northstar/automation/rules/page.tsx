/* @nsPage district="自动化区" page="rules" status="draft"
   sources="O-09 判决(分域);宪法 7 builder 分域;判决 7-8/7-9;N-20" approvedAt="" pr="" */
"use client";

/**
 * 规则文件编辑器 — 人看得懂、改得动的规则文件 + 开关(O-09 人工面)。
 * 清单要件:规则文件列表、可读规则文本、启停开关、勿扰名单硬约束提示、
 *           人插手即停原则、营业时间对象(N-20 纳入)。
 *
 * 不做节点画布(宪法 7 builder 分域):规则是一份读起来像话的文件,
 * 三种子句 trigger / action / guard,guard 是永不越界的硬约束。
 *
 * Otto 在场:这是「人工面」——规则是用户自己的设置,coral 只在 dock。
 *  开关是人的动作(§F7:checked = INK,永不 coral);翻页零静态 coral。
 * 布局:List archetype 的 list+detail(§L2),≤900 折成单列。
 */

import * as React from "react";
import Link from "next/link";
import {
  BellOff,
  CircleAlert,
  Clock,
  Hand,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  BUSINESS_HOURS,
  DO_NOT_DISTURB,
  RULE_FILES,
  RULES_LAND_STEPS,
  type RuleClause,
  type RuleFile,
  type RuleStatus,
} from "@/components/northstar/automation/_data";

const CLAUSE_META: Record<
  RuleClause["kind"],
  { label: string; icon: typeof Zap; tone: "trigger" | "action" | "guard" }
> = {
  trigger: { label: "When", icon: Zap, tone: "trigger" },
  action: { label: "Otto does", icon: Sparkles, tone: "action" },
  guard: { label: "Never", icon: ShieldCheck, tone: "guard" },
};

function ClauseRow({ clause }: { clause: RuleClause }) {
  const meta = CLAUSE_META[clause.kind];
  const Icon = meta.icon;
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg",
          meta.tone === "guard" ? "bg-warning-soft text-warning-soft-foreground" : "bg-secondary text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="mr-1.5 font-mono text-[10px] leading-none font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {meta.label}
        </span>
        <span className="text-[13px] leading-[19px] text-foreground">{clause.text}</span>
      </span>
    </li>
  );
}

function RuleListItem({
  rule,
  active,
  onSelect,
}: {
  rule: RuleFile;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-1 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-[120ms]",
        active ? "bg-secondary" : "hover:bg-accent",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{rule.name}</span>
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", rule.status === "on" ? "bg-success" : "bg-muted-foreground/40")}
        />
        <span className="sr-only">{rule.status === "on" ? "On" : "Off"}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="truncate text-xs text-muted-foreground">{rule.channels.join(" · ")}</span>
        {rule.hardConstraint && (
          <BellOff className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} aria-label="Respects do-not-disturb" />
        )}
      </span>
    </button>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("default");
  const [landed, setLanded] = React.useState(false);
  const [rules, setRules] = React.useState<RuleFile[]>(() => RULE_FILES.map((r) => ({ ...r })));
  const [selectedId, setSelectedId] = React.useState<string>(RULE_FILES[0]!.id);

  const isLoading = demo === "loading";
  const isEmpty = demo === "empty";
  const isError = demo === "error";
  const show = landed && !isLoading && !isEmpty && !isError;

  const selected = rules.find((r) => r.id === selectedId) ?? rules[0] ?? null;

  function setStatus(id: string, status: RuleStatus) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  }

  const onCount = rules.filter((r) => r.status === "on").length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Rules"
        subtitle="How Otto handles messages on its own. Written in plain words, yours to change."
        meta={["Human panel"]}
        actions={
          <Button size="sm" disabled={!show}>
            <Plus strokeWidth={2} />
            New rule
          </Button>
        }
      />

      {/* 数据一行(§D3) */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Rules on" value={show ? `${onCount}/${rules.length}` : "—"} />
        <StatCard label="Replied this week" value={show ? "63" : "—"} delta={{ dir: "flat", text: "across 3 channels" }} />
        <StatCard label="Do-not-disturb" value={show ? String(DO_NOT_DISTURB.length) : "—"} delta={{ dir: "flat", text: "always skipped" }} />
        <StatCard label="Active routines" value={String(AUTOMATION_SUMMARY.activeRoutines)} delta={{ dir: "flat", text: "in Routines" }} />
      </div>

      {/* 人插手即停原则 —— 一条恒真的告示条(§FB2 inline,info 语气) */}
      <div className="mt-6 flex items-start gap-3 rounded-[14px] border border-border bg-info-soft/50 px-4 py-3">
        <Hand className="mt-0.5 size-4 shrink-0 text-info-soft-foreground" strokeWidth={2} />
        <p className="text-[13px] leading-[19px] text-foreground">
          The moment you reply in a chat, Otto steps back for that person. Automation never talks over you.
        </p>
      </div>

      {/* 工具行:叙述条 */}
      <div className="mt-6 flex items-center gap-3">
        <p className="text-xs text-muted-foreground">
          Turning a rule off takes effect right away. No save needed.
        </p>
        <div className="flex-1" />
        {!landed && !isEmpty && !isError && (
          <OttoNarrationBar key="landing" steps={RULES_LAND_STEPS} stepMs={1100} onSettle={() => setLanded(true)} />
        )}
      </div>

      {/* 主体 */}
      <div className="mt-4">
        {isError ? (
          <div className="rounded-[var(--radius-card)] border border-border bg-card">
            <InlineError text="Couldn't load your rules. Try again." onRetry={() => setDemo("default")} />
          </div>
        ) : isEmpty ? (
          <div className="flex rounded-[var(--radius-card)] border border-border bg-card">
            <EmptyState
              icon={MessageSquare}
              title="No rules yet"
              body="Add a rule or ask Otto to set up a friendly auto-reply for new orders."
              action={
                <Button size="sm">
                  <Plus strokeWidth={2} />
                  New rule
                </Button>
              }
            />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
            {/* 左:规则文件列表 */}
            <div className="rounded-[var(--radius-card)] border border-border bg-card p-2">
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  Rule files
                </span>
                <span className="font-mono text-[10px] leading-none font-medium text-muted-foreground tabular-nums">
                  {rules.length}
                </span>
              </div>
              {!show ? (
                <div className="flex flex-col gap-1.5 p-1">
                  <SkeletonBlock className="h-12 w-full" />
                  <SkeletonBlock className="h-12 w-full" />
                  <SkeletonBlock className="h-12 w-full" shimmer={false} />
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {rules.map((r, i) => (
                    <Landed key={r.id} delayMs={(i % 5) * 60}>
                      <RuleListItem rule={r} active={selected?.id === r.id} onSelect={() => setSelectedId(r.id)} />
                    </Landed>
                  ))}
                </div>
              )}
            </div>

            {/* 右:可读规则文本 + 开关 */}
            <div className="flex flex-col gap-4">
              {!show ? (
                <div className="rounded-[var(--radius-card)] border border-border bg-card p-6">
                  <SkeletonBlock className="h-6 w-48" />
                  <SkeletonBlock className="mt-4 h-4 w-full" />
                  <SkeletonBlock className="mt-2 h-4 w-3/4" shimmer={false} />
                </div>
              ) : selected ? (
                <Landed key={selected.id}>
                  <article className="rounded-[var(--radius-card)] border border-border bg-card">
                    {/* 头:名称 + 启停开关(人的动作 → INK) */}
                    <div className="flex flex-wrap items-start gap-3 border-b border-border p-5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h2 className="text-lg font-semibold text-foreground">{selected.name}</h2>
                          <Badge variant={selected.status === "on" ? "success" : "outline"}>
                            {selected.status === "on" ? "On" : "Off"}
                          </Badge>
                        </div>
                        <p className="mt-1 max-w-[560px] text-[13px] leading-[19px] text-muted-foreground">
                          {selected.summary}
                        </p>
                      </div>
                      <label className="flex shrink-0 items-center gap-2.5">
                        <span className="text-[13px] font-medium text-foreground">
                          {selected.status === "on" ? "Running" : "Paused"}
                        </span>
                        <Switch
                          checked={selected.status === "on"}
                          onCheckedChange={(v) => setStatus(selected.id, v ? "on" : "off")}
                          aria-label={`Turn ${selected.name} ${selected.status === "on" ? "off" : "on"}`}
                        />
                      </label>
                    </div>

                    {/* 体:可读规则文本(三种子句) */}
                    <div className="p-5">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-4">
                        <span className="text-xs text-muted-foreground">
                          Channels · <span className="text-foreground">{selected.channels.join(", ")}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          This week ·{" "}
                          <span className="tabular-nums text-foreground">{selected.firedThisWeek} times</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Last ·{" "}
                          <span className="text-foreground">{selected.lastFiredAt ?? "not yet"}</span>
                        </span>
                      </div>
                      <ul className="flex flex-col gap-3 border-t border-border pt-4">
                        {selected.clauses.map((c, i) => (
                          <ClauseRow key={i} clause={c} />
                        ))}
                      </ul>
                    </div>

                    {/* 硬约束提示:碰勿扰名单的规则 */}
                    {selected.hardConstraint && (
                      <div className="flex items-start gap-3 border-t border-border bg-warning-soft/40 p-5">
                        <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-soft-foreground" strokeWidth={2} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-foreground">Respects your do-not-disturb list</p>
                          <p className="mt-0.5 text-[13px] leading-[19px] text-muted-foreground">
                            {DO_NOT_DISTURB.length} people are set to only hear from you. This rule always skips them.
                            You can't turn that off. It's a hard limit.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* 页脚动作(人工面:编辑/删除是人的事,非 spend) */}
                    <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
                      <Button variant="secondary" size="sm" disabled>
                        Edit rule
                      </Button>
                    </div>
                  </article>
                </Landed>
              ) : null}

              {/* 营业时间对象(N-20)—— after-hours 规则的依据,读出来给人看 */}
              {show && (
                <Landed delayMs={120}>
                  <section className="rounded-[var(--radius-card)] border border-border bg-card p-5">
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 text-muted-foreground" strokeWidth={2} />
                      <h3 className="text-sm font-semibold text-foreground">Business hours</h3>
                      <span className="ml-auto font-mono text-[10px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        {BUSINESS_HOURS.timezone}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The after-hours rule reads these. Change them here and every rule follows.
                    </p>
                    <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                      {BUSINESS_HOURS.days.map((d) => (
                        <div key={d.day} className="flex items-center justify-between border-t border-border pt-2">
                          <dt className="text-[13px] font-medium text-foreground">{d.day}</dt>
                          <dd className="font-mono text-xs tabular-nums text-muted-foreground">
                            {d.open ? `${d.open}–${d.close}` : "Closed"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                </Landed>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部:去 Routine 管理面的桥(自动化区两页互链) */}
      <div className="mt-8 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-border p-5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Looking for scheduled work?</p>
          <p className="mt-0.5 max-w-[560px] text-[13px] leading-[19px] text-muted-foreground">
            Rules react to messages. Routines are standing jobs Otto runs on a schedule, each with a budget cap and a
            kill switch.
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href="/northstar/automation/routines">Open Routines</Link>
        </Button>
      </div>

      <MockNote path="/northstar/automation/rules" />
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
