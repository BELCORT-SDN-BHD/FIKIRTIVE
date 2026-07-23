"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, LoaderCircle, Save } from "lucide-react";
import { updateCampaignEntry, type CampaignPlanEntry } from "@/lib/campaign-actions";
import type { listCampaigns } from "@/lib/campaign-view-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CampaignNav } from "./campaign-nav";

type ListResult = Awaited<ReturnType<typeof listCampaigns>>;

export default function CampaignCalendarPage({ initialState }: { initialState: ListResult }) {
  const initialCampaigns = "ok" in initialState ? initialState.campaigns : [];
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [drafts, setDrafts] = useState<Record<string, CampaignPlanEntry>>(() =>
    Object.fromEntries(initialCampaigns.flatMap((campaign) =>
      (campaign.plan?.entries ?? []).map((entry) => [`${campaign.id}:${entry.id}`, entry]),
    )),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>("error" in initialState ? initialState.error : null);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(() => campaigns.flatMap((campaign) =>
    (campaign.plan?.entries ?? []).map((entry) => ({ campaign, entry })),
  ).sort((left, right) => left.entry.date.localeCompare(right.entry.date)), [campaigns]);

  async function save(campaignId: string, entry: CampaignPlanEntry) {
    const key = `${campaignId}:${entry.id}`;
    const draft = drafts[key];
    if (!draft) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await updateCampaignEntry({
        campaignId,
        entryId: entry.id,
        patch: {
          date: draft.date,
          platform: draft.platform,
          format: draft.format,
          hook: draft.hook,
          brief: draft.brief,
          estCredits: draft.estCredits,
        },
      });
      if (!("ok" in result)) return setError(result.error);
      setCampaigns((current) => current.map((campaign) =>
        campaign.id === campaignId ? { ...campaign, plan: result.payload } : campaign,
      ));
      setNotice("Draft calendar entry updated. No publishing authorization was created.");
    } catch {
      setError("The calendar update could not finish. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-6xl">
        <CampaignNav current="calendar" />
        <header className="mt-7 border-b border-border pb-7">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">Draft planning</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Campaign calendar</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Review and edit campaign plan dates. This calendar does not publish or authorize publishing.
          </p>
        </header>
        <div className="mt-6 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
          Draft editing only. There is no standing outbound authorization on this page. Publishing requires a separate, exact approval in its own flow.
        </div>
        {error ? <div className="mt-4 rounded-xl border border-error-soft bg-error-soft p-4 text-sm text-destructive">{error}</div> : null}
        {notice ? <div className="mt-4 rounded-xl border border-success/25 bg-success-soft p-4 text-sm text-success-soft-foreground">{notice}</div> : null}

        {rows.length === 0 ? (
          <section className="mt-6 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
            <CalendarDays className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No campaign dates to show</h2>
            <p className="mt-2 text-sm text-muted-foreground">Add plan entries from a campaign detail page first.</p>
            <Button asChild className="mt-6" variant="secondary"><Link href="/campaign">View campaigns</Link></Button>
          </section>
        ) : (
          <section className="mt-6 grid gap-4">
            {rows.map(({ campaign, entry }) => {
              const key = `${campaign.id}:${entry.id}`;
              const draft = drafts[key] ?? entry;
              return (
                <Card key={key} className="gap-3">
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle>{draft.hook}</CardTitle>
                        <CardDescription className="mt-1">{campaign.name} · {draft.platform} · {draft.format}</CardDescription>
                      </div>
                      <Badge variant={entry.status === "approved" ? "success" : "outline"}>{entry.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-[11rem_1fr_auto] sm:items-end">
                    <label className="grid gap-2 text-xs font-semibold text-muted-foreground">
                      Planned date
                      <Input type="date" value={draft.date} onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...draft, date: event.target.value } }))} />
                    </label>
                    <label className="grid gap-2 text-xs font-semibold text-muted-foreground">
                      Hook
                      <Input value={draft.hook} onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...draft, hook: event.target.value } }))} />
                    </label>
                    <Button type="button" onClick={() => save(campaign.id, entry)} disabled={busy !== null}>
                      {busy === key ? <LoaderCircle className="animate-spin" /> : <Save />}
                      Save draft
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}

