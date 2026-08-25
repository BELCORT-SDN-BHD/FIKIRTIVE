"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */

/**
 * R22ApprovalsView.tsx —— Approvals 的外壳:状态、诚实机、键盘、批量条。
 *
 * 一张卡长什么样在 `ApprovalCard.tsx`,一次决策对列表做了什么在 `approvals-decisions.ts`,
 * 数据在 `approvals-fixture.ts`。这里只剩「这一面现在处在什么状态」这一件事。
 *
 * 五态诚实机原样保留(loading / error / permission / empty / unknown + 生产 unavailable),
 * 决策三态(permission / error+retry / unknown)、undo、workspace 隔离的 sessionStorage
 * 也都在。八件升级没有换掉其中任何一条 —— 它们本来就是这一面最贵的部分。
 */

import Link from "next/link";
import { AlertCircle, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useOttoPanelControls } from "@/components/otto/panel/OttoPanelShell";
import { readR22WorkspaceDirectory, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";

import { ApprovalCard, type ApprovalCardHandlers, type MenuAction } from "./ApprovalCard";
import type { ReviseMode } from "./ReviseFlow";
import { applyDecision, decisionNotice, type DecisionKind, type PendingDecision } from "./approvals-decisions";
import {
  DECISION_DELAY_MS,
  FIXTURE_ITEMS,
  FIXTURE_STATE_KEY,
  GROUPS,
  REVISE_DELAY_MS,
  creditSuffix,
  reviseRecipient,
  type ApprovalDetailTab,
  type ApprovalItem,
  type ApprovalStatus,
} from "./approvals-fixture";
import "./r22-approvals.css";

const MENU_KIND: Record<Exclude<MenuAction, "explain" | "copy">, DecisionKind> = {
  handled: "handled",
  superseded: "superseded",
  canceled: "canceled",
};

/** ⑧ 错过就跳过的政策句 —— 与 Decide by 同处一屏,而且只在 Needs review。 */
const DEADLINE_RULE = "Miss the Decide by time and the slot is skipped, not published. A reminder goes out 2 hours before. This is the current default.";

export function R22ApprovalsView({ fixture = false, fixtureState = "ready", fixtureOutcome = "success" }: { fixture?: boolean; fixtureState?: "ready" | "loading" | "error" | "permission" | "empty" | "unknown"; fixtureOutcome?: "success" | "error" | "permission" | "unknown" }) {
  const otto = useOttoPanelControls();
  const [items, setItems] = useState(fixtureState === "empty" ? [] : FIXTURE_ITEMS);
  const [tab, setTab] = useState<ApprovalStatus>("waiting");
  const [filter, setFilter] = useState<"all" | "otto" | "cost">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [revising, setRevising] = useState<{ anchorId: string; ids: string[]; mode: ReviseMode } | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "error">("success");
  const [undoItems, setUndoItems] = useState<ApprovalItem[] | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [retryDecision, setRetryDecision] = useState<PendingDecision | null>(null);
  const [restored, setRestored] = useState(!fixture);
  const [readState, setReadState] = useState(fixtureState);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<ApprovalDetailTab>("preview");
  const [focusId, setFocusId] = useState<string | null>(null);

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

  // ② Approve and next —— 批准落地之后焦点走到下一张待审卡,键盘不必回到列表顶端重找。
  useEffect(() => {
    if (!focusId) return;
    document.querySelector<HTMLElement>(`[data-approval-id="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId, items]);

  if (!fixture) return <main className="r22-approvals" data-r22-approvals data-state="unavailable"><header><div><h1>Approvals</h1><p>Everything waiting on your decision, in one list.</p></div></header><section className="r22-approvals-unavailable"><AlertCircle aria-hidden="true" /><h2>The unified approval feed is not connected yet</h2><p>Campaign plans, generation cards and scheduled posts do not currently expose one server-backed decision list. Fikirtive will not invent review counts, approval costs, revision versions, per-platform previews, decision history or decide-by times.</p><div><Link href="/campaign">Open campaigns</Link><Link href="/schedule">Open Schedule</Link></div></section></main>;
  if (readState === "loading") return <main className="r22-approvals" data-r22-approvals data-state="loading"><header><div><h1>Approvals</h1><p>Everything waiting on your decision, in one list.</p></div></header><section className="r22-approvals-unavailable" aria-busy="true"><h2>Loading workspace approvals…</h2><p>No empty approval feed is inferred while the current workspace read is pending.</p></section></main>;
  if (readState === "error" || readState === "permission" || readState === "unknown") return <main className="r22-approvals" data-r22-approvals data-state={readState}><header><div><h1>Approvals</h1><p>Everything waiting on your decision, in one list.</p></div></header><section className="r22-approvals-unavailable" role={readState === "error" ? "alert" : "status"}><AlertCircle aria-hidden="true" /><h2>{readState === "error" ? "Approvals could not load" : readState === "permission" ? "Approvals are not available to this member" : "Approval read outcome is unknown"}</h2><p>{readState === "error" ? "The unified fixture read failed. No empty feed or zero cost was inferred." : readState === "permission" ? "No titles, counts or approval costs are exposed without the required capability." : "The read may still finish. Retry the same read instead of treating it as empty."}</p>{readState !== "permission" ? <Button unstyled type="button" onClick={() => { setItems(FIXTURE_ITEMS); setReadState("ready"); setRestored(true); }}>Retry</Button> : null}</section></main>;
  if (!restored) return <main className="r22-approvals" data-r22-approvals data-state="loading"><header><div><h1>Approvals</h1><p>Everything waiting on your decision, in one list.</p></div></header><section className="r22-approvals-unavailable" aria-busy="true"><h2>Loading workspace approvals…</h2><p>Old workspace decisions are hidden while the active fixture store is read.</p></section></main>;

  const waitingItems = items.filter((item) => item.status === "waiting");
  const dueToday = waitingItems.filter((item) => item.group === "today").length;
  const approvable = waitingItems.filter((item) => !item.blocker);
  const approvableCost = approvable.reduce((sum, item) => sum + item.cost, 0);
  const blockedItems = waitingItems.filter((item) => item.blocker);
  const blockedCost = blockedItems.reduce((sum, item) => sum + item.cost, 0);
  const selectedItems = items.filter((item) => selected.includes(item.id));
  const selectedCost = selectedItems.reduce((sum, item) => sum + item.cost, 0);
  const approvableSelected = selectedItems.filter((item) => !item.blocker);
  const approvableSelectedCost = approvableSelected.reduce((sum, item) => sum + item.cost, 0);

  const groupedWaiting = GROUPS
    .map((group) => ({ group, groupItems: visible.filter((item) => item.group === group.id) }))
    .filter((entry) => entry.groupItems.length > 0);
  const waitingOrder = tab === "waiting" ? groupedWaiting.flatMap((entry) => entry.groupItems.map((item) => item.id)) : [];

  function nextAfter(id: string): string | null {
    const index = waitingOrder.indexOf(id);
    if (index < 0) return null;
    return waitingOrder[index + 1] ?? waitingOrder[index - 1] ?? null;
  }

  function run(pending: PendingDecision, retry = false) {
    if (busyIds.length) return;
    setBusyIds(pending.ids);
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
        setRetryDecision(pending);
        setBusyIds([]);
        return;
      }
      setUndoItems(items);
      setItems((current) => applyDecision(current, pending));
      setSelected([]);
      setRetryDecision(null);
      setNoticeKind("success");
      setNotice(decisionNotice(pending));
      setBusyIds([]);
      if (pending.focusAfter) setFocusId(pending.focusAfter);
    }, pending.kind === "revise" ? REVISE_DELAY_MS : DECISION_DELAY_MS);
  }

  function approve(item: ApprovalItem) {
    if (item.blocker) return;
    run({ ids: [item.id], kind: "approve", focusAfter: nextAfter(item.id) });
  }

  function begin(item: ApprovalItem, mode: ReviseMode) {
    setRevising({ anchorId: item.id, ids: [item.id], mode });
    setReason("");
    setNote("");
  }

  function beginBulk(mode: ReviseMode) {
    if (!selected.length) return;
    setRevising({ anchorId: selected[0]!, ids: selected, mode });
    setReason("");
    setNote("");
  }

  function submitRevise() {
    if (!revising) return;
    if (revising.mode === "revise" && !reason) return;
    run({ ids: revising.ids, kind: revising.mode, reason: reason || undefined, note: note || undefined });
    setRevising(null);
  }

  /** ⑤ Fix with Otto —— 面板挂得到就开面板,挂不到就说挂不到,不假装已经预填。 */
  function fixWithOtto(item: ApprovalItem) {
    if (!item.blocker) return;
    setNoticeKind("success");
    if (!otto) {
      setNotice(`The Otto panel is not mounted on this page, so nothing was prefilled. What needs fixing: ${item.blocker.fixContext}. Fixture state only.`);
      return;
    }
    otto.openPanel();
    setNotice(`Otto is open with this blocker in view: ${item.blocker.fixContext}. Fixture state only — no cap, batch or credit was changed.`);
  }

  function openVersion(id: string) {
    setTab("waiting");
    setSelected([]);
    setFocusId(id);
  }

  function menu(item: ApprovalItem, action: MenuAction) {
    if (action === "explain") {
      setNoticeKind("success");
      setNotice(`Otto explains a decision only in this visual fixture. Nothing was asked of a real ${reviseRecipient(item)} conversation.`);
      return;
    }
    if (action === "copy") {
      setNoticeKind("success");
      setNotice("Fixture link ready to copy. No external action occurred.");
      return;
    }
    run({ ids: [item.id], kind: MENU_KIND[action] });
  }

  const handlers: ApprovalCardHandlers = {
    onSelect: (id, checked) => setSelected((current) => checked ? [...current, id] : current.filter((value) => value !== id)),
    onApprove: approve,
    onBegin: begin,
    onToggleDetail: (item) => { setExpandedId((current) => current === item.id ? null : item.id); setDetailTab("preview"); },
    onDetailTab: setDetailTab,
    onFixWithOtto: fixWithOtto,
    onMenu: menu,
    onOpenVersion: openVersion,
    onReason: setReason,
    onNote: setNote,
    onSubmitRevise: submitRevise,
    onCancelRevise: () => setRevising(null),
  };

  function renderCard(item: ApprovalItem) {
    return <ApprovalCard
      key={item.id}
      item={item}
      waiting={tab === "waiting"}
      busy={busyIds.includes(item.id)}
      anyBusy={busyIds.length > 0}
      selected={selected.includes(item.id)}
      expanded={expandedId === item.id}
      detailTab={detailTab}
      revise={revising?.anchorId === item.id ? { mode: revising.mode, count: revising.ids.length, reason, note } : null}
      handlers={handlers}
    />;
  }

  return <main className="r22-approvals" data-r22-approvals data-fixture>
    <header><div><h1>Approvals</h1><p>Everything waiting on your decision, in one list.</p></div></header>
    <div className="r22-approvals-banner"><AlertCircle aria-hidden="true" /><span>No channel is connected yet, so approving holds a post in Schedule instead of sending it.</span><Link href="/settings?section=connections&fixture=r22">Connect one</Link></div>
    {tab === "waiting" ? <div className="r22-approvals-fact"><p><b>{counts.waiting} need your review</b> · {dueToday} due today · {approvable.length} ready to approve now{blockedItems.length ? ` · ${blockedCost} cr held by ${blockedItems.length} blocked item${blockedItems.length === 1 ? "" : "s"}` : ""}</p><Button unstyled type="button" disabled={!approvable.length || busyIds.length > 0} onClick={() => run({ ids: approvable.map((item) => item.id), kind: "approve" })}>{busyIds.length === approvable.length && busyIds.length > 0 ? "Approving…" : `Approve all (${approvable.length})${creditSuffix(approvableCost)}`}</Button></div> : null}
    {notice ? <div className="r22-approvals-notice" data-kind={noticeKind} role={noticeKind === "error" ? "alert" : "status"}>{noticeKind === "success" ? <Check aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}{notice}{retryDecision ? <Button unstyled type="button" onClick={() => run(retryDecision, true)}>Retry</Button> : null}{undoItems && noticeKind === "success" ? <Button unstyled type="button" onClick={() => { setItems(undoItems); setUndoItems(null); setNotice(""); }}>Undo</Button> : null}<Button unstyled type="button" onClick={() => { setUndoItems(null); setRetryDecision(null); setNotice(""); }}>Dismiss</Button></div> : null}
    <div className="r22-approvals-bar"><Tabs unstyled value={tab} onValueChange={(value) => { setTab(value as ApprovalStatus); setSelected([]); setExpandedId(null); setRevising(null); }}><TabsList unstyled aria-label="Approval state">{(["waiting", "approved", "rejected"] as const).map((value) => <TabsTrigger unstyled className={tab === value ? "is-active" : ""} key={value} value={value}>{value === "waiting" ? "Needs review" : value === "approved" ? "Approved" : "Sent back"} <span>{counts[value]}</span></TabsTrigger>)}</TabsList></Tabs><ToggleGroup unstyled type="single" value={filter} aria-label="Filter approvals" onValueChange={(value) => { if (value) setFilter(value as "all" | "otto" | "cost"); }}>{(["all", "otto", "cost"] as const).map((value) => <ToggleGroupItem unstyled key={value} value={value} className={filter === value ? "is-active" : ""}>{value === "all" ? "All" : value === "otto" ? "From Otto" : "Costs credits"}</ToggleGroupItem>)}</ToggleGroup></div>
    {visible.length ? <section className="r22-approvals-list">{tab === "waiting" ? groupedWaiting.map((entry, index) => <div className="r22-approvals-group" key={entry.group.id}><header><h2>{entry.group.label}</h2>{entry.group.time ? <span>{entry.group.time}</span> : null}</header>{index === 0 ? <p className="r22-approvals-rule">{DEADLINE_RULE}</p> : null}{entry.groupItems.map(renderCard)}</div>) : <div className="r22-approvals-group"><header><h2>Last 7 days</h2><span>times in GMT+8</span></header>{visible.map(renderCard)}</div>}</section> : <section className="r22-approvals-empty"><h2>{tab === "waiting" ? "Nothing needs your review" : tab === "approved" ? "Nothing approved in the last 7 days" : "Nothing sent back yet"}</h2><p>{filter !== "all" ? "The current filter matched nothing." : "Decision history remains visible here when it exists."}</p>{filter !== "all" ? <Button unstyled type="button" onClick={() => setFilter("all")}>Clear filter</Button> : null}</section>}
    {selected.length ? <div className="r22-approvals-bulk" role="status"><b>{selected.length} selected</b><span>{selectedCost} cr</span><Button unstyled type="button" disabled={!approvableSelected.length || busyIds.length > 0} onClick={() => run({ ids: approvableSelected.map((item) => item.id), kind: "approve" })}>{busyIds.length ? "Approving…" : `Approve ${approvableSelected.length} selected${creditSuffix(approvableSelectedCost)}`}</Button><Button unstyled type="button" disabled={busyIds.length > 0} onClick={() => beginBulk("revise")}>Ask for a revise</Button><Button unstyled type="button" disabled={busyIds.length > 0} onClick={() => beginBulk("reject")}>Reject</Button><Button unstyled type="button" disabled={busyIds.length > 0} onClick={() => setSelected([])}>Clear selection</Button></div> : null}
    <p className="r22-approvals-foot">Prototype · sample data · press a to approve and move to the next card, r to ask for a revise, x to select</p>
  </main>;
}

export default R22ApprovalsView;
