"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import Link from "next/link";
import { AlertCircle, ArrowRight, LoaderCircle, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { listCampaigns } from "@/lib/campaign-view-data";
import { proposeCampaign } from "@/lib/campaign-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { readR22WorkspaceDirectory, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import "./r22-campaigns.css";

type ListResult = Awaited<ReturnType<typeof listCampaigns>>;

const FIXTURE_CAMPAIGNS = [
  { id: "fixture-raya", name: "Raya launch", goal: "Launch the Raya collection", status: "DRAFT", ready: 2, total: 4, note: "The other two are rendering on the canvas.", entries: [{ label: "Image 1", status: "ready", image: "/fixtures/r22-canvas/art-1.jpg" }, { label: "Image 2", status: "ready", image: "/fixtures/r22-canvas/art-2.jpg" }, { label: "Image 3", status: "rendering" }, { label: "Image 4", status: "rendering" }] },
  { id: "fixture-care", name: "Candle care series", goal: "Teach customers how to care for candles", status: "ACTIVE", ready: 3, total: 3, note: "Tip 1 is queued for Sat 10:00.", entries: [{ label: "Tip 1", status: "queued", image: "/fixtures/r22-canvas/art-3.jpg" }, { label: "Tip 2", status: "draft", image: "/fixtures/r22-canvas/art-4.jpg" }, { label: "Tip 3", status: "draft", image: "/fixtures/r22-canvas/art-1.jpg" }] },
];

type DisplayCampaign = typeof FIXTURE_CAMPAIGNS[number];
type CampaignFixtureState = "ready" | "loading" | "error" | "permission" | "empty" | "mixed" | "unknown";
type CampaignFixtureOutcome = "success" | "error" | "permission" | "unknown";
const CAMPAIGN_ROWS_KEY = "r22:campaigns:rows:v1";
const CAMPAIGN_DRAFT_KEY = "r22:campaigns:draft:v1";

function readFixture<T>(key: string): T | null { try { const stored = window.sessionStorage.getItem(scopedR22FixtureKey(key)); return stored ? JSON.parse(stored) as T : null; } catch { return null; } }
function writeFixture(key: string, value: unknown | null) { try { const scopedKey = scopedR22FixtureKey(key); if (value === null) window.sessionStorage.removeItem(scopedKey); else window.sessionStorage.setItem(scopedKey, JSON.stringify(value)); } catch { /* Fixture remains usable without refresh recovery. */ } }

function liveCampaigns(initialState: ListResult): DisplayCampaign[] {
  if ("error" in initialState) return [];
  return initialState.campaigns.map((campaign) => {
    const entries = campaign.plan?.entries ?? [];
    const ready = entries.filter((entry) => entry.status === "approved").length;
    return { id: campaign.id, name: campaign.name, goal: campaign.goal, status: campaign.status, ready, total: entries.length, note: entries.length ? `${entries.length - ready} plan ${entries.length - ready === 1 ? "entry is" : "entries are"} still awaiting approval.` : "This campaign has no plan entries yet.", entries: entries.slice(0, 6).map((entry) => ({ label: entry.hook || entry.format, status: entry.status })) };
  });
}

export default function CampaignListPage({ initialState, fixture = false, fixtureState = "ready", fixtureCreateOutcome = "success" }: { initialState: ListResult; fixture?: boolean; fixtureState?: CampaignFixtureState; fixtureCreateOutcome?: CampaignFixtureOutcome }) {
  const [planning, setPlanning] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fixtureCampaigns, setFixtureCampaigns] = useState<DisplayCampaign[]>(FIXTURE_CAMPAIGNS);
  const [fixtureReady, setFixtureReady] = useState(!fixture);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [fixtureReadState, setFixtureReadState] = useState(fixtureState);
  const [fixtureCreateFailedOnce, setFixtureCreateFailedOnce] = useState(false);
  const [retryingRead, setRetryingRead] = useState(false);
  const campaigns = fixture ? fixtureReadState === "empty" ? [] : fixtureCampaigns : liveCampaigns(initialState);

  useEffect(() => {
    if (!fixture) return;
    if (fixtureState === "loading" || fixtureState === "error" || fixtureState === "permission" || fixtureState === "unknown") { setFixtureReady(true); return; }
    const rows = readFixture<DisplayCampaign[]>(CAMPAIGN_ROWS_KEY);
    if (rows) setFixtureCampaigns(rows);
    else if (readR22WorkspaceDirectory().activeId !== "batik-house") setFixtureCampaigns([]);
    const draft = readFixture<{ name: string; goal: string; start: string; end: string }>(CAMPAIGN_DRAFT_KEY);
    if (draft) { setName(draft.name); setGoal(draft.goal); setStart(draft.start); setEnd(draft.end); setPlanning(true); }
    setFixtureReady(true);
  }, [fixture, fixtureState]);

  useEffect(() => { if (fixture && fixtureReady && (fixtureReadState === "ready" || fixtureReadState === "mixed")) writeFixture(CAMPAIGN_ROWS_KEY, fixtureCampaigns); }, [fixture, fixtureCampaigns, fixtureReadState, fixtureReady]);
  useEffect(() => { if (fixture && fixtureReady && planning) writeFixture(CAMPAIGN_DRAFT_KEY, { name, goal, start, end }); }, [end, fixture, fixtureReady, goal, name, planning, start]);

  async function save() {
    if (!name.trim()) return setError("Give this campaign a name.");
    if (!goal.trim()) return setError("Describe the campaign goal.");
    if (!start || !end) return setError("Choose both campaign dates.");
    if (end < start) return setError("The end date must be on or after the start date.");
    if ("error" in initialState && !fixture) return setError(initialState.error);
    setSaving(true); setError("");
    if (fixture) {
      window.setTimeout(() => {
        if (fixtureCreateOutcome === "permission") {
          setSaving(false);
          setError("Your current workspace permission does not allow campaign creation. Nothing was saved.");
          return;
        }
        if ((fixtureCreateOutcome === "error" || fixtureCreateOutcome === "unknown") && !fixtureCreateFailedOnce) {
          setFixtureCreateFailedOnce(true);
          setSaving(false);
          setError(fixtureCreateOutcome === "unknown" ? "Campaign creation outcome is unknown. Reconcile this same draft before starting another." : "Campaign creation was not confirmed. Nothing was added; retry this same draft safely.");
          return;
        }
        setFixtureCampaigns((current) => {
          const next: DisplayCampaign = { id: `fixture-campaign-${current.filter((campaign) => campaign.id.startsWith("fixture-campaign-")).length + 1}`, name: name.trim(), goal: goal.trim(), status: "DRAFT", ready: 0, total: 0, note: `${start} to ${end} · draft only · 0 cr`, entries: [] };
          return [next, ...current];
        });
        writeFixture(CAMPAIGN_DRAFT_KEY, null); setSaving(false); setPlanning(false); setName(""); setGoal(""); setStart(""); setEnd(""); setNotice("Campaign draft created in this fixture. No content was generated or published.");
      }, 480);
      return;
    }
    if ("error" in initialState) { setSaving(false); setError(initialState.error); return; }
    const result = await proposeCampaign({ campaignId: initialState.nextCampaignId, campaignProof: initialState.nextCampaignProof, title: name, goal, status: "DRAFT", period: { start, end, tz: "Asia/Kuala_Lumpur" }, theme: name, items: [], ideas: [] }).catch(() => ({ error: "The save request could not finish. Retry this same draft." }));
    setSaving(false);
    if (!("ok" in result)) { setError(result.error); return; }
    window.location.assign(`/campaign/${result.campaignId}`);
  }

  const requestClose = () => {
    if (saving) return;
    if (name.trim() || goal.trim() || start || end) { setCancelOpen(true); return; }
    setPlanning(false);
  };

  const discardDraft = () => { writeFixture(CAMPAIGN_DRAFT_KEY, null); setCancelOpen(false); setPlanning(false); setName(""); setGoal(""); setStart(""); setEnd(""); setError(""); };

  const retryRead = () => {
    if (retryingRead) return;
    setRetryingRead(true);
    window.setTimeout(() => { setRetryingRead(false); setFixtureReadState("ready"); }, 300);
  };

  if (fixture && !fixtureReady) return <main className="r22-campaigns" data-r22-campaigns data-state="loading" aria-busy="true"><header><div><h1>Campaigns</h1><p>Plan a campaign, approve the plan, watch it run.</p></div></header><section className="r22-campaigns-state"><h2>Loading workspace campaigns…</h2><p>Old workspace plans are hidden while the active fixture store is read.</p></section></main>;

  return <Dialog open={planning} onOpenChange={(open) => open ? setPlanning(true) : requestClose()}><main className="r22-campaigns" data-r22-campaigns data-fixture={fixture || undefined}>
    <header><div><h1>Campaigns</h1><p>Plan a campaign, approve the plan, watch it run.</p></div><DialogTrigger asChild><Button unstyled type="button" disabled={fixture && (fixtureReadState === "loading" || fixtureReadState === "error" || fixtureReadState === "permission" || fixtureReadState === "unknown")}><Plus aria-hidden="true" />Plan a campaign</Button></DialogTrigger></header>
    {notice ? <p className="r22-campaigns-notice" role="status">{notice}</p> : null}{fixture && fixtureReadState === "loading" ? <section className="r22-campaigns-state" aria-busy="true"><LoaderCircle className="r22-spin" aria-hidden="true" /><h2>Loading workspace campaigns…</h2><p>No empty campaign list is inferred while the active workspace read is pending.</p></section> : fixture && (fixtureReadState === "error" || fixtureReadState === "permission" || fixtureReadState === "unknown") ? <section className="r22-campaigns-state" role={fixtureReadState === "error" ? "alert" : "status"}><AlertCircle aria-hidden="true" /><h2>{fixtureReadState === "error" ? "Campaigns could not load" : fixtureReadState === "permission" ? "Campaigns are not available to this member" : "Campaign read outcome is unknown"}</h2><p>{fixtureReadState === "error" ? "The workspace campaign read failed. No empty list was inferred." : fixtureReadState === "permission" ? "This fixture member cannot read campaign details or counts." : "The read may still finish. Retry the same read instead of treating the workspace as empty."}</p>{fixtureReadState !== "permission" ? <Button unstyled type="button" disabled={retryingRead} onClick={retryRead}>{retryingRead ? "Retrying…" : "Retry"}</Button> : null}</section> : "error" in initialState && !fixture ? <section className="r22-campaigns-state" role="alert"><AlertCircle aria-hidden="true" /><h2>Campaigns could not load</h2><p>{initialState.error} No empty campaign list was inferred.</p></section> : campaigns.length ? <section className="r22-campaigns-list">{fixtureReadState === "mixed" ? <p className="r22-campaigns-mixed" role="status"><AlertCircle aria-hidden="true" />Some campaign entries are ready, rendering or queued. The summary does not collapse this mixed state into success.</p> : null}{campaigns.map((campaign) => <article key={campaign.id}>
      <div className="r22-campaigns-card-head"><div><h2>{campaign.name}</h2><p>{campaign.goal}</p></div><span><b>Plan</b><ArrowRight /><em>Approve</em><ArrowRight /><em>Run</em></span></div>
      <div className="r22-campaigns-progress" aria-label={`${campaign.total} plan ${campaign.total === 1 ? "entry" : "entries"}`}><i style={{ width: `${campaign.total ? campaign.ready / campaign.total * 100 : 0}%` }} /><span>{campaign.ready} of {campaign.total} {campaign.total === campaign.ready && campaign.total ? "drafted" : "ready"}</span></div>
      <p className="r22-campaigns-note">{campaign.note}</p>
      {campaign.entries.length ? <div className="r22-campaigns-tiles">{campaign.entries.map((entry, index) => <Link href={fixture ? `/create/canvas?project=${encodeURIComponent(campaign.id)}&fixture=r22` : `/campaign/${encodeURIComponent(campaign.id)}`} key={`${entry.label}-${index}`}><span className="r22-campaigns-tile-media">{"image" in entry && entry.image ? <img src={entry.image} alt="" /> : <b>{entry.status}</b>}</span><strong>{entry.label}</strong><small>{entry.status}</small></Link>)}</div> : <div className="r22-campaigns-no-plan">No plan entries yet. Open the campaign to add the first one.</div>}
      <Link className="r22-campaigns-open" href={fixture ? `/create/canvas?project=${encodeURIComponent(campaign.id)}&fixture=r22` : `/campaign/${encodeURIComponent(campaign.id)}`}>Open {fixture ? "in Canvas" : "campaign"}<ArrowRight aria-hidden="true" /></Link>
    </article>)}</section> : <section className="r22-campaigns-state"><h2>No campaigns yet</h2><p>Start with a goal and period. Campaign creation costs zero credits and does not generate or publish anything.</p><DialogTrigger asChild><Button unstyled type="button">Plan your first campaign</Button></DialogTrigger></section>}
    <DialogContent className="r22-campaigns-dialog" showCloseButton={false}><DialogHeader><DialogTitle>Plan a campaign</DialogTitle><DialogDescription>Define the container. No content is generated or published.</DialogDescription></DialogHeader><label>Campaign name<Input unstyled autoFocus value={name} onChange={(event) => { setName(event.target.value); setError(""); }} maxLength={120} /></label><label>Goal<Textarea unstyled value={goal} onChange={(event) => { setGoal(event.target.value); setError(""); }} rows={3} maxLength={500} /></label><div className="r22-campaigns-dates"><label>Start date<Input unstyled type="date" value={start} onChange={(event) => { setStart(event.target.value); setError(""); }} /></label><label>End date<Input unstyled type="date" min={start || undefined} value={end} onChange={(event) => { setEnd(event.target.value); setError(""); }} /></label></div>{end && start && end < start ? <p role="alert">The end date must be on or after the start date.</p> : null}{error ? <p role="alert">{error}</p> : null}<DialogFooter><span>0 cr · draft only</span><Button unstyled type="button" className="is-quiet" disabled={saving} onClick={requestClose}>Cancel</Button><Button unstyled type="button" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="r22-spin" /> : null}{saving ? "Saving…" : "Create campaign"}</Button></DialogFooter></DialogContent>
    <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="r22-campaigns-dialog"><AlertDialogHeader><AlertDialogTitle>Discard this campaign draft?</AlertDialogTitle><AlertDialogDescription>The campaign name, goal and period will be removed. No content or publishing state will change.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={discardDraft}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main></Dialog>;
}
