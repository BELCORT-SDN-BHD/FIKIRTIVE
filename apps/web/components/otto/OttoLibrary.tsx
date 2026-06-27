"use client";
import React, { useCallback, useEffect, useState } from "react";
import type { EntityDTO } from "@/lib/types";
import { getGenerationHistory, type LibraryItem } from "@/lib/library-actions";
import { setFavorite } from "@/lib/asset-actions";
import DetailPanel from "../asset/DetailPanel";

const PAGE = 60;

export default function OttoLibrary({ projectId, entities = [] }: { projectId: string; entities?: EntityDTO[] }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [view, setView] = useState<"full" | "compact">("full");
  const [detailFor, setDetailFor] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (fromCursor: string | null, replace: boolean) => {
      setLoading(true);
      const res = await getGenerationHistory(projectId, {
        search: search.trim() || undefined,
        favoriteOnly,
        cursor: fromCursor,
        take: PAGE,
      });
      setLoading(false);
      if ("error" in res) return;
      setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
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

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-4)", flexShrink: 0, borderBottom: "1px solid var(--border-subtle)" }}>
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
          style={{ background: favoriteOnly ? "var(--surface-raised)" : "transparent" }}
        >
          {favoriteOnly ? "★ Favorites" : "☆ Favorites"}
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-1)" }}>
          <button type="button" onClick={() => setView("full")} aria-pressed={view === "full"} className="al-btn al-btn-sm" style={{ background: view === "full" ? "var(--surface-raised)" : "transparent" }}>Full</button>
          <button type="button" onClick={() => setView("compact")} aria-pressed={view === "compact"} className="al-btn al-btn-sm" style={{ background: view === "compact" ? "var(--surface-raised)" : "transparent" }}>Compact</button>
        </div>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-4)" }}>
        {items.length === 0 && !loading ? (
          <div style={{ padding: "var(--space-8)", textAlign: "center", color: "var(--text-muted)" }}>
            {search || favoriteOnly ? "Nothing matches." : "No generations yet — make something with Otto or the canvas."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${minCard}px, 1fr))`, gap: "var(--space-3)" }}>
            {items.map((it) => (
              <div key={it.id} style={{ position: "relative", borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", cursor: "pointer" }} onClick={() => setDetailFor(it.id)}>
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
                  <div style={{ padding: "var(--space-2)" }}>
                    <div style={{ fontSize: 12, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.prompt || "—"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(it.createdAt).toLocaleDateString()}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-4)" }}>
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
