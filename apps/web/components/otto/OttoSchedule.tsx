"use client";
import React, { useState, useEffect, useMemo, useCallback, useTransition } from "react";
import { Plus, X, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { OttoViewKey } from "./OttoApp";
import type { StuffItem } from "@/lib/stuff-items";
import {
  listScheduledPosts,
  listOwnerTargets,
  createScheduledPost,
  updateScheduledPost,
  approveScheduledPost,
  cancelScheduledPost,
  type ScheduledPostRow,
  type OwnerTarget,
} from "@/lib/schedule-actions";
import { getMetaConnection } from "@/lib/meta-actions";
import { getOwnerSettings, setOwnerSetting } from "@/lib/owner-settings-actions";
import { CHANNEL_META, channelMeta } from "@/lib/channels/channel-meta";
import type { ChannelId } from "@/lib/channels/types";
import {
  partsInTz,
  formatTime,
  dayKey,
  statusPill,
  groupByDay,
  buildMonthGrid,
  shiftMonth,
  MONTHS,
  DAYS_SHORT,
  type StatusTone,
} from "@/lib/schedule-view";

/**
 * Schedule screen (UI-first slice, spec §四B). Three views — a Plan+Queue blend
 * (default), a Month/Week/Day calendar, and a full Queue — plus a composer that
 * only reuses ALREADY-generated media ($0: never triggers generation/spend). Nothing
 * publishes in this slice; approval only moves a post DRAFT→SCHEDULED. The always-on
 * banner explains that auto-publish is gated on Meta App Review.
 *
 * Loads its own data client-side via the committed owner-scoped server actions (mirrors
 * how OttoConnections self-loads), so no new prop has to thread through OttoApp/page.
 */

const SCHEDULE_TZS = [
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "UTC",
] as const;

type ViewKey = "plan" | "calendar" | "queue";
type ChannelFilter = "all" | ChannelId;

// A generationId → thumbnail lookup, built from My Stuff (gen items). Media rows store
// generationId; History thumbs carry the same id, so this maps posts to their preview.
type MediaLookup = Map<string, { url: string | null; kind: StuffItem["mediaKind"] }>;

function tonePill(tone: StatusTone): string {
  switch (tone) {
    case "draft": return "bg-secondary text-muted-foreground";
    case "scheduled": return "bg-[#EAF3EC] text-[#15803D]";
    case "publishing": return "bg-[#FFF6F2] text-[#9A3A1A]";
    case "published": return "bg-[#EAF3EC] text-[#15803D]";
    case "warn": return "bg-[#FEF6E7] text-[#9A6B00]";
    case "error": return "bg-[#FDEDEC] text-[#B42318]";
    case "muted": return "bg-secondary text-muted-foreground/70";
  }
}

/** Inline IG/FB glyphs (lucide dropped brand icons; no new deps). currentColor-driven. */
function ChannelIcon({ channel, size = 15 }: { channel: string; size?: number }) {
  if (channel === "instagram") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
      </svg>
    );
  }
  if (channel === "facebook") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M14 8.5V7c0-.83.67-1 1-1h1.5V3.5H14C12.07 3.5 11 4.9 11 6.8V8.5H9V11h2v9.5h3V11h2.1l.4-2.5H14Z" />
      </svg>
    );
  }
  return null;
}

/** OTTO coral cloud mark (matches OttoAnalytics). Coral = OTTO only. */
function CoralCloud({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round((size * 110) / 120)} viewBox="0 0 120 110" role="img" aria-label="Otto" className="shrink-0">
      <g fill="var(--brand)">
        <ellipse cx="60" cy="64" rx="43" ry="22" />
        <circle cx="37" cy="52" r="18" />
        <circle cx="61" cy="40" r="24" />
        <circle cx="85" cy="53" r="17" />
      </g>
      <rect x="51" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
      <rect x="66" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
    </svg>
  );
}

function Thumb({ item, size = 40 }: { item: { url: string | null; kind: StuffItem["mediaKind"] } | undefined; size?: number }) {
  const style = { width: size, height: size } as const;
  if (!item || !item.url) {
    return <div className="shrink-0 rounded-[8px] bg-muted border border-border" style={style} aria-hidden />;
  }
  return (
    <div className="shrink-0 rounded-[8px] overflow-hidden bg-muted border border-border" style={style}>
      {item.kind === "video" ? (
        <video src={item.url} muted preload="metadata" className="w-full h-full object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt="" loading="lazy" className="w-full h-full object-cover" />
      )}
    </div>
  );
}

type ConnState =
  | { phase: "loading" }
  | { phase: "disconnected" }
  | { phase: "reconnect" }
  | { phase: "connected"; targets: { id: string; name: string }[] };

export function OttoSchedule({
  stuffItems,
  onNavigate,
}: {
  stuffItems: StuffItem[];
  onNavigate: (view: OttoViewKey) => void;
}) {
  const [view, setView] = useState<ViewKey>("plan");
  const [posts, setPosts] = useState<ScheduledPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState<ConnState>({ phase: "loading" });
  // Owner's connectable publish targets (page/account per channel). Drives both the
  // header chips (only channels with a real target are shown postable) and the composer's
  // required account picker. [] = nothing publishable → composer disables approve.
  const [targets, setTargets] = useState<OwnerTarget[]>([]);
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  const [autoPublish, setAutoPublish] = useState(false);
  const [defaultTz, setDefaultTz] = useState<string>("Asia/Kuala_Lumpur");
  const [savingAuto, setSavingAuto] = useState(false);
  const [composer, setComposer] = useState<ComposerSeed | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");

  // gen-media lookup (generationId → thumb) for post previews + the media picker.
  const mediaLookup = useMemo<MediaLookup>(() => {
    const m: MediaLookup = new Map();
    for (const s of stuffItems) {
      if (s.source === "gen") m.set(s.label, { url: s.url, kind: s.mediaKind });
    }
    return m;
  }, [stuffItems]);
  // Selectable media = already-generated items with a preview (never regenerated → $0).
  const mediaChoices = useMemo(
    () => stuffItems.filter((s) => s.source === "gen" && s.url),
    [stuffItems],
  );

  const reload = useCallback(async () => {
    const rows = await listScheduledPosts();
    setPosts(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Async initial load — every setState below runs after an await/`.then`, never
    // synchronously in the effect body (the lint rule can't see through the promise).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    void getMetaConnection().then((res) => {
      if ("error" in res || !res.connected) return setConn({ phase: "disconnected" });
      if (res.needsReconnect) return setConn({ phase: "reconnect" });
      setConn({ phase: "connected", targets: [] });
    });
    // Publishable targets (owner's own pages, per channel). Empty until a page-scoped
    // connection exists — an ads-only Meta connection returns none, so no channel shows
    // as postable and the composer keeps approve disabled.
    void listOwnerTargets().then((t) => {
      setTargets(t);
      setTargetsLoaded(true);
    });
    void getOwnerSettings().then((s) => {
      if (!("error" in s)) {
        setAutoPublish(s.autoPublish);
        setDefaultTz(s.timezone);
      }
    });
  }, [reload]);

  async function toggleAutoPublish(next: boolean) {
    setSavingAuto(true);
    setAutoPublish(next); // optimistic
    const res = await setOwnerSetting("autoPublish", next);
    setSavingAuto(false);
    if ("error" in res) setAutoPublish(!next); // roll back
  }

  // Postable channels = those with at least one real publishable target from
  // listOwnerTargets. This is stricter than "a Meta connection exists": an ads-only
  // connection (no page scope) yields no targets, so no channel shows as postable.
  const postableChannelIds = useMemo(
    () => new Set(targets.map((t) => t.channel)),
    [targets],
  );
  const connectedChannels = useMemo(
    () => CHANNEL_META.filter((c) => postableChannelIds.has(c.id)),
    [postableChannelIds],
  );

  const isConnected = connectedChannels.length > 0;

  function openNew() {
    setComposer({
      mode: "create",
      channel: connectedChannels[0]?.id ?? "instagram",
      caption: "",
      media: [],
      dateKey: dayKey(partsInTz(new Date(), defaultTz)),
      time: "09:00",
      tz: defaultTz,
      firstComment: "",
      metaTargetId: null,
    });
  }

  function openEdit(post: ScheduledPostRow) {
    const p = partsInTz(post.scheduledAt, post.scheduledTz);
    setComposer({
      mode: "edit",
      id: post.id,
      channel: post.channel,
      caption: post.caption,
      media: post.media.map((m) => m.generationId),
      dateKey: dayKey(p),
      time: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
      tz: post.scheduledTz,
      firstComment: post.firstComment ?? "",
      metaTargetId: post.metaTargetId,
      status: post.status,
    });
  }

  return (
    <div className="gb leading-[1.5] flex-1 overflow-auto">
      <div className="mx-auto max-w-[920px] px-7 py-6">
        {/* ── Shared header ── */}
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <h1 className="text-[1.5rem] font-bold tracking-[-0.02em]">Schedule</h1>
          <div className="flex items-center gap-1.5">
            {isConnected ? (
              connectedChannels.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1.5 h-[28px] rounded-full border border-border bg-card px-3 text-[12px] font-semibold text-foreground"
                >
                  <ChannelIcon channel={c.id} size={13} />
                  {c.label}
                </span>
              ))
            ) : conn.phase !== "loading" && targetsLoaded ? (
              <button
                type="button"
                onClick={() => onNavigate("connections")}
                className="inline-flex items-center gap-1.5 h-[28px] rounded-full border border-dashed border-border bg-card px-3 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
              >
                <Plus size={13} />
                Connect a channel
              </button>
            ) : null}
          </div>
          <div className="flex-1" />
          {/* OTTO auto-publish toggle — persists to owner settings; no live effect this slice. */}
          <label className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground select-none" title="Auto-publish approved posts at their time (turns on once Meta approves publishing).">
            <Switch checked={autoPublish} onCheckedChange={toggleAutoPublish} disabled={savingAuto} aria-label="OTTO auto-publish" />
            Auto-publish
          </label>
          {/* View switcher */}
          <div className="inline-flex rounded-[10px] border border-border bg-card p-0.5">
            {(["plan", "calendar", "queue"] as ViewKey[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`h-[30px] rounded-[8px] px-3 text-[12px] font-semibold capitalize ${
                  view === v ? "bg-secondary text-foreground" : "bg-transparent text-muted-foreground"
                }`}
              >
                {v === "plan" ? "Plan" : v === "calendar" ? "Calendar" : "Queue"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Always-on banner (App Review gate) ── */}
        <div className="flex items-start gap-[11px] bg-[#FFF6F2] border border-[#FBD9C9] rounded-[14px] px-[15px] py-[12px] mb-4">
          <CoralCloud size={22} />
          <span className="flex-1 text-[13px] leading-[1.5] text-[#9A3A1A]">
            Auto-publish turns on once Meta approves publishing — schedule your posts now and the
            queue starts sending automatically the moment it&rsquo;s approved.
          </span>
        </div>

        {loading ? (
          <div className="text-[13px] text-muted-foreground py-10 text-center">Loading your schedule…</div>
        ) : view === "plan" ? (
          <PlanView
            posts={posts}
            mediaLookup={mediaLookup}
            channelFilter={channelFilter}
            onChannelFilter={setChannelFilter}
            onEdit={openEdit}
            onNew={openNew}
            onReload={reload}
          />
        ) : view === "calendar" ? (
          <CalendarView posts={posts} mediaLookup={mediaLookup} defaultTz={defaultTz} onEdit={openEdit} onNew={openNew} />
        ) : (
          <QueueView
            posts={posts}
            mediaLookup={mediaLookup}
            channelFilter={channelFilter}
            onChannelFilter={setChannelFilter}
            onEdit={openEdit}
            onNew={openNew}
          />
        )}
      </div>

      {composer && (
        <Composer
          seed={composer}
          channels={connectedChannels.length ? connectedChannels.map((c) => c.id) : ["instagram", "facebook"]}
          targets={targets}
          mediaChoices={mediaChoices}
          onClose={() => setComposer(null)}
          onConnect={() => {
            setComposer(null);
            onNavigate("connections");
          }}
          onSaved={async () => {
            setComposer(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

// ── Queue list (shared by Plan bottom-half and the full Queue view) ──

function ChannelFilterBar({
  value,
  onChange,
}: {
  value: ChannelFilter;
  onChange: (v: ChannelFilter) => void;
}) {
  const opts: { key: ChannelFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "instagram", label: "Instagram" },
    { key: "facebook", label: "Facebook" },
  ];
  return (
    <div className="inline-flex gap-1.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`h-[28px] rounded-full px-3 text-[12px] font-semibold border ${
            value === o.key ? "border-foreground bg-secondary text-foreground" : "border-border bg-card text-muted-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function QueueList({
  posts,
  mediaLookup,
  onEdit,
  emptyText,
}: {
  posts: ScheduledPostRow[];
  mediaLookup: MediaLookup;
  onEdit: (p: ScheduledPostRow) => void;
  emptyText: string;
}) {
  const groups = useMemo(() => groupByDay(posts), [posts]);
  if (posts.length === 0) {
    return <div className="text-[13px] text-muted-foreground py-8 text-center">{emptyText}</div>;
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-[0.05em] mb-2">{g.heading}</div>
          <div className="flex flex-col gap-1.5">
            {g.posts.map((post) => {
              const p = partsInTz(post.scheduledAt, post.scheduledTz);
              const pill = statusPill(post.status);
              const firstMedia = post.media[0] ? mediaLookup.get(post.media[0].generationId) : undefined;
              return (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => onEdit(post)}
                  className="flex items-center gap-3 rounded-[12px] border border-border bg-card px-3 py-2.5 text-left hover:bg-secondary/60 transition-colors"
                >
                  <Thumb item={firstMedia} />
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-[7px] bg-accent text-foreground shrink-0">
                    <ChannelIcon channel={post.channel} size={14} />
                  </span>
                  <span className="text-[12px] font-semibold text-muted-foreground shrink-0 w-[64px]">{formatTime(p)}</span>
                  <span className="flex-1 min-w-0 text-[13px] text-foreground truncate">
                    {post.caption || <span className="text-muted-foreground/70">No caption yet</span>}
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tonePill(pill.tone)}`}>{pill.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── (1) Plan + next-Queue blend (default) ──

function PlanView({
  posts,
  mediaLookup,
  channelFilter,
  onChannelFilter,
  onEdit,
  onNew,
  onReload,
}: {
  posts: ScheduledPostRow[];
  mediaLookup: MediaLookup;
  channelFilter: ChannelFilter;
  onChannelFilter: (v: ChannelFilter) => void;
  onEdit: (p: ScheduledPostRow) => void;
  onNew: () => void;
  onReload: () => Promise<void>;
}) {
  // OTTO's proposed week = the DRAFTs OTTO created (source "otto", not yet approved).
  const proposed = useMemo(
    () => posts.filter((p) => p.source === "otto" && p.status === "DRAFT"),
    [posts],
  );
  // The upcoming queue = everything not a draft-proposal and not terminal, chronological.
  const queue = useMemo(
    () =>
      posts.filter(
        (p) =>
          (p.status === "SCHEDULED" || p.status === "PUBLISHING" || p.status === "NEEDS_ATTENTION" || (p.source === "owner" && p.status === "DRAFT")) &&
          (channelFilter === "all" || p.channel === channelFilter),
      ),
    [posts, channelFilter],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Top: OTTO's proposed-week plan card */}
      {proposed.length > 0 ? (
        <PlanCard posts={proposed} mediaLookup={mediaLookup} onEdit={onEdit} onReload={onReload} />
      ) : (
        <div className="rounded-[16px] border border-border bg-card p-[18px] flex items-center gap-3">
          <CoralCloud size={28} />
          <div className="flex-1">
            <div className="text-[14px] font-semibold text-foreground">No plan from OTTO yet</div>
            <div className="text-[13px] text-muted-foreground">
              Ask OTTO to plan your week — say something like &ldquo;post 3 times this week&rdquo; and it&rsquo;ll draft a schedule for you to approve.
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={onNew}>
            <Plus size={15} /> New post
          </Button>
        </div>
      )}

      {/* Bottom: upcoming queue */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="text-[15px] font-bold text-foreground">Up next</div>
          <div className="flex-1" />
          <ChannelFilterBar value={channelFilter} onChange={onChannelFilter} />
        </div>
        <QueueList posts={queue} mediaLookup={mediaLookup} onEdit={onEdit} emptyText="Nothing queued yet. Approve OTTO's plan or add a post." />
      </div>
    </div>
  );
}

/** OTTO's proposed-week card: per-row Tweak + a sticky "Approve all N". Approving a
 *  post only moves it DRAFT→SCHEDULED (no publish, no spend). */
function PlanCard({
  posts,
  mediaLookup,
  onEdit,
  onReload,
}: {
  posts: ScheduledPostRow[];
  mediaLookup: MediaLookup;
  onEdit: (p: ScheduledPostRow) => void;
  onReload: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => groupByDay(posts), [posts]);

  // Only posts that CAN be approved (have a target + media) count toward "Approve all".
  const approvable = useMemo(
    () => posts.filter((p) => p.metaTargetId && p.media.length > 0),
    [posts],
  );

  function approveAll() {
    setError(null);
    startTransition(async () => {
      let firstErr: string | null = null;
      for (const p of approvable) {
        const res = await approveScheduledPost(p.id);
        if ("error" in res && !firstErr) firstErr = res.error;
      }
      if (firstErr) setError(firstErr);
      await onReload();
    });
  }

  return (
    <div className="rounded-[16px] border border-[#FBD9C9] bg-[#FFFBF9] overflow-hidden">
      <div className="flex items-center gap-[11px] px-[18px] py-[14px] border-b border-[#FBD9C9]">
        <CoralCloud size={24} />
        <div className="flex-1">
          <div className="text-[14px] font-bold text-foreground">OTTO planned {posts.length} post{posts.length === 1 ? "" : "s"} this week</div>
          <div className="text-[12px] text-muted-foreground">Nothing sends until you say go — review, tweak, then approve.</div>
        </div>
      </div>

      <div className="px-[18px] py-3 flex flex-col gap-4">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-[0.05em] mb-2">{g.heading}</div>
            <div className="flex flex-col gap-1.5">
              {g.posts.map((post) => {
                const p = partsInTz(post.scheduledAt, post.scheduledTz);
                const firstMedia = post.media[0] ? mediaLookup.get(post.media[0].generationId) : undefined;
                return (
                  <div key={post.id} className="flex items-center gap-3 rounded-[12px] bg-card border border-border px-3 py-2.5">
                    <Thumb item={firstMedia} />
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-[7px] bg-accent text-foreground shrink-0">
                      <ChannelIcon channel={post.channel} size={14} />
                    </span>
                    <span className="text-[12px] font-semibold text-muted-foreground shrink-0 w-[64px]">{formatTime(p)}</span>
                    <span className="flex-1 min-w-0 text-[13px] text-foreground truncate">
                      {post.caption || <span className="text-muted-foreground/70">No caption yet</span>}
                    </span>
                    <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onEdit(post)}>
                      <Pencil size={14} /> Tweak
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Sticky approve-all bar */}
      <div className="sticky bottom-0 flex items-center gap-3 px-[18px] py-3 bg-[#FFFBF9] border-t border-[#FBD9C9]">
        {error && <span className="text-[12px] text-[var(--error-soft-foreground)] flex-1">{error}</span>}
        {!error && (
          <span className="text-[12px] text-muted-foreground flex-1">
            {approvable.length < posts.length
              ? `${approvable.length} of ${posts.length} ready — add media & a channel to the rest before approving.`
              : "Say go once you're happy — nothing publishes yet (Meta review pending)."}
          </span>
        )}
        <Button variant="brand" size="sm" disabled={pending || approvable.length === 0} onClick={approveAll}>
          <Check size={15} /> {pending ? "Approving…" : `Approve all ${approvable.length}`}
        </Button>
      </div>
    </div>
  );
}

// ── (2) Calendar (month / week / day) ──

type Granularity = "month" | "week" | "day";

function CalendarView({
  posts,
  mediaLookup,
  defaultTz,
  onEdit,
  onNew,
}: {
  posts: ScheduledPostRow[];
  mediaLookup: MediaLookup;
  defaultTz: string;
  onEdit: (p: ScheduledPostRow) => void;
  onNew: () => void;
}) {
  const today = useMemo(() => partsInTz(new Date(), defaultTz), [defaultTz]);
  const [gran, setGran] = useState<Granularity>("month");
  const [cursor, setCursor] = useState<{ year: number; month: number; day: number }>({
    year: today.year,
    month: today.month,
    day: today.day,
  });

  // Deterministic "day cursor" as a UTC arithmetic clock (never used for display).
  const cursorMs = useMemo(() => Date.UTC(cursor.year, cursor.month, cursor.day), [cursor]);

  function step(dir: -1 | 1) {
    if (gran === "month") {
      const { year, month } = shiftMonth(cursor.year, cursor.month, dir);
      setCursor((c) => ({ ...c, year, month }));
    } else {
      const days = gran === "week" ? 7 : 1;
      const d = new Date(cursorMs + dir * days * 86400000);
      setCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() });
    }
  }
  function goToday() {
    setCursor({ year: today.year, month: today.month, day: today.day });
  }

  const headerLabel =
    gran === "month"
      ? `${MONTHS[cursor.month]} ${cursor.year}`
      : gran === "week"
        ? weekRangeLabel(cursorMs)
        : `${MONTHS[cursor.month]} ${cursor.day}, ${cursor.year}`;

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="inline-flex rounded-[10px] border border-border bg-card p-0.5">
          {(["month", "week", "day"] as Granularity[]).map((gk) => (
            <button
              key={gk}
              type="button"
              onClick={() => setGran(gk)}
              className={`h-[30px] rounded-[8px] px-3 text-[12px] font-semibold capitalize ${
                gran === gk ? "bg-secondary text-foreground" : "bg-transparent text-muted-foreground"
              }`}
            >
              {gk}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <Button variant="secondary" size="icon" className="size-9" aria-label="Previous" onClick={() => step(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
          </Button>
          <Button variant="secondary" size="sm" onClick={goToday}>Today</Button>
          <Button variant="secondary" size="icon" className="size-9" aria-label="Next" onClick={() => step(1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
          </Button>
        </div>
        <div className="text-[15px] font-bold text-foreground">{headerLabel}</div>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onNew}><Plus size={15} /> New post</Button>
      </div>

      {gran === "month" && (
        <MonthGrid year={cursor.year} month={cursor.month} today={today} posts={posts} onEdit={onEdit} />
      )}
      {gran === "week" && (
        <WeekColumns startMs={weekStartMs(cursorMs)} posts={posts} mediaLookup={mediaLookup} onEdit={onEdit} />
      )}
      {gran === "day" && (
        <DayTimeline year={cursor.year} month={cursor.month} day={cursor.day} posts={posts} mediaLookup={mediaLookup} onEdit={onEdit} />
      )}
    </div>
  );
}

function weekStartMs(ms: number): number {
  const d = new Date(ms);
  return ms - d.getUTCDay() * 86400000; // back up to Sunday
}
function weekRangeLabel(ms: number): string {
  const start = new Date(weekStartMs(ms));
  const end = new Date(weekStartMs(ms) + 6 * 86400000);
  return `${MONTHS[start.getUTCMonth()].slice(0, 3)} ${start.getUTCDate()} – ${MONTHS[end.getUTCMonth()].slice(0, 3)} ${end.getUTCDate()}`;
}

function MonthGrid({
  year,
  month,
  today,
  posts,
  onEdit,
}: {
  year: number;
  month: number;
  today: { year: number; month: number; day: number };
  posts: ScheduledPostRow[];
  onEdit: (p: ScheduledPostRow) => void;
}) {
  const { weeks } = useMemo(() => buildMonthGrid(year, month, posts), [year, month, posts]);
  const todayKey = `${today.year}-${String(today.month + 1).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  return (
    <div className="rounded-[16px] border border-border bg-card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="px-2 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.05em] text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((cell) => {
          const shown = cell.posts.slice(0, 3);
          const overflow = cell.posts.length - shown.length;
          return (
            <div
              key={cell.key}
              className={`min-h-[92px] border-b border-r border-border p-1.5 flex flex-col gap-1 ${cell.inMonth ? "" : "bg-secondary/40"}`}
            >
              <div className={`text-[11px] font-semibold ${cell.key === todayKey ? "text-brand" : cell.inMonth ? "text-foreground" : "text-muted-foreground/60"}`}>
                {cell.day}
              </div>
              {shown.map((post) => {
                const pill = statusPill(post.status);
                return (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => onEdit(post)}
                    title={post.caption}
                    className={`flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[10.5px] font-medium ${tonePill(pill.tone)} truncate`}
                  >
                    <ChannelIcon channel={post.channel} size={11} />
                    <span className="truncate">{post.caption || "Post"}</span>
                  </button>
                );
              })}
              {overflow > 0 && <div className="text-[10.5px] font-semibold text-muted-foreground pl-1">+{overflow} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekColumns({
  startMs,
  posts,
  mediaLookup,
  onEdit,
}: {
  startMs: number;
  posts: ScheduledPostRow[];
  mediaLookup: MediaLookup;
  onEdit: (p: ScheduledPostRow) => void;
}) {
  // 7 day-key columns from the Sunday start.
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startMs + i * 86400000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      return { key, weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() };
    });
  }, [startMs]);
  const byDay = useMemo(() => {
    const m = new Map<string, ScheduledPostRow[]>();
    for (const post of posts) {
      const k = dayKey(partsInTz(post.scheduledAt, post.scheduledTz));
      const arr = m.get(k) ?? [];
      arr.push(post);
      m.set(k, arr);
    }
    return m;
  }, [posts]);

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => (
        <div key={d.key} className="rounded-[12px] border border-border bg-card min-h-[180px] p-2">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.05em] mb-2 text-center">
            {DAYS_SHORT[d.weekday]} {d.day}
          </div>
          <div className="flex flex-col gap-1.5">
            {(byDay.get(d.key) ?? []).map((post) => {
              const p = partsInTz(post.scheduledAt, post.scheduledTz);
              const pill = statusPill(post.status);
              const firstMedia = post.media[0] ? mediaLookup.get(post.media[0].generationId) : undefined;
              return (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => onEdit(post)}
                  className="flex flex-col gap-1 rounded-[9px] border border-border bg-secondary/40 p-1.5 text-left hover:bg-secondary transition-colors"
                >
                  <Thumb item={firstMedia} size={32} />
                  <div className="flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground">
                    <ChannelIcon channel={post.channel} size={11} /> {formatTime(p)}
                  </div>
                  <div className="text-[11px] text-foreground line-clamp-2">{post.caption || "Post"}</div>
                  <span className={`self-start rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ${tonePill(pill.tone)}`}>{pill.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function DayTimeline({
  year,
  month,
  day,
  posts,
  mediaLookup,
  onEdit,
}: {
  year: number;
  month: number;
  day: number;
  posts: ScheduledPostRow[];
  mediaLookup: MediaLookup;
  onEdit: (p: ScheduledPostRow) => void;
}) {
  const targetKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const dayPosts = useMemo(() => {
    return posts
      .map((post) => ({ post, p: partsInTz(post.scheduledAt, post.scheduledTz) }))
      .filter(({ p }) => dayKey(p) === targetKey);
  }, [posts, targetKey]);
  const byHour = useMemo(() => {
    const m = new Map<number, { post: ScheduledPostRow; p: ReturnType<typeof partsInTz> }[]>();
    for (const e of dayPosts) {
      const arr = m.get(e.p.hour) ?? [];
      arr.push(e);
      m.set(e.p.hour, arr);
    }
    return m;
  }, [dayPosts]);

  return (
    <div className="rounded-[16px] border border-border bg-card overflow-hidden">
      {Array.from({ length: 24 }, (_, h) => {
        const items = byHour.get(h) ?? [];
        const ampm = h < 12 ? "AM" : "PM";
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return (
          <div key={h} className="flex border-b border-border last:border-b-0 min-h-[44px]">
            <div className="w-[62px] shrink-0 px-2 py-2 text-[11px] font-semibold text-muted-foreground border-r border-border">{h12} {ampm}</div>
            <div className="flex-1 p-1.5 flex flex-wrap gap-1.5">
              {items.map(({ post, p }) => {
                const pill = statusPill(post.status);
                const firstMedia = post.media[0] ? mediaLookup.get(post.media[0].generationId) : undefined;
                return (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => onEdit(post)}
                    className="flex items-center gap-2 rounded-[9px] border border-border bg-secondary/40 px-2 py-1.5 text-left hover:bg-secondary transition-colors max-w-full"
                  >
                    <Thumb item={firstMedia} size={28} />
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-[6px] bg-accent text-foreground shrink-0">
                      <ChannelIcon channel={post.channel} size={12} />
                    </span>
                    <span className="text-[11px] font-semibold text-muted-foreground shrink-0">{formatTime(p)}</span>
                    <span className="text-[12px] text-foreground truncate max-w-[220px]">{post.caption || "Post"}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tonePill(pill.tone)}`}>{pill.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── (3) Queue (full) ──

function QueueView({
  posts,
  mediaLookup,
  channelFilter,
  onChannelFilter,
  onEdit,
  onNew,
}: {
  posts: ScheduledPostRow[];
  mediaLookup: MediaLookup;
  channelFilter: ChannelFilter;
  onChannelFilter: (v: ChannelFilter) => void;
  onEdit: (p: ScheduledPostRow) => void;
  onNew: () => void;
}) {
  const filtered = useMemo(
    () => posts.filter((p) => channelFilter === "all" || p.channel === channelFilter),
    [posts, channelFilter],
  );
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <ChannelFilterBar value={channelFilter} onChange={onChannelFilter} />
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onNew}><Plus size={15} /> New post</Button>
      </div>
      <QueueList posts={filtered} mediaLookup={mediaLookup} onEdit={onEdit} emptyText="No posts yet. Add one or ask OTTO to plan your week." />
    </div>
  );
}

// ── Composer ──

type ComposerSeed = {
  mode: "create" | "edit";
  id?: string;
  channel: ChannelId;
  caption: string;
  media: string[]; // generationIds
  dateKey: string; // y-mm-dd
  time: string; // HH:MM
  tz: string;
  firstComment: string;
  metaTargetId: string | null;
  status?: string;
};

/** Turn a local (dateKey,time) in tz into a UTC instant. We build the naive local time,
 *  then correct by the tz offset AT that instant (probe once, deterministic — no DST edge
 *  handling beyond a single offset lookup, which is fine for scheduling). */
function localToUtcIso(dateKey: string, time: string, tz: string): string | null {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if ([y, mo, d, hh, mm].some((n) => Number.isNaN(n))) return null;
  // Guess UTC = same wall-clock in UTC, then measure how far that guess lands from the
  // wanted wall time in tz and subtract the difference.
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const asParts = partsInTz(new Date(guess), tz);
  const landed = Date.UTC(asParts.year, asParts.month, asParts.day, asParts.hour, asParts.minute);
  const offset = landed - guess; // tz is ahead of UTC by `offset`
  return new Date(guess - offset).toISOString();
}

function Composer({
  seed,
  channels,
  targets,
  mediaChoices,
  onClose,
  onConnect,
  onSaved,
}: {
  seed: ComposerSeed;
  channels: ChannelId[];
  targets: OwnerTarget[];
  mediaChoices: StuffItem[];
  onClose: () => void;
  onConnect: () => void;
  onSaved: () => Promise<void>;
}) {
  const [channel, setChannel] = useState<ChannelId>(seed.channel);
  const [caption, setCaption] = useState(seed.caption);
  const [media, setMedia] = useState<string[]>(seed.media);
  const [dateKey, setDateKey] = useState(seed.dateKey);
  const [time, setTime] = useState(seed.time);
  const [tz, setTz] = useState(seed.tz);
  const [firstComment, setFirstComment] = useState(seed.firstComment);
  const [metaTargetId, setMetaTargetId] = useState<string | null>(seed.metaTargetId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cap = channelMeta(channel)?.capabilities;
  const maxMedia = cap?.maxMediaCount ?? 10;
  const supportsFirstComment = cap?.supportsFirstComment ?? false;
  const editable = seed.mode === "create" || seed.status === "DRAFT";

  // Account/page picker options for the SELECTED channel. A picked target must belong to
  // the channel being posted to (mirrors the server's owner-scoped approve check).
  const channelTargets = useMemo(() => targets.filter((t) => t.channel === channel), [targets, channel]);
  const noTargets = channelTargets.length === 0;

  // Switching channel drops a target that no longer belongs, so we never submit a mismatched
  // id (done in the handler, not an effect — derived-on-event, not synchronized-via-effect).
  function changeChannel(next: ChannelId) {
    setChannel(next);
    if (metaTargetId && !targets.some((t) => t.channel === next && t.id === metaTargetId)) {
      setMetaTargetId(null);
    }
  }
  // Approve = DRAFT→SCHEDULED, which the server rejects without a resolved owner-owned target.
  // Gate it in the UI too: no target picked (or none connectable) → approve disabled.
  const canApprove = editable && !!metaTargetId;

  function toggleMedia(genId: string) {
    setMedia((cur) => {
      if (cur.includes(genId)) return cur.filter((m) => m !== genId);
      if (cur.length >= maxMedia) return cur; // channel cap
      return [...cur, genId];
    });
  }

  async function persist(approve: boolean) {
    setError(null);
    const iso = localToUtcIso(dateKey, time, tz);
    if (!iso) return setError("Pick a valid date and time.");
    if (!caption.trim()) return setError("A post needs a caption.");
    setBusy(true);
    try {
      let id = seed.id;
      if (seed.mode === "create") {
        const res = await createScheduledPost({
          channel: channel as "instagram" | "facebook",
          caption,
          scheduledAt: iso,
          scheduledTz: tz,
          media,
          firstComment: supportsFirstComment && firstComment.trim() ? firstComment : undefined,
          metaTargetId: metaTargetId ?? undefined,
        });
        if ("error" in res) { setError(res.error); return; }
        id = res.id;
      } else {
        const res = await updateScheduledPost(seed.id!, {
          caption,
          scheduledAt: iso,
          scheduledTz: tz,
          firstComment: supportsFirstComment && firstComment.trim() ? firstComment : null,
          metaTargetId,
        });
        if ("error" in res) { setError(res.error); return; }
      }
      // Approve → DRAFT→SCHEDULED (needs a resolved target + media; the server re-validates).
      if (approve && id) {
        const res = await approveScheduledPost(id);
        if ("error" in res) { setError(res.error); return; }
      }
      await onSaved();
    } catch {
      setError("Couldn't save that — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelPost() {
    if (!seed.id) return;
    setBusy(true);
    setError(null);
    const res = await cancelScheduledPost(seed.id);
    setBusy(false);
    if ("error" in res) { setError(res.error); return; }
    await onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[min(560px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{seed.mode === "create" ? "New post" : "Edit post"}</DialogTitle>
          <DialogDescription>
            Reuse media you&rsquo;ve already made — scheduling never generates anything new. Nothing
            publishes until Meta approves; approving just queues it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 max-h-[62vh] overflow-auto pr-1">
          {/* Channel */}
          <Field label="Channel">
            <div className="flex gap-1.5">
              {channels.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={!editable}
                  onClick={() => changeChannel(c)}
                  className={`inline-flex items-center gap-1.5 h-9 rounded-[10px] border px-3 text-[13px] font-semibold ${
                    channel === c ? "border-foreground bg-secondary text-foreground" : "border-border bg-card text-muted-foreground"
                  } disabled:opacity-50`}
                >
                  <ChannelIcon channel={c} size={14} /> {channelMeta(c)?.label ?? c}
                </button>
              ))}
            </div>
            {cap && (
              <div className="text-[11.5px] text-muted-foreground mt-1">
                {channel === "instagram" ? "Feed image or carousel · up to 10 media" : "Single feed image"}
                {cap.rateLimitPer24h ? ` · ${cap.rateLimitPer24h}/day limit` : ""}
              </div>
            )}
          </Field>

          {/* Account / page — required to approve (sets metaTargetId). Options are the owner's
              own publishable targets for this channel; empty = nothing to post to yet. */}
          <Field label="Account">
            {noTargets ? (
              <div className="flex items-center gap-2 rounded-[10px] border border-dashed border-border p-3 text-[12px] text-muted-foreground">
                <span className="flex-1">Connect an account first — you can save a draft now, but approving needs a page to post to.</span>
                <Button variant="secondary" size="sm" type="button" onClick={onConnect}>
                  <Plus size={14} /> Connect
                </Button>
              </div>
            ) : (
              <select
                value={metaTargetId ?? ""}
                disabled={!editable}
                onChange={(e) => setMetaTargetId(e.target.value || null)}
                className="w-full h-9 rounded-[10px] border border-border bg-card px-2.5 text-[13px] font-semibold disabled:opacity-60"
              >
                <option value="">Choose an account…</option>
                {channelTargets.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </Field>

          {/* Media picker (already-generated only) */}
          <Field label={`Media ${media.length ? `· ${media.length}/${maxMedia}` : ""}`}>
            {mediaChoices.length === 0 ? (
              <div className="text-[12px] text-muted-foreground rounded-[10px] border border-dashed border-border p-3">
                No media yet. Make something on the canvas first — Schedule reuses your existing images and videos (it never generates new ones here).
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-1.5 max-h-[160px] overflow-auto">
                {mediaChoices.map((m) => {
                  const idx = media.indexOf(m.label);
                  const selected = idx >= 0;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={!editable}
                      onClick={() => toggleMedia(m.label)}
                      className={`relative aspect-square rounded-[9px] overflow-hidden border-2 ${selected ? "border-brand" : "border-border"} disabled:opacity-50`}
                    >
                      {m.mediaKind === "video" ? (
                        <video src={m.url ?? undefined} muted preload="metadata" className="w-full h-full object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url ?? undefined} alt="" loading="lazy" className="w-full h-full object-cover" />
                      )}
                      {selected && (
                        <span className="absolute top-0.5 right-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand text-brand-foreground text-[9px] font-bold">{idx + 1}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {/* Caption */}
          <Field label="Caption">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={!editable}
              rows={4}
              placeholder="Write your caption…"
              className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-[13px] resize-none disabled:opacity-60"
            />
            <button
              type="button"
              disabled
              title="Coming soon — OTTO will draft this from your brand memory."
              className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground opacity-60 cursor-default"
            >
              <CoralCloud size={16} /> Ask OTTO to write it
            </button>
          </Field>

          {/* First comment (channel-gated) */}
          {supportsFirstComment && (
            <Field label="First comment (optional)">
              <input
                value={firstComment}
                onChange={(e) => setFirstComment(e.target.value)}
                disabled={!editable}
                placeholder="Hashtags or a link…"
                className="w-full h-9 rounded-[10px] border border-border bg-card px-3 text-[13px] disabled:opacity-60"
              />
            </Field>
          )}

          {/* Date / time / tz */}
          <div className="grid grid-cols-3 gap-2">
            <Field label="Date">
              <input type="date" value={dateKey} disabled={!editable} onChange={(e) => setDateKey(e.target.value)} className="w-full h-9 rounded-[10px] border border-border bg-card px-2.5 text-[13px] disabled:opacity-60" />
            </Field>
            <Field label="Time">
              <input type="time" value={time} disabled={!editable} onChange={(e) => setTime(e.target.value)} className="w-full h-9 rounded-[10px] border border-border bg-card px-2.5 text-[13px] disabled:opacity-60" />
            </Field>
            <Field label="Time zone">
              <select value={tz} disabled={!editable} onChange={(e) => setTz(e.target.value)} className="w-full h-9 rounded-[10px] border border-border bg-card px-2 text-[13px] font-semibold disabled:opacity-60">
                {SCHEDULE_TZS.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </Field>
          </div>
        </div>

        {error && <div role="alert" className="text-[12.5px] text-[var(--error-soft-foreground)]">{error}</div>}

        <DialogFooter className="flex-wrap">
          {seed.mode === "edit" && seed.status && seed.status !== "CANCELLED" && seed.status !== "PUBLISHED" && (
            <Button variant="ghost" size="sm" className="mr-auto text-[var(--error-soft-foreground)]" disabled={busy} onClick={cancelPost}>
              <X size={14} /> Cancel post
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={busy || !editable} onClick={() => persist(false)}>
            {busy ? "Saving…" : "Save draft"}
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={busy || !canApprove}
            title={editable && !metaTargetId ? "Pick an account to approve" : undefined}
            onClick={() => persist(true)}
          >
            {busy ? "Saving…" : "Approve & schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold text-foreground">{label}</span>
      {children}
    </label>
  );
}

export default OttoSchedule;
