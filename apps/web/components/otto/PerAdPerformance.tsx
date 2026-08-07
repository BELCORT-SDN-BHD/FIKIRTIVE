"use client";
import React, { useEffect, useState, useTransition } from "react";
import { getAdPerformance } from "@/lib/meta-performance-actions";
import { buildPerAdView, type PerAdView } from "@/lib/per-ad-view";
import { RANGES, type RangeKey } from "@/lib/analytics-view";

/** Additive per-ad performance panel (宪法7 read parity). $0 read-only: self-fetches
 *  getAdPerformance (same fetchOwnerAdPerformance the Otto skill uses). Renders each ad's
 *  real creative + metrics with a source stamp; ROAS "—" when Meta has none; honest truncation.
 *  Winner/loser judgment = P2 (expert card); recreate = P3. */
export function PerAdPerformance({ range }: { range: RangeKey }) {
  const [view, setView] = useState<PerAdView | null>(null);
  const [gone, setGone] = useState(false); // notConnected/needsReconnect/transientError → render nothing (Analytics body already shows the wall)
  const [pending, start] = useTransition();

  useEffect(() => {
    // Analytics range key ("30d") → Meta preset ("last_30d") that getAdPerformance expects.
    const preset = RANGES.find((r) => r.key === range)?.preset ?? "last_30d";
    start(async () => {
      const res = await getAdPerformance(preset);
      if (!res || "error" in res || "notConnected" in res || "needsReconnect" in res || "transientError" in res) { setGone(true); return; }
      setGone(false);
      setView(buildPerAdView(res));
    });
  }, [range]);

  if (gone) return null;

  return (
    <div className="rounded-[16px] border border-border bg-card p-[18px] mt-[14px]">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[14px] font-semibold">Per-ad performance</div>
          <div className="text-[12px] text-[#86867F]">Which specific ads &amp; creatives are winning</div>
        </div>
        {view && (
          <span className="text-[11.5px] text-[#86867F] bg-muted rounded-[7px] px-2 py-[3px] font-medium whitespace-nowrap">
            {view.stamp}
          </span>
        )}
      </div>

      {/* #692: separate runs, never one ranking. The two sentences are earned separately —
          runs split by CURRENCY and runs split because Meta reported none are different facts. */}
      {view?.currencyNote && <div className="text-[12px] text-muted-foreground mt-2">{view.currencyNote}</div>}
      {view?.unreportedNote && <div className="text-[12px] text-muted-foreground mt-2">{view.unreportedNote}</div>}

      {view?.truncatedNote && <div className="text-[12px] text-muted-foreground mt-2">{view.truncatedNote}</div>}

      {pending && !view && <div className="text-[13px] text-muted-foreground mt-3">Loading your ads…</div>}

      {view && view.rows.length === 0 && (
        <div className="text-[13px] text-muted-foreground mt-3">No ads ran in this period yet.</div>
      )}

      <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {view?.rows.map((r) => (
          <React.Fragment key={r.adId}>
            {/* Heading for each money-bucket run (#692) — the rows under it are ranked only
                against each other, never against another bucket's. No `uppercase` (#692 r3):
                the heading carries sentence-case copy and a real ad-account name, and shouting
                them would mangle both. */}
            {r.groupLabel && (
              <div className="text-[11.5px] text-[#86867F] font-semibold tracking-[0.01em] pt-[14px] border-t border-border">
                {r.groupLabel}
              </div>
            )}
            <div className={"flex gap-[14px] items-center py-[14px] mt-0 " + (r.groupLabel ? "" : "border-t border-border first:border-t-[1px]")}>
              {/* creative thumbnail (video shows a play glyph) */}
              <div className="w-[56px] h-[56px] rounded-[10px] shrink-0 relative overflow-hidden border border-border bg-muted">
                {r.creative.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.creative.imageUrl} alt="" className="w-full h-full object-cover" />
                )}
                {r.creative.isVideo && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.5))" }}><path d="M8 5v14l11-7z" /></svg>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold truncate">{r.name}</div>
                <div className="flex gap-[22px] mt-[9px]">
                  {r.metrics.map((m) => (
                    <div key={m.label}>
                      <div className="text-[10.5px] text-[#86867F] font-medium uppercase tracking-[0.03em]">{m.label}</div>
                      <div className={"text-[14px] mt-[2px] " + (m.value === "—" ? "text-[#86867F] font-medium" : "font-semibold")}>{m.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default PerAdPerformance;
