"use client";

/**
 * Campaign 提案卡(聊天内)—— Otto 交出的整案:主题/目标/跨度/节奏 + N 条内容日历。
 * 研究叙述条(带来源,不捏造 trend)→ CAMPAIGN_CARD 落地(§8b + sweep)→ 逐条改/删/Approve($0)
 * → PREPARE_STEPS → pack-confirm(卡→钱定律:花钱在打包确认)。
 * Wave B:#27 上期真实表现反哺(rationale 带「Last time」引用 Raya learnings)。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto(叙述条/落卡 sweep);credits 永远是 credits。
 */

import * as React from "react";
import Link from "next/link";
import { MessageSquareText, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import { NS_CAMPAIGN, type NsCampaignEntry } from "@/components/northstar/_mock";
import { BACKUP_IDEAS, PROPOSAL_RATIONALE, trendById } from "@/components/northstar/campaign/_data";
import { campaignDraft, campaignEntries, deriveCampaignName, removeCampaignEntry, updateCampaignEntry, useStore } from "../_store";
import { CAMP_BASE as BASE, Landed, PlatformPill, SkeletonBlock, fmtCredits, fmtDay } from "./kit";

const RESEARCH_STEPS = [
  "Checking your trend archive…",
  "Searching Merdeka week trends…",
  "Reading last campaign's results…",
  "Drafting the proposal…",
] as const;
const PREPARE_STEPS = ["Laying generation cards…", "Estimating the pack…"] as const;

type Phase = "researching" | "proposed" | "approved" | "preparing" | "prepared";

export function CampaignProposal() {
  useStore();
  const [phase, setPhase] = React.useState<Phase>("researching");
  // 只留输入框草稿态(editingId + hookDraft);改/删的事实一律经 store,pack-confirm 同源。
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [hookDraft, setHookDraft] = React.useState("");

  const entries: NsCampaignEntry[] = campaignEntries();

  const draft = campaignDraft();
  const goalText = draft?.goal ?? NS_CAMPAIGN.goal;
  // 标题按 draft.goal 派生(从 Deepavali/CNY/自填目标起草不再误标 Merdeka)。
  const campaignName = draft ? deriveCampaignName(draft.goal) : NS_CAMPAIGN.name;
  const periodText = draft ? `${fmtDay(draft.start)} to ${fmtDay(draft.end)}, 2026` : "Aug 24 to 31, 2026";
  const budgetCredits = draft?.budgetCredits ?? NS_CAMPAIGN.budgetCredits;
  const draftPlatforms = (draft?.platforms as NsCampaignEntry["platform"][] | undefined) ?? ["instagram", "facebook", "tiktok"];

  const total = entries.reduce((s, e) => s + e.estCredits, 0);
  const cardVisible = phase !== "researching";
  const approved = phase === "approved" || phase === "preparing" || phase === "prepared";

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
        subtitle="Otto drafts the whole month. Review, edit or remove any post, then approve."
        meta={[campaignName]}
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
                I checked what&apos;s working for Merdeka week and looked back at your Raya results, then drafted a full plan
                around the gift box. Review it below — edit or remove any post before approving.
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
              <Landed sweep className="mt-3 max-w-[480px] rounded-[18px]">
                <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-[var(--shadow-sm)]">
                  <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Campaign proposal</div>
                      <div className="truncate text-lg font-semibold tracking-[-0.012em] text-foreground">{campaignName}</div>
                    </div>
                    {approved ? <Badge variant="success">Approved</Badge> : <Badge variant="warning">Awaiting your approval</Badge>}
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4">
                    <div><div className="text-xs font-medium text-muted-foreground">Goal</div><div className="mt-0.5 text-sm text-foreground">{goalText}</div></div>
                    <div><div className="text-xs font-medium text-muted-foreground">Period</div><div className="mt-0.5 text-sm text-foreground">{periodText}</div></div>
                    <div><div className="text-xs font-medium text-muted-foreground">Budget</div><div className="mt-0.5 text-sm text-foreground tabular-nums">{fmtCredits(budgetCredits)}</div></div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Platforms</div>
                      <div className="mt-1 flex flex-wrap gap-1">{draftPlatforms.map((p) => <PlatformPill key={p} platform={p} full />)}</div>
                    </div>
                  </div>

                  {/* rationale(带来源;Otto 不捏造 trend)+ #27 上期反哺 */}
                  <div className="border-t border-border px-5 py-4">
                    <div className="text-xs font-medium text-muted-foreground">Why this plan</div>
                    <p className="mt-1 text-[13px] leading-[18px] text-foreground">{PROPOSAL_RATIONALE.text}</p>
                    {/* [wave-b] 上期 campaign 真实表现反哺下期提案 */}
                    <p className="mt-2 rounded-[10px] bg-secondary px-2.5 py-1.5 text-[12px] leading-4 text-muted-foreground">
                      Last time (Raya): unboxing reels beat flat lays 3:1 on saves — so this plan leads with process video.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {PROPOSAL_RATIONALE.sourceIds.map((id) => {
                        const t = trendById(id);
                        if (!t) return null;
                        return (
                          <Link key={id} href={`${BASE}/campaign/trends`} className="inline-flex h-6 max-w-full items-center gap-1 truncate rounded-full border border-border bg-card px-2 font-mono text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                            {t.sources[0]?.domain} · {t.capturedAt}
                          </Link>
                        );
                      })}
                    </div>
                  </div>

                  {/* 内容日历(逐条编辑) */}
                  <div className="border-t border-border">
                    {entries.map((e, i) => (
                      <div key={e.id} className={cn("group flex items-center gap-2 px-5 py-2.5 focus-within:bg-accent/50 hover:bg-accent/50", i > 0 && "border-t border-border")}>
                        <span className="w-12 shrink-0 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">{fmtDay(e.date)}</span>
                        <PlatformPill platform={e.platform} />
                        {editingId === e.id ? (
                          <input
                            autoFocus
                            value={hookDraft}
                            onChange={(ev) => setHookDraft(ev.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(ev) => { if (ev.key === "Enter") commitEdit(); if (ev.key === "Escape") setEditingId(null); }}
                            aria-label="Edit hook"
                            className="h-7 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{e.hook}</span>
                        )}
                        <span className="shrink-0 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">{e.estCredits} cr</span>
                        {!approved && (
                          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                            <button type="button" aria-label={`Edit ${e.hook}`} onClick={() => startEdit(e)} className="flex size-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><Pencil className="size-3.5" strokeWidth={2} /></button>
                            <button type="button" aria-label={`Remove ${e.hook}`} onClick={() => removeEntry(e.id)} className="flex size-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-error-soft hover:text-error-soft-foreground"><X className="size-3.5" strokeWidth={2} /></button>
                          </span>
                        )}
                      </div>
                    ))}
                    {entries.length === 0 && <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">Every post was removed. Ask Otto to redraft the plan.</p>}
                  </div>

                  <div className="border-t border-border px-5 py-3">
                    <p className="text-xs text-muted-foreground">
                      {BACKUP_IDEAS.length} backup ideas saved to your{" "}
                      <Link href={`${BASE}/create/ideas`} className="font-semibold text-foreground underline-offset-2 hover:underline">Ideas list</Link>.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 border-t border-border bg-secondary/40 px-5 py-4">
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
