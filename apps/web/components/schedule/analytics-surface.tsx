"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { SelectNative } from "@/components/ui/native-select";

import Image from "next/image";
import Link from "next/link";
import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { getAnalytics, type AnalyticsData } from "@/lib/analytics-actions";
import type { RangeKey } from "@/lib/analytics-view";
import { useOttoPanelControls } from "@/components/otto/panel/OttoPanelShell";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { readR22WorkspaceDirectory } from "@/components/r22/r22-workspace-fixture";
import "./r22-analytics.css";

export const R22_ANALYTICS_FIXTURE: Extract<AnalyticsData, { state: "ready" }> = {
  state: "ready", range: "30d", empty: false,
  kpis: [
    { label: "Reach", values: [{ text: "15,280", currency: null, accountName: null }], delta: { dir: "up", text: "▲ 18%" } },
    { label: "Engagement", values: [{ text: "1,842", currency: null, accountName: null }], delta: { dir: "up", text: "▲ 9%" } },
    { label: "Spend", values: [{ text: "MYR 1,240.00", currency: "MYR", accountName: null }], delta: null },
    { label: "Sales (est.)", values: [{ text: "MYR 4,910", currency: "MYR", accountName: null }], delta: null },
  ],
  chart: { linePath: "M0,146 C90,140 120,88 205,104 C300,124 330,52 410,69 C500,87 558,36 640,52 C720,67 766,24 820,34", areaPath: "M0,146 C90,140 120,88 205,104 C300,124 330,52 410,69 C500,87 558,36 640,52 C720,67 766,24 820,34 L820,160 L0,160 Z", points: [] },
  insight: { text: "Raya table shots reached more people than the other ads in this period.", prefill: "Show me why the Raya table shots performed better." },
};

type AnalyticsFixtureQuality = "ready" | "empty" | "stale" | "partial" | "permission" | "unknown";

export function AnalyticsSurface({ initial, fixture = false, fixtureQuality = "ready" }: { initial: AnalyticsData; fixture?: boolean; fixtureQuality?: AnalyticsFixtureQuality }) {
  const otto = useOttoPanelControls();
  const [data, setData] = useState(initial);
  const [transitionPending, startTransition] = useTransition();
  const [fixturePending, setFixturePending] = useState(false);
  const [quality, setQuality] = useState<AnalyticsFixtureQuality>(fixtureQuality);
  const [fixtureWorkspaceId, setFixtureWorkspaceId] = useState(fixture ? "" : "production");
  const pending = transitionPending || fixturePending;

  useEffect(() => {
    if (!fixture) return;
    const workspaceId = readR22WorkspaceDirectory().activeId;
    setFixtureWorkspaceId(workspaceId);
    if (workspaceId !== "batik-house") setData({ state: "notConnected" });
  }, [fixture]);

  function load(range: RangeKey) {
    if (fixture) {
      setFixturePending(true);
      window.setTimeout(() => {
        setData({ ...R22_ANALYTICS_FIXTURE, range });
        setQuality("ready");
        setFixturePending(false);
      }, 260);
      return;
    }
    startTransition(async () => setData(await getAnalytics({ range })));
  }

  if (fixture && !fixtureWorkspaceId) return <main className="r22-analytics" data-r22-analytics data-state="loading" aria-busy="true"><header><div><h1>Analytics</h1><p>Loading workspace provider access…</p></div></header></main>;

  const permission = fixture && quality === "permission";
  const unknown = fixture && quality === "unknown";
  const ready = data.state === "ready" && !permission && !unknown;
  return <main className="r22-analytics" data-r22-analytics data-state={permission ? "permission" : unknown ? "unknown" : data.state} data-quality={ready ? quality : undefined} data-fixture={fixture || undefined}>
    <header><div><h1>Analytics</h1><p>See the performance data the connected provider actually exposes.</p></div></header>
    <p className="r22-analytics-fresh">{permission ? "Meta insights exist, but this member cannot read them." : unknown ? "The Meta read may still finish. Nothing is guessed in its place." : data.state === "notConnected" ? "No channel is connected, so there is nothing to sync yet." : data.state === "needsReconnect" ? "Meta access expired. Existing numbers are not shown as current." : data.state === "transientError" ? "Meta has not returned a fresh response. No old result is presented as current." : quality === "stale" ? "Last verified Aug 24, 2026 at 12:00 MYT · Meta has not returned a newer snapshot." : quality === "partial" ? "Verified Aug 25, 2026 at 08:42 MYT · One Meta account did not return a complete response." : `Meta ad-account insights · ${fixture ? "fixture snapshot · Aug 25, 2026 at 08:42 MYT" : "read-only live response"}`}</p>
    {ready ? <div className="r22-analytics-controls"><SelectNative unstyled aria-label="Analytics source" value="meta" disabled><option value="meta">Meta ads · read-only</option></SelectNative><div role="group" aria-label="Period"><Button unstyled type="button" disabled={pending} className={data.range === "7d" ? "is-active" : ""} onClick={() => load("7d")}>7 days</Button><Button unstyled type="button" disabled={pending} className={data.range === "30d" ? "is-active" : ""} onClick={() => load("30d")}>30 days</Button></div></div> : null}
    {permission ? <section className="r22-analytics-state"><CircleAlert /><h2>Performance is not available to this member</h2><p>Ask a workspace administrator for the capability to read provider insights. Nothing is guessed in its place.</p><Link href={`${SHELL_ROUTES.preferences}?section=members`}>Review members</Link></section> : unknown ? <section className="r22-analytics-state" role="status"><CircleAlert /><h2>Performance read outcome is unknown</h2><p>Do not reconnect or treat this as an empty report. Check the same workspace read before taking another action.</p><Button unstyled type="button" disabled={pending} onClick={() => load("30d")}>{pending ? "Checking…" : "Check read status"}</Button></section> : data.state === "notConnected" ? <section className="r22-analytics-state"><Image src="/brand/r22-otto.svg" width={120} height={110} style={{ width: 44, height: "auto" }} alt="" /><h2>Connect Meta to see performance</h2><p>Nothing here is guessed. Until a provider is connected there is no reach, engagement, spend or estimated sales to read.</p><Link href={`${SHELL_ROUTES.preferences}?section=connections`}>Open Connections</Link></section> : data.state === "needsReconnect" ? <section className="r22-analytics-state"><CircleAlert /><h2>Reconnect Meta</h2><p>The previous authorization no longer permits this read. Reconnecting is separate from a temporary provider failure.</p><Link href={`${SHELL_ROUTES.preferences}?section=connections`}>Reconnect</Link></section> : data.state === "transientError" ? <section className="r22-analytics-state" role="alert"><RefreshCw /><h2>Meta could not be reached just now</h2><p>Your connection was not reclassified as disconnected. Retry the same read.</p><Button unstyled type="button" disabled={pending} onClick={() => load("30d")}>{pending ? "Retrying…" : "Retry"}</Button></section> : <div className={pending ? "r22-analytics-body is-pending" : "r22-analytics-body"}>{data.empty || quality === "empty" ? <section className="r22-analytics-state"><h2>No Meta ad activity in this period</h2><p>The account read succeeded, but it returned no reportable activity.</p><Link href={SHELL_ROUTES.schedule}>Go to Schedule</Link></section> : <>{quality === "partial" ? <p className="r22-analytics-quality" role="status"><CircleAlert />Partial response: verified figures remain visible; missing account values are not estimated.</p> : quality === "stale" ? <p className="r22-analytics-quality" role="status"><CircleAlert />This is the last verified snapshot, not a current result. Refreshing does not reclassify the connection.</p> : null}<section className="r22-analytics-overview"><header><h2>Overview</h2><span>{data.range === "7d" ? "Last 7 days" : "Last 30 days"}</span></header><div>{data.kpis.map((kpi) => <article key={kpi.label}><span>{kpi.label}</span>{kpi.values.map((value, index) => <b key={`${value.text}-${index}`}>{value.text}</b>)}{kpi.delta ? <small className={`is-${kpi.delta.dir}`}>{kpi.delta.text} <i>vs prev. period</i></small> : <small>Meta account total</small>}</article>)}</div></section>{data.insight ? <section className="r22-analytics-insight"><Image src="/brand/r22-otto.svg" width={120} height={110} style={{ width: 30, height: "auto" }} alt="" /><p>{data.insight.text}</p><Button unstyled type="button" disabled={!otto} onClick={() => otto?.openPanel()}>Ask Otto</Button></section> : null}<section className="r22-analytics-chart"><header><h2>Reach over time</h2><span>{data.range === "7d" ? "Last 7 days" : "Last 30 days"}</span></header>{data.chart ? <svg viewBox="0 0 820 180" role="img" aria-label="Reach over time"><line x1="0" y1="150" x2="820" y2="150" /><line x1="0" y1="100" x2="820" y2="100" /><line x1="0" y1="50" x2="820" y2="50" /><path d={data.chart.areaPath} className="r22-analytics-area" /><path d={data.chart.linePath} className="r22-analytics-line" /></svg> : <p>No trend series was returned.</p>}</section></>}</div>}
  </main>;
}

export default AnalyticsSurface;
