"use client";

/**
 * 排期区 · Plan（默认落点,§L2 List 880）— 原生重建。
 * 周区块 + DRAFT 就地审批 + campaign 归组深链回容器。Otto 在场:进页草拟叙述条 →
 * 提案卡错峰着陆 → 容器 sweep 一次 → statement 通知（coral 仅此页,预算内）。
 * Wave B:批量导入(#10)· 草稿→审批 UI(#9)· 常青循环(#8)· Link-in-bio 微站(#12,最轻)。
 */

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, CalendarPlus, Plus, Upload, Recycle, Link as LinkIcon, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import { NS_BRAND, NS_NARRATION_STEPS, nsImage } from "@/components/northstar/_mock";
import { useSweep } from "../_kit";
import {
  recentEvents,
  schedulePost,
  saveDraft,
  bulkImportDrafts,
  evergreenLists,
  addEvergreenList,
  toggleEvergreenList,
  appendToStream,
  useStore,
} from "../_store";
import {
  ApproveDialog,
  BASE,
  NS_TIMEZONE,
  NS_TODAY,
  PostRow,
  ViewSwitch,
  addDaysIso,
  campaignPosts,
  dowMon,
  fmtDate,
  fmtDateLong,
  livePosts,
  toScheduled,
  type SPost,
} from "./kit";
import { bestTimesForType, campaignHref, campaignName, type SPlatform } from "./data";
import { OttoAssist } from "../otto-assist";

const WEEK_START = "2026-07-06";
const NS_CAMPAIGN_NAME = campaignName("camp-merdeka-01") ?? "Merdeka week bakes";

function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
}

export function SchedulePlan() {
  useStore();
  const posts = livePosts();
  const campaign = campaignPosts();
  const landingId = React.useMemo(
    () => recentEvents(20).find((e) => e.type === "post_scheduled")?.payload.id as string | undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posts.length],
  );

  const [ottoPhase, setOttoPhase] = React.useState<"idle" | "working" | "done">("idle");
  const [landedCount, setLandedCount] = React.useState(0);
  const startedRef = React.useRef(false);
  const groupSweep = useSweep();

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const t = window.setTimeout(() => setOttoPhase("working"), 1400);
    return () => window.clearTimeout(t);
  }, []);

  const onNarrationSettle = React.useCallback(() => {
    setOttoPhase("done");
    campaign.proposed.forEach((_, i) => {
      window.setTimeout(() => setLandedCount(i + 1), i * 120);
    });
    window.setTimeout(() => groupSweep.fire(), campaign.proposed.length * 120);
  }, [campaign.proposed, groupSweep]);

  const [approving, setApproving] = React.useState<SPost | null>(null);
  const approve = (id: string) => {
    const post = [...posts, ...campaign.scheduled, ...campaign.proposed].find((p) => p.id === id);
    if (post) schedulePost(toScheduled(post));
  };

  const [importOpen, setImportOpen] = React.useState(false);
  const [sendBack, setSendBack] = React.useState<SPost | null>(null);

  const thisWeek = weekDays(WEEK_START);
  const nextWeek = weekDays(addDaysIso(WEEK_START, 7));
  const landedProposed = campaign.proposed.slice(0, landedCount);
  const groupRows = [...campaign.scheduled, ...landedProposed];
  const proposedTotal = campaign.proposed.reduce((sum, p) => sum + (p.estCredits ?? 0), 0);
  const drafts = posts.filter((p) => p.status === "draft");

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Schedule"
        subtitle="Plan the week, approve drafts, keep every channel fed."
        meta={[NS_TIMEZONE]}
        actions={
          <>
            <ViewSwitch />
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload strokeWidth={2} />
              <span className="hidden sm:inline">Import</span>
            </Button>
            <Button size="sm" asChild>
              <Link href={`${BASE}/schedule/composer`}>
                <Plus strokeWidth={2} />
                New post
              </Link>
            </Button>
          </>
        }
      />

      {/* 叙述条槽位:固定高度先占位(§8b) */}
      <div className="mt-4 flex h-10 items-center justify-center">
        {ottoPhase === "working" && (
          <OttoNarrationBar steps={NS_NARRATION_STEPS} stepMs={1300} onSettle={onNarrationSettle} className="w-full max-w-[420px]" />
        )}
      </div>

      <div className="mt-2 flex flex-col gap-8">
        {/* Otto 提案通知(statement,一屏最多 1;§O4) */}
        {ottoPhase === "done" && (
          <div className="flex items-center gap-3 rounded-[18px] border border-border bg-brand-soft/60 p-4">
            <OttoAvatar size={26} mood="waiting" />
            <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground">
              I drafted {campaign.proposed.length} posts for {NS_CAMPAIGN_NAME}. Generating them will use about{" "}
              {proposedTotal} credits. Review them below or in the campaign calendar.
            </p>
            <Button variant="ghost" size="sm" asChild>
              <Link href={campaignHref("camp-merdeka-01", BASE)}>
                Review
                <ArrowRight strokeWidth={2} />
              </Link>
            </Button>
          </div>
        )}

        {/* [wave-b] 草稿→请求审批 UI:代运营建草稿,老板一键批 / 打回留言 */}
        {drafts.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground">Waiting for your approval</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Drafts an editor lined up. Approve to schedule, or send one back with a note.
            </p>
            <div className="mt-3 rounded-[18px] border border-dashed border-border bg-card px-4 pb-1">
              {drafts.map((p) => (
                <PostRow
                  key={p.id}
                  post={p}
                  onApprove={setApproving}
                  landing={p.id === landingId}
                  shareHref={`${BASE}/schedule/share-preview?post=${p.id}`}
                  trailing={
                    <Button variant="ghost" size="sm" onClick={() => setSendBack(p)}>
                      <MessageSquare strokeWidth={2} />
                      <span className="hidden sm:inline">Send back</span>
                    </Button>
                  }
                />
              ))}
            </div>
          </section>
        )}

        <WeekBlock
          label={`This week · ${fmtDate(thisWeek[0])} to ${fmtDate(thisWeek[6])}`}
          days={thisWeek}
          posts={posts}
          onApprove={setApproving}
          landingId={landingId}
        />
        <WeekBlock
          label={`Next week · ${fmtDate(nextWeek[0])} to ${fmtDate(nextWeek[6])}`}
          days={nextWeek}
          posts={posts}
          onApprove={setApproving}
          emptyText="Next week is still open — write the first post, or let Otto plan it."
          landingId={landingId}
        />

        {/* campaign 归组区块(深链回容器) */}
        <section id="campaign-group">
          <h2 className="text-sm font-semibold text-foreground">Campaigns</h2>
          <div className="mt-3 rounded-[18px] border border-border bg-card" style={groupSweep.style}>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">{NS_CAMPAIGN_NAME}</span>
              <span className="text-xs text-muted-foreground">
                24 to 31 Aug · {groupRows.length} posts · budget 320 credits
              </span>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" asChild>
                <Link href={campaignHref("camp-merdeka-01", BASE)}>Open campaign</Link>
              </Button>
            </div>
            <div className="px-4 pb-1">
              {groupRows.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">No campaign posts yet.</p>
              ) : (
                groupRows.map((p, i) => (
                  <PostRow
                    key={p.id}
                    post={p}
                    landing={i >= campaign.scheduled.length}
                    shareHref={`${BASE}/schedule/share-preview?post=${p.id}`}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        <EvergreenSection />
        <LinkInBioCard />
      </div>

      <ApproveDialog post={approving} onClose={() => setApproving(null)} onApproved={approve} />
      <BulkImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <SendBackDialog post={sendBack} onClose={() => setSendBack(null)} />
    </div>
  );
}

function WeekBlock({
  label,
  days,
  posts,
  onApprove,
  emptyText,
  landingId,
}: {
  label: string;
  days: string[];
  posts: SPost[];
  onApprove: (post: SPost) => void;
  emptyText?: string;
  landingId?: string;
}) {
  const planSweep = useSweep();
  const byDay = days
    .map((d) => ({ date: d, posts: posts.filter((p) => p.date === d).sort((a, b) => a.time.localeCompare(b.time)) }))
    .filter((g) => g.posts.length > 0);

  // §8e escort 目标面:让 Otto「排这一周」的工作在本页现场落地。Apply → 从常青清单 +
  // KL best-time 窗口起 3 条草稿(status: draft,不发不花);landsOn 声明本页 = 现场直播落点。
  const weekLabel = label.split(" · ")[0];
  const planWeek = () => {
    const items = evergreenLists().flatMap((l) => l.items);
    const seeds = (items.length ? items : ["Signature bakes this week", "Fresh out of the oven today", "Weekend pre-orders open"]).slice(0, 3);
    const windows = bestTimesForType("fresh");
    seeds.forEach((caption, i) => {
      const w = windows[i % windows.length];
      const target = days.find((d) => dowMon(d) === w.day) ?? days[i % days.length];
      saveDraft({
        id: `post-plan-${Date.now()}-${i}`,
        scheduledAt: `${target}T${w.time}:00+08:00`,
        platform: "instagram",
        caption,
        media: nsImage("bakery", i),
        status: "draft",
      });
    });
    planSweep.fire();
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground">{label}</h2>
      {byDay.length === 0 ? (
        <div
          style={planSweep.style}
          className="mt-3 flex flex-col items-center gap-3 rounded-[14px] border border-dashed border-border px-4 py-8 text-center"
        >
          <p className="text-[13px] text-muted-foreground">
            {emptyText ?? `${weekLabel} is still open — write the first post, or let Otto plan it.`}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href={`${BASE}/schedule/composer`}>
                <Plus strokeWidth={2} />
                New post
              </Link>
            </Button>
            <OttoAssist
              zone="Schedule"
              entityLabel={weekLabel}
              label="Ask Otto to plan"
              intents={[
                {
                  id: "plan-week",
                  label: `Plan ${weekLabel.toLowerCase()} for me`,
                  prompt: `Plan ${weekLabel.toLowerCase()} from my evergreen list and best posting times.`,
                  reply:
                    "I lined up 3 drafts from your evergreen list and KL best-time windows. They land here as drafts — nothing sends until you approve.",
                  apply: { summary: `Add 3 drafts to ${weekLabel.toLowerCase()}`, patch: { plan: weekLabel } },
                  landsOn: { surface: `${BASE}/schedule/plan`, label: `${weekLabel.toLowerCase()} drafts` },
                },
              ]}
              onApply={planWeek}
            />
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {byDay.map((g) => (
            <div key={g.date} className="rounded-[18px] border border-border bg-card px-4 pb-1">
              <div className="flex items-center gap-2 border-b border-border py-2.5">
                <span className="text-[13px] font-semibold text-foreground">{fmtDateLong(g.date)}</span>
                {g.date === NS_TODAY && (
                  <span className="font-mono text-[10px] leading-none font-medium tracking-[0.08em] text-muted-foreground uppercase">
                    today
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {g.posts.length} {g.posts.length === 1 ? "post" : "posts"}
                </span>
              </div>
              {g.posts.map((p) => (
                <PostRow
                  key={p.id}
                  post={p}
                  onApprove={onApprove}
                  landing={p.id === landingId}
                  shareHref={`${BASE}/schedule/share-preview?post=${p.id}`}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── [wave-b] 常青内容循环:把招牌菜/好评放进循环清单,隔段自动重发 ─────────── */
function EvergreenSection() {
  useStore();
  const lists = evergreenLists();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [cadence, setCadence] = React.useState("7");
  const [items, setItems] = React.useState("");
  const create = () => {
    if (!name.trim()) return;
    addEvergreenList(
      name.trim(),
      Number(cadence),
      items.split("\n").map((s) => s.trim()).filter(Boolean),
    );
    setOpen(false);
    setName("");
    setItems("");
    toast("Evergreen list started", { description: "Otto will refill gaps from it." });
  };
  return (
    <section>
      <div className="flex items-center gap-2">
        <Recycle className="size-4 text-muted-foreground" strokeWidth={2} />
        <h2 className="text-sm font-semibold text-foreground">Evergreen recycling</h2>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Plus strokeWidth={2} />
          New list
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Three evergreen posts can carry a whole month — Otto slots them into empty days.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {lists.map((l) => (
          <div key={l.id} className="rounded-[18px] border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{l.name}</span>
              <span className="text-xs text-muted-foreground">Every {l.cadenceDays} days · {l.items.length} items</span>
              <div className="flex-1" />
              <Button variant={l.active ? "secondary" : "ghost"} size="sm" onClick={() => toggleEvergreenList(l.id, !l.active)}>
                {l.active ? "On" : "Off"}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {l.items.map((it) => (
                <span key={it} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                  {it}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New evergreen list</DialogTitle>
            <DialogDescription>Posts here get recycled on a cadence when a day is empty.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input placeholder="List name — e.g. Customer reviews" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Cadence in days" type="number" value={cadence} onChange={(e) => setCadence(e.target.value)} />
            <Textarea placeholder="One item per line" value={items} onChange={(e) => setItems(e.target.value)} className="min-h-24" />
          </div>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={create}>Start list</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ── [wave-b] Link-in-bio 微站(真悬空 → 最轻原型:品牌色小落地页预览) ────────── */
function LinkInBioCard() {
  const buttons = ["Order now", "Today's menu", "WhatsApp us", "Find our store"];
  const latest = [nsImage("bakery", 0), nsImage("bakery", 1), nsImage("storefront", 4)];
  return (
    <section>
      <div className="flex items-center gap-2">
        <LinkIcon className="size-4 text-muted-foreground" strokeWidth={2} />
        <h2 className="text-sm font-semibold text-foreground">Link in bio</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        A no-code page for your Instagram bio link — menu, order button, latest posts. Otto keeps it fresh.
      </p>
      <div className="mt-3 flex flex-col items-center gap-3 rounded-[18px] border border-border bg-card p-6">
        <div className="w-full max-w-[300px] rounded-[18px] border border-border bg-background p-4 text-center">
          <p className="text-sm font-semibold text-foreground">{NS_BRAND.name}</p>
          <p className="text-xs text-muted-foreground">{NS_BRAND.tagline}</p>
          <div className="mt-3 flex flex-col gap-2">
            {buttons.map((b) => (
              <span key={b} className="rounded-full border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground">
                {b}
              </span>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {latest.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="aspect-square w-full rounded-[8px] border border-border object-cover" />
            ))}
          </div>
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">fikirtive.app/rotibulan</p>
        </div>
        <span className="text-xs text-muted-foreground">Prototype preview · click tracking counts every tap</span>
      </div>
    </section>
  );
}

/* ── [wave-b] 批量导入排期(Bulk CSV import)→ 逐条真写草稿 ───────────────────── */
const SAMPLE_CSV = `2026-07-19, instagram, Merdeka box early-bird opens
2026-07-21, facebook, Corporate boxes — reserve your slot
2026-07-23, tiktok, Croffle launch countdown`;

function BulkImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = React.useState(SAMPLE_CSV);
  const rows = React.useMemo(() => parseCsv(text), [text]);
  const valid = rows.filter((r) => r.ok);
  const doImport = () => {
    bulkImportDrafts(
      valid.map((r, i) => ({
        id: `post-import-${Date.now()}-${i}`,
        scheduledAt: `${r.date}T09:00:00+08:00`,
        platform: r.platform as SPlatform,
        caption: r.caption,
        media: nsImage("bakery", i),
        status: "draft" as const,
      })),
    );
    onClose();
    toast(`Imported ${valid.length} drafts`, { description: "Find them in the queue under Drafts." });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(640px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Import a month of posts</DialogTitle>
          <DialogDescription>
            One row per post: date, channel, caption. We preview and validate before anything is created. Or just ask
            Otto “plan 30 posts”.
          </DialogDescription>
        </DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-28 font-mono text-[12px]" />
        <div className="max-h-48 overflow-y-auto rounded-[14px] border border-border">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 border-t border-border px-3 py-2 text-[13px] first:border-t-0">
              {r.ok ? (
                <span className="inline-flex size-1.5 shrink-0 rounded-full bg-success-soft-foreground" />
              ) : (
                <span className="inline-flex size-1.5 shrink-0 rounded-full bg-error-soft-foreground" />
              )}
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{r.date || "—"}</span>
              <span className="w-16 shrink-0 text-muted-foreground">{r.platform || "—"}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">{r.caption || r.error}</span>
            </div>
          ))}
        </div>
        <DialogFooter className="flex-row items-center justify-end gap-3">
          <span className="mr-auto text-xs text-muted-foreground">{valid.length} of {rows.length} rows ready</span>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={valid.length === 0} onClick={doImport}>
            Import {valid.length} drafts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const VALID_PLATFORMS = ["instagram", "facebook", "tiktok", "x"];
function parseCsv(text: string): { date: string; platform: string; caption: string; ok: boolean; error?: string }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [date = "", platform = "", ...rest] = line.split(",").map((s) => s.trim());
      const caption = rest.join(", ");
      const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date);
      const platOk = VALID_PLATFORMS.includes(platform.toLowerCase());
      if (!dateOk) return { date, platform, caption, ok: false, error: "Bad date (use YYYY-MM-DD)" };
      if (!platOk) return { date, platform, caption, ok: false, error: "Unknown channel" };
      if (!caption) return { date, platform, caption, ok: false, error: "Missing caption" };
      return { date, platform: platform.toLowerCase(), caption, ok: true };
    });
}

/* ── [wave-b] 草稿打回留言:记一条 Otto 流备注(store-backed,不是死按钮) ────── */
function SendBackDialog({ post, onClose }: { post: SPost | null; onClose: () => void }) {
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (post) setNote("");
  }, [post]);
  const submit = () => {
    if (!post) return;
    saveDraft(toScheduled({ ...post, status: "draft" }));
    appendToStream({
      role: "owner",
      text: `Sent back a ${post.platform} draft to the editor${note.trim() ? `: ${note.trim()}` : ""}`,
      context: { zone: "Schedule", label: "Sent back a draft", href: `${BASE}/schedule/plan` },
    });
    onClose();
    toast("Sent back", { description: "Your note is on the draft." });
  };
  return (
    <Dialog open={post !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send this draft back?</DialogTitle>
          <DialogDescription>It stays a draft for your editor to fix. Add a note if you like.</DialogDescription>
        </DialogHeader>
        <Textarea placeholder="e.g. Move to Friday and add the price" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-20" />
        <DialogFooter className="flex-row justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit}>Send back</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
