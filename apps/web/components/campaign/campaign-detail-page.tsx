"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  FolderKanban,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import {
  approveCampaignEntry,
  proposeCampaignEntry,
  removeCampaignEntry,
  setCampaignGrouping,
  updateCampaignEntry,
  type CampaignPlanEntry,
  type ProposedCampaignEntry,
} from "@/lib/campaign-actions";
import { getCampaign, type CampaignDetailRow } from "@/lib/campaign-view-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CampaignNav } from "./campaign-nav";

type DetailResult = Awaited<ReturnType<typeof getCampaign>>;
type TargetType = "project" | "scheduled_post" | "generation";

const EMPTY_ENTRY: ProposedCampaignEntry = {
  date: "",
  platform: "instagram",
  format: "image",
  hook: "",
  brief: "",
  estCredits: 0,
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

function localDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

function planDrafts(campaign: CampaignDetailRow) {
  return Object.fromEntries((campaign.plan?.entries ?? []).map((entry) => [entry.id, entry]));
}

export default function CampaignDetailPage({ initialState }: { initialState: DetailResult }) {
  if ("error" in initialState) {
    return (
      <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
        <div className="mx-auto max-w-4xl">
          <CampaignNav current="detail" />
          <section className="mt-7 rounded-[var(--radius-card)] border border-error-soft bg-card p-6 shadow-sm">
            <AlertCircle className="size-6 text-destructive" />
            <h1 className="mt-4 text-2xl font-semibold">Campaign is not available</h1>
            <p className="mt-2 text-sm text-muted-foreground">{initialState.error}</p>
          </section>
        </div>
      </main>
    );
  }
  return <CampaignDetailWorkspace initialState={initialState} />;
}

function CampaignDetailWorkspace({ initialState }: { initialState: Extract<DetailResult, { ok: true }> }) {
  const [campaign, setCampaign] = useState(initialState.campaign);
  const [entryId, setEntryId] = useState(initialState.nextEntryId);
  const [entryProof, setEntryProof] = useState(initialState.nextEntryProof);
  const [drafts, setDrafts] = useState<Record<string, CampaignPlanEntry>>(planDrafts(initialState.campaign));
  const [proposal, setProposal] = useState<ProposedCampaignEntry>({
    ...EMPTY_ENTRY,
    date: localDate(initialState.campaign.startAt),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshDetail() {
    const result = await getCampaign(campaign.id);
    if (!("ok" in result)) {
      setError(result.error);
      return;
    }
    setCampaign(result.campaign);
    setEntryId(result.nextEntryId);
    setEntryProof(result.nextEntryProof);
    setDrafts(planDrafts(result.campaign));
  }

  function setDraft(entry: CampaignPlanEntry, patch: Partial<CampaignPlanEntry>) {
    setDrafts((current) => ({ ...current, [entry.id]: { ...current[entry.id], ...patch } }));
    setError(null);
    setNotice(null);
  }

  async function proposeEntry() {
    setBusy("propose");
    setError(null);
    try {
      const result = await proposeCampaignEntry({
        campaignId: campaign.id,
        entryId,
        entryProof,
        entry: proposal,
      });
      if (!("ok" in result)) return setError(result.error);
      setCampaign((current) => ({ ...current, plan: result.payload }));
      setDrafts(Object.fromEntries(result.payload.entries.map((item) => [item.id, item])));
      setProposal({ ...EMPTY_ENTRY, date: proposal.date });
      setNotice("Draft plan entry added. Nothing was generated or published.");
      await refreshDetail();
    } catch {
      setError("The proposal request could not finish. Retry the same draft.");
    } finally {
      setBusy(null);
    }
  }

  async function saveEntry(entry: CampaignPlanEntry) {
    const draft = drafts[entry.id];
    if (!draft) return;
    setBusy(`save:${entry.id}`);
    setError(null);
    try {
      const result = await updateCampaignEntry({
        campaignId: campaign.id,
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
      setCampaign((current) => ({ ...current, plan: result.payload }));
      setDrafts(Object.fromEntries(result.payload.entries.map((item) => [item.id, item])));
      setNotice("Plan entry updated.");
    } catch {
      setError("The update request could not finish. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  async function approveEntry(entry: CampaignPlanEntry) {
    setBusy(`approve:${entry.id}`);
    setError(null);
    try {
      const result = await approveCampaignEntry({ campaignId: campaign.id, entryId: entry.id });
      if (!("ok" in result)) return setError(result.error);
      setCampaign((current) => ({ ...current, plan: result.payload }));
      setDrafts(Object.fromEntries(result.payload.entries.map((item) => [item.id, item])));
      setNotice("Plan entry marked approved. No generation or publishing was started.");
    } catch {
      setError("The approval update could not finish. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  async function removeEntry(entry: CampaignPlanEntry) {
    setBusy(`remove:${entry.id}`);
    setError(null);
    try {
      const result = await removeCampaignEntry({ campaignId: campaign.id, entryId: entry.id });
      if (!("ok" in result)) return setError(result.error);
      setCampaign((current) => ({ ...current, plan: result.payload }));
      setDrafts(Object.fromEntries(result.payload.entries.map((item) => [item.id, item])));
      setNotice("Plan entry removed.");
    } catch {
      setError("The removal request could not finish. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  async function changeGrouping(targetType: TargetType, targetId: string, nextCampaignId: string | null) {
    setBusy(`group:${targetType}:${targetId}`);
    setError(null);
    try {
      const result = await setCampaignGrouping({ campaignId: nextCampaignId, targetType, targetId });
      if (!("ok" in result)) return setError(result.error);
      setNotice(nextCampaignId ? "Existing work grouped into this campaign." : "Campaign grouping cleared.");
      await refreshDetail();
    } catch {
      setError("The grouping request could not finish. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  const entries = campaign.plan?.entries ?? [];
  const proposalReady = proposal.date && proposal.hook.trim() && proposal.brief.trim();

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-7xl">
        <CampaignNav current="detail" />
        <header className="mt-7 grid gap-5 border-b border-border pb-7 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">Campaign detail</p>
              <Badge variant={campaign.status === "ACTIVE" ? "success" : "warning"}>{campaign.status.toLowerCase()}</Badge>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{campaign.name}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">{campaign.goal}</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-xs">
            <span className="flex items-center gap-2 font-semibold">
              <CalendarDays className="size-4 text-muted-foreground" />
              {dateLabel(campaign.startAt)} – {dateLabel(campaign.endAt)}
            </span>
          </div>
        </header>

        <div className="mt-6 rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm leading-6 text-info-soft-foreground">
          This is a zero-cost planning surface. Estimated credits are display-only. Marking an entry approved does not generate, schedule, send, or publish anything.
        </div>
        {error ? <div className="mt-4 rounded-xl border border-error-soft bg-error-soft p-4 text-sm text-destructive">{error}</div> : null}
        {notice ? <div className="mt-4 rounded-xl border border-success/25 bg-success-soft p-4 text-sm text-success-soft-foreground">{notice}</div> : null}

        <div className="mt-6 grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
          <section className="grid min-w-0 gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Plan entries</CardTitle>
                <CardDescription>Propose, edit, remove, or mark individual planning cards approved.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {entries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-5 py-9 text-center">
                    <Send className="mx-auto size-6 text-muted-foreground" />
                    <h2 className="mt-3 text-sm font-semibold">No plan entries yet</h2>
                    <p className="mt-2 text-sm text-muted-foreground">Add the first structured draft below.</p>
                  </div>
                ) : entries.map((entry) => {
                  const draft = drafts[entry.id] ?? entry;
                  return (
                    <article key={entry.id} className="rounded-xl border border-border bg-muted/25 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Badge variant={entry.status === "approved" ? "success" : "outline"}>{entry.status}</Badge>
                        <span className="text-xs text-muted-foreground">Entry {entry.id.slice(-6)}</span>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <Input type="date" value={draft.date} min={localDate(campaign.startAt)} max={localDate(campaign.endAt)} onChange={(event) => setDraft(entry, { date: event.target.value })} aria-label="Entry date" />
                        <Input value={draft.platform} onChange={(event) => setDraft(entry, { platform: event.target.value })} aria-label="Platform" placeholder="instagram" />
                        <Input value={draft.format} onChange={(event) => setDraft(entry, { format: event.target.value })} aria-label="Format" placeholder="image" />
                      </div>
                      <Input className="mt-3" value={draft.hook} onChange={(event) => setDraft(entry, { hook: event.target.value })} aria-label="Hook" placeholder="Opening hook" />
                      <Textarea className="mt-3" value={draft.brief} onChange={(event) => setDraft(entry, { brief: event.target.value })} aria-label="Creative brief" placeholder="English creative brief" />
                      <label className="mt-3 grid max-w-xs gap-2 text-xs font-semibold text-muted-foreground">
                        Estimated credits (display only)
                        <Input type="number" min={0} step={1} value={draft.estCredits} onChange={(event) => setDraft(entry, { estCredits: Number(event.target.value) })} />
                      </label>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button size="sm" type="button" onClick={() => saveEntry(entry)} disabled={busy !== null}>
                          {busy === `save:${entry.id}` ? <LoaderCircle className="animate-spin" /> : <Save />}
                          Save entry
                        </Button>
                        <Button size="sm" type="button" variant="secondary" onClick={() => approveEntry(entry)} disabled={busy !== null || entry.status === "approved"}>
                          {busy === `approve:${entry.id}` ? <LoaderCircle className="animate-spin" /> : <Check />}
                          Mark approved
                        </Button>
                        <Button size="sm" type="button" variant="ghost" onClick={() => removeEntry(entry)} disabled={busy !== null}>
                          <Trash2 />
                          Remove
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Propose a plan entry</CardTitle>
                <CardDescription>One structured CAMPAIGN_CARD-shaped draft. No free-form chat or dispatch.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input type="date" value={proposal.date} min={localDate(campaign.startAt)} max={localDate(campaign.endAt)} onChange={(event) => setProposal((current) => ({ ...current, date: event.target.value }))} aria-label="Proposal date" />
                  <Input value={proposal.platform} onChange={(event) => setProposal((current) => ({ ...current, platform: event.target.value }))} aria-label="Proposal platform" placeholder="instagram" />
                  <Input value={proposal.format} onChange={(event) => setProposal((current) => ({ ...current, format: event.target.value }))} aria-label="Proposal format" placeholder="image" />
                </div>
                <Input value={proposal.hook} onChange={(event) => setProposal((current) => ({ ...current, hook: event.target.value }))} placeholder="Opening hook" />
                <Textarea value={proposal.brief} onChange={(event) => setProposal((current) => ({ ...current, brief: event.target.value }))} placeholder="Describe the content in English" />
                <label className="grid max-w-xs gap-2 text-xs font-semibold text-muted-foreground">
                  Estimated credits (display only)
                  <Input type="number" min={0} step={1} value={proposal.estCredits} onChange={(event) => setProposal((current) => ({ ...current, estCredits: Number(event.target.value) }))} />
                </label>
                <Button type="button" className="w-full sm:w-fit" onClick={proposeEntry} disabled={!proposalReady || busy !== null}>
                  {busy === "propose" ? <LoaderCircle className="animate-spin" /> : <Plus />}
                  Add draft entry
                </Button>
              </CardContent>
            </Card>
          </section>

          <aside className="grid content-start gap-5">
            <GroupingCard
              title="Projects"
              campaignId={campaign.id}
              icon={<FolderKanban />}
              targetType="project"
              grouped={campaign.grouped.projects.map((item) => ({ id: item.id, label: item.name, meta: dateLabel(item.createdAt) }))}
              available={campaign.available.projects.map((item) => ({ id: item.id, label: item.name, meta: dateLabel(item.createdAt) }))}
              busy={busy}
              onChange={changeGrouping}
            />
            <GroupingCard
              title="Scheduled posts"
              campaignId={campaign.id}
              icon={<CalendarDays />}
              targetType="scheduled_post"
              grouped={campaign.grouped.scheduledPosts.map((item) => ({ id: item.id, label: `${item.channel}: ${item.caption || "Untitled post"}`, meta: `${item.status.toLowerCase()} · ${dateLabel(item.scheduledAt)}` }))}
              available={campaign.available.scheduledPosts.map((item) => ({ id: item.id, label: `${item.channel}: ${item.caption || "Untitled post"}`, meta: `${item.status.toLowerCase()} · ${dateLabel(item.scheduledAt)}` }))}
              busy={busy}
              onChange={changeGrouping}
            />
            <GroupingCard
              title="Generations"
              campaignId={campaign.id}
              icon={<ImageIcon />}
              targetType="generation"
              grouped={campaign.grouped.generations.map((item) => ({ id: item.id, label: item.modelRef || "Existing asset", meta: `Asset ${item.assetId.slice(-8)}` }))}
              available={campaign.available.generations.map((item) => ({ id: item.id, label: item.modelRef || "Existing asset", meta: `Asset ${item.assetId.slice(-8)}` }))}
              busy={busy}
              onChange={changeGrouping}
            />
          </aside>
        </div>
      </div>
    </main>
  );
}

function GroupingCard({
  title,
  campaignId,
  icon,
  targetType,
  grouped,
  available,
  busy,
  onChange,
}: {
  title: string;
  campaignId: string;
  icon: ReactNode;
  targetType: TargetType;
  grouped: { id: string; label: string; meta: string }[];
  available: { id: string; label: string; meta: string }[];
  busy: string | null;
  onChange: (targetType: TargetType, targetId: string, campaignId: string | null) => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  return (
    <Card>
      <CardHeader>
        <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon}
          <CardTitle>{title}</CardTitle>
        </span>
        <CardDescription>Group existing owner-scoped work. This creates no new content.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {grouped.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Nothing grouped yet.</p>
        ) : grouped.map((item) => (
          <div key={item.id} className="rounded-xl border border-border p-3">
            <p className="truncate text-sm font-semibold">{item.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.meta}</p>
            <Button type="button" size="sm" variant="ghost" className="mt-2" disabled={busy !== null} onClick={() => onChange(targetType, item.id, null)}>
              <Trash2 />
              Clear grouping
            </Button>
          </div>
        ))}
        {available.length > 0 ? (
          <div className="grid gap-2">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger><SelectValue placeholder={`Choose ${title.toLowerCase()}`} /></SelectTrigger>
              <SelectContent>
                {available.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="secondary" disabled={!selected || busy !== null} onClick={async () => {
              await onChange(targetType, selected, campaignId);
              setSelected("");
            }}>
              <Link2 />
              Group selected
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
