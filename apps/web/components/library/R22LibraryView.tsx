"use client";

/**
 * R22LibraryView.tsx —— `/library` 这扇门。一个壳,两条路。
 *
 * **为什么是两条路**:R22 样张把 Library 从「陈列柜」重建成了工作台(`LibraryWorkroom`)——
 * 多选、批量、素材包、上传,每一件都要写回一个真的存档。生产上这些还没有接线:没有素材包
 * 表,没有上传通道,收藏也还没接。把工作台照搬到生产上,商家会点到一排点了不算数的按钮。
 *
 * 所以生产走的仍是那张只读的网格 —— 它对得住今天真的存在的东西:读得到的历史、读不到时
 * 照实说、进行中与失败的任务另画一块。等后端把这几件接上,`fixture` 这道岔口就删掉,两条
 * 路并成一条。
 *
 * 壳自己只管三件所有路都要的事:标题、读取结果(loading / permission / error / unknown 各说
 * 各的,一律不冒充「空」)、以及那块「需要你看一眼」的任务区。
 */

import { CircleAlert, Search, Star } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { canvasHref } from "@/components/canvas/canvas-href";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { getGenerationHistory, type LibraryItem } from "@/lib/library-actions";
import type { AdJobItem } from "@/lib/data";

import { LibraryWorkroom } from "./LibraryWorkroom";
import "./r22-library.css";

type LibraryFilter = "all" | "image" | "video" | "star";
type LibraryViewState = "ready" | "loading" | "error" | "permission" | "unknown";

function itemLabel(item: LibraryItem, index: number): string {
  const prompt = item.prompt.trim();
  return prompt || `${item.kind === "video" ? "Video" : "Image"} ${index + 1}`;
}

export function R22LibraryView({
  initialItems,
  initialCursor = null,
  initialHasMore = false,
  attentionJobs = [],
  readError,
  fixture = false,
  fixtureRestore = true,
  fixtureEmpty = false,
  state = readError ? "error" : "ready",
}: {
  initialItems: LibraryItem[];
  initialCursor?: string | null;
  initialHasMore?: boolean;
  attentionJobs?: AdJobItem[] | null;
  readError?: string;
  fixture?: boolean;
  fixtureRestore?: boolean;
  fixtureEmpty?: boolean;
  state?: LibraryViewState;
}) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(readError ?? "");

  const counts = useMemo(() => ({
    all: items.length,
    image: items.filter((item) => item.kind === "image").length,
    video: items.filter((item) => item.kind === "video").length,
    star: items.filter((item) => item.favorite).length,
  }), [items]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesFilter = filter === "all" ? true : filter === "star" ? item.favorite : item.kind === filter;
      return matchesFilter && (!term || `${item.prompt} ${item.kind}`.toLowerCase().includes(term));
    });
  }, [filter, items, query]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError("");
    const result = await getGenerationHistory({ cursor, take: 80 });
    setLoading(false);
    if ("error" in result) return setError(result.error);
    setItems((current) => [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
    setCursor(result.nextCursor);
    setHasMore(result.hasMore);
  }

  const emptyCopy = filter === "video"
    ? "No videos yet — ask for one in Canvas."
    : filter === "star"
      ? "Nothing starred yet — star the keepers in their project and they will gather here."
      : "Nothing has been made yet. Start from Canvas and completed media will gather here.";

  const banner = state === "loading"
    ? <section className="r22-library-empty" aria-busy="true">Opening your Library…</section>
    : state === "permission"
      ? <section className="r22-library-empty" role="status"><CircleAlert aria-hidden="true" /> You do not have access to this Library. Nothing is guessed in its place.</section>
      : <section className="r22-library-empty" role={state === "error" || error ? "alert" : "status"}>
          <CircleAlert aria-hidden="true" />
          {state === "unknown"
            ? "We could not tell whether your Library loaded. Nothing is guessed in its place."
            : `Your Library could not be opened: ${error || "the read did not finish"}. Nothing is guessed in its place.`}
          <Link href={fixture ? "/library?fixture=r22" : "/library"}>Retry</Link>
        </section>;

  return (
    <main className="r22-library" data-r22-library data-fixture={fixture || undefined}>
      <header><h1>Library</h1><p>Find every image and video you have already made.</p></header>

      {state !== "ready" || error ? banner : fixture ? <LibraryWorkroom fixture restore={fixtureRestore} empty={fixtureEmpty} /> : (
        <>
          <div className="r22-library-tools">
            {/* 搜索框归 `ui/input-group`(审计 A-12)。 */}
            <InputGroup className="r22-library-search">
              <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
              <InputGroupInput type="search" aria-label="Search library" placeholder="Search Library" value={query} onChange={(event) => setQuery(event.target.value)} />
            </InputGroup>
            {/*
              计数从拼进按钮文字的 `All · 13` 改成标签 + 一枚安静的计数(审计 B-4)——
              同一扇门里 `LibraryNav` 早就用 `<em>` 这么做了,两种做法留在一门里,商家
              看到的是同一件事两种长相。这里对齐已经做对的那一种,不发明第三种。
            */}
            <div className="r22-library-filters" role="group" aria-label="Filter library">
              {(["all", "image", "video", "star"] as const).map((value) => (
                <Button unstyled type="button" key={value} className={filter === value ? "is-active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  <span>{value === "all" ? "All" : value === "image" ? "Images" : value === "video" ? "Videos" : "Starred"}</span>
                  <em data-r22-library-count={value}>{counts[value]}{value === "all" && hasMore ? "+" : ""}</em>
                </Button>
              ))}
            </div>
          </div>

          {visible.length ? (
            <div className="r22-library-grid">
              {visible.map((item, index) => (
                <article className="r22-library-tile" key={item.id}>
                  <Link className="r22-library-tile-link" href={canvasHref(item.projectId)} aria-label={`Open ${itemLabel(item, index)} in Canvas`}>
                    <span className="r22-library-media">
                      {item.kind === "video" ? <video src={item.url} muted preload="metadata" /> : <img src={item.url} alt="" />}
                    </span>
                    <span className="r22-library-meta">
                      <b>{itemLabel(item, index)}</b>
                      <span>{item.kind === "video" ? "Video" : "Image"} · {new Date(item.createdAt).toLocaleDateString("en-GB", { month: "short", day: "numeric" })}</span>
                    </span>
                  </Link>
                  <Button
                    unstyled
                    type="button"
                    className="r22-library-star"
                    aria-label={`${item.favorite ? "Remove" : "Add"} ${itemLabel(item, index)} ${item.favorite ? "from" : "to"} Starred`}
                    aria-pressed={item.favorite}
                    onClick={() => toast("Starring is not connected to the production Library yet, so nothing changed.")}
                  >
                    <Star fill={item.favorite ? "currentColor" : "none"} aria-hidden="true" />
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            /* 空态归位 `ui/empty`(审计 A-5),句子里点名的去处配一颗真按钮(B-6)——
               「Start from Canvas」指的就是 `/create` 那扇门,不是一句读完还得自己找路的话。 */
            <Empty className="r22-library-empty">
              <EmptyHeader>
                <EmptyDescription>{query ? "No Library item matches this search and filter." : emptyCopy}</EmptyDescription>
              </EmptyHeader>
              {query ? null : (
                <EmptyContent>
                  <Link className="r22-library-empty-act" href="/create">Start from Canvas</Link>
                </EmptyContent>
              )}
            </Empty>
          )}

          {hasMore ? (
            <Button unstyled className="r22-library-more" type="button" onClick={() => void loadMore()} disabled={loading}>{loading ? "Loading…" : "Load more"}</Button>
          ) : null}
        </>
      )}

      {attentionJobs === null ? (
        <section className="r22-library-attention" role="alert">
          <h2>Generation status unavailable</h2>
          <p>Running and failed jobs could not be read. Nothing is guessed in its place.</p>
        </section>
      ) : attentionJobs.length ? (
        <section className="r22-library-attention">
          <h2>Needs attention</h2>
          <p>Incomplete generations stay separate from reusable Library items.</p>
          <div>
            {attentionJobs.map((job) => (
              <article key={job.id}>
                <b>{job.status === "processing" ? "Processing…" : "Didn't go through"}</b>
                <span>{job.prompt || `${job.kind} generation`}</span>
                {job.error && job.status !== "processing" ? <small>{job.error}</small> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default R22LibraryView;
