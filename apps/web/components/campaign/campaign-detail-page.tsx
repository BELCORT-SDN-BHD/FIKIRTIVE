"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Archive,
  CalendarDays,
  Check,
  FolderKanban,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Megaphone,
  Pencil,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  approveCampaignEntry,
  deleteCampaign,
  proposeCampaignEntry,
  removeCampaignEntry,
  setCampaignGrouping,
  setCampaignStatus,
  unapproveCampaignEntry,
  updateCampaign,
  updateCampaignEntry,
  type CampaignPlanEntry,
  type ProposedCampaignEntry,
} from "@/lib/campaign-actions";
import {
  CAMPAIGN_STATUS_BADGE,
  CAMPAIGN_STATUS_LABELS,
  canEditCampaignDetails,
  isCampaignStatus,
  nextCampaignStatuses,
  type CampaignStatus,
} from "@/lib/campaign-lifecycle";
import {
  getCampaign,
  type CampaignDetailRow,
  type CampaignGroupedBroadcast,
} from "@/lib/campaign-view-data";
import {
  purposeLabel,
  runStatusPresentation,
} from "@/components/crm/broadcasts/broadcast-format";
import { trendSourceLabels } from "@/lib/trend-source-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [editingCampaign, setEditingCampaign] = useState(false);
  const [campaignDraft, setCampaignDraft] = useState({
    name: initialState.campaign.name,
    goal: initialState.campaign.goal,
    start: localDate(initialState.campaign.startAt),
    end: localDate(initialState.campaign.endAt),
  });
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const status: CampaignStatus | null = isCampaignStatus(campaign.status) ? campaign.status : null;
  const statusMoves = status ? nextCampaignStatuses(status) : [];
  const detailsEditable = status !== null && canEditCampaignDetails(status);

  function openCampaignEditor() {
    setCampaignDraft({
      name: campaign.name,
      goal: campaign.goal,
      start: localDate(campaign.startAt),
      end: localDate(campaign.endAt),
    });
    setEditingCampaign(true);
    setError(null);
    setNotice(null);
  }

  async function saveCampaignDetails() {
    setBusy("campaign:save");
    setError(null);
    try {
      const result = await updateCampaign({
        campaignId: campaign.id,
        patch: {
          name: campaignDraft.name.trim(),
          goal: campaignDraft.goal.trim(),
          period: { start: campaignDraft.start, end: campaignDraft.end, tz: "Asia/Kuala_Lumpur" },
        },
      });
      if (!("ok" in result)) return setError(result.error);
      setEditingCampaign(false);
      setNotice("Campaign details updated.");
      await refreshDetail();
    } catch {
      setError("The campaign update could not finish. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  async function moveStatus(next: CampaignStatus) {
    setBusy(`campaign:status:${next}`);
    setError(null);
    try {
      const result = await setCampaignStatus({ campaignId: campaign.id, status: next });
      if (!("ok" in result)) return setError(result.error);
      setNotice(`Campaign marked ${CAMPAIGN_STATUS_LABELS[next].toLowerCase()}.`);
      await refreshDetail();
    } catch {
      setError("The status change could not finish. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  async function removeCampaign() {
    setBusy("campaign:delete");
    setError(null);
    try {
      const result = await deleteCampaign({ campaignId: campaign.id });
      if (!("ok" in result)) {
        setConfirmingDelete(false);
        setError(result.error);
        // A refusal leaves the page exactly as it was, so it must leave the BUTTONS as they were
        // too. Returning here without clearing `busy` froze every control on a page the merchant
        // was still allowed to use (#744 判官 r1 P2).
        setBusy(null);
        return;
      }
      // Deleted campaigns are not readable any more, so stay off this page entirely. `busy` stays
      // set on purpose: the navigation is already under way and nothing here is actionable again.
      window.location.assign("/campaign");
    } catch {
      setError("The delete request could not finish. Please retry.");
      setBusy(null);
    }
  }

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

  /** #712 — the way back out of the priced set. Nothing the merchant wrote is lost. */
  async function unapproveEntry(entry: CampaignPlanEntry) {
    setBusy(`unapprove:${entry.id}`);
    setError(null);
    try {
      const result = await unapproveCampaignEntry({ campaignId: campaign.id, entryId: entry.id });
      if (!("ok" in result)) return setError(result.error);
      setCampaign((current) => ({ ...current, plan: result.payload }));
      setDrafts(Object.fromEntries(result.payload.entries.map((item) => [item.id, item])));
      setNotice("Approval undone. This entry is out of the generation list and its brief is unchanged.");
    } catch {
      setError("The approval change could not finish. Please retry.");
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
  const dispatchedEntryIds = new Set(campaign.dispatchedEntryIds);
  const approvedCount = entries.filter((entry) => entry.status === "approved").length;
  const proposalReady = proposal.date && proposal.hook.trim() && proposal.brief.trim();

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-7xl">
        <CampaignNav current="detail" />
        <header className="mt-7 grid gap-5 border-b border-border pb-7 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">Campaign detail</p>
              <Badge variant={status ? CAMPAIGN_STATUS_BADGE[status] : "warning"}>{campaign.status.toLowerCase()}</Badge>
            </div>
            {editingCampaign ? (
              <div className="mt-3 grid max-w-3xl gap-3">
                <Input value={campaignDraft.name} maxLength={120} onChange={(event) => setCampaignDraft((current) => ({ ...current, name: event.target.value }))} aria-label="Campaign name" placeholder="Campaign name" />
                <Textarea value={campaignDraft.goal} maxLength={500} onChange={(event) => setCampaignDraft((current) => ({ ...current, goal: event.target.value }))} aria-label="Campaign goal" placeholder="What this campaign is for" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input type="date" value={campaignDraft.start} onChange={(event) => setCampaignDraft((current) => ({ ...current, start: event.target.value }))} aria-label="Campaign start date" />
                  <Input type="date" value={campaignDraft.end} onChange={(event) => setCampaignDraft((current) => ({ ...current, end: event.target.value }))} aria-label="Campaign end date" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    type="button"
                    onClick={saveCampaignDetails}
                    disabled={busy !== null || !campaignDraft.name.trim() || !campaignDraft.goal.trim() || !campaignDraft.start || !campaignDraft.end}
                  >
                    {busy === "campaign:save" ? <LoaderCircle className="animate-spin" /> : <Save />}
                    Save campaign
                  </Button>
                  <Button size="sm" type="button" variant="ghost" disabled={busy !== null} onClick={() => setEditingCampaign(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{campaign.name}</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">{campaign.goal}</p>
              </>
            )}
          </div>
          <div className="grid content-start gap-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-xs">
              <span className="flex items-center gap-2 font-semibold">
                <CalendarDays className="size-4 text-muted-foreground" />
                {dateLabel(campaign.startAt)} – {dateLabel(campaign.endAt)}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {editingCampaign ? null : (
                <Button size="sm" type="button" variant="secondary" disabled={busy !== null || !detailsEditable} onClick={openCampaignEditor}>
                  <Pencil />
                  Edit campaign
                </Button>
              )}
              {/* The moves come from the one shared lifecycle table, so this menu can never
                  offer a step the server refuses — or hide one it allows (#710). */}
              {statusMoves.map((next) => (
                <Button key={next} size="sm" type="button" variant="secondary" disabled={busy !== null} onClick={() => moveStatus(next)}>
                  {busy === `campaign:status:${next}` ? <LoaderCircle className="animate-spin" /> : null}
                  Mark {CAMPAIGN_STATUS_LABELS[next].toLowerCase()}
                </Button>
              ))}
              <Button size="sm" type="button" variant="ghost" disabled={busy !== null} onClick={() => setConfirmingDelete(true)}>
                <Trash2 />
                Delete
              </Button>
            </div>
            {!detailsEditable && !editingCampaign ? (
              <p className="max-w-xs text-xs leading-5 text-muted-foreground">
                Reopen this campaign to change its name, goal, or dates.
              </p>
            ) : null}
          </div>
        </header>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm leading-6 text-info-soft-foreground">
          <span>This is a zero-cost planning surface. Estimated credits are display-only. Marking an entry approved does not generate, schedule, send, or publish anything.</span>
          {approvedCount > 0 ? (
            <Button asChild size="sm" className="shrink-0">
              <Link href={`/campaign/${campaign.id}/confirm`}>
                <Sparkles />
                Generate approved · {approvedCount}
              </Link>
            </Button>
          ) : null}
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
                  // Already generated = already paid for. The server refuses to take such an
                  // entry back out of the plan, so the page must not offer a button whose only
                  // possible outcome is that refusal (#744 判官 r1 P1-1).
                  const generated = dispatchedEntryIds.has(entry.id);
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
                        {entry.status === "approved" ? (
                          <Button size="sm" type="button" variant="secondary" onClick={() => unapproveEntry(entry)} disabled={busy !== null || generated}>
                            {busy === `unapprove:${entry.id}` ? <LoaderCircle className="animate-spin" /> : <Undo2 />}
                            Undo approval
                          </Button>
                        ) : (
                          <Button size="sm" type="button" variant="secondary" onClick={() => approveEntry(entry)} disabled={busy !== null}>
                            {busy === `approve:${entry.id}` ? <LoaderCircle className="animate-spin" /> : <Check />}
                            Mark approved
                          </Button>
                        )}
                        <Button size="sm" type="button" variant="ghost" onClick={() => removeEntry(entry)} disabled={busy !== null || generated}>
                          <Trash2 />
                          Remove
                        </Button>
                      </div>
                      {generated ? (
                        <p className="mt-3 text-xs leading-5 text-muted-foreground">
                          Already generated, so it stays in this plan — its generation and the credits
                          it used are part of your history.
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Propose a plan entry</CardTitle>
                {/* #714 — CAMPAIGN_CARD is Otto's internal card contract name. It told the
                    merchant nothing about what these five boxes are for. */}
                <CardDescription>One scheduled draft: date, platform, format, opening hook, and what the content should show. Nothing is written for you here, and nothing is sent.</CardDescription>
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
            <CampaignTrendsCard trendSnapshots={campaign.trendSnapshots} />
            <CampaignBroadcastsCard broadcasts={campaign.grouped.broadcasts} />
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
              grouped={campaign.grouped.generations.map((item) => ({ id: item.id, label: item.kind === "video" ? "Video" : "Image", meta: `Asset ${item.assetId.slice(-8)}` }))}
              available={campaign.available.generations.map((item) => ({ id: item.id, label: item.kind === "video" ? "Video" : "Image", meta: `Asset ${item.assetId.slice(-8)}` }))}
              busy={busy}
              onChange={changeGrouping}
            />
          </aside>
        </div>
      </div>

      <Dialog open={confirmingDelete} onOpenChange={(next) => { if (!next && busy === null) setConfirmingDelete(false); }}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Delete “{campaign.name}”?</DialogTitle>
            <DialogDescription>
              This campaign leaves your list along with its plan entries.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm leading-6 text-info-soft-foreground">
            Generations, scheduled posts, and broadcasts created under it are kept — they stay in
            your library and in your billing history, exactly as they are.
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={busy !== null} onClick={() => void removeCampaign()}>
              {busy === "campaign:delete" ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              Delete campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** #711 — the conclusions a merchant filed under this campaign, on the campaign itself. */
export function CampaignTrendsCard({
  trendSnapshots,
}: {
  trendSnapshots: CampaignDetailRow["trendSnapshots"];
}) {
  return (
    <Card>
      <CardHeader>
        <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
          <Archive />
          <CardTitle>Trend conclusions</CardTitle>
        </span>
        <CardDescription>Why this campaign exists. Saved research filed under it.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {trendSnapshots.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No conclusions are filed under this campaign yet.
          </p>
        ) : trendSnapshots.map((snapshot) => (
          <article key={snapshot.id} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-semibold leading-6">{snapshot.summary}</p>
              <Badge variant="outline">{dateLabel(snapshot.capturedAt)}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {trendSourceLabels(snapshot.sources).map((label, index) => (
                <span key={`${snapshot.id}:${index}`} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {label}
                </span>
              ))}
            </div>
          </article>
        ))}
        <Link
          href="/campaign/trends"
          className="text-sm font-semibold text-brand-strong underline-offset-4 hover:underline"
        >
          Open trend archive
        </Link>
      </CardContent>
    </Card>
  );
}

export function CampaignBroadcastsCard({
  broadcasts,
}: {
  broadcasts: CampaignGroupedBroadcast[];
}) {
  return (
    <Card>
      <CardHeader>
        <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
          <Megaphone />
          <CardTitle>Broadcasts</CardTitle>
        </span>
        <CardDescription>Broadcasts grouped into this campaign.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {broadcasts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Nothing grouped yet.</p>
        ) : broadcasts.map((broadcast) => {
          const status = runStatusPresentation(broadcast.status);
          return (
            <Link
              key={broadcast.id}
              href={`/crm/broadcasts/${broadcast.id}`}
              className="rounded-xl border border-border p-3 outline-none transition-colors hover:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{purposeLabel(broadcast.purpose)} broadcast</p>
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {broadcast.executedAt
                  ? `Sent (simulated) ${dateLabel(broadcast.executedAt)}`
                  : `Created ${dateLabel(broadcast.createdAt)}`}
              </p>
            </Link>
          );
        })}
      </CardContent>
    </Card>
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
