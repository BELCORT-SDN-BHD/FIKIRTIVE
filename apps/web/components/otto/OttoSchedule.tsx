"use client";
import React, { useState, useEffect, useMemo, useCallback, useRef, useTransition } from "react";
import { Plus, X, Check, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { OttoViewKey } from "./OttoApp";
import { isGenerationBackedItem, type StuffItem } from "@/lib/stuff-items";
import {
  listScheduledPosts,
  listOwnerTargets,
  createScheduledPost,
  updateScheduledPost,
  approveScheduledPost,
  cancelScheduledPost,
  type ScheduledPostRow,
} from "@/lib/schedule-actions";
import { getMetaConnection } from "@/lib/meta-actions";
import { getOwnerSettings, setOwnerSetting } from "@/lib/owner-settings-actions";
import { autoPublishHint } from "@/lib/auto-publish-gate";
// Whether a post can actually reach a social account today, and the ONE set of words for saying so
// (#851). This screen is the surface a merchant is most likely to read as "send" — so it states the
// answer itself rather than hoping the merchant infers it from a greyed-out switch.
import { publishPreviewBadge, publishSurfaceCopy, publishSurfaceLines } from "@fikirtive/core/schedule-draft";
import { CONNECTABLE_CHANNEL_META, channelMeta, isConnectableChannel } from "@/lib/channels/channel-meta";
// The single source of "which accounts is this merchant connected to right now" and the ONE
// derived judgement built on it (#741 r2). This screen never touches the raw list — the type
// makes that impossible — so Plan, the composer and "Approve all" cannot drift apart again.
import {
  ACCOUNTS_CHECK_FAILED,
  ACCOUNTS_LOADING,
  CHECKING_ACCOUNTS_BLOCKER,
  accountPicker,
  accountsUnreadable,
  approvalFor,
  autoPublishAllowed,
  blockedConnection,
  canOfferConnect,
  channelUnavailableBlocker,
  connectionBlockerStatus,
  isConnectedTarget,
  loadedAccounts,
  markRechecking,
  postableChannelIds,
  UNREAD_ACCOUNTS,
  type ConnectedAccounts,
} from "@/lib/schedule-connections";
import type { ChannelId, ChannelCapabilities } from "@/lib/channels/types";
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

// A generationId → thumbnail lookup, built from Library gen items. Media rows store
// generationId; History thumbs carry the same id, so this maps posts to their preview.
type MediaLookup = Map<string, { url: string | null; kind: StuffItem["mediaKind"] }>;

// The ONE media key this whole screen uses — generationId, the same key the media rows,
// the server's owner-scoped check, and the Otto skills all speak (#691). A gen item's
// `label` is its PROMPT TEXT (stuff-items.ts: `h.prompt || h.id`) — display copy only,
// never a key. Keying off label sent prompt text where the server expected a Generation.id,
// so every real (prompted) generation failed its ownership check and no media post could
// be scheduled. Narrowing here makes the key non-optional at every use site below.
type MediaChoice = StuffItem & { generationId: string };

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

/** Brand glyphs keyed by channel id (E4-16 / contract 6: data-driven dispatch — adding a channel is
 *  one map entry, no if-chain). currentColor-driven; lucide dropped brand icons so these are inline. */
const CHANNEL_GLYPHS: Record<string, (size: number) => React.ReactElement> = {
  instagram: (size) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  ),
  facebook: (size) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14 8.5V7c0-.83.67-1 1-1h1.5V3.5H14C12.07 3.5 11 4.9 11 6.8V8.5H9V11h2v9.5h3V11h2.1l.4-2.5H14Z" />
    </svg>
  ),
  x: (size) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
};

function ChannelIcon({ channel, size = 15 }: { channel: string; size?: number }) {
  return CHANNEL_GLYPHS[channel]?.(size) ?? null;
}

/** Data-driven capability blurb (E4-16: UI copy from CHANNEL_META capabilities, no per-channel-name
 *  ternary). Adding a channel needs no edit here. */
function capsBlurb(cap: ChannelCapabilities): string {
  if (cap.maxMediaCount <= 0) return "Text posts · media coming soon";
  if (cap.maxMediaCount === 1) return "Single feed image";
  return cap.postTypes.includes("carousel")
    ? `Feed image or carousel · up to ${cap.maxMediaCount} media`
    : `Up to ${cap.maxMediaCount} photos or a video`;
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
  // THE connection state for this screen (#741 r2/r3). Explicitly two-phase: ACCOUNTS_LOADING until
  // BOTH platform reads land, then loadedAccounts({...}) — where an empty list is a real answer.
  // Header chips, the auto-publish switch, the composer's account picker and "Approve all" all
  // derive from this one value through lib/schedule-connections, so they cannot disagree with each
  // other or with the server. There is deliberately no second connection state on this screen: the
  // one it used to have (`conn` + `canPublish`, fed by their own getMetaConnection call) is exactly
  // how the header and the plan card ended up describing the same instant differently.
  const [accounts, setAccounts] = useState<ConnectedAccounts>(ACCOUNTS_LOADING);
  const [autoPublish, setAutoPublish] = useState(false);
  const [defaultTz, setDefaultTz] = useState<string>("Asia/Kuala_Lumpur");
  const [savingAuto, setSavingAuto] = useState(false);
  const [composer, setComposer] = useState<ComposerSeed | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");

  // Generated-media lookup (generationId → thumb) for post previews + the media picker. Keyed by
  // generationId — what post.media rows actually store (see the lookups in QueueList/Calendar).
  // #704: every source whose items ARE a generation, not just Library history. Otto's
  // schedulePosts accepts any generationId the merchant owns, and an ad build's id IS a
  // Generation.id — reading only `gen` left those posts showing a grey block for media that
  // was right there. Recognising media is not the same as offering it: mediaChoices below
  // still lists only what the picker has always listed.
  const mediaLookup = useMemo<MediaLookup>(() => {
    const m: MediaLookup = new Map();
    for (const s of stuffItems) {
      if (isGenerationBackedItem(s)) m.set(s.generationId, { url: s.url, kind: s.mediaKind });
    }
    return m;
  }, [stuffItems]);
  // Selectable media = already-generated items with a preview (never regenerated → $0) AND a
  // generationId to select them BY — an item with no key can't be scheduled, so it isn't offered.
  const mediaChoices = useMemo<MediaChoice[]>(
    () => stuffItems.filter((s): s is MediaChoice => s.source === "gen" && !!s.url && !!s.generationId),
    [stuffItems],
  );

  // focus/visibilitychange/60s-poll can all fire reload() concurrently; a slower older
  // request landing after a newer one would clobber fresh data. Sequence guard: only the
  // still-latest call is allowed to write state.
  const reloadSeq = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++reloadSeq.current;
    // ONE refresh, both facts (#741 r2). The connection list used to be read once at mount while
    // posts refreshed on focus/60s — so a merchant who disconnected in another tab kept seeing a
    // draft the server would refuse. Both reads are issued by this call and share its sequence
    // guard; a failed connection read leaves the previous state rather than inventing
    // "nothing connected" (the next cycle retries, so "Checking…" stays literally true).
    const postsPromise = listScheduledPosts();
    // BOTH platform reads, one answer (#741 r3 P1). The publish permission used to be a second
    // read on its own timeline; it now rides this one, and the screen commits to a connection state
    // only from this single value — so "accounts loaded empty while the permission read is still in
    // flight" is not a state this screen can be in. Cost: getMetaConnection joins the 60s cycle
    // (one more platform call per refresh), which is the price of one honest answer.
    //
    // #741 r5 P1: EVERY outcome produces a state, including failure. A failed read is a finished
    // read whose answer is "we could not find out" (carried per channel), never a reason to sit in
    // "Checking…" forever and never a reason to keep last cycle's list alive — an old list shown as
    // if it were current is worse than saying nothing, because the screen would go on counting
    // those posts ready while the server would refuse them.
    const connectionPromise = Promise.all([
      listOwnerTargets().catch(() => null),
      getMetaConnection().then(
        (meta) => !("error" in meta) && meta.canPublish === true,
        () => false,
      ),
    ]);
    // Not awaited together with the posts: a slow connection read must not hold the schedule
    // hostage. While it is in flight the screen stays in "checking", which is literally true.
    void connectionPromise.then(([targetsRead, canPublish]) => {
      if (seq !== reloadSeq.current) return;
      // The server's answer is spread through WHOLE — this screen never authors a channel state
      // of its own, and the "request failed" case is a value the authority module owns.
      setAccounts(targetsRead ? loadedAccounts({ ...targetsRead, canPublish }) : UNREAD_ACCOUNTS);
    });
    const rows = await postsPromise;
    if (seq !== reloadSeq.current) return;
    setPosts(rows);
    setLoading(false);
    // Keep an open composer's status/lastError current (e.g. a NEEDS_ATTENTION landing
    // mid-edit). Composer itself decides whether it's safe to display — it won't clobber
    // unsaved field edits.
    setComposer((prev) => {
      if (!prev || prev.mode !== "edit" || !prev.id) return prev;
      const match = rows.find((r) => r.id === prev.id);
      if (!match || (match.status === prev.status && match.lastError === prev.lastError)) return prev;
      return { ...prev, status: match.status, lastError: match.lastError };
    });
  }, []);

  /**
   * The same read, over an answer we already have (#741 r5 P1).
   *
   * `seq` stops a stale RESPONSE from overwriting a newer one, but it never stopped the stale
   * ANSWER from being read while the next one was in flight. Saying so first — before the read is
   * issued — is what keeps a hung refresh from leaving posts approvable on facts we are at that
   * very moment re-checking. The list itself stays on screen, so the merchant's own channels don't
   * blink out every minute; it just stops counting as ready.
   *
   * This is separate from `reload` because it belongs to the EVENT that re-reads (poll tick, focus,
   * Retry, save), not to the first read: at mount there is no previous answer to invalidate —
   * `markRechecking` is a no-op on a value that has never loaded — and a setState called
   * synchronously from an effect body is a cascading render React tells us not to write.
   */
  const refresh = useCallback(async () => {
    setAccounts(markRechecking);
    await reload();
  }, [reload]);

  useEffect(() => {
    // Async initial load — every setState below runs after an await/`.then`, never
    // synchronously in the effect body (the lint rule can't see through the promise).
    // `reload`, not `refresh`: nothing has been read yet, so there is nothing to un-trust.
    void reload();
    // Neither the target list nor the publish permission is read here any more: reload() owns
    // both, so the first load and every later refresh follow the same single timeline (#741 r2/r3).
    void getOwnerSettings().then((s) => {
      if (!("error" in s)) {
        setAutoPublish(s.autoPublish);
        setDefaultTz(s.timezone);
      }
    });
  }, [reload]);

  // Minimal real-time-ish refresh: nothing else in this screen pushes updates (no
  // websocket/SSE), so a status flip (e.g. worker lands NEEDS_ATTENTION) is otherwise
  // invisible until the user manually reloads the page. Refetch on focus/visibility, plus
  // a bounded 60s poll while the tab is visible — paused (not just idle) while hidden.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    function startPolling() {
      if (interval || document.visibilityState !== "visible") return;
      interval = setInterval(() => void refresh(), 60000);
    }
    function stopPolling() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    }
    function onFocus() {
      void refresh();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refresh();
        startPolling();
      } else {
        stopPolling();
      }
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    startPolling();
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopPolling();
    };
  }, [refresh]);

  async function toggleAutoPublish(next: boolean) {
    setSavingAuto(true);
    setAutoPublish(next); // optimistic
    const res = await setOwnerSetting("autoPublish", next);
    setSavingAuto(false);
    if ("error" in res) setAutoPublish(!next); // roll back
  }

  // Postable channels = those with at least one real publishable target. Stricter than "a Meta
  // connection exists": an ads-only connection (no page scope) yields no targets, so no channel
  // shows as postable. Derived from the one connection state — empty while it is still unknown.
  const postable = useMemo(() => postableChannelIds(accounts), [accounts]);
  const connectedChannels = useMemo(
    () => CONNECTABLE_CHANNEL_META.filter((c) => postable.has(c.id)),
    [postable],
  );

  const isConnected = connectedChannels.length > 0;
  // Same single source, same "unknown never unlocks anything" rule as everything else on the screen.
  const autoPublishAvailable = autoPublishAllowed(accounts);
  const headerBlocker = blockedConnection(accounts);
  // Whether posts can actually go out, and the words for saying so. A product fact, not a fact
  // about this merchant's workspace — so it needs no read, no state and no loading branch (#851).
  const publishCopy = publishSurfaceCopy();
  const previewBadge = publishPreviewBadge();

  function openNew() {
    setComposer({
      mode: "create",
      channel: connectedChannels[0]?.id ?? CONNECTABLE_CHANNEL_META[0]?.id ?? "instagram",
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
      lastError: post.lastError,
    });
  }

  return (
    <div className="gb leading-[1.5] flex-1 overflow-auto">
      <div className="mx-auto max-w-[920px] px-7 py-6">
        {/* ── Shared header ── */}
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <h1 className="text-[1.5rem] font-bold tracking-[-0.02em]">Schedule</h1>
          {/* #851 — the merchant must know BEFORE they write anything that the sending half is not
              on. The word and the sentence behind it both come from the publish authority, so the
              day it is switched on the badge disappears with nothing else to edit. */}
          {previewBadge && (
            <Badge variant="warning" title={publishCopy.fact}>
              {previewBadge}
            </Badge>
          )}
          <div className="flex items-center gap-1.5">
            {/* Chips and the status notice are NOT alternatives (#741 r5 P1). When one channel
                read fine and another did not, the old if/else took the "connected" branch and
                swallowed the "couldn't check" line with its Retry — the partial truncation went
                silent again, which is the exact failure this ticket keeps re-finding. */}
            {isConnected &&
              connectedChannels.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1.5 h-[28px] rounded-full border border-border bg-card px-3 text-[12px] font-semibold text-foreground"
                >
                  <ChannelIcon channel={c.id} size={13} />
                  {c.label}
                </span>
              ))}
            {!isConnected && canOfferConnect(accounts) ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onNavigate("connections")}
                className="h-[28px] gap-1.5 rounded-full border-dashed border-border bg-card px-3 text-[12px] font-semibold text-muted-foreground hover:bg-card hover:text-foreground"
              >
                <Plus size={13} />
                Connect a channel
              </Button>
            ) : accountsUnreadable(accounts) ? (
              // The read came back empty-handed. Say so, and give the merchant the one action that
              // can change it — a silent retry loop they cannot see or trigger is not an answer.
              <span role="status" className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                {ACCOUNTS_CHECK_FAILED}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void refresh()}
                  className="h-[28px] rounded-full border-border bg-card px-3 font-semibold text-foreground hover:bg-card"
                >
                  Retry
                </Button>
              </span>
            ) : headerBlocker ? (
              // Connected, but not usable. Stated on the screen itself so a merchant with an empty
              // schedule still learns it — and pointed at the flow that actually fixes it.
              <span role="status" className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                {connectionBlockerStatus(headerBlocker)}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onNavigate("connections")}
                  className="h-[28px] rounded-full border-border bg-card px-3 font-semibold text-foreground hover:bg-card"
                >
                  Reconnect
                </Button>
              </span>
            ) : null}
          </div>
          <div className="flex-1" />
          {/* OTTO auto-publish toggle. #791-2: this is now the switch the publish scheduler
              actually reads (apps/worker scanDuePublishPosts) — off means approved posts wait.

              #851 — the sentence comes from autoPublishHint, which weighs BOTH gates: this
              workspace's own connection AND whether the product can send at all. Asking only the
              first one is how the enabled branch came to promise a working send on the very same
              screen whose banner says nothing goes out. */}
          <label
            className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground select-none"
            title={autoPublishHint(autoPublishAvailable)}
          >
            <Switch checked={autoPublish} onCheckedChange={toggleAutoPublish} disabled={savingAuto || !autoPublishAvailable} aria-label="Otto auto-publish" />
            Auto-publish
          </label>
          {/* View switcher */}
          <div className="inline-flex rounded-[10px] border border-border bg-card p-0.5">
            {(["plan", "calendar", "queue"] as ViewKey[]).map((v) => (
              <Button
                key={v}
                type="button"
                variant="ghost"
                onClick={() => setView(v)}
                className={`h-[30px] rounded-[8px] px-3 text-[12px] font-semibold ${
                  view === v ? "bg-secondary text-foreground hover:bg-secondary" : "bg-transparent text-muted-foreground hover:bg-transparent"
                }`}
              >
                {v === "plan" ? "Plan" : v === "calendar" ? "Calendar" : "Queue"}
              </Button>
            ))}
          </div>
        </div>

        {/* ── Always-on banner: what this screen does and does not do ──
            #851 — this used to explain the auto-publish switch and nothing else, which left the
            bigger fact ("nothing here reaches a social account at all") to be guessed. Every
            sentence now comes from the publish authority, in its reading order: the fact, why,
            what is still real, and what comes next — with no date attached to that last one. */}
        <div className="flex items-start gap-[11px] bg-[#FFF6F2] border border-[#FBD9C9] rounded-[14px] px-[15px] py-[12px] mb-4">
          <CoralCloud size={22} />
          <span className="flex-1 text-[13px] leading-[1.5] text-[#9A3A1A] flex flex-col gap-1">
            {publishSurfaceLines().map((line) => (
              <span key={line}>{line}</span>
            ))}
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
            onReload={refresh}
            accounts={accounts}
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
          // Nothing connected yet ⇒ offer the channels a merchant can actually connect, never
          // "all of them" (#694): the old fallback put X in front of brand-new merchants, whose
          // Connect button led to a Connections row with nothing to press.
          channels={connectedChannels.length ? connectedChannels.map((c) => c.id) : CONNECTABLE_CHANNEL_META.map((c) => c.id)}
          accounts={accounts}
          mediaChoices={mediaChoices}
          onClose={() => setComposer(null)}
          onConnect={() => {
            setComposer(null);
            onNavigate("connections");
          }}
          onRetry={() => void refresh()}
          onSaved={async () => {
            setComposer(null);
            await refresh();
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
    // Same filter as the composer (#694): a channel nobody can connect can't have posts to filter.
    ...CONNECTABLE_CHANNEL_META.map((c) => ({ key: c.id, label: c.label })),
  ];
  return (
    <div className="inline-flex gap-1.5">
      {opts.map((o) => (
        <Button
          key={o.key}
          type="button"
          variant="outline"
          onClick={() => onChange(o.key)}
          className={`h-[28px] rounded-full px-3 text-[12px] font-semibold ${
            value === o.key ? "border-foreground bg-secondary text-foreground hover:bg-secondary" : "border-border bg-card text-muted-foreground hover:bg-card"
          }`}
        >
          {o.label}
        </Button>
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
                <Button
                  key={post.id}
                  type="button"
                  variant="outline"
                  onClick={() => onEdit(post)}
                  className="h-auto w-full justify-start gap-3 rounded-[12px] border-border bg-card px-3 py-2.5 text-left font-normal hover:bg-secondary/60"
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
                </Button>
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
  accounts,
}: {
  posts: ScheduledPostRow[];
  mediaLookup: MediaLookup;
  channelFilter: ChannelFilter;
  onChannelFilter: (v: ChannelFilter) => void;
  onEdit: (p: ScheduledPostRow) => void;
  onNew: () => void;
  onReload: () => Promise<void>;
  /** The one connection state (see lib/schedule-connections) — never the raw list. */
  accounts: ConnectedAccounts;
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
        <PlanCard posts={proposed} mediaLookup={mediaLookup} onEdit={onEdit} onReload={onReload} accounts={accounts} />
      ) : (
        /* Same shape as the Analytics banner (#697): the button keeps its own width, so
           without flex-wrap and a minimum for the copy the empty-state sentence collapsed
           into a narrow ribbon on a phone. */
        <div className="rounded-[16px] border border-border bg-card p-[18px] flex flex-wrap items-center gap-3">
          <CoralCloud size={28} />
          <div className="min-w-[220px] flex-1">
            <div className="text-[14px] font-semibold text-foreground">No plan from Otto yet</div>
            <div className="text-[13px] text-muted-foreground">
              Ask Otto to plan your week — say something like &ldquo;post 3 times this week&rdquo; and Otto will draft a schedule for you to approve.
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
        <QueueList posts={queue} mediaLookup={mediaLookup} onEdit={onEdit} emptyText="Nothing queued yet. Approve Otto's plan or add a post." />
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
  accounts,
}: {
  posts: ScheduledPostRow[];
  mediaLookup: MediaLookup;
  onEdit: (p: ScheduledPostRow) => void;
  onReload: () => Promise<void>;
  accounts: ConnectedAccounts;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => groupByDay(posts), [posts]);

  // The SAME derived judgement the composer shows and the server enforces (#741 r2) — including
  // its loading semantics: while the connection state is unknown nothing counts as ready, so this
  // card can no longer wave a post through while the composer accuses it of having no account.
  const approvals = useMemo(
    () =>
      posts.map((p) =>
        approvalFor(accounts, { channel: p.channel, targetId: p.metaTargetId, mediaCount: p.media.length }),
      ),
    [posts, accounts],
  );
  const approvable = useMemo(
    () => posts.filter((_, i) => approvals[i]!.canApprove),
    [posts, approvals],
  );
  // The summary sentence is ASSEMBLED from those blockers, never hand-written: the old copy said
  // "add media & a channel" whatever was actually missing, inventing a gap that wasn't there.
  const outstanding = useMemo(() => [...new Set(approvals.flatMap((a) => a.blockers))], [approvals]);

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
          <div className="text-[14px] font-bold text-foreground">Otto planned {posts.length} post{posts.length === 1 ? "" : "s"} this week</div>
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
            {outstanding.length > 0
              ? `${approvable.length} of ${posts.length} ready — ${outstanding.join(" ")}`
              // #851 — this sentence used to name an approval queue the merchant was supposedly
              // waiting in, which implies the far end is wired up and only gated. It isn't. The
              // fact comes from the publish authority now, so it cannot go stale on its own.
              // (The old wording is deliberately not quoted here: a fence checks this file for it.)
              : `Say go once you're happy. ${publishSurfaceCopy().fact}`}
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

/** Labels live here, not in `text-transform` — what is read must equal what is seen (#739). */
const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
];

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
          {GRANULARITIES.map(({ id, label }) => (
            <Button
              key={id}
              type="button"
              variant="ghost"
              onClick={() => setGran(id)}
              className={`h-[30px] rounded-[8px] px-3 text-[12px] font-semibold ${
                gran === id ? "bg-secondary text-foreground hover:bg-secondary" : "bg-transparent text-muted-foreground hover:bg-transparent"
              }`}
            >
              {label}
            </Button>
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
              <div className={`text-[11px] font-semibold ${cell.key === todayKey ? "text-brand-strong" : cell.inMonth ? "text-foreground" : "text-muted-foreground/60"}`}>
                {cell.day}
              </div>
              {shown.map((post) => {
                const pill = statusPill(post.status);
                return (
                  // variant="link" — the only primitive with no hover:bg-* of its own,
                  // so the status tint (tonePill) is never covered on hover. Tailwind's
                  // JIT scanner needs each class as a literal token, so the hover cancel
                  // is spelled out (hover:no-underline) rather than built from a variable.
                  <Button
                    key={post.id}
                    type="button"
                    variant="link"
                    onClick={() => onEdit(post)}
                    title={post.caption}
                    className={`h-auto w-full justify-start gap-1 truncate rounded-[6px] px-1.5 py-1 text-[10.5px] font-medium no-underline hover:no-underline ${tonePill(pill.tone)}`}
                  >
                    <ChannelIcon channel={post.channel} size={11} />
                    <span className="truncate">{post.caption || "Post"}</span>
                  </Button>
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
                <Button
                  key={post.id}
                  type="button"
                  variant="outline"
                  onClick={() => onEdit(post)}
                  className="h-auto w-full flex-col items-start justify-start gap-1 rounded-[9px] border-border bg-secondary/40 p-1.5 text-left font-normal hover:bg-secondary"
                >
                  <Thumb item={firstMedia} size={32} />
                  <div className="flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground">
                    <ChannelIcon channel={post.channel} size={11} /> {formatTime(p)}
                  </div>
                  <div className="text-[11px] text-foreground line-clamp-2">{post.caption || "Post"}</div>
                  <span className={`self-start rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ${tonePill(pill.tone)}`}>{pill.label}</span>
                </Button>
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
                  <Button
                    key={post.id}
                    type="button"
                    variant="outline"
                    onClick={() => onEdit(post)}
                    className="h-auto w-full max-w-full justify-start gap-2 rounded-[9px] border-border bg-secondary/40 px-2 py-1.5 text-left font-normal hover:bg-secondary"
                  >
                    <Thumb item={firstMedia} size={28} />
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-[6px] bg-accent text-foreground shrink-0">
                      <ChannelIcon channel={post.channel} size={12} />
                    </span>
                    <span className="text-[11px] font-semibold text-muted-foreground shrink-0">{formatTime(p)}</span>
                    <span className="text-[12px] text-foreground truncate max-w-[220px]">{post.caption || "Post"}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tonePill(pill.tone)}`}>{pill.label}</span>
                  </Button>
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
      <QueueList posts={filtered} mediaLookup={mediaLookup} onEdit={onEdit} emptyText="No posts yet. Add one or ask Otto to plan your week." />
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
  lastError?: string | null;
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
  accounts,
  mediaChoices,
  onClose,
  onConnect,
  onRetry,
  onSaved,
}: {
  seed: ComposerSeed;
  channels: ChannelId[];
  accounts: ConnectedAccounts;
  mediaChoices: MediaChoice[];
  onClose: () => void;
  onConnect: () => void;
  /** Ask for the connection read again — the way out of "we couldn't check" (#741 r5 P1). */
  onRetry: () => void;
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
  // status/lastError are kept in local state (not read straight off `seed`) so a background
  // refetch can update them without also clobbering whatever the user is mid-typing below —
  // see the sync effect, which only applies a fresh seed while the form is untouched.
  const [status, setStatus] = useState<string | undefined>(seed.status);
  const [lastError, setLastError] = useState<string | null | undefined>(seed.lastError);

  const cap = channelMeta(channel)?.capabilities;
  const maxMedia = cap?.maxMediaCount ?? 10;
  const supportsFirstComment = cap?.supportsFirstComment ?? false;
  const editable = seed.mode === "create" || status === "DRAFT";

  // seed's own fields (channel, caption, ...) never change after open — only `openEdit`
  // creates a seed, and reload() only ever patches status/lastError onto it — so comparing
  // live form state to `seed` doubles as "has the user touched this form yet".
  const dirty =
    channel !== seed.channel ||
    caption !== seed.caption ||
    dateKey !== seed.dateKey ||
    time !== seed.time ||
    tz !== seed.tz ||
    firstComment !== seed.firstComment ||
    metaTargetId !== seed.metaTargetId ||
    media.length !== seed.media.length ||
    media.some((m, i) => m !== seed.media[i]);

  useEffect(() => {
    if (dirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(seed.status);
    setLastError(seed.lastError);
  }, [seed.status, seed.lastError, dirty]);

  // Account/page picker options for the SELECTED channel. A picked target must belong to
  // the channel being posted to (mirrors the server's owner-scoped approve check).
  // Four states, kept apart on purpose (#741 r2): "still checking", "this channel can't be
  // connected at all", "connected to nothing here", "here are your accounts". The first two must
  // never offer a Connect button — one because we haven't looked, the other because there is
  // nowhere to send them.
  const picker = accountPicker(accounts, channel);

  // #741 r1 P2 — two different questions, previously answered with one list:
  //   OFFERED = the channels this composer puts forward (the merchant's connected ones, or the
  //             connectable ones when nothing is connected yet);
  //   SHOWN   = OFFERED plus the channel this draft is already ON.
  // A post written for X before X was hidden still belongs to X. Filtering it out of the picker
  // left the merchant looking at a Channel row with nothing selected — the post's own channel
  // silently erased from a screen that is supposed to show them what they have.
  const shownChannels = channels.includes(seed.channel) ? channels : [seed.channel, ...channels];
  // Only a channel the product genuinely can't connect is locked. "Connectable but not connected"
  // (an Instagram draft written before the merchant disconnected) stays selectable — a draft may
  // legitimately sit on a channel you haven't connected yet, and the Account field says so.
  const channelUnavailable = !isConnectableChannel(channel);

  // Switching channel drops a target that no longer belongs, so we never submit a mismatched
  // id (done in the handler, not an effect — derived-on-event, not synchronized-via-effect).
  function changeChannel(next: ChannelId) {
    setChannel(next);
    // Trim media the new channel can't hold (e.g. switching to text-only X) so a carried-over
    // selection never fails validation on save.
    const nextMax = channelMeta(next)?.capabilities.maxMediaCount ?? 0;
    setMedia((cur) => (cur.length > nextMax ? cur.slice(0, nextMax) : cur));
    if (metaTargetId && !isConnectedTarget(accounts, next, metaTargetId)) {
      setMetaTargetId(null);
    }
  }
  // Approve = DRAFT→SCHEDULED, which the server rejects without a resolved owner-owned target AND
  // at least one media item. Gate BOTH in the UI so "Approve & schedule" never fires create-then-
  // fail-approval and leaves an orphan draft behind (#123): require a target AND media before approve.
  //
  // #695 — the gate and the EXPLANATION come from the same rule the server enforces. #741 r1 —
  // the account is checked against the live list, not just "an id is set". #741 r2 — and that
  // whole judgement now comes from the ONE connection state, so the plan card above cannot
  // disagree with this dialog about the very same post.
  const approval = editable
    ? approvalFor(accounts, { channel, targetId: metaTargetId, mediaCount: media.length })
    : { blockers: [] as string[], canApprove: false };
  const canApprove = editable && approval.canApprove;
  // The channel-unavailable sentence is rendered next to the channel buttons it is about (below);
  // repeating it by the footer would be the same truth twice on one screen. Same string, one
  // source — it is only ever chosen, never re-typed.
  const channelNote = channelUnavailable ? channelUnavailableBlocker(channel) : null;
  const footerBlockers = approval.blockers.filter((b) => b !== channelNote);

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
          channel,
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
          channel,
          caption,
          scheduledAt: iso,
          scheduledTz: tz,
          media,
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
            {/* Two different promises, kept apart on purpose: this composer never spends (it only
                reuses media the merchant already has), and — #851 — approving here does not send
                anything anywhere. The second half comes from the publish authority. */}
            Reuse media you&rsquo;ve already made — scheduling never generates anything new.{" "}
            {publishSurfaceCopy().fact}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 max-h-[62vh] overflow-auto pr-1">
          {/* Channel */}
          <Field label="Channel">
            <div className="flex gap-1.5">
              {shownChannels.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant="outline"
                  disabled={!editable || !isConnectableChannel(c)}
                  onClick={() => changeChannel(c)}
                  className={`h-9 gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold disabled:opacity-50 ${
                    channel === c ? "border-foreground bg-secondary text-foreground hover:bg-secondary" : "border-border bg-card text-muted-foreground hover:bg-card"
                  }`}
                >
                  <ChannelIcon channel={c} size={14} /> {channelMeta(c)?.label ?? c}
                </Button>
              ))}
            </div>
            {channelNote && (
              <div role="status" className="text-[11.5px] text-muted-foreground mt-1">
                {channelNote}
              </div>
            )}
            {cap && (
              <div className="text-[11.5px] text-muted-foreground mt-1">
                {capsBlurb(cap)}
                {cap.rateLimitPer24h ? ` · ${cap.rateLimitPer24h}/day limit` : ""}
              </div>
            )}
          </Field>

          {/* Account / page — required to approve (sets metaTargetId). One field, four honest
              states from the single connection source (#741 r2): while the read is in flight we
              say we're looking (no Connect call to action — we haven't looked yet); a channel with
              no connect flow at all shows no picker and no button (the Channel note above is the
              real next step); only a COMPLETED read that found nothing offers Connect. */}
          {picker.phase !== "unavailable" && (
            <Field label="Account">
              {picker.phase === "checking" ? (
                <div role="status" className="rounded-[10px] border border-dashed border-border p-3 text-[12px] text-muted-foreground">
                  {CHECKING_ACCOUNTS_BLOCKER}
                </div>
              ) : picker.phase === "unreadable" ? (
                // We looked and came back empty-handed. Never the Connect prompt below — we have
                // no idea whether they are connected, so inviting them to connect is a guess.
                <div role="status" className="flex items-center gap-2 rounded-[10px] border border-dashed border-border p-3 text-[12px] text-muted-foreground">
                  <span className="flex-1">{ACCOUNTS_CHECK_FAILED}</span>
                  <Button variant="secondary" size="sm" type="button" onClick={onRetry}>
                    Retry
                  </Button>
                </div>
              ) : picker.phase === "blocked" ? (
                // Connected, but not usable right now. The label is the one the Connections page
                // shows for the same fact, and the action is the one that actually fixes it.
                <div role="status" className="flex items-center gap-2 rounded-[10px] border border-dashed border-border p-3 text-[12px] text-muted-foreground">
                  <span className="flex-1">{connectionBlockerStatus(picker.blocker)}</span>
                  <Button variant="secondary" size="sm" type="button" onClick={onConnect}>
                    Reconnect
                  </Button>
                </div>
              ) : picker.phase === "none" ? (
                <div className="flex items-center gap-2 rounded-[10px] border border-dashed border-border p-3 text-[12px] text-muted-foreground">
                  <span className="flex-1">Connect an account first — you can save a draft now, but approving needs a page to post to.</span>
                  <Button variant="secondary" size="sm" type="button" onClick={onConnect}>
                    <Plus size={14} /> Connect
                  </Button>
                </div>
              ) : (
                // #840 — left as a bare select element, NOT the shadcn Select used two
                // fields down for time zone. Three money-adjacent test suites (schedule-
                // connect-honesty, schedule-media-key, publish-honest-preview) drive account
                // selection by dispatching a native "change" event on this exact element —
                // Radix's Select renders a trigger button plus a Portal-rendered listbox,
                // nothing dispatches a "change" the same way, and this codebase's own
                // convention for that gap (campaign-confirm-requote-race.test.ts) is to mock
                // SelectTrigger out entirely, which would have cost those three suites their
                // real coverage of the schedule approval gate. Left on the fence's exempt
                // board with that reasoning; not a case of "forgot to migrate it".
                <select
                  value={metaTargetId ?? ""}
                  disabled={!editable}
                  onChange={(e) => setMetaTargetId(e.target.value || null)}
                  className="w-full h-9 rounded-[10px] border border-border bg-card px-2.5 text-[13px] font-semibold disabled:opacity-60"
                >
                  <option value="">Choose an account…</option>
                  {picker.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {/* Media picker (already-generated only) — hidden for text-only channels (maxMedia 0) */}
          {maxMedia > 0 && (
          <Field label={`Media ${media.length ? `· ${media.length}/${maxMedia}` : ""}`}>
            {mediaChoices.length === 0 ? (
              <div className="text-[12px] text-muted-foreground rounded-[10px] border border-dashed border-border p-3">
                No media yet. Make something on the canvas first — Schedule reuses your existing images and videos (it never generates new ones here).
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-1.5 max-h-[160px] overflow-auto">
                {mediaChoices.map((m) => {
                  // Selection is tracked by generationId — the same key `media` is seeded with
                  // (openEdit) and submitted as. Matching on `label` (prompt text) never lined up
                  // with either, so an attached image showed as unselected and re-clicking it
                  // appended the prompt text to `media` (#691).
                  const idx = media.indexOf(m.generationId);
                  const selected = idx >= 0;
                  return (
                    <Button
                      key={m.id}
                      type="button"
                      variant="outline"
                      disabled={!editable}
                      onClick={() => toggleMedia(m.generationId)}
                      className={`relative aspect-square h-auto w-full overflow-hidden rounded-[9px] border-2 p-0 disabled:opacity-50 ${selected ? "border-brand" : "border-border"}`}
                    >
                      {m.mediaKind === "video" ? (
                        <video src={m.url ?? undefined} muted preload="metadata" className="w-full h-full object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url ?? undefined} alt="" loading="lazy" className="w-full h-full object-cover" />
                      )}
                      {selected && (
                        <span className="absolute top-0.5 right-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-strong text-brand-foreground text-[9px] font-bold">{idx + 1}</span>
                      )}
                    </Button>
                  );
                })}
              </div>
            )}
          </Field>
          )}

          {/* Caption */}
          <Field label="Caption">
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={!editable}
              rows={4}
              placeholder="Write your caption…"
              className="min-h-0 w-full resize-none rounded-[10px] border-border bg-card px-3 py-2 text-[13px] shadow-none"
            />
            <Button
              type="button"
              variant="ghost"
              disabled
              title="Coming soon — Otto will draft this from your brand memory."
              className="mt-1 h-auto w-auto gap-1.5 p-0 text-[12px] font-semibold text-muted-foreground opacity-60 hover:bg-transparent disabled:cursor-default disabled:opacity-60"
            >
              <CoralCloud size={16} /> Ask Otto to write it
            </Button>
          </Field>

          {/* First comment (channel-gated) */}
          {supportsFirstComment && (
            <Field label="First comment (optional)">
              <Input
                value={firstComment}
                onChange={(e) => setFirstComment(e.target.value)}
                disabled={!editable}
                placeholder="Hashtags or a link…"
                className="h-9 w-full rounded-[10px] border-border bg-card px-3 text-[13px]"
              />
            </Field>
          )}

          {/* Date / time / tz */}
          <div className="grid grid-cols-3 gap-2">
            <Field label="Date">
              <Input type="date" value={dateKey} disabled={!editable} onChange={(e) => setDateKey(e.target.value)} className="h-9 w-full rounded-[10px] border-border bg-card px-2.5 text-[13px]" />
            </Field>
            <Field label="Time">
              <Input type="time" value={time} disabled={!editable} onChange={(e) => setTime(e.target.value)} className="h-9 w-full rounded-[10px] border-border bg-card px-2.5 text-[13px]" />
            </Field>
            <Field label="Time zone">
              <Select value={tz} disabled={!editable} onValueChange={setTz}>
                <SelectTrigger className="h-9 w-full rounded-[10px] border-border bg-card px-2 text-[13px] font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_TZS.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        {/* Why this post is stuck (publish worker's lastError). Read-only disclosure so a
            NEEDS_ATTENTION post — whose fields + Approve are disabled below — isn't a silent
            dead-end. The confirm/link disposition action is a separate, later ticket. */}
        {status === "NEEDS_ATTENTION" && lastError && (
          <div role="status" className="text-[12.5px] text-[var(--error-soft-foreground)]">
            Needs attention — {lastError}
          </div>
        )}

        {error && <div role="alert" className="text-[12.5px] text-[var(--error-soft-foreground)]">{error}</div>}

        {/* #695 — what "Approve & schedule" is still waiting for, on screen for as long as it is
            greyed out. A title attribute alone was invisible to anyone not hovering (and to screen
            readers), and it only ever covered the first of the two conditions. */}
        {footerBlockers.length > 0 && (
          <div role="status" className="text-[12.5px] text-muted-foreground flex flex-col gap-0.5">
            {footerBlockers.map((b) => (
              <span key={b}>{b}</span>
            ))}
          </div>
        )}

        <DialogFooter className="flex-wrap">
          {seed.mode === "edit" && status && status !== "CANCELLED" && status !== "PUBLISHED" && (
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
            title={approval.blockers.length > 0 ? approval.blockers.join(" ") : undefined}
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
