"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, LoaderCircle, Save } from "lucide-react";
import type { listCampaigns } from "@/lib/campaign-view-data";
import { listTrendSnapshots, saveTrendSnapshot } from "@/lib/trend-actions";
import { trendSourceLabels } from "@/lib/trend-source-labels";
import { MY_DATE_FORMAT } from "@/lib/my-date-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CampaignNav } from "./campaign-nav";

type TrendResult = Awaited<ReturnType<typeof listTrendSnapshots>>;
type CampaignResult = Awaited<ReturnType<typeof listCampaigns>>;

function dateLabel(value: string) {
  return MY_DATE_FORMAT.format(new Date(value));
}

export default function CampaignTrendsPage({
  initialTrends,
  initialCampaigns,
}: {
  initialTrends: TrendResult;
  initialCampaigns: CampaignResult;
}) {
  const [trends, setTrends] = useState("ok" in initialTrends ? initialTrends.snapshots : []);
  const [snapshotId, setSnapshotId] = useState("ok" in initialTrends ? initialTrends.nextSnapshotId : "");
  const [snapshotProof, setSnapshotProof] = useState("ok" in initialTrends ? initialTrends.nextSnapshotProof : "");
  const campaigns = "ok" in initialCampaigns ? initialCampaigns.campaigns : [];
  const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
  const [summary, setSummary] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceDomain, setSourceDomain] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [campaignId, setCampaignId] = useState("none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(
    "error" in initialTrends ? initialTrends.error : "error" in initialCampaigns ? initialCampaigns.error : null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    if (!snapshotId || !snapshotProof || !summary.trim() || !sourceTitle.trim() || !sourceDomain.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveTrendSnapshot({
        snapshotId,
        snapshotProof,
        campaignId: campaignId === "none" ? null : campaignId,
        evidence: {
          summary,
          sources: [{ title: sourceTitle, domain: sourceDomain }],
          ...(capturedAt ? { capturedAt } : {}),
        },
      });
      if (!("ok" in result)) return setError(result.error);
      const refreshed = await listTrendSnapshots();
      if (!("ok" in refreshed)) return setError(refreshed.error);
      setTrends(refreshed.snapshots);
      setSnapshotId(refreshed.nextSnapshotId);
      setSnapshotProof(refreshed.nextSnapshotProof);
      setSummary("");
      setSourceTitle("");
      setSourceDomain("");
      setCapturedAt("");
      // The campaign choice is cleared with the rest of the draft: an unrelated next
      // conclusion must never inherit the campaign the merchant picked for this one.
      setCampaignId("none");
      setNotice("Trend conclusion saved to the owner-scoped archive.");
    } catch {
      setError("The trend snapshot could not be saved. Retry the same draft.");
    } finally {
      setSaving(false);
    }
  }

  const ready = snapshotId && snapshotProof && summary.trim() && sourceTitle.trim() && sourceDomain.trim();

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-6xl">
        <CampaignNav current="trends" />
        <header className="mt-7 border-b border-border pb-7">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">Research conclusions</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Trend archive</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Save thin, source-labelled conclusions for campaign planning. This archive does not call a provider.
          </p>
        </header>
        {error ? <div className="mt-4 rounded-xl border border-error-soft bg-error-soft p-4 text-sm text-destructive">{error}</div> : null}
        {notice ? <div className="mt-4 rounded-xl border border-success/25 bg-success-soft p-4 text-sm text-success-soft-foreground">{notice}</div> : null}

        <div className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Save a trend conclusion</CardTitle>
              <CardDescription>Use a structured conclusion and at least one visible source label.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <label className="grid gap-2 text-sm font-semibold">Conclusion<Textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1000} placeholder="Locally rooted gift stories are gaining attention before Merdeka." /></label>
              <label className="grid gap-2 text-sm font-semibold">Source title<Input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} maxLength={200} placeholder="Malaysia seasonal commerce brief" /></label>
              <label className="grid gap-2 text-sm font-semibold">Source domain<Input value={sourceDomain} onChange={(event) => setSourceDomain(event.target.value)} maxLength={253} placeholder="example.com" /></label>
              <label className="grid gap-2 text-sm font-semibold">Captured date <span className="font-normal text-muted-foreground">Optional</span><Input type="date" value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)} /></label>
              <label className="grid gap-2 text-sm font-semibold">Campaign <span className="font-normal text-muted-foreground">Optional</span>
                <Select value={campaignId} onValueChange={setCampaignId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No campaign</SelectItem>
                    {campaigns.map((campaign) => <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <Button type="button" onClick={save} disabled={!ready || saving}>
                {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
                {saving ? "Saving conclusion" : "Save conclusion"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Saved conclusions</CardTitle>
              <CardDescription>Newest evidence first. Missing evidence is never guessed.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {trends.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center">
                  <Archive className="mx-auto size-7 text-muted-foreground" />
                  <h2 className="mt-3 text-sm font-semibold">No trend conclusions yet</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Save the first source-labelled conclusion.</p>
                </div>
              ) : trends.map((trend) => {
                const campaign = trend.campaignId ? campaignNames.get(trend.campaignId) : undefined;
                return (
                  <article key={trend.id} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="text-sm font-semibold leading-6">{trend.summary}</p>
                      <Badge variant="outline">{dateLabel(trend.capturedAt)}</Badge>
                    </div>
                    {trend.campaignId ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Filed under{" "}
                        {campaign ? (
                          <Link href={`/campaign/${trend.campaignId}`} className="font-semibold text-brand-strong underline-offset-4 hover:underline">
                            {campaign}
                          </Link>
                        ) : (
                          <span className="font-semibold">a campaign that is no longer listed</span>
                        )}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {trendSourceLabels(trend.sources).map((label, index) => (
                        <span key={`${trend.id}:${index}`} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{label}</span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

