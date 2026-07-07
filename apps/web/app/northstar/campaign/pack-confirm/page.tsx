/* @nsPage district="Campaign 区" page="pack-confirm" status="draft"
   sources="判决 7-3/7-7;campaign spec §2.5" approvedAt="" pr="" */
"use client";

/**
 * 打包确认页(大单确认)— Otto 花大钱前复述理解 + 报价,一次点头。
 * 清单要件:总价 + 逐条明细(PackCard 模式)、server 重算注记、失败自动退款说明(铁律③)。
 * 钱文案:§V5 spend 按钮带准确价「Confirm pack · N credits」;§FB6 blocking money 确认;
 * coral 预算:brand 按钮 = 本页唯一 statement(按下即开 Otto 工作);Otto 16px mark ≤3 组。
 * 流程演示:review → 确认(server 重算)→ 逐条过 generate 闸(一条演示失败 + 自动退款 + Retry)。
 */

import * as React from "react";
import Link from "next/link";
import { Check, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";
import { NS_BRAND, NS_CAMPAIGN, NS_CAMPAIGN_ENTRIES } from "@/components/northstar/_mock";
import { FORMAT_META } from "@/components/northstar/campaign/_data";
import {
  DemoStates,
  GenBar,
  Landed,
  PlatformPill,
  fmtCredits,
  fmtDay,
  type DemoState,
} from "@/components/northstar/campaign/_bits";

type Phase = "review" | "confirming" | "running" | "settled";
type RunState = "queued" | "generating" | "done" | "failed";

const FAIL_ID = "ce-06"; // 演示:一条失败 → 自动退款 → Retry

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("default");
  const [phase, setPhase] = React.useState<Phase>("review");
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  const [run, setRun] = React.useState<Record<string, RunState>>({});
  const [spent, setSpent] = React.useState(0);

  const items = NS_CAMPAIGN_ENTRIES;
  const included = items.filter((e) => !excluded.has(e.id));
  const total = included.reduce((s, e) => s + e.estCredits, 0);
  const balance = NS_BRAND.creditBalance - spent;

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

  // 跑批用 ref 镜像(interval 内读最新值,副作用不进 setState updater)
  const runRef = React.useRef(run);
  React.useEffect(() => {
    runRef.current = run;
  }, [run]);
  const packIdsRef = React.useRef<string[]>([]);
  const failedOnceRef = React.useRef(false);

  function confirmPack() {
    if (included.length === 0) return;
    packIdsRef.current = included.map((e) => e.id);
    setPhase("confirming");
    setRun(Object.fromEntries(included.map((e) => [e.id, "queued" as RunState])));
  }

  // server 重算的一拍(演示 900ms)→ 开跑
  React.useEffect(() => {
    if (phase !== "confirming") return;
    const t = window.setTimeout(() => setPhase("running"), 900);
    return () => window.clearTimeout(t);
  }, [phase]);

  // 逐条过闸:每 ~1100ms 推进一条;FAIL_ID 第一次必失败(演示自动退款)
  React.useEffect(() => {
    if (phase !== "running") return;
    const timer = window.setInterval(() => {
      const ids = packIdsRef.current;
      const cur = runRef.current;
      const activeId = ids.find((id) => cur[id] === "generating");
      const nextQueued = ids.find((id) => cur[id] === "queued");
      if (activeId) {
        const item = items.find((e) => e.id === activeId);
        if (activeId === FAIL_ID && !failedOnceRef.current) {
          failedOnceRef.current = true;
          setRun((prev) => ({ ...prev, [activeId]: "failed" }));
        } else {
          setRun((prev) => ({ ...prev, [activeId]: "done" }));
          if (item) setSpent((s) => s + item.estCredits);
        }
      } else if (nextQueued) {
        setRun((prev) => ({ ...prev, [nextQueued]: "generating" }));
      } else {
        window.clearInterval(timer);
        setPhase((p) => (p === "running" ? "settled" : p));
      }
    }, 1100);
    return () => window.clearInterval(timer);
  }, [phase, items]);

  // 全部 done = complete(派生,不进 effect)
  const complete = phase === "settled" && included.length > 0 && included.every((e) => run[e.id] === "done");

  function retryItem(id: string) {
    const item = included.find((e) => e.id === id);
    if (!item) return;
    setRun((prev) => ({ ...prev, [id]: "generating" }));
    window.setTimeout(() => {
      setRun((prev) => ({ ...prev, [id]: "done" }));
      setSpent((s) => s + item.estCredits);
    }, 1400);
  }

  const busy = phase === "confirming" || phase === "running";
  const isEmpty = demo === "empty";

  const ottoMood =
    phase === "review" ? "warning" : busy ? "approving" : failedItems.length > 0 ? "warning" : "success";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Confirm campaign pack"
        subtitle="One nod for the whole batch. Nothing spends until you confirm."
        meta={[NS_CAMPAIGN.name]}
      />

      {isEmpty ? (
        <div className="mt-6 flex rounded-[var(--radius-card)] border border-border bg-card">
          <EmptyState
            icon={PackageCheck}
            title="Nothing to confirm"
            body="Approve a proposal first. The pack lands here for one confirmation."
            action={
              <Button asChild size="sm">
                <Link href="/northstar/campaign/proposal-card">Open proposal</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {/* Otto 复述理解(判决 7-7)— 16px mark(coral 预算:mark 组) */}
          <div className="mt-6 flex items-start gap-3 rounded-[14px] bg-secondary/70 px-4 py-3">
            <OttoAvatar size={16} mood={ottoMood} className="mt-0.5 shrink-0" />
            <p className="text-[13px] leading-[18px] text-foreground">
              My understanding: {included.length} posts for Merdeka week, Aug 24 to 31, across Instagram, Facebook and
              TikTok, to drive gift box pre-orders. The total below is the exact quote for this batch.
            </p>
          </div>

          {/* 叙述行(§8c 解剖:avatar + 一行 + counter),只在跑批时出现 */}
          {busy && (
            <div
              role="status"
              className="mt-4 flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-[var(--shadow-sm)]"
            >
              <OttoAvatar size={20} mood="approving" />
              <span className="text-[13px] leading-[18px] font-medium text-muted-foreground">
                {phase === "confirming" ? "Recalculating the quote…" : "Generating your pack…"}
              </span>
              {phase === "running" ? (
                <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
                  {doneCount}/{included.length}
                </span>
              ) : (
                <GenBar />
              )}
            </div>
          )}

          {/* 逐条明细(PackCard 模式) */}
          <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Items · {included.length}</span>
              {phase === "review" && (
                <span className="text-xs text-muted-foreground">Untick anything you don&apos;t want in this batch.</span>
              )}
            </div>
            {items.map((e, i) => {
              const off = excluded.has(e.id);
              const state = run[e.id];
              return (
                <div
                  key={e.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3",
                    i > 0 && "border-t border-border",
                    off && "opacity-50",
                  )}
                >
                  {phase === "review" ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={!off}
                      aria-label={`Include ${e.hook}`}
                      onClick={() => toggleItem(e.id)}
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-[120ms]",
                        off ? "border-input bg-card" : "border-transparent bg-primary text-primary-foreground",
                      )}
                    >
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
                  <span className="w-14 shrink-0 font-mono text-xs font-medium text-muted-foreground tabular-nums">
                    {fmtDay(e.date)}
                  </span>
                  <PlatformPill platform={e.platform} />
                  <span className="hidden w-16 shrink-0 text-xs text-muted-foreground sm:block">
                    {FORMAT_META[e.format].label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{e.hook}</span>
                    {state === "failed" && (
                      <span className="mt-0.5 flex items-center gap-2">
                        <span role="alert" className="text-[13px] leading-[18px] font-medium text-error-soft-foreground">
                          Couldn&apos;t generate. {e.estCredits} credits refunded automatically.
                        </span>
                        <button
                          type="button"
                          onClick={() => retryItem(e.id)}
                          className="inline-flex h-6 items-center rounded-lg px-2 text-xs font-semibold text-foreground hover:bg-accent"
                        >
                          Retry
                        </button>
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs font-medium text-muted-foreground tabular-nums">
                    {e.estCredits} cr
                  </span>
                </div>
              );
            })}
          </div>

          {/* 报价面板:总价 + 注记(server 重算 / 自动退款 / 余额) */}
          <div className="mt-4 rounded-[var(--radius-card)] border border-border bg-card p-5">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-lg font-semibold tracking-[-0.012em] text-foreground tabular-nums">
                Total · {fmtCredits(total)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">Your balance · {fmtCredits(balance)}</span>
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
              <li>The server recalculates this total from the stored card when you confirm. Card estimates are display only.</li>
              <li>If an item fails, that item refunds automatically and the rest continue.</li>
              <li>Finished pieces land in your schedule as drafts. Nothing publishes without you.</li>
              {phase === "review" && <li className="text-foreground">No charge until you confirm.</li>}
            </ul>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
              {phase === "review" && (
                <>
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/northstar/campaign/calendar">Cancel</Link>
                  </Button>
                  <Button variant="brand" size="sm" onClick={confirmPack} disabled={included.length === 0}>
                    Confirm pack · {total} credits
                  </Button>
                </>
              )}
              {busy && (
                <Button variant="brand" size="sm" disabled>
                  {phase === "confirming" ? "Confirming…" : `Generating… ${doneCount}/${included.length}`}
                </Button>
              )}
              {phase === "settled" && !complete && failedItems.length > 0 && (
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  {doneCount} of {included.length} done. Retry the failed item above, or leave it out.
                </p>
              )}
              {complete && (
                <Landed className="w-full rounded-[14px]">
                  <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-success-soft px-4 py-3">
                    <p className="min-w-0 flex-1 text-[13px] leading-[18px] font-medium text-success-soft-foreground">
                      Pack complete. You approved this batch and it used {fmtCredits(spent)}. {included.length} drafts
                      are in your schedule, none published.
                    </p>
                    <Button asChild size="sm">
                      <Link href="/northstar/schedule/plan">Open schedule</Link>
                    </Button>
                  </div>
                </Landed>
              )}
            </div>
          </div>
        </>
      )}

      <MockNote path="/northstar/campaign/pack-confirm" />
      <DemoStates
        value={demo}
        onChange={(s) => {
          setDemo(s);
          if (s === "default") {
            setPhase("review");
            setRun({});
            setSpent(0);
            failedOnceRef.current = false;
            setExcluded(new Set());
          }
        }}
        states={["default", "empty"]}
      />
    </div>
  );
}
