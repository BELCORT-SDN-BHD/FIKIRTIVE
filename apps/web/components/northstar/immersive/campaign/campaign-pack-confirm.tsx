"use client";

/**
 * 打包确认页(大单确认)—— Otto 花大钱前复述理解 + 报价,一次点头。
 * review 逐条(可剔除,server 重算)→ spend 按钮带准确价「Confirm pack · N credits」(§F10 花钱守
 * INK,非 coral)→ running 逐条过 generate 闸(一条失败自动退该条 + Retry,其余不累)→ 成片 schedulePosts
 * 只建草稿 → schedule/plan。§FB6 blocking money 确认。
 *
 * 铁律:纯 client、零后台 import;§V5 spend 面只显示 credits;coral 预算:花钱按钮 INK(§F10),
 * 页面 coral 只在 running 的 Otto live activity(narration pill + GenBar),settle 后归零。
 */

import * as React from "react";
import Link from "next/link";
import { Check, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, PageHeader } from "@/components/northstar/_shared";
import { NS_CAMPAIGN, nsImage, type NsCampaignEntry } from "@/components/northstar/_mock";
import { FORMAT_META, PLATFORM_META } from "@/components/northstar/campaign/_data";
import { approveCampaignEntry, balance, campaignDraft, campaignEntries, deriveCampaignName, saveDraft, spendCredits, useStore } from "../_store";
import { CAMP_BASE as BASE, GenBar, Landed, PlatformPill, fmtCredits, fmtDay } from "./kit";

/** 平台数组 → 人话串（"Instagram, Facebook and TikTok"）。 */
function joinPlatforms(platforms: string[]): string {
  const labels = platforms.map((p) => PLATFORM_META[p as NsCampaignEntry["platform"]]?.label ?? p);
  if (labels.length === 0) return "your channels";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

type Phase = "review" | "confirming" | "running" | "settled";
type RunState = "queued" | "generating" | "done" | "failed";
const FAIL_ID = "ce-06"; // 演示:一条失败 → 自动退款 → Retry

export function CampaignPackConfirm() {
  useStore();
  const [phase, setPhase] = React.useState<Phase>("review");
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  const [run, setRun] = React.useState<Record<string, RunState>>({});
  const [spent, setSpent] = React.useState(0);

  const items = campaignEntries();
  const included = items.filter((e) => !excluded.has(e.id));
  const total = included.reduce((s, e) => s + e.estCredits, 0);
  const liveBalance = balance();

  // STALL #58:复述条读真实草稿(goal / period / platforms / 条数),不再写死 Merdeka。
  const draft = campaignDraft();
  const reciteName = draft ? deriveCampaignName(draft.goal) : NS_CAMPAIGN.name;
  const recitePeriod = draft ? `${fmtDay(draft.start)} to ${fmtDay(draft.end)}` : "Aug 24 to 31";
  const recitePlatforms = joinPlatforms((draft?.platforms as string[] | undefined) ?? [...NS_CAMPAIGN.platforms]);
  const reciteGoal = draft?.goal ?? NS_CAMPAIGN.goal;

  // STALL #59:余额不足分支(合计 > 余额 → 提示差额 + 引导充值,不静默扣到 0)。
  const shortfall = Math.max(0, total - liveBalance);
  const canAfford = total <= liveBalance;

  function commitGenerated(entry: NsCampaignEntry) {
    spendCredits(entry.estCredits, `Campaign generation · ${entry.hook}`, "Video");
    approveCampaignEntry(entry.id);
    // 兑现文案承诺:每条生成的 pack item 真的落进排期(DRAFT、归组本 campaign、日期沿 entry)。
    // 「Open schedule」即见新帖;同 id 重试幂等(saveDraft 就地更新,不双写)。
    saveDraft({
      id: `sched-${entry.id}`,
      scheduledAt: `${entry.date}T09:00:00+08:00`,
      platform: entry.platform,
      caption: entry.hook,
      media: nsImage("campaign", Number(entry.id.replace(/\D/g, "")) || 0),
      status: "draft",
      campaignId: NS_CAMPAIGN.id,
      altText: entry.hook,
    });
  }

  const doneCount = included.filter((e) => run[e.id] === "done").length;
  const failedItems = included.filter((e) => run[e.id] === "failed");

  function toggleItem(id: string) {
    if (phase !== "review") return;
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const runRef = React.useRef(run);
  React.useEffect(() => { runRef.current = run; }, [run]);
  const itemsRef = React.useRef(items);
  React.useEffect(() => { itemsRef.current = items; }, [items]);
  const packIdsRef = React.useRef<string[]>([]);
  const failedOnceRef = React.useRef(false);

  function confirmPack() {
    if (included.length === 0) return;
    if (total > liveBalance) return; // STALL #59:兜底,余额不足永不进入扣费流
    packIdsRef.current = included.map((e) => e.id);
    setPhase("confirming");
    setRun(Object.fromEntries(included.map((e) => [e.id, "queued" as RunState])));
  }

  React.useEffect(() => {
    if (phase !== "confirming") return;
    const t = window.setTimeout(() => setPhase("running"), 900);
    return () => window.clearTimeout(t);
  }, [phase]);

  React.useEffect(() => {
    if (phase !== "running") return;
    const timer = window.setInterval(() => {
      const ids = packIdsRef.current;
      const cur = runRef.current;
      const activeId = ids.find((id) => cur[id] === "generating");
      const nextQueued = ids.find((id) => cur[id] === "queued");
      if (activeId) {
        const item = itemsRef.current.find((e) => e.id === activeId);
        if (activeId === FAIL_ID && !failedOnceRef.current) {
          failedOnceRef.current = true;
          setRun((prev) => ({ ...prev, [activeId]: "failed" }));
        } else {
          setRun((prev) => ({ ...prev, [activeId]: "done" }));
          if (item) {
            setSpent((s) => s + item.estCredits);
            commitGenerated(item);
          }
        }
      } else if (nextQueued) {
        setRun((prev) => ({ ...prev, [nextQueued]: "generating" }));
      } else {
        window.clearInterval(timer);
        setPhase((p) => (p === "running" ? "settled" : p));
      }
    }, 1100);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const complete = phase === "settled" && included.length > 0 && included.every((e) => run[e.id] === "done");

  function retryItem(id: string) {
    const item = included.find((e) => e.id === id);
    if (!item) return;
    setRun((prev) => ({ ...prev, [id]: "generating" }));
    window.setTimeout(() => {
      setRun((prev) => ({ ...prev, [id]: "done" }));
      setSpent((s) => s + item.estCredits);
      commitGenerated(item);
    }, 1400);
  }

  const busy = phase === "confirming" || phase === "running";
  const ottoMood = phase === "review" ? "warning" : busy ? "approving" : failedItems.length > 0 ? "warning" : "success";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-16">
      <PageHeader title="Confirm campaign pack" subtitle="One nod for the whole batch. Nothing spends until you confirm." meta={[NS_CAMPAIGN.name]} />

      {included.length === 0 && phase === "review" ? (
        <div className="mt-6 flex rounded-[18px] border border-border bg-card">
          <EmptyState
            icon={PackageCheck}
            title="Nothing to confirm"
            body="Approve a proposal first. The pack lands here for one confirmation."
            action={<Button asChild size="sm"><Link href={`${BASE}/campaign/proposal-card`}>Open proposal</Link></Button>}
          />
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-start gap-3 rounded-[14px] bg-secondary/70 px-4 py-3">
            <OttoAvatar size={16} mood={ottoMood} className="mt-0.5 shrink-0" />
            <p className="text-[13px] leading-[18px] text-foreground">
              My understanding: {included.length} post{included.length === 1 ? "" : "s"} for {reciteName}, {recitePeriod}, across {recitePlatforms}, to {reciteGoal.charAt(0).toLowerCase() + reciteGoal.slice(1)}. The total below is the exact quote for this batch.
            </p>
          </div>

          {busy && (
            <div role="status" className="mt-4 flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-[var(--shadow-sm)]">
              <OttoAvatar size={20} mood="approving" />
              <span className="text-[13px] font-medium text-muted-foreground">{phase === "confirming" ? "Recalculating the quote…" : "Generating your pack…"}</span>
              {phase === "running" ? (
                <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">{doneCount}/{included.length}</span>
              ) : (
                <GenBar />
              )}
            </div>
          )}

          <div className="mt-4 overflow-hidden rounded-[18px] border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Items · {included.length}</span>
              {phase === "review" && <span className="text-xs text-muted-foreground">Untick anything you don&apos;t want in this batch.</span>}
            </div>
            {items.map((e, i) => {
              const off = excluded.has(e.id);
              const state = run[e.id];
              return (
                <div key={e.id} className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-border", off && "opacity-50")}>
                  {phase === "review" ? (
                    <button type="button" role="checkbox" aria-checked={!off} aria-label={`Include ${e.hook}`} onClick={() => toggleItem(e.id)} className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors", off ? "border-input bg-card" : "border-transparent bg-primary text-primary-foreground")}>
                      {!off && <Check className="size-3.5" strokeWidth={3} />}
                    </button>
                  ) : (
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      {state === "done" && <Check className="size-4 text-success" strokeWidth={2.5} />}
                      {state === "generating" && <GenBar className="w-8" />}
                      {state === "queued" && <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/40" />}
                      {state === "failed" && <span aria-hidden className="size-1.5 rounded-full bg-error" />}
                    </span>
                  )}
                  <span className="w-14 shrink-0 font-mono text-xs font-medium text-muted-foreground tabular-nums">{fmtDay(e.date)}</span>
                  <PlatformPill platform={e.platform} />
                  <span className="hidden w-16 shrink-0 text-xs text-muted-foreground sm:block">{FORMAT_META[e.format].label}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{e.hook}</span>
                    {state === "failed" && (
                      <span className="mt-0.5 flex items-center gap-2">
                        <span role="alert" className="text-[13px] font-medium text-error-soft-foreground">Couldn&apos;t generate. {e.estCredits} credits refunded automatically.</span>
                        <button type="button" onClick={() => retryItem(e.id)} className="inline-flex h-6 items-center rounded-lg px-2 text-xs font-semibold text-foreground hover:bg-accent">Retry</button>
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs font-medium text-muted-foreground tabular-nums">{e.estCredits} cr</span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-[18px] border border-border bg-card p-5">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-lg font-semibold tracking-[-0.012em] text-foreground tabular-nums">Total · {fmtCredits(total)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">Your balance · {fmtCredits(liveBalance)}</span>
            </div>

            {/* STALL #59:合计 > 余额 → 显式差额 + 去充值,不让「Confirm」把余额静默压到 0 */}
            {phase === "review" && !canAfford && (
              <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-[12px] bg-warning-soft px-4 py-3">
                <p className="min-w-0 flex-1 text-[13px] font-medium text-warning-soft-foreground tabular-nums">
                  You&apos;re {fmtCredits(shortfall)} short for this batch. Top up, or untick a few posts to fit {fmtCredits(liveBalance)}.
                </p>
              </div>
            )}

            <ul className="mt-3 flex flex-col gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
              <li>The server recalculates this total from the stored card when you confirm. Card estimates are display only.</li>
              <li>If an item fails, that item refunds automatically and the rest continue.</li>
              <li>Finished pieces land in your schedule as scheduled posts. Nothing publishes without you.</li>
              {phase === "review" && <li className="text-foreground">No charge until you confirm.</li>}
            </ul>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
              {phase === "review" && (
                <>
                  <Button asChild variant="secondary" size="sm"><Link href={`${BASE}/campaign/calendar`}>Cancel</Link></Button>
                  {canAfford ? (
                    <Button size="sm" onClick={confirmPack} disabled={included.length === 0}>Confirm pack · {total} credits</Button>
                  ) : (
                    <Button asChild size="sm"><Link href={`${BASE}/account/top-up`}>Top up first · short {shortfall} credits</Link></Button>
                  )}
                </>
              )}
              {busy && <Button size="sm" disabled>{phase === "confirming" ? "Confirming…" : `Generating… ${doneCount}/${included.length}`}</Button>}
              {phase === "settled" && !complete && failedItems.length > 0 && (
                <p className="text-[13px] text-muted-foreground">{doneCount} of {included.length} done. Retry the failed item above, or leave it out.</p>
              )}
              {complete && (
                <Landed className="w-full rounded-[14px]">
                  <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-success-soft px-4 py-3">
                    <p className="min-w-0 flex-1 text-[13px] font-medium text-success-soft-foreground">
                      Pack complete. You approved this batch and it used {fmtCredits(spent)}. {doneCount} posts are in your schedule, none published.
                    </p>
                    <Button asChild size="sm"><Link href={`${BASE}/schedule/plan`}>Open schedule</Link></Button>
                  </div>
                </Landed>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
