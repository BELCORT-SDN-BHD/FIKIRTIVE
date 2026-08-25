"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import Link from "next/link";
import { CircleAlert, Search, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getGenerationHistory, type LibraryItem } from "@/lib/library-actions";
import { canvasHref } from "@/components/canvas/canvas-href";
import type { AdJobItem } from "@/lib/data";
import { readR22WorkspaceDirectory, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import "./r22-library.css";

type LibraryFilter = "all" | "image" | "video" | "star";
type LibraryViewState = "ready" | "loading" | "error" | "permission" | "unknown";
const FIXTURE_STATE_KEY = "fikirtive.r22.library.state.v1";

function itemLabel(item: LibraryItem, index: number): string {
  const prompt = item.prompt.trim();
  return prompt || `${item.kind === "video" ? "Video" : "Image"} ${index + 1}`;
}

export function R22LibraryView({ initialItems, initialCursor = null, initialHasMore = false, attentionJobs = [], readError, fixture = false, fixtureRestore = true, state = readError ? "error" : "ready" }: { initialItems: LibraryItem[]; initialCursor?: string | null; initialHasMore?: boolean; attentionJobs?: AdJobItem[] | null; readError?: string; fixture?: boolean; fixtureRestore?: boolean; state?: LibraryViewState }) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(readError ?? "");
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [restored, setRestored] = useState(!fixture);
  const counts = useMemo(() => ({ all: items.length, image: items.filter((item) => item.kind === "image").length, video: items.filter((item) => item.kind === "video").length, star: items.filter((item) => item.favorite).length }), [items]);
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesFilter = filter === "all" ? true : filter === "star" ? item.favorite : item.kind === filter;
      return matchesFilter && (!term || `${item.prompt} ${item.kind}`.toLowerCase().includes(term));
    });
  }, [filter, items, query]);

  useEffect(() => {
    if (!fixture || !fixtureRestore) return;
    try {
      const raw = window.sessionStorage.getItem(scopedR22FixtureKey(FIXTURE_STATE_KEY));
      if (raw) {
        const saved = JSON.parse(raw) as { items?: LibraryItem[]; filter?: LibraryFilter; query?: string };
        if (Array.isArray(saved.items)) setItems(saved.items);
        if (saved.filter === "all" || saved.filter === "image" || saved.filter === "video" || saved.filter === "star") setFilter(saved.filter);
        if (typeof saved.query === "string") setQuery(saved.query);
      } else if (readR22WorkspaceDirectory().activeId !== "batik-house") setItems([]);
    } catch {
      // Ignore malformed fixture-only recovery data.
    }
    setRestored(true);
  }, [fixture, fixtureRestore]);

  useEffect(() => {
    if (!fixture || !fixtureRestore || !restored) return;
    try {
      window.sessionStorage.setItem(scopedR22FixtureKey(FIXTURE_STATE_KEY), JSON.stringify({ items, filter, query }));
    } catch {
      // A blocked storage API must not break the fixture.
    }
  }, [fixture, fixtureRestore, restored, items, filter, query]);

  function toggleFavorite(item: LibraryItem) {
    if (favoriteBusyId) return;
    if (!fixture) {
      setNotice("Favorites are not connected to the production library yet. Nothing changed.");
      return;
    }
    setFavoriteBusyId(item.id);
    setNotice("");
    window.setTimeout(() => {
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, favorite: !row.favorite } : row));
      setNotice(item.favorite ? "Removed from Starred in this R22 fixture." : "Added to Starred in this R22 fixture.");
      setFavoriteBusyId(null);
    }, 220);
  }

  async function loadMore() {
    if (fixture || !cursor || loading) return;
    setLoading(true);
    setError("");
    const result = await getGenerationHistory({ cursor, take: 80 });
    setLoading(false);
    if ("error" in result) return setError(result.error);
    setItems((current) => [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
    setCursor(result.nextCursor);
    setHasMore(result.hasMore);
  }

  const emptyCopy = filter === "video" ? "No videos yet — ask for one from any canvas composer." : filter === "star" ? "Nothing starred yet — star the keepers on their canvas and they will gather here." : "Nothing has been made yet. Start from Canvas and completed media will gather here.";

  if (fixture && fixtureRestore && !restored) return <main className="r22-library" data-r22-library data-state="loading" aria-busy="true"><header><div><h1>Library</h1><p>Everything you made, across every Canvas.</p></div></header><section className="r22-library-state"><b>Loading workspace library…</b><p>Old workspace assets are hidden while the active fixture store is read.</p></section></main>;

  return <main className="r22-library" data-r22-library data-fixture={fixture || undefined}>
    <header><h1>Library</h1><p>Find every image and video you have already made.</p></header>
    <div className="r22-library-tools"><label><Search aria-hidden="true" /><Input unstyled type="search" aria-label="Search library" placeholder="Search Library" value={query} disabled={state !== "ready"} onChange={(event) => setQuery(event.target.value)} /></label><div className="r22-library-filters" role="group" aria-label="Filter library">
      {(["all", "image", "video", "star"] as const).map((value) => <Button unstyled type="button" key={value} disabled={state !== "ready"} className={filter === value ? "is-active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "image" ? "Images" : value === "video" ? "Videos" : "Starred"} · {counts[value]}{value === "all" && hasMore ? "+" : ""}</Button>)}
    </div>
    </div>
    {notice ? <p className="r22-library-notice" role="status">{notice}</p> : null}
    {state === "loading" ? <section className="r22-library-empty" aria-busy="true">Loading the current workspace Library…</section> : state === "permission" ? <section className="r22-library-empty" role="status"><CircleAlert aria-hidden="true" /> This member cannot read the current workspace Library. Nothing is guessed in its place.</section> : state === "error" || state === "unknown" || error ? <section className="r22-library-empty" role={state === "error" || error ? "alert" : "status"}><CircleAlert aria-hidden="true" /> {state === "unknown" ? "Library read outcome is unknown. Nothing is guessed in its place." : `Library could not be loaded: ${error || "the workspace read failed"}. Nothing is guessed in its place.`}<Link href={fixture ? "/library?fixture=r22" : "/library"}>Retry</Link></section> : visible.length ? <div className="r22-library-grid">{visible.map((item, index) => <article className="r22-library-tile" key={item.id}><Link className="r22-library-tile-link" href={fixture ? "/create/canvas?project=fixture-raya&fixture=r22" : canvasHref(item.projectId)} aria-label={`Open ${itemLabel(item, index)} in Canvas`}><span className="r22-library-media">{item.kind === "video" ? <video src={item.url} muted preload="metadata" /> : <img src={item.url} alt="" />}</span><span className="r22-library-meta"><b>{itemLabel(item, index)}</b><span>{item.kind === "video" ? "Video" : "Image"} · {new Date(item.createdAt).toLocaleDateString("en-GB", { month: "short", day: "numeric" })}</span></span></Link><Button unstyled type="button" className="r22-library-star" disabled={favoriteBusyId !== null} aria-label={`${item.favorite ? "Remove" : "Add"} ${itemLabel(item, index)} ${item.favorite ? "from" : "to"} Starred`} aria-pressed={item.favorite} onClick={() => toggleFavorite(item)}><Star fill={item.favorite ? "currentColor" : "none"} aria-hidden="true" /></Button></article>)}</div> : <section className="r22-library-empty">{query ? "No Library item matches this search and filter." : emptyCopy}</section>}
    {attentionJobs === null ? <section className="r22-library-attention" role="alert"><h2>Generation status unavailable</h2><p>Running and failed jobs could not be read. Nothing is guessed in its place.</p></section> : attentionJobs.length ? <section className="r22-library-attention"><h2>Needs attention</h2><p>Incomplete generations stay separate from reusable Library items.</p><div>{attentionJobs.map((job) => <article key={job.id}><b>{job.status === "processing" ? "Processing…" : "Didn't go through"}</b><span>{job.prompt || `${job.kind} generation`}</span>{job.error && job.status !== "processing" ? <small>{job.error}</small> : null}</article>)}</div></section> : null}
    {hasMore && !error ? <Button unstyled className="r22-library-more" type="button" onClick={() => void loadMore()} disabled={loading}>{loading ? "Loading…" : "Load more"}</Button> : null}
    <p className="r22-library-foot">Everything here was made on a canvas — open any item to return to its project.</p>
  </main>;
}

export default R22LibraryView;
