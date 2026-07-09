"use client";

/**
 * 规则 —— when → then 的自动化。花额度的规则用 coral 小点提示(§O:coral = Otto 会干活),
 * 只回复/安排的不带 coral。§F7 即时开关(花钱的规则关时不确认,开时才是花钱动作 → 这里
 * 开关只是「启用规则」,真正花钱仍走每次的审批,故即时生效安全)。
 * 交叉链接:规则命中的动作 → schedule / inbox;想要更长的动作序列 → routines。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Lock, Plus, Sparkles } from "lucide-react";
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
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { PageHeader } from "@/components/northstar/_shared";
import { addRule, aiHandledCount, rules, toggleAutomationRule, useStore } from "../_store";
import { ACCOUNT_OPS_BASE as BASE, AutomationNav, Card } from "./kit";
import { type NsRule } from "./data";

/** 平台铁律(宪法硬约束:不可关、不可配,与下方可配置规则视觉分区)。
 * 这些永远优先于任何自定义规则 —— 人插手即停、勿扰名单、花钱先审。 */
const IRON_LAWS: { title: string; detail: string }[] = [
  {
    title: "You reply, Otto steps back",
    detail: "The moment you type in a chat, Otto stops auto-answering that person until you hand it back.",
  },
  {
    title: "The do-not-disturb list is never messaged",
    detail: "Anyone you mark do-not-disturb is off-limits to every rule and routine — no exceptions.",
  },
  {
    title: "Nothing spends or publishes on its own",
    detail: "Any action that costs credits or posts publicly waits for a person to approve it.",
  },
];

/** 「Draft a rule」按钮的预填(照 Otto 的建议条口径,让草稿看起来像真的从建议来的) */
const OTTO_DRAFT: RuleDraft = {
  name: "Answer order questions",
  when: "A new WhatsApp chat asks about pricing or pickup",
  then: "Otto drafts a reply and waits for your tap to send",
};

interface RuleDraft {
  name: string;
  when: string;
  then: string;
}

function RuleCard({
  rule,
  runs,
  onToggle,
}: {
  rule: NsRule;
  runs: number;
  onToggle: (v: boolean) => void;
}) {
  const enabled = rule.enabled;
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
          {enabled ? `Ran ${runs}× this week` : "Paused"}
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
  useStore();
  const list = rules();
  const aiHandled = aiHandledCount();

  const [draft, setDraft] = React.useState<RuleDraft | null>(null);
  const canSave = draft ? draft.name.trim() && draft.when.trim() && draft.then.trim() : false;

  const save = () => {
    if (!draft || !canSave) return;
    addRule({ name: draft.name.trim(), when: draft.when.trim(), then: draft.then.trim() });
    setDraft(null);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Automation"
        subtitle="Small rules that run themselves. Anything that spends still waits for your tap."
        actions={
          <>
            <AutomationNav />
            <Button size="sm" onClick={() => setDraft({ name: "", when: "", then: "" })}>
              <Plus strokeWidth={2} />
              New rule
            </Button>
          </>
        }
      />

      {/* 平台铁律区(硬约束,不可关;与下方可配置规则视觉区分:locked 框 + Always on 标) */}
      <section className="mt-6 rounded-[18px] border border-border bg-secondary/40" aria-label="Platform rules">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Lock className="size-4 text-muted-foreground" strokeWidth={2} />
          <h2 className="text-sm font-semibold text-foreground">Platform rules</h2>
          <span className="ml-auto inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
            Always on
          </span>
        </div>
        <ul className="divide-y divide-border">
          {IRON_LAWS.map((law) => (
            <li key={law.title} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary">
                <Lock className="size-3 text-muted-foreground" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] leading-[18px] font-semibold text-foreground">{law.title}</p>
                <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{law.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Otto 建议条(本屏唯一 coral statement;「Draft a rule」预填 Otto 建议进创建弹窗) */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-[18px] border border-brand-soft bg-brand-soft/50 px-4 py-3.5">
        <OttoAvatar size={28} mood="helpful" />
        <p className="min-w-0 flex-1 basis-64 text-[13px] leading-[1.45] text-brand-soft-foreground">
          You reply to most WhatsApp order questions the same way. Want a rule for that?
        </p>
        <Button variant="brand" size="sm" onClick={() => setDraft({ ...OTTO_DRAFT })}>
          <Sparkles strokeWidth={2} />
          Draft a rule
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3">
        {list.map((r) => (
          <RuleCard
            key={r.id}
            rule={r}
            runs={r.runsFromChats ? aiHandled : r.runsThisWeek}
            onToggle={(v) => toggleAutomationRule(r.id, v)}
          />
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Want a multi-step sequence instead of one rule? Set up a{" "}
        <Link href={`${BASE}/automation/routines`} className="font-semibold text-foreground hover:underline">
          routine
        </Link>
        .
      </p>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New rule</DialogTitle>
            <DialogDescription>
              One trigger, one action. Otto runs it for you. Anything that spends still waits for your tap.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">Name</span>
              <input
                type="text"
                value={draft?.name ?? ""}
                onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                placeholder="Answer order questions"
                className="h-11 w-full rounded-[10px] border border-border bg-background px-3.5 text-[15px] leading-[22px] text-foreground outline-none transition-colors duration-[120ms] placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">When</span>
              <input
                type="text"
                value={draft?.when ?? ""}
                onChange={(e) => setDraft((d) => (d ? { ...d, when: e.target.value } : d))}
                placeholder="A new WhatsApp chat asks about pricing"
                className="h-11 w-full rounded-[10px] border border-border bg-background px-3.5 text-[15px] leading-[22px] text-foreground outline-none transition-colors duration-[120ms] placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">Then</span>
              <input
                type="text"
                value={draft?.then ?? ""}
                onChange={(e) => setDraft((d) => (d ? { ...d, then: e.target.value } : d))}
                placeholder="Otto drafts a reply and waits for your tap"
                className="h-11 w-full rounded-[10px] border border-border bg-background px-3.5 text-[15px] leading-[22px] text-foreground outline-none transition-colors duration-[120ms] placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canSave} onClick={save}>
              Create rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
