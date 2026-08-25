"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectNative } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import Image from "next/image";
import Link from "next/link";
import { Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { readR22WorkspaceDirectory } from "@/components/r22/r22-workspace-fixture";
import "./r22-routines.css";

export type R22RoutineRow = {
  id: string;
  name: string;
  cadence: string | null;
  postsPerWeek: number | null;
  topic: string | null;
  channel: string | null;
  creditsUsed: number | null;
  creditsCap: number | null;
  creditPeriod: "weekly" | "monthly" | null;
  status: "active" | "paused" | "draft";
  autoPublish: boolean | null;
  warning: string | null;
  policy: string | null;
  slots: Array<{ when: string; topic: string; channel: string; status: string }>;
};

type RoutineView = "configuration" | "runs" | "activity";

const FIXTURE_ROWS: R22RoutineRow[] = [
  {
    id: "r1",
    name: "Weekday mornings",
    cadence: "Mon, Wed, Fri · 09:00",
    postsPerWeek: 3,
    topic: "The market stall",
    channel: "Instagram",
    creditsUsed: 12,
    creditsCap: 24,
    creditPeriod: "weekly",
    status: "active",
    autoPublish: false,
    warning: "Instagram is not connected, so nothing from this routine can publish yet.",
    policy: "If a post is not approved by its slot: skip it and remind you 2 hours before. That is today’s default.",
    slots: [
      { when: "Mon 09:00", topic: "Market stall, morning light", channel: "Instagram", status: "Needs review" },
      { when: "Wed 09:00", topic: "Two scents, one tray", channel: "Instagram", status: "Scheduled" },
      { when: "Fri 09:00", topic: "Otto picks this from your brand memory", channel: "Instagram", status: "Draft" },
    ],
  },
  {
    id: "r2",
    name: "Weekend routine",
    cadence: "Sat, Sun · 10:00",
    postsPerWeek: 2,
    topic: "How to burn a candle so it lasts",
    channel: "Facebook",
    creditsUsed: 6,
    creditsCap: 16,
    creditPeriod: "weekly",
    status: "active",
    autoPublish: false,
    warning: "Facebook is not connected, so nothing from this routine can publish yet.",
    policy: "If a post is not approved by its slot: skip it and remind you 2 hours before. That is today’s default.",
    slots: [
      { when: "Sat 10:00", topic: "Trim the wick to 5 mm", channel: "Facebook", status: "Needs review" },
      { when: "Sun 10:00", topic: "Burn it wide the first time", channel: "Facebook", status: "Draft" },
    ],
  },
];

const ROUTINE_DAYS = [
  ["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"],
] as const;
const IQ_CONTEXT = ["Brand Voice", "Visual Guidelines", "Teal batik candle", "Audience: Raya gift buyers"] as const;
const ROUTINE_DRAFT_KEY = "r22:routines:draft:v1";
const ROUTINE_ROWS_KEY = "r22:routines:rows:v1";
const ROUTINE_ACTIVITY_KEY = "r22:routines:activity:v1";

type RoutineActivity = { id: string; title: string; detail: string; at: string };

function prependFixtureActivity(current: RoutineActivity[], title: string, detail: string): RoutineActivity[] {
  return [{ id: `routine-activity-${current.length + 1}`, title, detail, at: "Just now · Nadia Ahmad · 0 cr" }, ...current];
}

type RoutineEditorState = {
  name: string;
  topic: string;
  activeDays: string[];
  times: string[];
  newTime: string;
  timezone: string;
  postsPerWeek: number;
  context: string[];
  channel: string;
  approvalPolicy: string;
  autoPublish: boolean;
  creditCap: number;
  reminderPolicy: string;
  missedPolicy: string;
  showReview: boolean;
};

type RoutineFixtureDraft = {
  version: 1;
  editing: "new" | string;
  baseline: string;
  editor: RoutineEditorState;
};

function readFixtureValue<T>(key: string): T | null {
  try {
    const value = window.sessionStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

function writeFixtureValue(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A locked session store must never make the Routines surface unusable.
  }
}

function removeFixtureValue(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // A locked session store must never make the Routines surface unusable.
  }
}

function RoutineCard({ row, fixture, busy, onEdit, onPause }: { row: R22RoutineRow; fixture: boolean; busy: boolean; onEdit: () => void; onPause: () => void }) {
  const cap = row.creditsCap;
  const used = row.creditsUsed;
  const percent = cap && used !== null ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const needsReview = row.slots.filter((slot) => slot.status === "Needs review").length;

  return (
    <article className={`r22-routine-card${row.status === "paused" ? " is-paused" : ""}`}>
      <header>
        <h2>{row.name}</h2>
        <span className="r22-routine-badges"><i>{row.autoPublish === null ? "Auto-publish unknown" : row.autoPublish ? "Auto-publish on" : "Auto-publish off"}</i><i>{row.status === "active" ? "Active" : row.status === "paused" ? "Paused" : "Draft"}</i></span>
      </header>
      <p className="r22-routine-cadence">{row.cadence ?? "Schedule details are not connected"}</p>
      <p className="r22-routine-fact">
        {row.postsPerWeek === null ? "Posting cadence not connected" : `${row.postsPerWeek} posts a week`} · {row.topic ?? "topic not connected"} · {row.channel ?? "channel not connected"}
      </p>

      {row.status !== "paused" && cap !== null && cap > 0 ? (
        <div className="r22-routine-progress"><span>{row.creditPeriod === "monthly" ? "Monthly credits" : row.creditPeriod === "weekly" ? "Weekly credits" : "Credit limit"}</span><span><i style={{ width: `${percent}%` }} /></span><b>{used === null ? `Usage unavailable · ${cap} cr cap` : `${used} of ${cap} cr`}</b><small>{used === null ? "Nothing is guessed here" : fixture ? "used · 3 days into the week" : `used this ${row.creditPeriod ?? "period"}`}</small></div>
      ) : row.status === "paused" ? <p className="r22-routine-fact">Paused — Otto is preparing nothing for this routine and spending nothing.</p> : null}

      {row.warning && <p className="r22-routine-warning">{row.warning} <Link href={fixture ? "/settings/connections?fixture=r22" : "/settings/connections"}>Open Connections</Link></p>}
      {row.policy && row.status !== "paused" && <p className="r22-routine-policy">{row.policy}</p>}

      {row.slots.length ? (
        <div className="r22-routine-table" role="table" aria-label={`${row.name} schedule`}>
          <div role="row"><b>When</b><b>Topic</b><b>Channel</b><b>Status</b></div>
          {row.slots.map((slot) => <div role="row" key={`${row.id}-${slot.when}`}><span>{slot.when}</span><span>{slot.topic}</span><span>{slot.channel}</span><span><i>{slot.status}</i></span></div>)}
        </div>
      ) : <p className="r22-routine-contract">This routine exists in the authenticated workflow service. Its posting slots, topic and channel need the R22 publishing-routine adapter before they can appear here.</p>}

      <footer>
        <Button unstyled type="button" disabled={busy} onClick={onEdit}>Edit</Button>
        <Button unstyled type="button" disabled={busy} onClick={onPause}>{busy ? "Updating…" : row.status === "paused" ? "Resume" : "Pause"}</Button>
        {needsReview > 0 && <Link href={fixture ? `${SHELL_ROUTES.approvals}?fixture=r22` : SHELL_ROUTES.approvals}>Review {needsReview} post{needsReview === 1 ? "" : "s"}</Link>}
        <span><Image src="/brand/r22-otto.svg" alt="" width={120} height={110} style={{ width: 16, height: "auto" }} />Otto prepares this</span>
      </footer>
      {!fixture && <p className="r22-routine-action-note">Editing and pausing need the R22 publishing-routine mutation contract. No change is made until an action confirms it.</p>}
    </article>
  );
}

export function R22RoutinesView({ routines, fixture = false, readError, fixtureState = "ready", fixtureOutcome = "success" }: { routines: R22RoutineRow[]; fixture?: boolean; readError?: string; fixtureState?: "ready" | "loading" | "empty" | "error" | "permission" | "unknown"; fixtureOutcome?: "success" | "error" | "conflict" | "unknown" }) {
  const [view, setView] = useState<RoutineView>("configuration");
  const [rows, setRows] = useState(fixture ? fixtureState === "empty" ? [] : FIXTURE_ROWS : routines);
  const [editing, setEditing] = useState<R22RoutineRow | "new" | null>(null);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [activeDays, setActiveDays] = useState<string[]>(["mon", "wed", "fri"]);
  const [times, setTimes] = useState<string[]>(["09:00"]);
  const [newTime, setNewTime] = useState("09:00");
  const [timezone, setTimezone] = useState("Asia/Kuala_Lumpur");
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [context, setContext] = useState<string[]>(["Brand Voice", "Visual Guidelines", "Teal batik candle"]);
  const [channel, setChannel] = useState("Instagram");
  const [approvalPolicy, setApprovalPolicy] = useState("Require approval before publishing");
  const [autoPublish, setAutoPublish] = useState(false);
  const [creditCap, setCreditCap] = useState(24);
  const [reminderPolicy, setReminderPolicy] = useState("Remind me 2 hours before");
  const [missedPolicy, setMissedPolicy] = useState("skip-remind");
  const [showReview, setShowReview] = useState(false);
  const [deleted, setDeleted] = useState<{ row: R22RoutineRow; index: number } | null>(null);
  const [validation, setValidation] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState<"draft" | "active" | null>(null);
  const [fixtureReady, setFixtureReady] = useState(!fixture);
  const [editorBaseline, setEditorBaseline] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("batik-house");
  const [activity, setActivity] = useState<RoutineActivity[]>([]);
  const [pendingToggle, setPendingToggle] = useState<R22RoutineRow | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState("");
  const [toggleFailedOnce, setToggleFailedOnce] = useState(false);
  const [saveFailedOnce, setSaveFailedOnce] = useState(false);
  const runRows = useMemo(() => rows.flatMap((row) => row.slots.map((slot) => ({ routine: row.name, ...slot }))), [rows]);

  const editorState = useMemo<RoutineEditorState>(() => ({
    name, topic, activeDays, times, newTime, timezone, postsPerWeek, context, channel,
    approvalPolicy, autoPublish, creditCap, reminderPolicy, missedPolicy, showReview,
  }), [name, topic, activeDays, times, newTime, timezone, postsPerWeek, context, channel, approvalPolicy, autoPublish, creditCap, reminderPolicy, missedPolicy, showReview]);
  const editorDirty = Boolean(editing && editorBaseline && JSON.stringify(editorState) !== editorBaseline);

  const applyEditorState = (next: RoutineEditorState) => {
    setName(next.name);
    setTopic(next.topic);
    setActiveDays(next.activeDays);
    setTimes(next.times);
    setNewTime(next.newTime);
    setTimezone(next.timezone);
    setPostsPerWeek(next.postsPerWeek);
    setContext(next.context);
    setChannel(next.channel);
    setApprovalPolicy(next.approvalPolicy);
    setAutoPublish(next.autoPublish);
    setCreditCap(next.creditCap);
    setReminderPolicy(next.reminderPolicy);
    setMissedPolicy(next.missedPolicy);
    setShowReview(next.showReview);
  };

  useEffect(() => {
    if (!fixture) return;
    const activeWorkspaceId = readR22WorkspaceDirectory().activeId;
    setWorkspaceId(activeWorkspaceId);
    if (fixtureState !== "ready") {
      setRows(fixtureState === "empty" ? [] : FIXTURE_ROWS);
      setFixtureReady(true);
      return;
    }
    const fallbackRows = activeWorkspaceId === "batik-house" ? FIXTURE_ROWS : [];
    const savedRows = readFixtureValue<R22RoutineRow[]>(`${ROUTINE_ROWS_KEY}:${activeWorkspaceId}`);
    setRows(Array.isArray(savedRows) ? savedRows : fallbackRows);
    const savedActivity = readFixtureValue<RoutineActivity[]>(`${ROUTINE_ACTIVITY_KEY}:${activeWorkspaceId}`);
    if (Array.isArray(savedActivity)) setActivity(savedActivity);
    const savedDraft = readFixtureValue<RoutineFixtureDraft>(`${ROUTINE_DRAFT_KEY}:${activeWorkspaceId}`);
    if (savedDraft?.version === 1 && savedDraft.editor && savedDraft.baseline) {
      const target = savedDraft.editing === "new"
        ? "new"
        : (savedRows ?? fallbackRows).find((row) => row.id === savedDraft.editing) ?? null;
      if (target) {
        setEditing(target);
        setEditorBaseline(savedDraft.baseline);
        applyEditorState(savedDraft.editor);
      }
    }
    setFixtureReady(true);
  // Fixture restoration runs only once; the persistence effects own later updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture, fixtureState]);

  useEffect(() => {
    if (!fixture || !fixtureReady || fixtureState !== "ready") return;
    writeFixtureValue(`${ROUTINE_ROWS_KEY}:${workspaceId}`, rows);
  }, [fixture, fixtureReady, fixtureState, rows, workspaceId]);

  useEffect(() => {
    if (!fixture || !fixtureReady || fixtureState !== "ready") return;
    writeFixtureValue(`${ROUTINE_ACTIVITY_KEY}:${workspaceId}`, activity);
  }, [activity, fixture, fixtureReady, fixtureState, workspaceId]);

  useEffect(() => {
    if (!fixture || !fixtureReady || fixtureState !== "ready") return;
    if (!editing) {
      removeFixtureValue(`${ROUTINE_DRAFT_KEY}:${workspaceId}`);
      return;
    }
    writeFixtureValue(`${ROUTINE_DRAFT_KEY}:${workspaceId}`, {
      version: 1,
      editing: editing === "new" ? "new" : editing.id,
      baseline: editorBaseline,
      editor: editorState,
    } satisfies RoutineFixtureDraft);
  }, [fixture, fixtureReady, fixtureState, editing, editorBaseline, editorState, workspaceId]);

  const openEditor = (row?: R22RoutineRow) => {
    const cadenceDays = row?.cadence?.split("·", 1)[0]?.toLowerCase() ?? "";
    const parsedDays = ROUTINE_DAYS.filter(([, label]) => cadenceDays.includes(label.toLowerCase())).map(([id]) => id);
    const next: RoutineEditorState = {
      name: row?.name ?? "",
      topic: row?.topic ?? "",
      activeDays: parsedDays.length ? parsedDays : ["mon", "wed", "fri"],
      times: [row?.cadence?.match(/\d{2}:\d{2}/)?.[0] ?? "09:00"],
      newTime: "09:00",
      timezone: "Asia/Kuala_Lumpur",
      postsPerWeek: row?.postsPerWeek ?? 3,
      context: ["Brand Voice", "Visual Guidelines", "Teal batik candle"],
      channel: row?.channel ?? "Instagram",
      approvalPolicy: "Require approval before publishing",
      autoPublish: row?.autoPublish ?? false,
      creditCap: row?.creditsCap ?? 24,
      reminderPolicy: "Remind me 2 hours before",
      missedPolicy: "skip-remind",
      showReview: false,
    };
    setEditing(row ?? "new");
    applyEditorState(next);
    setEditorBaseline(JSON.stringify(next));
    setValidation([]);
    setNotice("");
    setSubmitting(null);
    setSaveFailedOnce(false);
  };

  const routineErrors = () => [
    !name.trim() ? "Give this routine a name." : "",
    !topic.trim() ? "Describe what this routine should post about." : "",
    !activeDays.length || !times.length ? "Add at least one active day and posting time." : "",
    !context.length ? "Choose at least one approved Otto IQ source." : "",
    creditCap < 1 ? "Set a weekly credit cap of at least 1 cr." : "",
  ].filter(Boolean);

  const saveRoutine = (status: "draft" | "active") => {
    const errors = routineErrors();
    setValidation(errors);
    if (errors.length) return;
    if (!fixture) {
      setNotice("The publishing-routine mutation adapter is not connected. The complete configuration remains visible, but nothing was saved or activated.");
      return;
    }
    setSubmitting(status);
    const dayLabels = ROUTINE_DAYS.filter(([id]) => activeDays.includes(id)).map(([, label]) => label);
    const slotRows = dayLabels.flatMap((day) => times.map((time) => ({ when: `${day} ${time}`, topic: topic.trim() || "Otto picks from approved Otto IQ", channel, status: autoPublish ? "Scheduled" : "Draft" }))).slice(0, postsPerWeek);
    const nextRow: R22RoutineRow = {
      id: editing === "new" ? `fixture-${rows.length + 1}` : editing!.id,
      name: name.trim(),
      cadence: `${dayLabels.join(", ")} · ${times.join(", ")} · ${timezone.replace("_", " ")}`,
      postsPerWeek,
      topic: topic.trim() || "Otto picks from approved Otto IQ",
      channel,
      creditsUsed: editing === "new" ? 0 : editing!.creditsUsed,
      creditsCap: creditCap,
      creditPeriod: "weekly",
      status,
      autoPublish,
      warning: `${channel} is not connected, so nothing from this routine can publish yet.`,
      policy: autoPublish ? "Auto-publish is on for this routine." : missedPolicy === "skip-remind" ? "If a post is not approved by its slot: skip it and remind you 2 hours before." : missedPolicy === "skip" ? "If a post is not approved by its slot: skip it without a reminder." : "If a post is not approved by its slot: move it to the next slot in this routine.",
      slots: slotRows,
    };
    window.setTimeout(() => {
      if (fixtureOutcome !== "success" && !saveFailedOnce) {
        setSubmitting(null);
        setSaveFailedOnce(true);
        setNotice(fixtureOutcome === "conflict" ? "This routine changed elsewhere. Review the visible draft and retry; nothing was overwritten." : fixtureOutcome === "unknown" ? "Routine save outcome is unknown. Check this same draft before starting another; nothing is assumed saved." : "The routine adapter did not confirm the save. The draft remains open and nothing changed.");
        return;
      }
      const actionTitle = editing === "new" ? (status === "active" ? "Routine activated" : "Routine draft created") : (status === "active" ? "Routine updated" : "Routine saved as draft");
      if (editing === "new") {
        setRows((current) => [...current, nextRow]);
      } else if (editing) {
        setRows((current) => current.map((row) => row.id === editing.id ? nextRow : row));
      }
      setActivity((current) => prependFixtureActivity(current, actionTitle, `${nextRow.name} · ${nextRow.cadence}`));
      setSubmitting(null);
      setEditing(null);
      setEditorBaseline("");
      setSaveFailedOnce(false);
      setNotice(status === "active" ? "Routine activated in this fixture. Otto can use only the declared slots and cap." : "Routine saved as a fixture draft. Otto is not running it.");
    }, 520);
  };

  const deleteFixture = () => {
    if (!fixture || editing === "new" || !editing) {
      setNotice("Routine deletion is unavailable until the publishing-routine mutation adapter is connected. Nothing changed.");
      return;
    }
    const index = rows.findIndex((row) => row.id === editing.id);
    if (index < 0) return;
    setDeleted({ row: rows[index]!, index });
    setRows((current) => current.filter((row) => row.id !== editing.id));
    setEditing(null);
    setEditorBaseline("");
    setActivity((current) => prependFixtureActivity(current, "Routine deleted", `${editing.name} · future slots stopped`));
    setNotice(`${editing.name} deleted in this fixture. Otto stopped preparing for it.`);
  };

  const pauseFixture = (row: R22RoutineRow) => {
    if (!fixture) {
      setNotice("The publishing-routine pause adapter is not connected. Nothing changed.");
      return;
    }
    setPendingToggle(row); setToggleError(""); setToggleFailedOnce(false);
  };

  const confirmRoutineToggle = () => {
    if (!pendingToggle || toggleBusy) return;
    setToggleBusy(true); setToggleError("");
    window.setTimeout(() => {
      if (fixtureOutcome !== "success" && !toggleFailedOnce) {
        setToggleBusy(false); setToggleFailedOnce(true);
        setToggleError(fixtureOutcome === "conflict" ? "This routine changed elsewhere. Its current status is unchanged; review and retry." : fixtureOutcome === "unknown" ? "Routine status outcome is unknown. Check this same change before starting another; the visible status is unchanged." : "The routine adapter did not confirm the status change. Nothing changed; retry is safe.");
        return;
      }
      const nextStatus = pendingToggle.status === "paused" ? "active" : "paused";
      setRows((current) => current.map((item) => item.id === pendingToggle.id ? { ...item, status: nextStatus } : item));
      setActivity((current) => prependFixtureActivity(current, nextStatus === "active" ? "Routine resumed" : "Routine paused", `${pendingToggle.name} · ${nextStatus === "active" ? "future slots can prepare again" : "future slots and spend stopped"}`));
      setToggleBusy(false); setPendingToggle(null); setToggleFailedOnce(false);
      setNotice(`${pendingToggle.name} ${nextStatus === "active" ? "resumed" : "paused"} in this fixture. The change applied once.`);
    }, 360);
  };

  const cancelEditor = () => {
    if (editorDirty) {
      setCancelOpen(true);
      return;
    }
    setEditing(null);
    setEditorBaseline("");
  };

  const discardEditor = () => {
    removeFixtureValue(`${ROUTINE_DRAFT_KEY}:${workspaceId}`);
    setCancelOpen(false);
    setEditing(null);
    setEditorBaseline("");
    setValidation([]);
  };

  if (fixture && (fixtureState === "loading" || fixtureState === "error" || fixtureState === "permission" || fixtureState === "unknown")) return <main className="r22-routines" data-r22-routines data-state={fixtureState}><div className="r22-routines-head"><div><h1>Routines</h1><p>Otto only works inside a routine you set up.</p></div></div><p className="r22-routine-read-error" role={fixtureState === "error" ? "alert" : "status"}>{fixtureState === "loading" ? "Loading workspace routines… Nothing is guessed while this loads." : fixtureState === "permission" ? "Routines are not available to this member. No names, slots, usage or counts are exposed." : fixtureState === "unknown" ? "Routine read outcome is unknown. Nothing is guessed in its place." : "Routines could not be loaded. Nothing is guessed in its place."}{fixtureState === "error" || fixtureState === "unknown" ? <> <Link href="/routines?fixture=r22">Retry</Link></> : null}</p></main>;

  return (
    <main className="r22-routines" data-r22-routines>
      <div className="r22-routines-head"><div><h1>Routines</h1><p>Otto only works inside a routine you set up.</p></div>{!readError && view === "configuration" && !editing && <Button unstyled type="button" onClick={() => openEditor()}>Create routine</Button>}</div>

      {!readError && <Tabs unstyled value={view} onValueChange={(value) => { setView(value as RoutineView); setEditing(null); }}>
        <TabsList unstyled className="r22-routine-tabs" aria-label="Routine view">
          {(["configuration", "runs", "activity"] as const).map((item) => <TabsTrigger unstyled key={item} value={item}>{item[0]!.toUpperCase() + item.slice(1)}</TabsTrigger>)}
        </TabsList>
      </Tabs>}

      {readError && <p className="r22-routine-read-error" role="alert">Routines could not be loaded: {readError}. Nothing is guessed in its place.</p>}
      {notice && <p className="r22-routine-read-error" role="status">{notice}</p>}
      {deleted && <div className="r22-routine-undo" role="status"><span>{deleted.row.name} deleted.</span><Button unstyled type="button" onClick={() => { setRows((current) => [...current.slice(0, deleted.index), deleted.row, ...current.slice(deleted.index)]); setActivity((current) => prependFixtureActivity(current, "Routine restored", `${deleted.row.name} · previous configuration restored`)); setDeleted(null); setNotice("Routine restored in this fixture."); }}>Undo</Button></div>}

      {!readError && view === "configuration" && (
        <>
          <p className="r22-routines-standing">Outside these routines Otto prepares nothing and spends nothing. Times are in GMT+8.</p>
          {editing && (
            <section className="r22-routine-editor" aria-label="Routine settings">
              <header><h2>{editing === "new" ? "New routine" : "Edit routine"}</h2><span>Nothing runs until you save</span></header>
              <label><span><b>Name</b><small>What this routine is called.</small></span><Input unstyled autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekday mornings" /></label>
              <section className="r22-routine-editor-block"><h3>Posting times</h3><p>These are the only moments Otto prepares a post. Every time uses the selected Timezone.</p><div className="r22-routine-days" role="group" aria-label="Active days">{ROUTINE_DAYS.map(([id, label]) => <Button unstyled type="button" aria-pressed={activeDays.includes(id)} key={id} onClick={() => setActiveDays((current) => current.includes(id) ? current.filter((day) => day !== id) : [...current, id])}><b>{label}</b><small>{activeDays.includes(id) ? "On" : "Off"}</small></Button>)}</div><div className="r22-routine-time-row"><Input unstyled type="time" aria-label="Posting time" value={newTime} onChange={(event) => setNewTime(event.target.value)} /><Button unstyled type="button" onClick={() => { if (newTime && !times.includes(newTime)) setTimes((current) => [...current, newTime].sort()); }}>Add time</Button><span>{times.map((time) => <Button unstyled type="button" key={time} aria-label={`Remove ${time}`} onClick={() => setTimes((current) => current.filter((value) => value !== time))}>{time} ×</Button>)}</span></div></section>
              <label><span><b>Timezone</b><small>Shown before activation and in the review summary.</small></span><SelectNative unstyled value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="Asia/Kuala_Lumpur">Asia/Kuala Lumpur · GMT+8</option><option value="Asia/Singapore">Asia/Singapore · GMT+8</option><option value="Australia/Perth">Australia/Perth · GMT+8</option></SelectNative></label>
              <label><span><b>Posts a week</b><small>Otto never prepares more than this, even if there are more slots.</small></span><span className="r22-routine-step"><Button unstyled type="button" aria-label="One post fewer a week" onClick={() => setPostsPerWeek((value) => Math.max(1, value - 1))}>−</Button><b>{postsPerWeek}</b><Button unstyled type="button" aria-label="One post more a week" onClick={() => setPostsPerWeek((value) => Math.min(14, value + 1))}>+</Button></span></label>
              <label><span><b>What it posts about</b><small>A brief, not a script. Otto still reads only the approved context below.</small></span><Input unstyled value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="The market stall" /></label>
              <section className="r22-routine-editor-block"><h3>What it may read from Otto IQ</h3><p>Every item stays workspace-scoped and remains visible in the review.</p><div className="r22-routine-context" role="group" aria-label="Otto IQ sources">{IQ_CONTEXT.map((item) => <Button unstyled type="button" key={item} aria-pressed={context.includes(item)} onClick={() => setContext((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])}>{item}</Button>)}</div></section>
              <label><span><b>Publishing channel</b><small>A missing connection holds finished work; it never guesses success.</small></span><SelectNative unstyled value={channel} onChange={(event) => setChannel(event.target.value)}><option>Instagram</option><option>Facebook</option><option>TikTok</option><option>LinkedIn</option></SelectNative></label>
              <label><span><b>Approval policy</b><small>Auto-publish remains off by default.</small></span><SelectNative unstyled value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value)}><option>Require approval before publishing</option><option>Require approval before scheduling</option><option>Approval handled outside FIKIRTIVE</option></SelectNative></label>
              <label><span><b>Auto-publish</b><small>When off, finished work waits in Approvals. Turning it on affects only this Routine.</small></span><span className="r22-routine-switch"><span>{autoPublish ? "On" : "Off"}</span><Switch unstyled checked={autoPublish} onCheckedChange={setAutoPublish} aria-label="Auto-publish" /></span></label>
              <label><span><b>Weekly credit cap</b><small>Expected maximum: about {Math.floor(creditCap / 3)} image{Math.floor(creditCap / 3) === 1 ? "" : "s"} a week at 3 cr each.</small></span><span className="r22-routine-credit"><Input unstyled type="number" min={1} value={creditCap} onChange={(event) => setCreditCap(Number(event.target.value))} aria-label="Weekly credit cap" /><b>cr</b></span></label>
              <label><span><b>Reminder policy</b><small>Choose when the approver is reminded before a slot.</small></span><SelectNative unstyled value={reminderPolicy} onChange={(event) => setReminderPolicy(event.target.value)}><option>Remind me 2 hours before</option><option>Remind me 1 day before</option><option>Do not send a reminder</option></SelectNative></label>
              <label><span><b>If a post isn&apos;t approved by its slot</b><small>Unapproved work never publishes.</small></span><SelectNative unstyled value={missedPolicy} onChange={(event) => setMissedPolicy(event.target.value)}><option value="skip-remind">Skip it and remind me 2 hours before</option><option value="skip">Skip it and stay quiet</option><option value="next">Move it to the next slot in this routine</option></SelectNative></label>
              {validation.length ? <ul className="r22-routine-validation" role="alert">{validation.map((item) => <li key={item}>{item}</li>)}</ul> : null}
              <section className="r22-routine-review"><Button unstyled type="button" aria-expanded={showReview} onClick={() => { const errors = routineErrors(); setValidation(errors); if (!errors.length) setShowReview((open) => !open); }}>Review routine</Button>{showReview ? <dl><div><dt>Schedule</dt><dd>{activeDays.length} active days · {times.join(", ") || "No time"} · {timezone.replace("_", " ")}</dd></div><div><dt>Scope</dt><dd>{postsPerWeek} posts · {channel} · {context.length} Otto IQ sources</dd></div><div><dt>Approval</dt><dd>{autoPublish ? "Auto-publish on" : approvalPolicy}</dd></div><div><dt>Spend</dt><dd>Maximum {creditCap} cr weekly · {reminderPolicy}</dd></div></dl> : null}</section>
              <footer><Button unstyled type="button" disabled={submitting !== null} onClick={() => saveRoutine("active")}>{submitting === "active" ? "Activating…" : "Activate routine"}</Button><Button unstyled type="button" disabled={submitting !== null} onClick={() => saveRoutine("draft")}>{submitting === "draft" ? "Saving…" : "Save draft"}</Button><Button unstyled type="button" disabled={submitting !== null} onClick={cancelEditor}>Cancel</Button>{editing !== "new" ? <AlertDialog><AlertDialogTrigger asChild><Button unstyled type="button" className="is-danger" disabled={submitting !== null}>Delete routine</Button></AlertDialogTrigger><AlertDialogContent className="r22-routine-delete-dialog"><AlertDialogHeader><AlertDialogTitle>Delete {name || "this routine"}?</AlertDialogTitle><AlertDialogDescription>Otto will stop preparing every future slot in this routine. Fixture deletion can be undone from the Routines page.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep routine</AlertDialogCancel><AlertDialogAction onClick={deleteFixture}>Delete routine</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> : null}</footer>
            </section>
          )}
          {!readError && !editing && rows.length === 0 && <section className="r22-routines-empty"><Workflow aria-hidden="true" /><b>No routine yet</b><p>A routine is the only thing that lets Otto work without you starting each post — the days and times Otto posts, what those posts are about, and how many credits Otto may spend in a week. Until you make one, Otto prepares nothing and spends nothing.</p><Button unstyled type="button" onClick={() => openEditor()}>Create routine</Button></section>}
          {!editing && <div className="r22-routines-list">{rows.map((row) => <RoutineCard key={row.id} row={row} fixture={fixture} busy={toggleBusy && pendingToggle?.id === row.id} onEdit={() => openEditor(row)} onPause={() => pauseFixture(row)} />)}</div>}
        </>
      )}

      {!readError && view === "runs" && <section className="r22-routine-view"><h2>Runs</h2><p>Every prepared slot is listed here. A missing channel never counts as a completed run.</p>{runRows.length ? <div className="r22-routine-table"><div><b>Routine</b><b>When</b><b>Channel</b><b>Status</b></div>{runRows.map((run) => <div key={`${run.routine}-${run.when}`}><span>{run.routine}</span><span>{run.when}</span><span>{run.channel}</span><span><i>{run.status}</i></span></div>)}</div> : <p className="r22-routine-contract">No posting runs are available from the current backend contract.</p>}</section>}
      {!readError && view === "activity" && <section className="r22-routine-view"><h2>Activity</h2><p>Routine changes and autonomous actions appear with the person, time and credit impact that caused them.</p>{fixture ? activity.length ? <div className="r22-routine-activity-list">{activity.map((item) => <div key={item.id}><span><b>{item.title}</b><small>{item.detail}</small></span><time>{item.at}</time></div>)}</div> : <p className="r22-routine-contract">No fixture routine change has been recorded in this workspace yet.</p> : <p className="r22-routine-contract">The publishing-routine activity adapter is not connected. No activity was fabricated.</p>}</section>}
      <AlertDialog open={Boolean(pendingToggle)} onOpenChange={(open) => { if (!open && !toggleBusy) setPendingToggle(null); }}>
        <AlertDialogContent className="r22-routine-delete-dialog">
          <AlertDialogHeader><AlertDialogTitle>{pendingToggle?.status === "paused" ? "Resume" : "Pause"} {pendingToggle?.name}?</AlertDialogTitle><AlertDialogDescription>{pendingToggle?.status === "paused" ? "Otto may prepare future slots again, within the visible schedule, approval policy and credit cap." : "Otto will stop preparing future slots and spending credits for this routine. Existing drafts and history stay visible."}</AlertDialogDescription></AlertDialogHeader>
          {toggleError ? <p className="r22-routine-toggle-error" role="alert">{toggleError}</p> : null}
          <AlertDialogFooter><AlertDialogCancel disabled={toggleBusy}>Keep current status</AlertDialogCancel><AlertDialogAction disabled={toggleBusy} onClick={(event) => { event.preventDefault(); confirmRoutineToggle(); }}>{toggleBusy ? "Updating…" : toggleError ? "Retry" : pendingToggle?.status === "paused" ? "Resume routine" : "Pause routine"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="r22-routine-delete-dialog">
          <AlertDialogHeader><AlertDialogTitle>Discard this routine draft?</AlertDialogTitle><AlertDialogDescription>Your unsaved schedule, Otto IQ sources, publishing rules and credit cap will be removed from this fixture.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={discardEditor}>Discard draft</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
