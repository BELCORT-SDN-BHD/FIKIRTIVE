/* @nsPage district="Campaign 区" page="proposal-card" status="draft"
   sources="campaign spec §2.2" approvedAt="" pr="" */
"use client";

/**
 * Campaign 提案卡(聊天内)— Otto 交出的整案:主题 / 目标 / 跨度 / 节奏 + N 条内容日历。
 * 清单要件:日历式卡、逐条编辑、trend 依据(rationale 带来源引用)、预估总价、Approve。
 * 形态:聊天流里的 CAMPAIGN_CARD(缝 8),卡宽 480(§L3 Otto chat cards);
 * 流程演示:研究叙述条 → 卡落地(§8b + sweep)→ 改/批 → Otto 铺生成卡 → 去打包确认。
 * 卡→钱定律:卡上只有预估;Approve $0;花钱在打包确认页过闸。
 */

import * as React from "react";
import Link from "next/link";
import { MessageSquareText, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, MockNote, OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import { NS_CAMPAIGN, NS_CAMPAIGN_ENTRIES, type NsCampaignEntry } from "@/components/northstar/_mock";
import { BACKUP_IDEAS, PROPOSAL_RATIONALE, trendById } from "@/components/northstar/campaign/_data";
import {
  DemoStates,
  Landed,
  PlatformPill,
  SkeletonBlock,
  fmtCredits,
  fmtDay,
  type DemoState,
} from "@/components/northstar/campaign/_bits";

const RESEARCH_STEPS = [
  "Checking your trend archive…",
  "Searching Merdeka week trends…",
  "Reading your brand memory…",
  "Drafting the proposal…",
] as const;

const PREPARE_STEPS = ["Laying generation cards…", "Estimating the pack…"] as const;

type Phase = "researching" | "proposed" | "approved" | "preparing" | "prepared";

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("default");
  const [phase, setPhase] = React.useState<Phase>("researching");
  const [entries, setEntries] = React.useState<NsCampaignEntry[]>(() => NS_CAMPAIGN_ENTRIES.map((e) => ({ ...e })));
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [hookDraft, setHookDraft] = React.useState("");

  const total = entries.reduce((s, e) => s + e.estCredits, 0);
  const cardVisible = phase !== "researching";
  const approved = phase === "approved" || phase === "preparing" || phase === "prepared";

  function startEdit(e: NsCampaignEntry) {
    setEditingId(e.id);
    setHookDraft(e.hook);
  }

  function commitEdit() {
    if (editingId == null) return;
    setEntries((prev) => prev.map((e) => (e.id === editingId && hookDraft.trim() ? { ...e, hook: hookDraft.trim() } : e)));
    setEditingId(null);
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (editingId === id) setEditingId(null);
  }

  const isEmpty = demo === "empty";
  const isError = demo === "error";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Campaign proposal card"
        subtitle="How Otto hands over a full plan in chat. Same data as the calendar workbench."
        meta={["CAMPAIGN_CARD · $0"]}
      />

      {/* 聊天流(演示切片) */}
      <div className="mt-6 flex flex-col gap-4" role="log" aria-label="Chat excerpt">
        {/* 用户消息 */}
        <div className="flex justify-end">
          <div className="max-w-[75%] rounded-[18px] rounded-br-[8px] bg-secondary px-4 py-3 text-[15px] leading-[22px] text-foreground">
            Help me plan a Merdeka campaign for the gift box
          </div>
        </div>

        {isEmpty ? (
          <div className="flex rounded-[var(--radius-card)] border border-border bg-card">
            <EmptyState
              icon={MessageSquareText}
              title="No proposal in this thread yet"
              body="Ask Otto to plan a campaign, or start from the workbench form."
              action={
                <Button asChild size="sm">
                  <Link href="/northstar/campaign/workbench">Open workbench</Link>
                </Button>
              }
            />
          </div>
        ) : isError ? (
          <div className="flex items-start gap-3">
            <OttoAvatar size={26} mood="error" className="mt-1 shrink-0" />
            <div className="max-w-[80%] rounded-[18px] rounded-bl-[8px] bg-error-soft px-4 py-3">
              <p className="text-[15px] leading-[22px] text-error-soft-foreground" role="alert">
                Couldn&apos;t finish the proposal. Try again.
              </p>
              <button
                type="button"
                onClick={() => {
                  setDemo("default");
                  setPhase("researching");
                }}
                className="mt-2 inline-flex h-8 items-center rounded-lg px-2.5 text-[13px] font-semibold text-error-soft-foreground hover:bg-card/60"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Otto 回话 */}
            <div className="flex items-start gap-3">
              <OttoAvatar size={26} mood={cardVisible ? "helpful" : "thinking"} className="mt-1 shrink-0" />
              <div className="min-w-0 flex-1">
                {cardVisible ? (
                  <div className="max-w-[80%] rounded-[18px] rounded-bl-[8px] border border-border bg-card px-4 py-3 text-[15px] leading-[22px] text-foreground">
                    I checked what&apos;s working for Merdeka week and drafted a full plan around the gift box. Review
                    it below. You can edit or remove any post before approving.
                  </div>
                ) : (
                  <div className="flex max-w-[80%] flex-col gap-2">
                    {/* 先留位再落卡(§8b):卡位骨架 */}
                    <SkeletonBlock className="h-10 w-3/4" />
                    <SkeletonBlock className="h-40 w-full" shimmer={false} />
                  </div>
                )}

                {/* 叙述条:研究阶段(§8c,一屏一条) */}
                {phase === "researching" && (
                  <OttoNarrationBar
                    key="research"
                    steps={RESEARCH_STEPS}
                    stepMs={1200}
                    counter
                    onSettle={() => setPhase("proposed")}
                    className="mt-3 w-fit"
                  />
                )}

                {/* CAMPAIGN_CARD */}
                {cardVisible && (
                  <Landed sweep className="mt-3 max-w-[480px] rounded-[var(--radius-card)]">
                    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-sm)]">
                      {/* 卡头 */}
                      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                            Campaign proposal
                          </div>
                          <div className="truncate text-lg font-semibold tracking-[-0.012em] text-foreground">
                            {NS_CAMPAIGN.name}
                          </div>
                        </div>
                        {approved ? <Badge variant="success">Approved</Badge> : <Badge variant="warning">Awaiting your approval</Badge>}
                      </div>

                      {/* 主题 / 目标 / 跨度 / 节奏 */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground">Goal</div>
                          <div className="mt-0.5 text-sm text-foreground">{NS_CAMPAIGN.goal}</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground">Period</div>
                          <div className="mt-0.5 text-sm text-foreground">Aug 24 to 31, 2026</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground">Cadence</div>
                          <div className="mt-0.5 text-sm text-foreground">{PROPOSAL_RATIONALE.cadence}</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground">Platforms</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(["instagram", "facebook", "tiktok"] as const).map((p) => (
                              <PlatformPill key={p} platform={p} full />
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* trend 依据(带来源引用;Otto 不捏造 trend) */}
                      <div className="border-t border-border px-5 py-4">
                        <div className="text-xs font-medium text-muted-foreground">Why this plan</div>
                        <p className="mt-1 text-[13px] leading-[18px] text-foreground">{PROPOSAL_RATIONALE.text}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {PROPOSAL_RATIONALE.sourceIds.map((id) => {
                            const t = trendById(id);
                            if (!t) return null;
                            return (
                              <Link
                                key={id}
                                href="/northstar/campaign/trends"
                                className="inline-flex h-6 max-w-full items-center gap-1 truncate rounded-full border border-border bg-card px-2 font-mono text-[10px] leading-none font-medium tracking-[0.02em] text-muted-foreground hover:bg-accent hover:text-foreground"
                              >
                                {t.sources[0]?.domain} · {t.capturedAt}
                              </Link>
                            );
                          })}
                        </div>
                      </div>

                      {/* 内容日历(逐条编辑) */}
                      <div className="border-t border-border">
                        {entries.map((e, i) => (
                          <div
                            key={e.id}
                            className={cn(
                              "group flex items-center gap-2 px-5 py-2.5 focus-within:bg-accent/50 hover:bg-accent/50",
                              i > 0 && "border-t border-border",
                            )}
                          >
                            <span className="w-12 shrink-0 font-mono text-[11px] leading-[14px] font-medium text-muted-foreground tabular-nums">
                              {fmtDay(e.date)}
                            </span>
                            <PlatformPill platform={e.platform} />
                            {editingId === e.id ? (
                              <input
                                autoFocus
                                value={hookDraft}
                                onChange={(ev) => setHookDraft(ev.target.value)}
                                onBlur={commitEdit}
                                onKeyDown={(ev) => {
                                  if (ev.key === "Enter") commitEdit();
                                  if (ev.key === "Escape") setEditingId(null);
                                }}
                                aria-label="Edit hook"
                                className="h-7 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
                              />
                            ) : (
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{e.hook}</span>
                            )}
                            <span className="shrink-0 font-mono text-[11px] leading-[14px] font-medium text-muted-foreground tabular-nums">
                              {e.estCredits} cr
                            </span>
                            {!approved && (
                              <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
                                <button
                                  type="button"
                                  aria-label={`Edit ${e.hook}`}
                                  onClick={() => startEdit(e)}
                                  className="flex size-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                                >
                                  <Pencil className="size-3.5" strokeWidth={2} />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Remove ${e.hook}`}
                                  onClick={() => removeEntry(e.id)}
                                  className="flex size-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-error-soft hover:text-error-soft-foreground"
                                >
                                  <X className="size-3.5" strokeWidth={2} />
                                </button>
                              </span>
                            )}
                          </div>
                        ))}
                        {entries.length === 0 && (
                          <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">
                            Every post was removed. Ask Otto to redraft the plan.
                          </p>
                        )}
                      </div>

                      {/* 备选点子 → 想法清单(spec §一.3) */}
                      <div className="border-t border-border px-5 py-3">
                        <p className="text-xs text-muted-foreground">
                          {BACKUP_IDEAS.length} backup ideas saved to your{" "}
                          <Link href="/northstar/create/ideas" className="font-semibold text-foreground underline-offset-2 hover:underline">
                            Ideas list
                          </Link>
                          .
                        </p>
                      </div>

                      {/* 预估总价 + Approve */}
                      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-secondary/40 px-5 py-4">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground tabular-nums">
                            Estimated total · {fmtCredits(total)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Display estimate. No charge until you confirm each generation.
                          </div>
                        </div>
                        <div className="flex-1" />
                        {!approved ? (
                          <>
                            <Button asChild variant="ghost" size="sm">
                              <Link href="/northstar/campaign/calendar">Open in calendar</Link>
                            </Button>
                            <Button size="sm" onClick={() => setPhase("approved")} disabled={entries.length === 0}>
                              Approve plan
                            </Button>
                          </>
                        ) : (
                          <Badge variant="success">Plan approved</Badge>
                        )}
                      </div>
                    </div>
                  </Landed>
                )}

                {/* 批准后:Otto 铺生成卡(叙述条 → 完成行) */}
                {phase === "approved" && (
                  <div className="mt-3">
                    <OttoNarrationBar
                      key="prepare"
                      steps={PREPARE_STEPS}
                      stepMs={1300}
                      onSettle={() => setPhase("prepared")}
                      className="w-fit"
                    />
                    {/* phase approved → preparing 的视觉即叙述条本身 */}
                  </div>
                )}
                {phase === "prepared" && (
                  <Landed className="mt-3 max-w-[480px] rounded-[14px]">
                    <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
                      <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground">
                        {entries.length} generation cards are ready. One nod covers the whole batch at pack confirm.
                      </p>
                      <Button asChild size="sm">
                        <Link href="/northstar/campaign/pack-confirm">Review pack</Link>
                      </Button>
                    </div>
                  </Landed>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <MockNote path="/northstar/campaign/proposal-card" />
      <DemoStates
        value={demo}
        onChange={(s) => {
          setDemo(s);
          if (s === "default") setPhase("proposed");
          if (s === "loading") setPhase("researching");
        }}
      />
    </div>
  );
}
