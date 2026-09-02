"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Archive, Check, Save } from "lucide-react";
import type { listCampaigns } from "@/lib/campaign-view-data";
import { listTrendSnapshots, saveTrendSnapshot } from "@/lib/trend-actions";
import { trendSourceLabels } from "@/lib/trend-source-labels";
import { MY_DATE_FORMAT } from "@/lib/my-date-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
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
      <div className="mx-auto max-w-7xl">
        <CampaignNav current="trends" />
        <header className="mt-7 border-b border-border pb-7">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Campaign intelligence</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Trend archive</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Save thin, source-labeled conclusions for campaign planning. This archive does not call a provider.
          </p>
        </header>
        {error ? (
          <Alert variant="destructive" className="mt-4" role="alert">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert variant="success" className="mt-4" role="status">
            <Check />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(20rem,0.72fr)_minmax(0,1.28fr)] lg:items-start">
          <Card className="lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle>Save a trend conclusion</CardTitle>
              <CardDescription>Use a structured conclusion and at least one visible source label.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="trend-conclusion">Conclusion</FieldLabel>
                  <Textarea id="trend-conclusion" value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1000} placeholder="Locally rooted gift stories are gaining attention before Merdeka." />
                  <FieldDescription>Record the conclusion, not the raw article or research notes.</FieldDescription>
                </Field>
                <div className="grid gap-4">
                  <Field>
                    <FieldLabel htmlFor="trend-source-title">Source title</FieldLabel>
                    <Input id="trend-source-title" value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} maxLength={200} placeholder="Seasonal commerce brief" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="trend-source-domain">Source domain</FieldLabel>
                    <Input id="trend-source-domain" value={sourceDomain} onChange={(event) => setSourceDomain(event.target.value)} maxLength={253} placeholder="example.com" />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="trend-captured-date">Captured date <span className="font-normal text-muted-foreground">Optional</span></FieldLabel>
                    <Input id="trend-captured-date" type="date" value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel>Campaign <span className="font-normal text-muted-foreground">Optional</span></FieldLabel>
                <Select value={campaignId} onValueChange={setCampaignId}>
                  <SelectTrigger className="w-full" aria-label="Campaign"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">No campaign</SelectItem>
                      {campaigns.map((campaign) => <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
            <CardFooter>
              <Button type="button" className="w-full" onClick={save} disabled={!ready || saving}>
                {saving ? <Spinner /> : <Save data-icon="inline-start" />}
                {saving ? "Saving conclusion" : "Save conclusion"}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle>Saved conclusions</CardTitle>
                <CardDescription>Newest evidence first. Missing evidence is never guessed.</CardDescription>
              </div>
              <Badge variant="outline">{trends.length} saved</Badge>
            </CardHeader>
            <CardContent className="grid gap-3">
              {trends.length === 0 ? (
                <Empty className="border py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><Archive /></EmptyMedia>
                    <EmptyTitle>No trend conclusions yet</EmptyTitle>
                    <EmptyDescription>Save the first source-labeled conclusion.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : trends.map((trend) => {
                const campaign = trend.campaignId ? campaignNames.get(trend.campaignId) : undefined;
                return (
                  <Card key={trend.id} size="sm" className="shadow-none">
                    <CardHeader className="flex-row items-start justify-between gap-3">
                      <CardTitle className="max-w-2xl leading-6">{trend.summary}</CardTitle>
                      <Badge variant="outline">{dateLabel(trend.capturedAt)}</Badge>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                    {trend.campaignId ? (
                      <p className="text-xs text-muted-foreground">
                        Filed under{" "}
                        {campaign ? (
                          <Link href={`/campaign/${trend.campaignId}`} className="font-semibold text-foreground underline-offset-4 hover:underline">
                            {campaign}
                          </Link>
                        ) : (
                          <span className="font-semibold">a campaign that is no longer listed</span>
                        )}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {trendSourceLabels(trend.sources).map((label, index) => (
                        <Badge key={`${trend.id}:${index}`} variant="outline" className="font-normal text-muted-foreground">{label}</Badge>
                      ))}
                    </div>
                    </CardContent>
                  </Card>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
