"use client";
import React, { useState, useTransition } from "react";
import { getAnalytics, type AnalyticsData } from "@/lib/analytics-actions";
import { RANGES, type RangeKey } from "@/lib/analytics-view";
import { ANALYTICS_PLATFORMS, platformById } from "@/lib/analytics-platforms";
import type { OttoViewKey } from "./OttoApp";
import { PerAdPerformance } from "./PerAdPerformance";

/**
 * Analytics screen (Phase A) — KPIs, a reach-over-time chart, and OTTO's "best day"
 * insight, read straight from Meta. Matches the founder gold-standard ui_kit
 * (docs/design-refs/analytics-ui-kit.html) pixel-for-pixel. Read-only: nothing here
 * spends credits. Range changes re-fetch via the getAnalytics Server Action.
 */
export function OttoAnalytics({
  initial,
  onNavigate,
  onUseInOtto,
}: {
  initial: AnalyticsData;
  onNavigate: (view: OttoViewKey) => void;
  onUseInOtto?: (prompt: string) => void;
}) {
  const [data, setData] = useState<AnalyticsData>(initial);
  const [pending, startTransition] = useTransition();
  // Which analytics platform is selected. Purely in-page: switching platform
  // fires NO server action (soon platforms have no data; returning to meta
  // reuses the already-loaded `data`). Only range changes re-fetch.
  const [platform, setPlatform] = useState("meta");

  function onRangeChange(range: RangeKey) {
    startTransition(async () => {
      const next = await getAnalytics({ range });
      setData(next);
    });
  }

  const selected = platformById(platform);
  const isMeta = platform === "meta";

  // Header platform select — same styling as the date-range select. "(soon)"
  // suffix on placeholder platforms; · read-only muted tag trails it.
  const platformSelect = (
    <>
      <select
        aria-label="Platform"
        value={platform}
        onChange={(e) => setPlatform(e.target.value)}
        className="h-[34px] rounded-[10px] border border-border bg-card px-[13px] text-[13px] font-semibold"
      >
        {ANALYTICS_PLATFORMS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.status === "soon" ? " (soon)" : ""}
          </option>
        ))}
      </select>
      <span className="text-[12px] text-muted-foreground">· read-only</span>
    </>
  );

  // Header always renders (h1 + platform switcher + · read-only), so a user
  // whose Meta is disconnected can still switch to another platform — the
  // connect/reconnect wall lives in the BODY, never as a full-page return.
  // The date-range select only appears on the meta+ready path (no range to
  // pick for soon platforms or connect/reconnect states).
  const isReady = isMeta && data.state === "ready";
  const rangeLabel = isReady ? RANGES.find((r) => r.key === data.range)?.label ?? "" : "";
  const label = selected?.label ?? platform;

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-[880px] px-7 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-[1.5rem] font-bold tracking-[-0.02em]">Analytics</h1>
          {platformSelect}
          <div className="flex-1" />
          {isReady && (
            <select
              aria-label="Date range"
              value={data.range}
              onChange={(e) => onRangeChange(e.target.value as RangeKey)}
              className="h-[34px] rounded-[10px] border border-border bg-card px-[13px] text-[13px] font-semibold"
            >
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* "Soon" platform: coming-soon panel (mirrors ConnectPanel's card
            layout). Never touches Meta's connection state — switching platform
            fires no server action, so `data` is untouched here. */}
        {!isMeta && (
          <div className="rounded-[16px] border border-border bg-card p-[18px] text-center flex flex-col items-center gap-3 py-14">
            <CoralCloud size={40} />
            <div className="text-[1.5rem] font-bold tracking-[-0.02em]">
              {label} analytics is coming soon
            </div>
            <div className="text-[13px] text-muted-foreground" style={{ maxWidth: 360 }}>
              We'll light this up here once {label} is connected — same place, same view.
            </div>
          </div>
        )}

        {/* Meta connect/reconnect walls live in the body so the header (and its
            platform switcher) stays visible — the user can switch away. */}
        {isMeta && data.state === "notConnected" && (
          <ConnectPanel kind="connect" onNavigate={onNavigate} />
        )}
        {isMeta && data.state === "needsReconnect" && (
          <ConnectPanel kind="reconnect" onNavigate={onNavigate} />
        )}

        {isReady && (
        <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {/* KPI grid */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {data.kpis.map((k) => (
              <div key={k.label} className="rounded-[14px] border border-border bg-card p-[15px]">
                <div className="text-[12px] text-[#86867F] font-medium">{k.label}</div>
                {/* Empty period: every value renders "—" (buildKpis sums an empty series to 0). */}
                <div className="text-[26px] font-bold tracking-[-0.02em] mt-1">
                  {data.empty ? "—" : k.value}
                </div>
                {k.delta && (
                  <div
                    className={
                      "text-[12px] font-semibold mt-[5px] " +
                      (k.delta.dir === "up"
                        ? "text-[#15803D]"
                        : k.delta.dir === "down"
                          ? "text-[#B42318]"
                          : "text-[#86867F]")
                    }
                  >
                    {k.delta.text}
                    {/* Gold-standard suffix: "▲ 18% vs last month" — muted, weight 500. */}
                    <span className="text-[#86867F] font-medium"> vs prev. period</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {data.empty && (
            <div className="text-[12px] text-muted-foreground mt-2">No activity in this period yet.</div>
          )}

          {/* OTTO insight banner */}
          {data.insight && (
            <div className="flex items-center gap-[13px] bg-[#FFF6F2] border border-[#FBD9C9] rounded-[16px] px-[17px] py-[15px] mt-[14px]">
              <CoralCloud />
              <span className="flex-1 text-[14px] leading-[1.45] text-[#9A3A1A]">{data.insight.text}</span>
              <button
                type="button"
                onClick={() => {
                  // PREFILL ONLY — no generation, no auto-send, no spend.
                  if (onUseInOtto) onUseInOtto(data.insight!.prefill);
                  else onNavigate("otto");
                }}
                className="h-[38px] rounded-[11px] bg-brand text-white text-[13.5px] font-semibold px-4 whitespace-nowrap"
              >
                Make more like it
              </button>
            </div>
          )}

          {/* Reach chart panel */}
          <div className="rounded-[16px] border border-border bg-card p-[18px] mt-[14px]">
            <div className="text-[14px] font-semibold">Reach over time</div>
            <div className="text-[12px] text-[#86867F]">{rangeLabel}</div>
            <svg viewBox="0 0 820 180" className="h-[170px] w-full mt-[10px]">
              <defs>
                <linearGradient id="otto-reach-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#0A0A0A" stopOpacity="0.10" />
                  <stop offset="1" stopColor="#0A0A0A" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="0" y1="150" x2="820" y2="150" stroke="#EFEFED" />
              <line x1="0" y1="100" x2="820" y2="100" stroke="#F4F4F2" />
              <line x1="0" y1="50" x2="820" y2="50" stroke="#F4F4F2" />
              {data.chart && (
                <>
                  <path d={data.chart.areaPath} fill="url(#otto-reach-fill)" />
                  <path d={data.chart.linePath} fill="none" stroke="#0A0A0A" strokeWidth="2.2" />
                  {data.chart.points
                    .filter((p) => p.peak)
                    .map((p) => (
                      <circle key={`${p.date}-${p.x}`} cx={p.x} cy={p.y} r="4" fill="var(--brand)" />
                    ))}
                </>
              )}
            </svg>
          </div>

          {/* Per-ad performance (additive, 宪法7 read parity) */}
          <PerAdPerformance range={data.range} />

          {/* Top posts panel — pending one more Meta permission (Phase A) */}
          <div className="rounded-[16px] border border-border bg-card p-[18px] mt-[14px]">
            <div className="text-[14px] font-semibold">Top posts</div>
            <div className="text-[13px] text-muted-foreground mt-1">
              Per-post performance needs one more Meta permission — it lights up automatically once
              approved.
            </div>
            <button
              type="button"
              disabled
              className="mt-3 h-[34px] rounded-[10px] px-[13px] text-[13px] font-semibold text-muted-foreground opacity-50 cursor-default"
            >
              Learn more
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

/** Not-connected / needs-reconnect prompt — a single centred card. Renders
 *  inside the Analytics body (below the always-visible header), so it carries
 *  no page-level wrapper of its own. */
function ConnectPanel({
  kind,
  onNavigate,
}: {
  kind: "connect" | "reconnect";
  onNavigate: (view: OttoViewKey) => void;
}) {
  const isConnect = kind === "connect";
  return (
    <div className="rounded-[16px] border border-border bg-card p-[18px] text-center flex flex-col items-center gap-3 py-14">
      <CoralCloud size={40} />
      <div className="text-[1.5rem] font-bold tracking-[-0.02em]">
        {isConnect ? "Connect Meta to see your numbers" : "Reconnect Meta"}
      </div>
      <div className="text-[13px] text-muted-foreground" style={{ maxWidth: 360 }}>
        Analytics reads your reach, spend and results straight from Meta — read-only.
      </div>
      <button
        type="button"
        onClick={() => onNavigate("connections")}
        className="mt-1 h-[38px] rounded-[11px] bg-[#0A0A0A] text-white text-[13.5px] font-semibold px-4"
      >
        {isConnect ? "Connect Meta" : "Reconnect"}
      </button>
    </div>
  );
}

/** OTTO's coral cloud mark (copied from OttoAvatar), sized ~30px for the insight banner. */
function CoralCloud({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round((size * 110) / 120)}
      viewBox="0 0 120 110"
      role="img"
      aria-label="Otto"
      className="shrink-0"
    >
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

export default OttoAnalytics;
