"use client";

/**
 * Campaign 提案卡(聊天内)—— Otto 交出的是一份**策略级**整案,不是氛围标题清单。
 * 研究叙述条(带来源)→ CAMPAIGN_CARD 落地(§8b + sweep)→ 逐条改/删/Approve($0) → pack-confirm。
 *
 * Wave C 内容工程(GOOSEWORKS-MAP §一 工具4 + 金标准 REFERENCE-PROPOSAL-MERDEKA.md):
 *   提案头 = 战略洞察 + 目标 + 预期产出(上期系数派生模型)+ 产能闸门 + 受众表 + 「别做这个」;
 *   每条 entry = 受众 × 角度 × 明价/CTA × KPI(带判决门槛) × 建议时段 × 产能约束 × role;
 *   learnings 逐条落点(反哺循环兑现,含补回的 FB B2B 帖)。goal 换模板 → 换整套帖(复购/唤回/新客)。
 *   空态(删空)从死文案换成一颗真「Otto 帮我」(§O7,STALL #44)。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto(叙述条/落卡 sweep);credits 永远是 credits。
 */

import * as React from "react";
import Link from "next/link";
import { MessageSquareText, Pencil, TrendingUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import { NS_CAMPAIGN, type NsCampaignEntry } from "@/components/northstar/_mock";
import {
  BACKUP_IDEAS,
  entryStrategy,
  resolveCampaignTemplate,
  trendById,
  type CampaignEntryStrategy,
} from "@/components/northstar/campaign/_data";
import { applyCampaignTemplate, campaignDraft, campaignEntries, deriveCampaignName, removeCampaignEntry, updateCampaignEntry, useStore } from "../_store";
import { OttoAssist } from "../otto-assist";
import { CAMP_BASE as BASE, Landed, PlatformPill, RoleBadge, SkeletonBlock, fmtCredits, fmtDay } from "./kit";

const RESEARCH_STEPS = [
  "Checking your trend archive…",
  "Searching Merdeka week trends…",
  "Reading last campaign's results…",
  "Drafting the strategy…",
] as const;
const PREPARE_STEPS = ["Laying generation cards…", "Estimating the pack…"] as const;

type Phase = "researching" | "proposed" | "approved" | "preparing" | "prepared";

/** 一行「标签 · 值」(策略元;标签 muted,值 foreground)。 */
function MetaLine({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex gap-2 text-[13px] leading-[18px]">
      <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1", accent ? "font-medium text-foreground" : "text-foreground")}>{value}</span>
    </div>
  );
}

/** 一条 entry 的策略卡(hook 读 store,机制读策略层)。 */
function StrategyRow({
  entry,
  strat,
  editing,
  hookDraft,
  approved,
  onStartEdit,
  onChangeHook,
  onCommit,
  onCancel,
  onRemove,
}: {
  entry: NsCampaignEntry;
  strat?: CampaignEntryStrategy;
  editing: boolean;
  hookDraft: string;
  approved: boolean;
  onStartEdit: () => void;
  onChangeHook: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">{fmtDay(entry.date)}</span>
        <PlatformPill platform={entry.platform} />
        {strat && <RoleBadge role={strat.role} />}
        <span className="flex-1" />
        <span className="shrink-0 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">{entry.estCredits} cr</span>
        {!approved && (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <button type="button" aria-label={`Edit ${entry.hook}`} onClick={onStartEdit} className="ns-pressable flex size-6 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"><Pencil className="size-3.5" strokeWidth={2} /></button>
            <button type="button" aria-label={`Remove ${entry.hook}`} onClick={onRemove} className="ns-pressable flex size-6 items-center justify-center rounded-lg text-muted-foreground hover:text-error-soft-foreground"><X className="size-3.5" strokeWidth={2} /></button>
          </span>
        )}
      </div>

      {editing ? (
        <input
          autoFocus
          value={hookDraft}
          onChange={(ev) => onChangeHook(ev.target.value)}
          onBlur={onCommit}
          onKeyDown={(ev) => { if (ev.key === "Enter") onCommit(); if (ev.key === "Escape") onCancel(); }}
          aria-label="Edit hook"
          className="mt-2 h-8 w-full rounded-lg border border-input bg-card px-2 text-sm font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
        />
      ) : (
        <p className="mt-2 text-sm font-semibold tracking-[-0.006em] text-foreground">{entry.hook}</p>
      )}

      {strat && (
        <div className="mt-2.5 flex flex-col gap-1.5 rounded-[12px] bg-secondary/50 px-3 py-2.5">
          <MetaLine label="For" value={strat.segment} />
          <MetaLine label="Angle" value={strat.angle} />
          <MetaLine label="Offer" value={strat.offer} accent />
          <MetaLine label="Do" value={strat.cta} accent />
          <MetaLine label="KPI" value={strat.kpi} />
          <MetaLine label="Post" value={strat.suggestedTime} />
          {strat.learningRef && (
            <div className="mt-0.5 flex gap-2 text-[12px] leading-[16px]">
              <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">From</span>
              <span className="min-w-0 flex-1 text-muted-foreground">{strat.learningRef}</span>
            </div>
          )}
          {strat.capacityNote && (
            <div className="mt-0.5 flex gap-2 rounded-[8px] bg-warning-soft px-2 py-1 text-[12px] leading-[16px]">
              <span className="min-w-0 flex-1 text-warning-soft-foreground">{strat.capacityNote}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CampaignProposal() {
  useStore();
  const [phase, setPhase] = React.useState<Phase>("researching");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [hookDraft, setHookDraft] = React.useState("");

  const entries: NsCampaignEntry[] = campaignEntries();
  const draft = campaignDraft();
  const template = resolveCampaignTemplate(draft?.goal);
  const strategy = template.strategy;

  const goalText = draft?.goal ?? NS_CAMPAIGN.goal;
  const campaignName = draft ? deriveCampaignName(draft.goal) : NS_CAMPAIGN.name;
  const periodText = draft ? `${fmtDay(draft.start)} to ${fmtDay(draft.end)}, 2026` : "Aug 24 to 31, 2026";
  const budgetCredits = draft?.budgetCredits ?? NS_CAMPAIGN.budgetCredits;
  const draftPlatforms = (draft?.platforms as NsCampaignEntry["platform"][] | undefined) ?? ["instagram", "facebook", "tiktok"];

  const total = entries.reduce((s, e) => s + e.estCredits, 0);
  const cardVisible = phase !== "researching";
  const approved = phase === "approved" || phase === "preparing" || phase === "prepared";
  const exp = strategy.expectedOutput;
  // 引用的 trend(默认新客模板引 ts-01/ts-02;其它模板引各自 learnings 内的来源不再拉 trend chip)
  const trendChipIds = template.key === "new-customer" ? ["ts-01", "ts-02"] : [];

  function startEdit(e: NsCampaignEntry) {
    setEditingId(e.id);
    setHookDraft(e.hook);
  }
  function commitEdit() {
    if (editingId == null) return;
    if (hookDraft.trim()) updateCampaignEntry(editingId, { hook: hookDraft.trim() });
    setEditingId(null);
  }
  function removeEntry(id: string) {
    removeCampaignEntry(id);
    if (editingId === id) setEditingId(null);
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Campaign plan"
        subtitle="Otto drafts a full strategy — audience, offer, CTA and a decision KPI per post. Review, edit or remove any post, then approve."
        meta={[campaignName, template.label]}
      />

      <div className="mt-6 flex flex-col gap-4" role="log" aria-label="Chat excerpt">
        <div className="flex justify-end">
          <div className="max-w-[75%] rounded-[18px] rounded-br-[8px] bg-secondary px-4 py-3 text-[15px] leading-[22px] text-foreground">
            {goalText}
          </div>
        </div>

        <div className="flex items-start gap-3">
          <OttoAvatar size={26} mood={cardVisible ? "helpful" : "thinking"} className="mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            {cardVisible ? (
              <div className="max-w-[80%] rounded-[18px] rounded-bl-[8px] border border-border bg-card px-4 py-3 text-[15px] leading-[22px] text-foreground">
                {strategy.insight}
              </div>
            ) : (
              <div className="flex max-w-[80%] flex-col gap-2">
                <SkeletonBlock className="h-10 w-3/4" />
                <SkeletonBlock className="h-40 w-full" shimmer={false} />
              </div>
            )}

            {phase === "researching" && (
              <OttoNarrationBar key="research" steps={RESEARCH_STEPS} stepMs={1200} counter onSettle={() => setPhase("proposed")} className="mt-3 w-fit" />
            )}

            {cardVisible && (
              <Landed sweep className="mt-3 max-w-[520px] rounded-[18px]">
                <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-[var(--shadow-sm)]">
                  {/* 头 */}
                  <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Campaign strategy · {template.label}</div>
                      <div className="truncate text-lg font-semibold tracking-[-0.012em] text-foreground">{campaignName}</div>
                    </div>
                    {approved ? <Badge variant="success">Approved</Badge> : <Badge variant="warning">Awaiting your approval</Badge>}
                  </div>

                  {/* 目标 + 元 */}
                  <div className="border-b border-border px-5 py-4">
                    <div className="text-xs font-medium text-muted-foreground">Objective</div>
                    <p className="mt-1 text-[13px] leading-[18px] text-foreground">{strategy.objective}</p>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                      <div><div className="text-xs font-medium text-muted-foreground">Period</div><div className="mt-0.5 text-sm text-foreground">{periodText}</div></div>
                      <div><div className="text-xs font-medium text-muted-foreground">Budget cap</div><div className="mt-0.5 text-sm text-foreground tabular-nums">{fmtCredits(budgetCredits)}</div></div>
                      <div className="col-span-2">
                        <div className="text-xs font-medium text-muted-foreground">Platforms</div>
                        <div className="mt-1 flex flex-wrap gap-1">{draftPlatforms.map((p) => <PlatformPill key={p} platform={p} full />)}</div>
                      </div>
                    </div>
                  </div>

                  {/* 预期产出(估算模型,非拍脑袋) */}
                  <div className="border-b border-border bg-secondary/40 px-5 py-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="size-4 text-muted-foreground" strokeWidth={2} />
                      <span className="text-sm font-semibold text-foreground">Expected output</span>
                      <span className="flex-1" />
                      {exp.confidence === "high" && <Badge variant="success">High confidence</Badge>}
                      {exp.confidence === "medium" && <Badge variant="warning">Medium confidence</Badge>}
                      {exp.confidence === "low" && <Badge variant="outline">Low confidence</Badge>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-foreground tabular-nums">
                      <span className="font-semibold">{exp.targetOrders} orders</span>
                      <span>{exp.revenue}</span>
                      <span>{exp.cpaTarget}</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-[16px] text-muted-foreground"><span className="font-medium text-foreground">Basis:</span> {exp.basis}</p>
                    <p className="mt-1 text-[12px] leading-[16px] text-muted-foreground"><span className="font-medium text-foreground">Assumption:</span> {exp.condition}</p>
                  </div>

                  {/* 趋势来源(新客模板;Otto 不捏造 trend) */}
                  {trendChipIds.length > 0 && (
                    <div className="border-b border-border px-5 py-3">
                      <div className="text-xs font-medium text-muted-foreground">Trend evidence</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {trendChipIds.map((id) => {
                          const t = trendById(id);
                          if (!t) return null;
                          return (
                            <Link key={id} href={`${BASE}/campaign/trends`} className="ns-pressable inline-flex h-6 max-w-full items-center gap-1 truncate rounded-full border border-border bg-card px-2 font-mono text-[10px] font-medium text-muted-foreground hover:text-foreground">
                              {t.sources[0]?.domain} · {t.capturedAt}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 内容日历(逐条策略) */}
                  <div className="divide-y divide-border border-b border-border">
                    {entries.map((e) => (
                      <StrategyRow
                        key={e.id}
                        entry={e}
                        strat={entryStrategy(e.id)}
                        editing={editingId === e.id}
                        hookDraft={hookDraft}
                        approved={approved}
                        onStartEdit={() => startEdit(e)}
                        onChangeHook={setHookDraft}
                        onCommit={commitEdit}
                        onCancel={() => setEditingId(null)}
                        onRemove={() => removeEntry(e.id)}
                      />
                    ))}
                    {entries.length === 0 && (
                      <div className="flex flex-wrap items-center gap-3 px-5 py-5">
                        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">Every post was removed. Ask Otto to redraft the plan.</p>
                        <OttoAssist
                          zone="Campaign"
                          entityLabel={campaignName}
                          formState={{ goal: goalText, template: template.key }}
                          label="Redraft with Otto"
                          intents={[
                            { id: "redraft", label: "Redraft the whole plan", prompt: `Redraft the ${template.label} plan for "${goalText}".`, reply: `On it — here's a fresh ${template.label} plan for "${goalText}". Apply it to bring the posts back.`, apply: { summary: `Restore the ${template.label} plan`, patch: { redraft: true } } },
                          ]}
                          onApply={() => applyCampaignTemplate(goalText)}
                        />
                      </div>
                    )}
                  </div>

                  {/* learnings 逐条落点(反哺循环兑现) */}
                  <div className="border-b border-border px-5 py-4">
                    <div className="text-xs font-medium text-muted-foreground">What last time taught us — and where it lands</div>
                    <ul className="mt-2 flex flex-col gap-2">
                      {strategy.learningsApplied.map((l) => (
                        <li key={l.learning} className="text-[13px] leading-[18px]">
                          <span className="text-foreground">{l.learning}</span>
                          <span className="mt-0.5 block text-[12px] text-muted-foreground">→ {l.landsOn}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* 产能闸门(卖实物战役的命门:stop/pause 门槛) */}
                  <div className="border-b border-border px-5 py-4">
                    <div className="text-xs font-medium text-muted-foreground">Capacity guardrails</div>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {strategy.guardrails.map((g, i) => (
                        <li key={i} className="flex gap-2 text-[13px] leading-[18px] text-foreground">
                          <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                          <span className="min-w-0 flex-1">{g}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* 受众表 + 「别做这个」(disclosure,避免压垮首屏) */}
                  <details className="border-b border-border">
                    <summary className="ns-pressable flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-semibold text-foreground hover:bg-accent">
                      Who it&apos;s for &amp; what we&apos;re not doing
                    </summary>
                    <div className="px-5 pb-4">
                      <ul className="flex flex-col gap-2.5">
                        {strategy.audiences.map((a) => (
                          <li key={a.segment} className="text-[13px] leading-[18px]">
                            <span className="font-medium text-foreground">{a.segment}</span>
                            <span className="mt-0.5 block text-muted-foreground">{a.jtbd} — {a.route}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 text-xs font-medium text-muted-foreground">What we&apos;re NOT doing</div>
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {strategy.notDoing.map((n, i) => (
                          <li key={i} className="flex gap-2 text-[13px] leading-[18px] text-foreground">
                            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-error/50" />
                            <span className="min-w-0 flex-1">{n}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>

                  <div className="border-b border-border px-5 py-3">
                    <p className="text-xs text-muted-foreground">
                      {BACKUP_IDEAS.length} backup ideas saved to your{" "}
                      <Link href={`${BASE}/create/ideas`} className="ns-human-text font-semibold underline-offset-2 hover:underline">Ideas list</Link>.
                    </p>
                  </div>

                  {/* 底:总价 + Approve */}
                  <div className="flex flex-wrap items-center gap-3 bg-secondary/40 px-5 py-4">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground tabular-nums">Estimated total · {fmtCredits(total)}</div>
                      <div className="text-xs text-muted-foreground">Display estimate. No charge until you confirm each generation.</div>
                    </div>
                    <div className="flex-1" />
                    {!approved ? (
                      <>
                        <Button asChild variant="ghost" size="sm"><Link href={`${BASE}/campaign/calendar`}>Open in calendar</Link></Button>
                        <Button size="sm" onClick={() => setPhase("approved")} disabled={entries.length === 0}>Approve plan</Button>
                      </>
                    ) : (
                      <Badge variant="success">Plan approved</Badge>
                    )}
                  </div>
                </div>
              </Landed>
            )}

            {phase === "approved" && (
              <div className="mt-3">
                <OttoNarrationBar key="prepare" steps={PREPARE_STEPS} stepMs={1300} onSettle={() => setPhase("prepared")} className="w-fit" />
              </div>
            )}
            {phase === "prepared" && (
              <Landed className="mt-3 max-w-[480px] rounded-[14px]">
                <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
                  <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground">
                    {entries.length} generation cards are ready. One nod covers the whole batch at pack confirm.
                  </p>
                  <Button asChild size="sm"><Link href={`${BASE}/campaign/pack-confirm`}>Review pack</Link></Button>
                </div>
              </Landed>
            )}
          </div>
        </div>

        {entries.length === 0 && phase === "proposed" && (
          <EmptyState icon={MessageSquareText} title="No posts left in this plan" body="Ask Otto to redraft, or start again from the workbench." action={<Button asChild size="sm"><Link href={`${BASE}/campaign/workbench`}>Open workbench</Link></Button>} />
        )}
      </div>
    </div>
  );
}
