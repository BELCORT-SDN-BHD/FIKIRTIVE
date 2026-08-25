"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { Camera, ChevronLeft, ChevronRight, CircleAlert, Megaphone, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StuffItem } from "@/lib/stuff-items";
import { listOwnerTargets, listScheduledPosts, type OwnerTargetsResult, type ScheduledPostRow } from "@/lib/schedule-actions";
import { ACCOUNTS_LOADING, accountsFromOwnerTargets, UNREAD_ACCOUNTS } from "@/lib/schedule-connections";
import { R22ScheduleComposer, type R22ScheduleComposerSeed } from "./r22-schedule-composer";
import { readR22WorkspaceDirectory, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import "./r22-schedule.css";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "permission" } | { status: "ready"; posts: ScheduledPostRow[]; connected: boolean | null; targets: OwnerTargetsResult | null; timezone: string };
type ScheduleFixtureState = "ready" | "loading" | "error" | "permission" | "empty" | "unknown";
type ScheduleFixtureOutcome = "success" | "error" | "permission" | "unknown";

const FIXTURE_POSTS_KEY = "fikirtive.r22.schedule.posts.v1";
const FIXTURE_ACTIVE_COMPOSER_KEY = "fikirtive.r22.schedule.composer.active.v1";

const FIXTURE_POSTS: ScheduledPostRow[] = [
  { id: "s1", channel: "instagram", caption: "Raya promo — image 1", firstComment: null, scheduledAt: new Date("2026-08-28T01:00:00.000Z"), scheduledTz: "Asia/Kuala_Lumpur", status: "SCHEDULED", publishMode: "reminder", source: "owner", metaTargetId: null, approvedAt: new Date("2026-08-24T01:00:00.000Z"), lastError: null, media: [{ generationId: "fixture-asset-1", position: 0 }], updatedAt: new Date("2026-08-24T01:00:00.000Z") },
  { id: "s2", channel: "instagram", caption: "Raya promo — image 2", firstComment: null, scheduledAt: new Date("2026-08-28T01:00:00.000Z"), scheduledTz: "Asia/Kuala_Lumpur", status: "SCHEDULED", publishMode: "reminder", source: "owner", metaTargetId: null, approvedAt: new Date("2026-08-24T01:00:00.000Z"), lastError: null, media: [{ generationId: "fixture-asset-2", position: 0 }], updatedAt: new Date("2026-08-24T01:00:00.000Z") },
  { id: "s3", channel: "instagram", caption: "Candle care tip 1 of 3", firstComment: null, scheduledAt: new Date("2026-08-29T02:00:00.000Z"), scheduledTz: "Asia/Kuala_Lumpur", status: "SCHEDULED", publishMode: "reminder", source: "owner", metaTargetId: null, approvedAt: new Date("2026-08-24T01:00:00.000Z"), lastError: null, media: [{ generationId: "fixture-asset-3", position: 0 }], updatedAt: new Date("2026-08-24T01:00:00.000Z") },
  { id: "s4", channel: "facebook", caption: "Weekend market recap", firstComment: null, scheduledAt: new Date("2026-08-31T01:00:00.000Z"), scheduledTz: "Asia/Kuala_Lumpur", status: "DRAFT", publishMode: "reminder", source: "owner", metaTargetId: null, approvedAt: null, lastError: null, media: [], updatedAt: new Date("2026-08-24T01:00:00.000Z") },
  { id: "s5", channel: "instagram", caption: "Candle care tip 2 of 3", firstComment: null, scheduledAt: new Date("2026-09-01T01:00:00.000Z"), scheduledTz: "Asia/Kuala_Lumpur", status: "DRAFT", publishMode: "reminder", source: "owner", metaTargetId: null, approvedAt: null, lastError: null, media: [], updatedAt: new Date("2026-08-24T01:00:00.000Z") },
];

function readFixturePosts(): ScheduledPostRow[] {
  if (typeof window === "undefined") return FIXTURE_POSTS;
  try {
    const raw = window.sessionStorage.getItem(scopedR22FixtureKey(FIXTURE_POSTS_KEY));
    if (!raw) return readR22WorkspaceDirectory().activeId === "batik-house" ? FIXTURE_POSTS : [];
    const parsed = JSON.parse(raw) as Array<Omit<ScheduledPostRow, "scheduledAt" | "approvedAt" | "updatedAt"> & { scheduledAt: string; approvedAt: string | null; updatedAt: string }>;
    return parsed.map((post) => ({ ...post, scheduledAt: new Date(post.scheduledAt), approvedAt: post.approvedAt ? new Date(post.approvedAt) : null, updatedAt: new Date(post.updatedAt) }));
  } catch {
    return FIXTURE_POSTS;
  }
}

function writeFixturePosts(posts: ScheduledPostRow[]) {
  try {
    window.sessionStorage.setItem(scopedR22FixtureKey(FIXTURE_POSTS_KEY), JSON.stringify(posts));
  } catch {
    // A blocked storage API must not break the visual fixture.
  }
}

function mondayOf(value: Date): Date { const day = value.getUTCDay(); const out = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())); out.setUTCDate(out.getUTCDate() - (day === 0 ? 6 : day - 1)); return out; }
function addDays(value: Date, days: number): Date { const out = new Date(value); out.setUTCDate(out.getUTCDate() + days); return out; }
function dayKey(value: Date): string { return value.toISOString().slice(0, 10); }
function displayTime(post: ScheduledPostRow): string { return new Intl.DateTimeFormat("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: post.scheduledTz }).format(new Date(post.scheduledAt)); }
function displayDay(post: ScheduledPostRow): string { return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: post.scheduledTz }).format(new Date(post.scheduledAt)).replace(/-/g, "-"); }

export function ScheduleSurface({ stuffItems, fixture = false, openComposer = false, fixtureState = "ready", fixtureOutcome = "success" }: { stuffItems: StuffItem[]; fixture?: boolean; openComposer?: boolean; fixtureState?: ScheduleFixtureState; fixtureOutcome?: ScheduleFixtureOutcome }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [view, setView] = useState<"week" | "list">("week");
  const [filter, setFilter] = useState<"all" | "instagram" | "facebook">("all");
  const [week, setWeek] = useState(() => fixture ? mondayOf(new Date("2026-08-24T00:00:00.000Z")) : mondayOf(new Date()));
  const [composer, setComposer] = useState<R22ScheduleComposerSeed | null>(openComposer ? { mode: "new" } : null);
  const [notice, setNotice] = useState<string | null>(null);
  const media = useMemo(() => new Map(stuffItems.flatMap((item) => item.generationId && item.url ? [[item.generationId, item.url] as const] : [])), [stuffItems]);
  const accounts = useMemo(() => load.status === "loading" ? ACCOUNTS_LOADING : load.status === "ready" && load.targets ? accountsFromOwnerTargets(load.targets) : UNREAD_ACCOUNTS, [load]);

  const reload = useCallback(async () => {
    if (fixture) {
      const posts = readFixturePosts();
      setLoad({ status: "ready", posts, connected: false, targets: { targets: [], channelStates: { instagram: "ok", facebook: "ok" } }, timezone: "Asia/Kuala_Lumpur" });
      return;
    }
    try {
      const [posts, targets] = await Promise.all([listScheduledPosts(), listOwnerTargets()]);
      setLoad({ status: "ready", posts, connected: Object.keys(targets.channelStates).length ? targets.targets.length > 0 : null, targets, timezone: posts[0]?.scheduledTz ?? "Asia/Kuala_Lumpur" });
    } catch {
      setLoad({ status: "error", message: "Schedule could not be loaded." });
    }
  }, [fixture]);

  useEffect(() => {
    if (fixture) return;
    queueMicrotask(() => void reload());
  }, [fixture, reload]);

  useEffect(() => {
    if (!fixture) return;
    const posts = readFixturePosts();
    if (fixtureState === "loading") setLoad({ status: "loading" });
    else if (fixtureState === "error") setLoad({ status: "error", message: "The fixture schedule read failed." });
    else if (fixtureState === "permission") setLoad({ status: "permission" });
    else setLoad({ status: "ready", posts: fixtureState === "empty" ? [] : posts, connected: fixtureState === "unknown" ? null : false, targets: { targets: [], channelStates: { instagram: "ok", facebook: "ok" } }, timezone: "Asia/Kuala_Lumpur" });
    if (openComposer) return;
    try {
      const active = JSON.parse(window.sessionStorage.getItem(scopedR22FixtureKey(FIXTURE_ACTIVE_COMPOSER_KEY)) ?? "null") as { mode?: "new" | "edit"; id?: string } | null;
      if (active?.mode === "new") setComposer({ mode: "new" });
      if (active?.mode === "edit") {
        const post = posts.find((item) => item.id === active.id);
        if (post) setComposer({ mode: "edit", post });
      }
    } catch {
      // Ignore malformed fixture-only recovery data.
    }
  }, [fixture, fixtureState, openComposer]);

  function mutateFixturePosts(change: { kind: "upsert"; post: ScheduledPostRow } | { kind: "cancel"; id: string }) {
    setLoad((current) => {
      if (current.status !== "ready") return current;
      const posts = change.kind === "cancel"
        ? current.posts.filter((post) => post.id !== change.id)
        : current.posts.some((post) => post.id === change.post.id)
          ? current.posts.map((post) => post.id === change.post.id ? change.post : post)
          : [...current.posts, change.post];
      writeFixturePosts(posts);
      return { ...current, posts };
    });
    setNotice(change.kind === "cancel" ? "Post cancelled in this R22 fixture." : change.post.status === "SCHEDULED" ? "Post approved and held until a channel is connected." : "Draft saved in this R22 fixture.");
  }

  function closeComposer() {
    setComposer(null);
    if (!openComposer || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("compose");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }

  const posts = load.status === "ready" ? load.posts : [];
  const filtered = posts.filter((post) => filter === "all" || post.channel === filter);
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const weekPosts = filtered.filter((post) => { const key = displayDay(post); return key >= dayKey(week) && key < dayKey(addDays(week, 7)); });
  const counts = { all: posts.length, instagram: posts.filter((post) => post.channel === "instagram").length, facebook: posts.filter((post) => post.channel === "facebook").length };
  const todayWeek = mondayOf(new Date());
  const label = dayKey(week) === dayKey(todayWeek) ? "This week" : `${new Intl.DateTimeFormat("en-MY", { month: "short", day: "numeric" }).format(week)} – ${new Intl.DateTimeFormat("en-MY", { month: "short", day: "numeric" }).format(addDays(week, 6))}`;

  return <main className="r22-schedule" data-r22-schedule data-fixture={fixture || undefined}>
    <header><div><h1>Schedule</h1><p>See exactly what goes out, and when.</p></div>{load.status === "ready" ? <div className="r22-schedule-head-actions">{load.connected === false ? <Link href={fixture ? "/settings?section=connections&fixture=r22" : "/settings?section=connections"}>Connect a channel</Link> : null}<Button unstyled type="button" className="r22-schedule-new" onClick={() => setComposer({ mode: "new" })}><Plus /> New post</Button></div> : null}</header>
    {load.status === "ready" && load.connected === false ? <p className="r22-schedule-fact"><CircleAlert />No channel is connected yet, so nothing here can actually go out — every slot below is held, not promised.</p> : load.status === "ready" && load.connected === null ? <p className="r22-schedule-fact"><CircleAlert />Connection status could not be confirmed. No post is described as publishable.</p> : null}
    {notice ? <p className="r22-schedule-notice" role="status">{notice}</p> : null}
    <div className="r22-schedule-controls"><Button unstyled type="button" aria-label="Previous week" onClick={() => setWeek((value) => addDays(value, -7))}><ChevronLeft /></Button><Button unstyled type="button" onClick={() => setWeek(todayWeek)}>Today</Button><Button unstyled type="button" aria-label="Next week" onClick={() => setWeek((value) => addDays(value, 7))}><ChevronRight /></Button><b>{label}</b><span>Times in {load.status === "ready" ? load.timezone.replace("_", " ") : "workspace timezone"}</span><div role="group" aria-label="View"><Button unstyled type="button" className={view === "week" ? "is-active" : ""} onClick={() => setView("week")}>Week</Button><Button unstyled type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}>List</Button></div></div>
    <div className="r22-schedule-filters" role="group" aria-label="Filter by channel">{(["all", "instagram", "facebook"] as const).map((value) => <Button unstyled type="button" key={value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "instagram" ? "Instagram" : "Facebook"} · {counts[value]}</Button>)}</div>
    {load.status === "loading" ? <section className="r22-schedule-state" aria-busy="true">Loading your schedule…</section> : load.status === "permission" ? <section className="r22-schedule-state" role="status"><CircleAlert /><h2>Schedule is not available to this member</h2><p>No post count, caption, target or empty week is exposed without schedule.read.</p></section> : load.status === "error" ? <section className="r22-schedule-state" role="alert"><CircleAlert /><h2>Schedule could not be loaded</h2><p>{load.message} No empty week was inferred.</p><Button unstyled type="button" onClick={() => void reload()}>Retry</Button></section> : view === "week" ? <div className="r22-schedule-week">{days.map((day) => { const inDay = weekPosts.filter((post) => displayDay(post) === dayKey(day)); return <section key={dayKey(day)}><header><span>{new Intl.DateTimeFormat("en-MY", { weekday: "short" }).format(day)}</span><b>{day.getUTCDate()}</b></header><div>{inDay.map((post) => <article key={post.id}><Button unstyled type="button" className="r22-schedule-card" aria-label={`Open ${post.caption}`} onClick={() => setComposer({ mode: "edit", post })}><span>{post.channel === "instagram" ? <Camera /> : <Megaphone />}</span>{post.media[0] && media.get(post.media[0].generationId) ? <img src={media.get(post.media[0].generationId)} alt="" /> : null}<b>{displayTime(post)}</b><p>{post.caption}</p><small>{load.connected ? post.status.toLowerCase() : `${post.status.toLowerCase()} · held`}</small></Button></article>)}{!inDay.length ? <p className="r22-schedule-none">No posts</p> : null}</div></section>; })}</div> : <section className="r22-schedule-list"><header><h2>Everything queued</h2></header>{filtered.length ? <table><thead><tr><th>When</th><th>Post</th><th>Channel</th><th>Status</th></tr></thead><tbody>{filtered.map((post) => <tr key={post.id}><td>{new Intl.DateTimeFormat("en-MY", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: post.scheduledTz }).format(new Date(post.scheduledAt))}</td><td><Button unstyled type="button" onClick={() => setComposer({ mode: "edit", post })}>{post.caption}</Button></td><td>{post.channel === "instagram" ? "Instagram" : "Facebook"}</td><td><span>{load.connected ? post.status.toLowerCase() : `${post.status.toLowerCase()} · held`}</span></td></tr>)}</tbody></table> : <div className="r22-schedule-empty">No posts match this channel.</div>}<p>Home shows the next few — this list is all of it.</p></section>}
    {composer && load.status === "ready" ? <R22ScheduleComposer key={composer.mode === "new" ? "new" : composer.post.id} seed={composer} accounts={accounts} stuffItems={stuffItems} timezone={load.timezone} fixture={fixture} fixtureOutcome={fixtureOutcome} onClose={closeComposer} onSaved={reload} onFixtureUpsert={(post) => mutateFixturePosts({ kind: "upsert", post })} onFixtureCancel={(id) => mutateFixturePosts({ kind: "cancel", id })} /> : null}
  </main>;
}

export default ScheduleSurface;
