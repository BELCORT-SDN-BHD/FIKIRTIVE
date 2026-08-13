"use client";
import React, { useState, useTransition } from "react";
import { getAnalytics, type AnalyticsData } from "@/lib/analytics-actions";
import { RANGES, buildCurrencyNotes, type RangeKey } from "@/lib/analytics-view";
import { ANALYTICS_PLATFORM_LABEL } from "@/lib/analytics-platforms";
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

  function onRangeChange(range: RangeKey) {
    startTransition(async () => {
      const next = await getAnalytics({ range });
      setData(next);
    });
  }

  // #792 — the platform picker is gone. It could select four platforms that have no
  // adapter, no data and no date, and a control that moves is a promise; the four
  // "(soon)" rows were the product claiming reach it does not have. What is left is a
  // statement of fact: this screen reads one platform, read-only.
  const source = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-[13px] font-semibold">{ANALYTICS_PLATFORM_LABEL}</span>
      <span className="whitespace-nowrap text-[12px] text-muted-foreground">· read-only</span>
    </div>
  );

  // The header always renders (h1 + what this reads + · read-only), so a user whose Meta
  // is disconnected still gets the page's own frame — the connect/reconnect wall lives in
  // the BODY, never as a full-page return. The date-range select only appears on the ready
  // path (there is no range to pick in a connect/reconnect state).
  const isReady = data.state === "ready";
  // Only what the numbers establish (#692 r3) — computed from the same KPI lines on screen.
  const currencyNotes =
    data.state === "ready"
      ? buildCurrencyNotes(data.kpis)
      : { multipleCurrencies: null, unreportedCurrency: null };
  const rangeLabel = isReady ? RANGES.find((r) => r.key === data.range)?.label ?? "" : "";

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-[880px] px-7 py-6">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[1.5rem] font-bold tracking-[-0.02em]">Analytics</h1>
          {source}
          <div className="hidden flex-1 sm:block" />
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

        {/* Connect/reconnect walls live in the body so the header stays visible — the page
            keeps its own frame instead of becoming a full-page return. */}
        {data.state === "notConnected" && (
          <ConnectPanel kind="connect" onNavigate={onNavigate} />
        )}
        {data.state === "needsReconnect" && (
          <ConnectPanel kind="reconnect" onNavigate={onNavigate} />
        )}
        {/* F37: transient Graph failure — the token is fine, so offer a retry, never a reconnect. */}
        {data.state === "transientError" && (
          <div className="rounded-[16px] border border-border bg-card p-[18px] text-center flex flex-col items-center gap-3 py-14">
            <div className="text-[1.5rem] font-bold tracking-[-0.02em]">
              Couldn&apos;t reach Meta just now
            </div>
            <div className="text-[13px] text-muted-foreground" style={{ maxWidth: 360 }}>
              This is usually a temporary hiccup on Meta&apos;s side — your connection is fine. Try again in a moment.
            </div>
          </div>
        )}

        {isReady && (
        <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {/* KPI grid */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {data.kpis.map((k) => (
              <div key={k.label} className="rounded-[14px] border border-border bg-card p-[15px]">
                <div className="text-[12px] text-[#86867F] font-medium">{k.label}</div>
                {/* Empty period: every value renders "—" (buildKpis sums an empty series to 0).
                    Money cards carry one line PER CURRENCY (#692) — several lines mean several
                    ad-account currencies, shown side by side and never added together. */}
                <div className="mt-1">
                  {(data.empty
                    ? [{ text: "—", currency: null, accountName: null }]
                    : k.values
                  ).map((v, i) => (
                    <div key={`${v.currency ?? ""}|${v.accountName ?? ""}|${i}`}>
                      <div
                        className={
                          "font-bold tracking-[-0.02em] " +
                          (!data.empty && k.values.length > 1
                            ? "text-[20px] leading-[1.25]"
                            : "text-[26px]")
                        }
                      >
                        {v.text}
                      </div>
                      {/* A figure we cannot label says so on its OWN line, and says whose it is —
                          each unlabelled line is one account's own money (#692 r2). */}
                      {!data.empty && v.accountName !== null && (
                        <div className="text-[11.5px] text-muted-foreground font-medium">
                          Currency not reported — {v.accountName}
                        </div>
                      )}
                    </div>
                  ))}
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

          {/* #692 r3: each sentence is earned separately in buildCurrencyNotes — "more than one
              currency" needs two DIFFERENT known codes, which two unlabelled accounts do not
              establish; an unlabelled figure needs its own explanation whatever else is on screen. */}
          {!data.empty && currencyNotes.multipleCurrencies && (
            <div className="text-[12px] text-muted-foreground mt-2">{currencyNotes.multipleCurrencies}</div>
          )}
          {!data.empty && currencyNotes.unreportedCurrency && (
            <div className="text-[12px] text-muted-foreground mt-2">{currencyNotes.unreportedCurrency}</div>
          )}

          {/* OTTO insight banner */}
          {data.insight && (
            /* flex-wrap + a real minimum for the copy (#697): the button below says
               whitespace-nowrap, so on a phone it took the width it wanted and left the
               sentence a two-words-per-line ribbon. Below ~220px of copy the button now
               drops to its own line instead. */
            <div className="flex flex-wrap items-center gap-[13px] bg-[#FFF6F2] border border-[#FBD9C9] rounded-[16px] px-[17px] py-[15px] mt-[14px]">
              <CoralCloud />
              <span className="min-w-[220px] flex-1 text-[14px] leading-[1.45] text-[#9A3A1A]">{data.insight.text}</span>
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
        {isConnect ? "Connect Instagram or Facebook to see your numbers" : "Reconnect Meta"}
      </div>
      <div className="text-[13px] text-muted-foreground" style={{ maxWidth: 360 }}>
        Analytics reads your reach, spend and results straight from Meta — read-only.
      </div>
      <button
        type="button"
        onClick={() => onNavigate("connections")}
        className="mt-1 h-[38px] rounded-[11px] bg-[#0A0A0A] text-white text-[13.5px] font-semibold px-4"
      >
        {isConnect ? "Open Connections" : "Reconnect"}
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
