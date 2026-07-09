"use client";

/**
 * Campaign 日历工作台 —— 提案卡的日历批改面(与聊天卡同一份 store 数据,不建第二份副本)。
 * 进场 Otto 铺日历(叙述条 + 卡片错峰落地 + 容器 sweep 一次)→ 落定归平静(dock 外零静态 coral)。
 * 逐条批/改/删经 Dialog;预估总价实时重算;成片一次点头在 pack-confirm。
 *
 * 铁律:纯 client、零后台 import;credits 永远是 credits;coral 只属于 Otto。
 */

import * as React from "react";
import Link from "next/link";
import { CalendarRange, Check, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, OttoNarrationBar, PageHeader, StatCard } from "@/components/northstar/_shared";
import { NS_CAMPAIGN, type NsCampaignEntry } from "@/components/northstar/_mock";
import { FORMAT_META, PLATFORM_META } from "@/components/northstar/campaign/_data";
import { EntryStatusBadge } from "@/components/northstar/campaign/_bits";
import { approveCampaignEntry, campaignEntries, useStore } from "../_store";
import { CAMP_BASE as BASE, Landed, PlatformPill, SkeletonBlock, fmtCredits, fmtDay } from "./kit";

interface GridDay {
  iso: string;
  day: number;
  inMonth: boolean;
}
function buildAugustWeeks(): GridDay[][] {
  const start = Date.UTC(2026, 6, 27);
  const weeks: GridDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: GridDay[] = [];
    for (let d = 0; d < 7; d++) {
      const t = new Date(start + (w * 7 + d) * 86400000);
      row.push({ iso: t.toISOString().slice(0, 10), day: t.getUTCDate(), inMonth: t.getUTCMonth() === 7 });
    }
    weeks.push(row);
  }
  return weeks;
}
const AUGUST_WEEKS = buildAugustWeeks();
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const FORMAT_CREDITS: Record<NsCampaignEntry["format"], number> = { image: 12, video: 40, carousel: 24 };
const LAND_STEPS = ["Reading the proposal…", "Laying out the calendar…"] as const;
type EntryEdit = Partial<Pick<NsCampaignEntry, "date" | "platform" | "format" | "estCredits" | "hook">>;

export function CampaignCalendar() {
  useStore();
  const [edits, setEdits] = React.useState<Record<string, EntryEdit>>({});
  const [removed, setRemoved] = React.useState<Set<string>>(new Set());
  const [view, setView] = React.useState<"calendar" | "list">("calendar");
  const [landed, setLanded] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<NsCampaignEntry | null>(null);

  const entries: NsCampaignEntry[] = campaignEntries()
    .filter((e) => !removed.has(e.id))
    .map((e) => (edits[e.id] ? { ...e, ...edits[e.id] } : e));
  const editing = entries.find((e) => e.id === editingId) ?? null;
  const total = entries.reduce((s, e) => s + e.estCredits, 0);
  const approvedCount = entries.filter((e) => e.status !== "proposed").length;
  const proposedCount = entries.length - approvedCount;
  const headroom = NS_CAMPAIGN.budgetCredits - total;

  function openEdit(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setDraft({ ...entry });
    setEditingId(id);
  }
  function closeEdit() {
    setEditingId(null);
    setDraft(null);
  }
  function saveDraft(approve: boolean) {
    if (!draft) return;
    const { date, platform, format, estCredits, hook } = draft;
    setEdits((prev) => ({ ...prev, [draft.id]: { date, platform, format, estCredits, hook } }));
    if (approve) approveCampaignEntry(draft.id);
    closeEdit();
  }
  function removeEntry(id: string) {
    setRemoved((prev) => new Set(prev).add(id));
    if (editingId === id) closeEdit();
  }
  function approveRemaining() {
    entries.filter((e) => e.status === "proposed").forEach((e) => approveCampaignEntry(e.id));
  }

  const byDate = new Map<string, NsCampaignEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const showEntries = landed;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1100px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Campaign calendar"
        subtitle={`${NS_CAMPAIGN.name} · ${NS_CAMPAIGN.period}`}
        meta={["Proposed"]}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={approveRemaining} disabled={!showEntries || proposedCount === 0}>
              {proposedCount > 0 ? `Approve remaining · ${proposedCount}` : "All approved"}
            </Button>
            <Button asChild size="sm"><Link href={`${BASE}/campaign/pack-confirm`}>Review pack</Link></Button>
          </>
        }
      />

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Posts" value={String(entries.length)} />
        <StatCard label="Approved" value={`${approvedCount}/${entries.length}`} />
        <StatCard label="Estimated credits" value={String(total)} delta={{ dir: "flat", text: "display estimate" }} />
        <StatCard label="Budget headroom" value={String(headroom)} delta={{ dir: headroom >= 0 ? "flat" : "down", text: `of ${NS_CAMPAIGN.budgetCredits} budget` }} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-[10px] border border-border bg-card p-0.5" role="group" aria-label="View">
          {(["calendar", "list"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} className={cn("h-[30px] rounded-lg px-3 text-xs font-semibold capitalize", view === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
              {v}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Edit any post here or in Otto&apos;s chat — it stays in sync.</p>
        <div className="flex-1" />
        {!landed && <OttoNarrationBar key="landing" steps={LAND_STEPS} stepMs={1200} onSettle={() => setLanded(true)} />}
      </div>

      <div className="mt-4">
        {entries.length === 0 && showEntries ? (
          <div className="flex rounded-[18px] border border-border bg-card">
            <EmptyState icon={CalendarRange} title="No campaign plan yet" body="Start one in the workbench or ask Otto to plan your month." action={<Button asChild size="sm"><Link href={`${BASE}/campaign/workbench`}>Open workbench</Link></Button>} />
          </div>
        ) : view === "calendar" ? (
          <Landed key={showEntries ? "grid-landed" : "grid-waiting"} sweep={showEntries} className="rounded-[18px]">
            <div className="overflow-hidden rounded-[18px] border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="text-sm font-semibold text-foreground">August 2026</span>
                <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Asia/Kuala_Lumpur</span>
              </div>
              <div className="grid grid-cols-7 border-b border-border">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="px-2 py-2 text-center font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{d}</div>
                ))}
              </div>
              {AUGUST_WEEKS.map((week, wi) => (
                <div key={wi} className={cn("grid grid-cols-7", wi > 0 && "border-t border-border")}>
                  {week.map((day, di) => {
                    const dayEntries = byDate.get(day.iso) ?? [];
                    return (
                      <div key={day.iso} className={cn("min-h-20 p-1.5", di > 0 && "border-l border-border", !day.inMonth && "bg-muted/60")}>
                        <div className={cn("px-1 text-xs tabular-nums", day.inMonth ? "font-medium text-muted-foreground" : "text-muted-foreground/50")}>{day.day}</div>
                        <div className="mt-1 flex flex-col gap-1">
                          {!showEntries && dayEntries.length > 0 && <SkeletonBlock className="h-11 w-full" />}
                          {showEntries &&
                            dayEntries.map((e, ei) => (
                              <Landed key={e.id} delayMs={((wi * 7 + di + ei) % 7) * 120}>
                                <button type="button" onClick={() => openEdit(e.id)} className="w-full rounded-[10px] border border-border bg-card px-2 py-1.5 text-left shadow-[var(--shadow-xs)] transition-colors hover:bg-accent">
                                  <span className="flex items-center gap-1">
                                    <PlatformPill platform={e.platform} />
                                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", e.status === "proposed" ? "bg-muted-foreground/50" : "bg-success")} />
                                    <span className="sr-only">{e.status}</span>
                                    <span className="ml-auto font-mono text-[10px] font-medium text-muted-foreground tabular-nums">{e.estCredits} cr</span>
                                  </span>
                                  <span className="mt-1 block truncate text-xs font-medium text-foreground">{e.hook}</span>
                                </button>
                              </Landed>
                            ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Landed>
        ) : (
          <div className="overflow-hidden rounded-[18px] border border-border bg-card">
            {!showEntries ? (
              <div className="flex flex-col gap-2 p-4">
                <SkeletonBlock className="h-12 w-full" />
                <SkeletonBlock className="h-12 w-full" />
                <SkeletonBlock className="h-12 w-full" shimmer={false} />
              </div>
            ) : (
              entries.map((e, i) => (
                <div key={e.id} className={cn("group flex items-center gap-3 px-4 py-3 focus-within:bg-accent/50 hover:bg-accent/50", i > 0 && "border-t border-border")}>
                  <span className="w-14 shrink-0 font-mono text-xs font-medium text-muted-foreground tabular-nums">{fmtDay(e.date)}</span>
                  <PlatformPill platform={e.platform} />
                  <span className="hidden w-16 shrink-0 text-xs text-muted-foreground sm:block">{FORMAT_META[e.format].label}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{e.hook}</span>
                  <span className="shrink-0 font-mono text-xs font-medium text-muted-foreground tabular-nums">{e.estCredits} cr</span>
                  <EntryStatusBadge status={e.status} />
                  <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    {e.status === "proposed" && (
                      <button type="button" aria-label={`Approve ${e.hook}`} onClick={() => approveCampaignEntry(e.id)} className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><Check className="size-4" strokeWidth={2} /></button>
                    )}
                    <button type="button" aria-label={`Edit ${e.hook}`} onClick={() => openEdit(e.id)} className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><Pencil className="size-4" strokeWidth={2} /></button>
                    <button type="button" aria-label={`Remove ${e.hook}`} onClick={() => removeEntry(e.id)} className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-error-soft hover:text-error-soft-foreground"><Trash2 className="size-4" strokeWidth={2} /></button>
                  </span>
                </div>
              ))
            )}
            {showEntries && entries.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Every post was removed. Ask Otto to redraft the plan.</p>}
          </div>
        )}
      </div>

      {showEntries && entries.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
          <span className="text-sm font-semibold text-foreground">Estimated total · {fmtCredits(total)}</span>
          <span className="text-xs text-muted-foreground">Display estimate. The server recalculates before any spend. No charge until you confirm the pack.</span>
          <div className="flex-1" />
          <Button asChild variant="secondary" size="sm"><Link href={`${BASE}/campaign/pack-confirm`}>Go to pack confirm</Link></Button>
        </div>
      )}

      <Dialog open={editing != null} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="max-w-[min(560px,calc(100vw-2rem))]">
          {draft && (
            <form onSubmit={(e) => { e.preventDefault(); saveDraft(draft.status === "proposed"); }}>
              <DialogHeader>
                <DialogTitle>Edit post</DialogTitle>
                <DialogDescription>{fmtDay(draft.date)} · {PLATFORM_META[draft.platform].label} · estimated {draft.estCredits} credits</DialogDescription>
              </DialogHeader>
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label htmlFor="entry-date" className="text-[13px] font-semibold text-foreground">Date</label>
                    <Input id="entry-date" type="date" value={draft.date} min="2026-08-24" max="2026-08-31" onChange={(e) => setDraft((d) => (d ? { ...d, date: e.target.value } : d))} className="mt-2" />
                  </div>
                  <div className="flex-1">
                    <span className="text-[13px] font-semibold text-foreground">Platform</span>
                    <Select value={draft.platform} onValueChange={(v) => setDraft((d) => (d ? { ...d, platform: v as NsCampaignEntry["platform"] } : d))}>
                      <SelectTrigger className="mt-2 h-11 w-full rounded-[14px] bg-card"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PLATFORM_META) as NsCampaignEntry["platform"][]).map((p) => <SelectItem key={p} value={p}>{PLATFORM_META[p].label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <span className="text-[13px] font-semibold text-foreground">Format</span>
                  <Select value={draft.format} onValueChange={(v) => { const format = v as NsCampaignEntry["format"]; setDraft((d) => (d ? { ...d, format, estCredits: FORMAT_CREDITS[format] } : d)); }}>
                    <SelectTrigger className="mt-2 h-11 w-full rounded-[14px] bg-card"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(FORMAT_META) as NsCampaignEntry["format"][]).map((f) => <SelectItem key={f} value={f}>{FORMAT_META[f].label} · {FORMAT_CREDITS[f]} credits</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="mt-2 text-xs font-medium text-muted-foreground">Changing the format changes the estimate. Final cost is confirmed at pack confirm.</p>
                </div>
                <div>
                  <label htmlFor="entry-hook" className="text-[13px] font-semibold text-foreground">Hook</label>
                  <Input id="entry-hook" value={draft.hook} onChange={(e) => setDraft((d) => (d ? { ...d, hook: e.target.value } : d))} className="mt-2" />
                </div>
              </div>
              <DialogFooter className="mt-6 flex-wrap sm:justify-between">
                <Button type="button" variant="ghost" size="sm" onClick={() => removeEntry(draft.id)} className="text-error-soft-foreground hover:bg-error-soft hover:text-error-soft-foreground">
                  <Trash2 strokeWidth={2} /> Remove
                </Button>
                <span className="flex items-center gap-3">
                  <Button type="button" variant="secondary" size="sm" onClick={closeEdit}>Cancel</Button>
                  <Button type="submit" size="sm">{draft.status === "proposed" ? "Approve post" : "Save changes"}</Button>
                </span>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
