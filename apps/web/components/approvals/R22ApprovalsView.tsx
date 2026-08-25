"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */

import Link from "next/link";
import { AlertCircle, Check, Ellipsis } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { readR22WorkspaceDirectory, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";

import "./r22-approvals.css";

type ApprovalStatus = "waiting" | "approved" | "rejected";
type ApprovalGroup = "today" | "week" | "none";
type ApprovalItem = {
  id: string; title: string; origin: string; source: "otto" | "team"; cost: number; status: ApprovalStatus;
  group?: ApprovalGroup; when?: string; detail: string; images?: string[]; moreImages?: number; pendingImage?: boolean;
  sources?: string[]; warning?: string; previousTime?: string; nextTime?: string; decision?: string; resolution?: "approved" | "rejected" | "superseded" | "canceled"; openLabel?: string; openHref?: string;
};

const FIXTURE_STATE_KEY = "fikirtive.r22.approvals.state.v1";

const FIXTURE_ITEMS: ApprovalItem[] = [
  { id: "i1", title: "Candle care tip for the pandan range", origin: "Otto · Weekday mornings", source: "otto", cost: 0, status: "waiting", group: "today", when: "Today 09:00", detail: "Instagram · 1 post", images: ["/fixtures/r22-canvas/art-3.jpg"], sources: ["candle scent list", "no discounts before Oct 25"], openLabel: "Open in campaign", openHref: "/campaign?fixture=r22" },
  { id: "i2", title: "Deepavali gift set — 4 posts", origin: "Otto · Weekend routine", source: "otto", cost: 0, status: "waiting", group: "today", when: "Today 18:00", detail: "Instagram, Facebook · 2 of these hold Sat 10:00", images: ["/fixtures/r22-canvas/art-2.jpg", "/fixtures/r22-canvas/art-1.jpg", "/fixtures/r22-canvas/art-4.jpg", "/fixtures/r22-canvas/art-3.jpg"], moreImages: 2, sources: ["Deepavali gift set", "no discounts before Oct 25"], openLabel: "Open in campaign", openHref: "/campaign?fixture=r22" },
  { id: "i3", title: "Make 4 more Deepavali variants", origin: "Otto · Weekend routine", source: "otto", cost: 16, status: "waiting", group: "week", when: "Before Sat 09:00", detail: "Images ×4 · 4 cr each", pendingImage: true, warning: "This batch would take the routine past its weekly credits cap, so it needs your go-ahead before Otto makes anything.", sources: ["candle scent list"], openLabel: "See the credit ledger", openHref: "/settings?section=billing&fixture=r22" },
  { id: "i4", title: "Restock note for the pandan candle", origin: "Aiman · draft", source: "team", cost: 0, status: "waiting", group: "week", when: "Thu 17:00", detail: "Facebook · 1 post", images: ["/fixtures/r22-canvas/art-4.jpg"], sources: ["pandan candle"], openLabel: "Open in schedule", openHref: "/schedule?fixture=r22" },
  { id: "i5", title: "Move Friday's post to Saturday", origin: "Otto · Weekday mornings", source: "otto", cost: 0, status: "waiting", group: "none", previousTime: "Fri 10:00", nextTime: "Sat 09:00", detail: "Instagram · 1 post · nothing is generated or spent by this change", sources: ["public holidays"], openLabel: "Open in schedule", openHref: "/schedule?fixture=r22" },
  { id: "h1", title: "Weekend market reminder", origin: "Otto · Weekend routine", source: "otto", cost: 0, status: "approved", when: "Sat 10:00", detail: "Instagram · Scheduled · held until a channel is connected", images: ["/fixtures/r22-canvas/art-2.jpg"], decision: "Approved by Nicks · today 08:42" },
  { id: "h2", title: "Soy wax restock — 2 posts", origin: "Otto · Weekday mornings", source: "otto", cost: 8, status: "approved", when: "Mon 09:00", detail: "Instagram · Scheduled · held until a channel is connected", images: ["/fixtures/r22-canvas/art-4.jpg", "/fixtures/r22-canvas/art-1.jpg"], decision: "Approved by Nicks · Mon 07:55 · see the 8 cr in the ledger" },
  { id: "h3", title: "Discount teaser for the gift set", origin: "Otto · Weekend routine", source: "otto", cost: 0, status: "rejected", detail: "Instagram · Otto remade it and the new version is in Needs review", images: ["/fixtures/r22-canvas/art-2.jpg"], decision: "Sent back by Nicks · yesterday 17:10 · Breaks a rule I set — “no discounts before Oct 25”" },
];

const GROUPS: Array<{ id: ApprovalGroup; label: string; time?: string }> = [
  { id: "today", label: "Due today", time: "times in GMT+8" }, { id: "week", label: "This week" }, { id: "none", label: "No deadline" },
];
const REASONS = ["Doesn't sound like us", "Wrong facts or price", "Image looks off", "Breaks a rule I set", "Something else"] as const;

export function R22ApprovalsView({ fixture = false, fixtureState = "ready", fixtureOutcome = "success" }: { fixture?: boolean; fixtureState?: "ready" | "loading" | "error" | "permission" | "empty" | "unknown"; fixtureOutcome?: "success" | "error" | "permission" | "unknown" }) {
  const [items, setItems] = useState(fixtureState === "empty" ? [] : FIXTURE_ITEMS);
  const [tab, setTab] = useState<ApprovalStatus>("waiting");
  const [filter, setFilter] = useState<"all" | "otto" | "cost">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState<{ anchorId: string; ids: string[] } | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "error">("success");
  const [undoItems, setUndoItems] = useState<ApprovalItem[] | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [retryDecision, setRetryDecision] = useState<{ ids: string[]; status: "approved" | "rejected"; decision: string; resolution: NonNullable<ApprovalItem["resolution"]> } | null>(null);
  const [restored, setRestored] = useState(!fixture);
  const [readState, setReadState] = useState(fixtureState);
  const counts = useMemo(() => ({ waiting: items.filter((item) => item.status === "waiting").length, approved: items.filter((item) => item.status === "approved").length, rejected: items.filter((item) => item.status === "rejected").length }), [items]);
  const visible = items.filter((item) => item.status === tab && (filter === "all" || filter === "otto" && item.source === "otto" || filter === "cost" && item.cost > 0));

  useEffect(() => {
    if (!fixture) return;
    setReadState(fixtureState);
    if (fixtureState !== "ready") {
      setItems(fixtureState === "empty" ? [] : FIXTURE_ITEMS);
      setRestored(true);
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(scopedR22FixtureKey(FIXTURE_STATE_KEY));
      if (raw) {
        const saved = JSON.parse(raw) as { items?: ApprovalItem[]; tab?: ApprovalStatus; filter?: "all" | "otto" | "cost" };
        if (Array.isArray(saved.items)) setItems(saved.items);
        if (saved.tab === "waiting" || saved.tab === "approved" || saved.tab === "rejected") setTab(saved.tab);
        if (saved.filter === "all" || saved.filter === "otto" || saved.filter === "cost") setFilter(saved.filter);
      } else if (readR22WorkspaceDirectory().activeId !== "batik-house") setItems([]);
    } catch {
      // Ignore malformed fixture-only recovery data.
    }
    setRestored(true);
  }, [fixture, fixtureState]);

  useEffect(() => {
    if (!fixture || !restored || readState !== "ready") return;
    try {
      window.sessionStorage.setItem(scopedR22FixtureKey(FIXTURE_STATE_KEY), JSON.stringify({ items, tab, filter }));
    } catch {
      // A blocked storage API must not break the fixture.
    }
  }, [fixture, restored, readState, items, tab, filter]);

  if (!fixture) return <main className="r22-approvals" data-r22-approvals data-state="unavailable"><header><div><h1>Approvals</h1><p>Everything waiting on your decision, in one list.</p></div></header><section className="r22-approvals-unavailable"><AlertCircle aria-hidden="true" /><h2>The unified approval feed is not connected yet</h2><p>Campaign plans, generation cards and scheduled posts do not currently expose one server-backed decision list. Fikirtive will not invent review counts, bulk success, undo or rejection reasons.</p><div><Link href="/campaign">Open campaigns</Link><Link href="/schedule">Open Schedule</Link></div></section></main>;
  if (readState === "loading") return <main className="r22-approvals" data-r22-approvals data-state="loading"><header><div><h1>Approvals</h1><p>Everything waiting on your decision, in one list.</p></div></header><section className="r22-approvals-unavailable" aria-busy="true"><h2>Loading workspace approvals…</h2><p>No empty approval feed is inferred while the current workspace read is pending.</p></section></main>;
  if (readState === "error" || readState === "permission" || readState === "unknown") return <main className="r22-approvals" data-r22-approvals data-state={readState}><header><div><h1>Approvals</h1><p>Everything waiting on your decision, in one list.</p></div></header><section className="r22-approvals-unavailable" role={readState === "error" ? "alert" : "status"}><AlertCircle aria-hidden="true" /><h2>{readState === "error" ? "Approvals could not load" : readState === "permission" ? "Approvals are not available to this member" : "Approval read outcome is unknown"}</h2><p>{readState === "error" ? "The unified fixture read failed. No empty feed or zero cost was inferred." : readState === "permission" ? "No titles, counts or approval costs are exposed without the required capability." : "The read may still finish. Retry the same read instead of treating it as empty."}</p>{readState !== "permission" ? <Button unstyled type="button" onClick={() => { setItems(FIXTURE_ITEMS); setReadState("ready"); setRestored(true); }}>Retry</Button> : null}</section></main>;
  if (!restored) return <main className="r22-approvals" data-r22-approvals data-state="loading"><header><div><h1>Approvals</h1><p>Everything waiting on your decision, in one list.</p></div></header><section className="r22-approvals-unavailable" aria-busy="true"><h2>Loading workspace approvals…</h2><p>Old workspace decisions are hidden while the active fixture store is read.</p></section></main>;

  function decide(ids: string[], status: "approved" | "rejected", decision: string, resolution: NonNullable<ApprovalItem["resolution"]> = status, retry = false) {
    if (busyIds.length) return;
    setBusyIds(ids);
    setNotice("");
    window.setTimeout(() => {
      if (fixtureOutcome === "permission") {
        setNoticeKind("error");
        setNotice("Your current workspace permission does not allow this decision. Nothing changed.");
        setRetryDecision(null);
        setBusyIds([]);
        return;
      }
      if ((fixtureOutcome === "error" || fixtureOutcome === "unknown") && !retry) {
        setNoticeKind("error");
        setNotice(fixtureOutcome === "unknown" ? "The decision outcome is unknown. Nothing is counted as approved; retry reconciles this same decision." : "The approval service did not confirm that decision. Nothing changed.");
        setRetryDecision({ ids, status, decision, resolution });
        setBusyIds([]);
        return;
      }
      setUndoItems(items);
      setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, status, decision, resolution } : item));
      setSelected([]);
      setRetryDecision(null);
      setNoticeKind("success");
      setNotice(`${ids.length} ${resolution === "approved" ? "approved" : resolution}. Fixture state only.`);
      setBusyIds([]);
    }, 260);
  }
  function beginReject(anchorId: string, ids: string[]) { setRejecting({ anchorId, ids }); setReason(""); setNote(""); }
  const selectedCost = items.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + item.cost, 0);

  function renderCard(item: ApprovalItem) {
    const waiting = tab === "waiting";
    const busy = busyIds.includes(item.id);
    return <article className={`r22-approvals-item${rejecting?.anchorId === item.id ? " is-rejecting" : ""}${busy ? " is-busy" : ""}`} key={item.id} tabIndex={0} aria-busy={busy || undefined}>
      <header className="r22-approvals-item-head">
        {waiting ? <Checkbox unstyled className="r22-approvals-check" aria-label={`Select: ${item.title}`} checked={selected.includes(item.id)} onCheckedChange={(checked) => setSelected((current) => checked === true ? [...current, item.id] : current.filter((id) => id !== item.id))} /> : null}
        <b>{item.title}</b><span className={`r22-approvals-origin${item.source === "otto" ? " is-otto" : ""}`}>{item.source === "otto" ? <i /> : <em>A</em>}{item.origin}</span><span className="r22-approvals-price">{item.cost ? waiting ? `${item.cost} cr` : `${item.cost} cr spent` : "Free to schedule"}</span>
      </header>
      <div className="r22-approvals-body">
        {item.images?.length || item.pendingImage ? <div className="r22-approvals-thumbs">{item.images?.map((image, index) => <img className="r22-approvals-thumb" src={image} alt="" key={`${item.id}-${index}`} />)}{item.pendingImage ? <span className="r22-approvals-thumb is-pending">To make</span> : null}{item.moreImages ? <Button unstyled type="button" className="r22-approvals-thumb is-more" aria-label={`Preview ${item.moreImages} more images`}>+{item.moreImages}</Button> : null}</div> : null}
        {item.previousTime && item.nextTime ? <p className="r22-approvals-diff"><span>{item.previousTime}</span><i>→</i><b>{item.nextTime}</b></p> : null}
        <p className="r22-approvals-facts">{item.when ? <><span>{item.when}</span> · </> : null}{item.detail}</p>
        {item.warning ? <p className="r22-approvals-warning">{item.warning}</p> : null}
        {item.sources?.length ? <div className="r22-approvals-sources"><span>Based on</span>{item.sources.map((source) => <Button unstyled type="button" key={source}>{source}</Button>)}</div> : null}
      </div>
      {waiting ? <footer className="r22-approvals-actions"><Button unstyled type="button" disabled={busyIds.length > 0} onClick={() => decide([item.id], "approved", "Approved in fixture")}>{busy ? "Approving…" : "Approve"}</Button><Button unstyled type="button" disabled={busyIds.length > 0} onClick={() => beginReject(item.id, [item.id])}>Send back</Button><Link href={item.openHref ?? "/campaign?fixture=r22"}>{item.openLabel ?? "Open in campaign"}</Link><DropdownMenu><DropdownMenuTrigger asChild><Button unstyled type="button" disabled={busyIds.length > 0} className="r22-approvals-more" aria-label="More actions"><Ellipsis data-icon="inline-start" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onSelect={() => decide([item.id], "approved", "Marked handled in fixture")}>Mark handled</DropdownMenuItem><DropdownMenuItem onSelect={() => decide([item.id], "rejected", "Superseded by a newer fixture request", "superseded")}>Mark superseded</DropdownMenuItem><DropdownMenuItem onSelect={() => decide([item.id], "rejected", "Canceled in fixture before approval", "canceled")}>Cancel request</DropdownMenuItem><DropdownMenuItem onSelect={() => { setNoticeKind("success"); setNotice("Otto explanation is available only in this visual fixture."); }}>Ask Otto why</DropdownMenuItem><DropdownMenuItem onSelect={() => { setNoticeKind("success"); setNotice("Fixture link ready to copy. No external action occurred."); }}>Copy link</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu></footer> : <p className="r22-approvals-decision">{item.decision}</p>}
      {rejecting?.anchorId === item.id ? <div className="r22-approvals-reject" role="group" aria-label="Send this back"><h3>Why send {rejecting.ids.length > 1 ? `${rejecting.ids.length} items` : "this back"}?</h3><p>Pick one reason. {item.source === "team" ? "Aiman sees it on the draft." : "Otto uses it for the next version."}</p><RadioGroup unstyled value={reason} onValueChange={setReason} aria-label="Reason for sending back">{REASONS.map((label) => <label key={label}><RadioGroupItem unstyled className="r22-approvals-radio" value={label} />{label}</label>)}</RadioGroup><Textarea unstyled rows={2} value={note} aria-label={`What should ${item.source === "team" ? "Aiman" : "Otto"} change`} onChange={(event) => setNote(event.target.value)} placeholder={`What should ${item.source === "team" ? "Aiman" : "Otto"} change? Optional.`} /><div><Button unstyled type="button" disabled={!reason || busyIds.length > 0} onClick={() => { decide(rejecting.ids, "rejected", `Sent back in fixture · ${reason}`); setRejecting(null); }}>Send back</Button><Button unstyled type="button" disabled={busyIds.length > 0} onClick={() => setRejecting(null)}>Cancel</Button></div></div> : null}
    </article>;
  }

  return <main className="r22-approvals" data-r22-approvals data-fixture>
    <header><div><h1>Approvals</h1><p>Everything waiting on your decision, in one list.</p></div></header>
    <div className="r22-approvals-banner"><AlertCircle aria-hidden="true" /><span>No channel is connected yet, so approving holds a post in Schedule instead of sending it.</span><Link href="/settings?section=connections&fixture=r22">Connect one</Link></div>
    <div className="r22-approvals-fact"><p><b>{counts.waiting} need your review</b> · 2 due today · {items.filter((item) => item.status === "waiting").reduce((sum, item) => sum + item.cost, 0)} cr if you approve everything</p><Button unstyled type="button" disabled={!counts.waiting || busyIds.length > 0} onClick={() => decide(items.filter((item) => item.status === "waiting").map((item) => item.id), "approved", "Approved in fixture")}>{busyIds.length === counts.waiting ? "Approving…" : `Approve all (${counts.waiting})`}</Button></div>
    <p className="r22-approvals-rule">If you have not approved by the slot time, it is skipped — not published. A reminder goes out 2 hours before. This is the current default.</p>
    {notice ? <div className="r22-approvals-notice" data-kind={noticeKind} role={noticeKind === "error" ? "alert" : "status"}>{noticeKind === "success" ? <Check aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}{notice}{retryDecision ? <Button unstyled type="button" onClick={() => decide(retryDecision.ids, retryDecision.status, retryDecision.decision, retryDecision.resolution, true)}>Retry</Button> : null}{undoItems && noticeKind === "success" ? <Button unstyled type="button" onClick={() => { setItems(undoItems); setUndoItems(null); setNotice(""); }}>Undo</Button> : null}<Button unstyled type="button" onClick={() => { setUndoItems(null); setRetryDecision(null); setNotice(""); }}>Dismiss</Button></div> : null}
    <div className="r22-approvals-bar"><Tabs unstyled value={tab} onValueChange={(value) => { setTab(value as ApprovalStatus); setSelected([]); }}><TabsList unstyled aria-label="Approval state">{(["waiting", "approved", "rejected"] as const).map((value) => <TabsTrigger unstyled className={tab === value ? "is-active" : ""} key={value} value={value}>{value === "waiting" ? "Needs review" : value === "approved" ? "Approved" : "Sent back"} <span>{counts[value]}</span></TabsTrigger>)}</TabsList></Tabs><ToggleGroup unstyled type="single" value={filter} aria-label="Filter approvals" onValueChange={(value) => { if (value) setFilter(value as "all" | "otto" | "cost"); }}>{(["all", "otto", "cost"] as const).map((value) => <ToggleGroupItem unstyled key={value} value={value} className={filter === value ? "is-active" : ""}>{value === "all" ? "All" : value === "otto" ? "From Otto" : "Costs credits"}</ToggleGroupItem>)}</ToggleGroup></div>
    {visible.length ? <section className="r22-approvals-list">{tab === "waiting" ? GROUPS.map((group) => { const groupItems = visible.filter((item) => item.group === group.id); if (!groupItems.length) return null; return <div className="r22-approvals-group" key={group.id}><header><h2>{group.label}</h2>{group.time ? <span>{group.time}</span> : null}</header>{groupItems.map(renderCard)}</div>; }) : <div className="r22-approvals-group"><header><h2>Last 7 days</h2><span>times in GMT+8</span></header>{visible.map(renderCard)}</div>}</section> : <section className="r22-approvals-empty"><h2>{tab === "waiting" ? "Nothing needs your review" : tab === "approved" ? "Nothing approved in the last 7 days" : "Nothing sent back yet"}</h2><p>{filter !== "all" ? "The current filter matched nothing." : "Decision history remains visible here when it exists."}</p>{filter !== "all" ? <Button unstyled type="button" onClick={() => setFilter("all")}>Clear filter</Button> : null}</section>}
    {selected.length ? <div className="r22-approvals-bulk" role="status"><b>{selected.length} selected</b><span>{selectedCost} cr</span><Button unstyled type="button" disabled={busyIds.length > 0} onClick={() => decide(selected, "approved", "Approved in fixture")}>{busyIds.length ? "Approving…" : "Approve"}</Button><Button unstyled type="button" disabled={busyIds.length > 0} onClick={() => beginReject(selected[0]!, selected)}>Send back</Button><Button unstyled type="button" disabled={busyIds.length > 0} onClick={() => setSelected([])}>Clear selection</Button></div> : null}
    <p className="r22-approvals-foot">Prototype · sample data · press a to approve, r to send back, x to select</p>
  </main>;
}

export default R22ApprovalsView;
