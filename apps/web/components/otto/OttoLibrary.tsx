"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { EntityDTO } from "@/lib/types";
import { getGenerationHistory, type LibraryItem } from "@/lib/library-actions";
import { setFavorite } from "@/lib/asset-actions";
import DetailPanel from "../asset/DetailPanel";

const PAGE = 60;

export default function OttoLibrary({ projectId, entities = [] }: { projectId: string; entities?: EntityDTO[] }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true); // seed true so the empty-state copy doesn't flash before the first fetch
  const [search, setSearch] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [view, setView] = useState<"full" | "compact">("full");
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const fetchPage = useCallback(
    async (fromCursor: string | null, replace: boolean) => {
      const myReq = ++reqIdRef.current;
      setLoading(true);
      const res = await getGenerationHistory(projectId, {
        search: search.trim() || undefined,
        favoriteOnly,
        cursor: fromCursor,
        take: PAGE,
      });
      if (myReq !== reqIdRef.current) return;
      setLoading(false);
      if ("error" in res) return;
      if (myReq !== reqIdRef.current) return;
      setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
      if (myReq !== reqIdRef.current) return;
      setCursor(res.nextCursor);
      if (myReq !== reqIdRef.current) return;
      setHasMore(res.hasMore);
    },
    [projectId, search, favoriteOnly],
  );

  // Initial load + reload (debounced) whenever search/favorites change.
  useEffect(() => {
    const t = setTimeout(() => {
      void fetchPage(null, true);
    }, 300);
    return () => clearTimeout(t);
  }, [fetchPage]);

  async function toggleFav(id: string, current: boolean) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, favorite: !current } : it)));
    const res = await setFavorite(id, !current);
    if ("error" in res) {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, favorite: current } : it)));
    }
  }

  const minCard = view === "compact" ? 120 : 220;

  // leading-[1.65]: pin the inherited line-height for the .gb subtree so S4
  // teardown can remove it without layout shift (mirrors the S1a OttoNav pattern).
  return (
    <div className="gb leading-[1.65]" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem", flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your library…"
          className="al-input"
          style={{ flex: 1, maxWidth: 360 }}
        />
        <button
          type="button"
          onClick={() => setFavoriteOnly((v) => !v)}
          aria-pressed={favoriteOnly}
          className="al-btn al-btn-sm"
          style={{ background: favoriteOnly ? "var(--muted)" : "transparent" }}
        >
          {favoriteOnly ? "★ Favorites" : "☆ Favorites"}
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.25rem" }}>
          <button type="button" onClick={() => setView("full")} aria-pressed={view === "full"} className="al-btn al-btn-sm" style={{ background: view === "full" ? "var(--muted)" : "transparent" }}>Full</button>
          <button type="button" onClick={() => setView("compact")} aria-pressed={view === "compact"} className="al-btn al-btn-sm" style={{ background: view === "compact" ? "var(--muted)" : "transparent" }}>Compact</button>
        </div>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: "auto", padding: "1rem" }}>
        {items.length === 0 && !loading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted-foreground)" }}>
            {search || favoriteOnly ? "Nothing matches." : "No generations yet — make something with Otto or the canvas."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${minCard}px, 1fr))`, gap: "0.75rem" }}>
            {items.map((it) => (
              <div key={it.id} style={{ position: "relative", borderRadius: "14px", overflow: "hidden", border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer" }} onClick={() => setDetailFor(it.id)}>
                {it.kind === "video" ? (
                  <video src={it.url} muted style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.url} alt={it.prompt} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                )}
                <button
                  type="button"
                  aria-label={it.favorite ? "Unfavorite" : "Favorite"}
                  onClick={(e) => { e.stopPropagation(); void toggleFav(it.id, it.favorite); }}
                  style={{ position: "absolute", top: 6, right: 6, border: "none", background: "rgba(0,0,0,0.45)", color: it.favorite ? "#ffce4d" : "#fff", cursor: "pointer", borderRadius: "999px", width: 26, height: 26, lineHeight: 1 }}
                >
                  {it.favorite ? "★" : "☆"}
                </button>
                {view === "full" && (
                  <div style={{ padding: "0.5rem" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.prompt || "—"}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>{new Date(it.createdAt).toLocaleDateString()}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <div style={{ display: "flex", justifyContent: "center", padding: "1rem" }}>
            <button type="button" className="al-btn al-btn-sm" disabled={loading} onClick={() => void fetchPage(cursor, false)}>
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>

      {detailFor && (
        <DetailPanel
          generationId={detailFor}
          projectId={projectId}
          entities={entities}
          onClose={() => { setDetailFor(null); void fetchPage(null, true); }}
        />
      )}
    </div>
  );
}
