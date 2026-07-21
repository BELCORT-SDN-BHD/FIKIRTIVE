"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Clock3,
  LoaderCircle,
  RefreshCw,
  Save,
  Unplug,
  UserCheck,
  UserMinus,
  UserPlus,
} from "lucide-react";
import {
  assignConversation,
  getConversation,
  getConversationPreflight,
  getHistory,
  handOffConversation,
  requestAutomationResume,
  saveConversationDraft,
  setConversationStatus,
  takeOverConversation,
} from "@/lib/customer-inbox-ui-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  controlBadgePresentation,
  dateTimeLabel,
  errorMessage,
  eventDescription,
  messageText,
  relativeTimeLabel,
  statusPresentation,
} from "./inbox-format";

type ConversationResult = Awaited<ReturnType<typeof getConversation>>;
type ConversationSuccess = Extract<ConversationResult, { ok: true }>;
type ConversationResource = ConversationSuccess["resource"];
type HistoryResult = Awaited<ReturnType<typeof getHistory>>;
type HistorySuccess = Extract<HistoryResult, { ok: true }>;
type HistoryMessage = HistorySuccess["resource"]["messages"][number];
type HistoryEvent = HistorySuccess["resource"]["events"][number];
type PreflightResult = Awaited<ReturnType<typeof getConversationPreflight>>;

export type ConversationInitialState = {
  conversation: ConversationResult;
  history: HistoryResult;
  preflight: PreflightResult;
};

const POLL_MS = 20_000;

function DetailUnavailable() {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM Inbox</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This conversation is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          It may not exist, or you may not have access. Nothing was changed. This message is the same whether the
          conversation was never yours or never existed.
        </p>
        <Button asChild className="mt-6" variant="secondary"><Link href="/crm/inbox"><ArrowLeft />Back to Inbox</Link></Button>
      </section>
    </main>
  );
}

export default function InboxConversationPage({
  conversationId,
  initialState,
}: {
  conversationId: string;
  initialState: ConversationInitialState;
}) {
  if (!initialState.conversation.ok) return <DetailUnavailable />;
  return (
    <ConversationWorkspace
      conversationId={conversationId}
      initialConversation={initialState.conversation.resource}
      initialHistory={initialState.history}
      initialPreflight={initialState.preflight}
    />
  );
}

function ConversationWorkspace({
  conversationId,
  initialConversation,
  initialHistory,
  initialPreflight,
}: {
  conversationId: string;
  initialConversation: ConversationResource;
  initialHistory: HistoryResult;
  initialPreflight: PreflightResult;
}) {
  const [conversation, setConversation] = useState<ConversationResource>(initialConversation);
  const [historyResult, setHistoryResult] = useState<HistoryResult>(initialHistory);
  const [preflightResult, setPreflightResult] = useState<PreflightResult>(initialPreflight);
  const [refreshedAt, setRefreshedAt] = useState<Date>(
    initialPreflight.ok ? new Date(initialPreflight.resource.checkedAt) : new Date(),
  );
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  const [draftText, setDraftText] = useState(() => {
    const draft = initialConversation.draft;
    if (!draft) return "";
    const content = messageText(draft.contentJson);
    return "text" in content ? content.text : "";
  });
  const [draftDirty, setDraftDirty] = useState(false);
  const draftDirtyRef = useRef(false);
  const draftRevisionAtEditStartRef = useRef<number | null>(initialConversation.draft?.revision ?? null);

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [targetMembershipId, setTargetMembershipId] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const [resumeNote, setResumeNote] = useState("");

  const refresh = useCallback(async (): Promise<ConversationResource | null> => {
    try {
      const [conv, hist, pre] = await Promise.all([
        getConversation({ conversationId }),
        getHistory({ conversationId }),
        getConversationPreflight({ conversationId }),
      ]);
      let fresh: ConversationResource | null = null;
      if (conv.ok) {
        fresh = conv.resource;
        const freshDraftRevision = fresh.draft?.revision ?? null;
        if (draftDirtyRef.current) {
          if (freshDraftRevision !== draftRevisionAtEditStartRef.current) {
            setConflictNotice(
              "This conversation's draft changed elsewhere. Your unsaved text is still here — reload to compare before saving.",
            );
          }
        } else {
          draftRevisionAtEditStartRef.current = freshDraftRevision;
        }
        setConversation(fresh);
      }
      setHistoryResult(hist);
      setPreflightResult(pre);
      setRefreshedAt(new Date());
      setRefreshFailed(!conv.ok);
      return fresh;
    } catch {
      setRefreshFailed(true);
      return null;
    }
  }, [conversationId]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  function onDraftChange(text: string) {
    setDraftText(text);
    if (!draftDirtyRef.current) {
      draftDirtyRef.current = true;
      setDraftDirty(true);
    }
  }

  async function acknowledgeConflict() {
    const fresh = await refresh();
    setConflictNotice(null);
    draftDirtyRef.current = false;
    setDraftDirty(false);
    if (fresh) {
      draftRevisionAtEditStartRef.current = fresh.draft?.revision ?? null;
      const content = fresh.draft ? messageText(fresh.draft.contentJson) : null;
      setDraftText(content && "text" in content ? content.text : "");
    }
  }

  async function runMutation<T extends { ok: true } | { ok: false; error: string }>(
    key: string,
    action: () => Promise<T>,
    onSuccess: (result: Extract<T, { ok: true }>) => void,
  ) {
    setBusy(key);
    setActionError(null);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        const code = (result as { error: string }).error;
        if (code === "CAS_CONFLICT") {
          setConflictNotice("This conversation changed — reload to see the latest.");
          return;
        }
        setActionError(errorMessage(code));
        return;
      }
      onSuccess(result as Extract<T, { ok: true }>);
      await refresh();
    } catch {
      setActionError("The request could not finish. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  async function doTakeOver() {
    await runMutation(
      "takeover",
      () => takeOverConversation({ conversationId, expectedRevision: conversation.revision }),
      () => setNotice("You took over from Otto. Auto-reply is paused for this conversation."),
    );
  }

  async function doSaveDraft() {
    const draftBaseRevision = conversation.draft?.revision ?? null;
    await runMutation(
      "draft",
      () =>
        saveConversationDraft({
          conversationId,
          conversationBaseRevision: conversation.revision,
          draftBaseRevision,
          text: draftText,
        }),
      (result) => {
        draftDirtyRef.current = false;
        setDraftDirty(false);
        draftRevisionAtEditStartRef.current = result.change.revision;
        setNotice("Draft saved. It has not been sent — sending isn't available yet.");
      },
    );
  }

  async function doAssign(target: string | null) {
    await runMutation(
      "assign",
      () => assignConversation({ conversationId, expectedRevision: conversation.revision, targetMembershipId: target }),
      () => {
        setNotice(target ? "Assignment updated." : "Conversation unassigned.");
        setTargetMembershipId("");
      },
    );
  }

  async function doHandOff(event: FormEvent) {
    event.preventDefault();
    if (!targetMembershipId.trim()) return;
    await runMutation(
      "handoff",
      () =>
        handOffConversation({
          conversationId,
          expectedRevision: conversation.revision,
          targetMembershipId: targetMembershipId.trim(),
          note: handoffNote.trim() || undefined,
        }),
      () => {
        setNotice("Conversation handed off. Auto-reply is paused.");
        setTargetMembershipId("");
        setHandoffNote("");
      },
    );
  }

  async function doSetStatus(status: "open" | "closed") {
    await runMutation(
      "status",
      () => setConversationStatus({ conversationId, expectedRevision: conversation.revision, status }),
      () => setNotice(status === "closed" ? "Conversation closed." : "Conversation reopened."),
    );
  }

  async function doRequestResume(event: FormEvent) {
    event.preventDefault();
    await runMutation(
      "resume",
      () =>
        requestAutomationResume({
          conversationId,
          expectedRevision: conversation.revision,
          note: resumeNote.trim() || undefined,
        }),
      () => {
        setResumeNote("");
        setNotice("Resume request recorded — auto-reply stays off for now.");
      },
    );
  }

  const preflightOk = preflightResult.ok;
  const capabilityStatus = preflightOk ? preflightResult.resource.internalCapability.status : "unknown";
  const actionsDisabled = capabilityStatus !== "pass";
  const actionsDisabledReason =
    capabilityStatus === "block"
      ? "You can view this conversation, but only the assigned teammate can act on it right now."
      : !preflightOk
        ? "Actions are disabled until capability can be confirmed — diagnostics could not load."
        : null;
  // Widened to `string`: the service currently types connection.status as the single
  // literal "unknown" (no provider exists yet), which would make a "pass" comparison
  // a compile error. The check stays honest/future-proof for whenever a connection
  // axis can report "pass".
  const connectionStatus: string = preflightOk ? preflightResult.resource.connection.status : "unknown";
  const control = controlBadgePresentation(conversation.automationState);
  const status = statusPresentation(conversation.status);
  const identity = conversation.contactIdentity;
  const assignee = conversation.assigneeMembership;

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-6xl">
        <Link href="/crm/inbox" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" />Back to Inbox
        </Link>

        <header className="mt-4 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">CRM · Conversation</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{identity.contact.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{identity.channel} · {identity.externalId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            <Badge variant={control.variant}>{control.label}</Badge>
          </div>
        </header>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />Last message: {conversation.lastMessageAt ? dateTimeLabel(conversation.lastMessageAt) : "No messages yet"}</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />Connection health check: {preflightOk ? "No health check has run yet" : "Unknown — diagnostics could not load"}</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />This screen loaded: {dateTimeLabel(refreshedAt)}</span>
        </div>

        {connectionStatus !== "pass" ? (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
            <Unplug className="mt-0.5 size-4 shrink-0" />
            <span>Not connected yet — no messaging channel is linked to this conversation. Nothing here reflects live provider traffic.</span>
          </div>
        ) : null}

        {refreshFailed ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
            <span>This view may be out of date — last confirmed {relativeTimeLabel(refreshedAt)}. It is not being shown as live.</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}><RefreshCw />Reload</Button>
          </div>
        ) : null}

        {conflictNotice ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error-soft bg-error-soft px-4 py-3 text-sm text-destructive">
            <span>{conflictNotice}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => void acknowledgeConflict()}><RefreshCw />Reload</Button>
          </div>
        ) : null}

        {actionsDisabled ? (
          <div className="mt-4 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            {actionsDisabledReason}
          </div>
        ) : null}

        {notice ? <p className="mt-4 text-sm text-success">{notice}</p> : null}
        {actionError ? <p className="mt-4 text-sm text-destructive">{actionError}</p> : null}

        <div className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="grid content-start gap-5">
            <HistoryPanel historyResult={historyResult} onRetry={refresh} />

            <Card>
              <CardHeader><CardTitle>Reply draft</CardTitle><CardDescription>Internal only — see the note below.</CardDescription></CardHeader>
              <CardContent>
                <Composer
                  automationState={conversation.automationState}
                  draft={conversation.draft}
                  draftText={draftText}
                  draftDirty={draftDirty}
                  actionsDisabled={actionsDisabled}
                  busy={busy}
                  onDraftChange={onDraftChange}
                  onSave={doSaveDraft}
                  onTakeOver={doTakeOver}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid content-start gap-5">
            <Card>
              <CardHeader><CardTitle>Assignment &amp; status</CardTitle><CardDescription>Team-member lookup isn&apos;t available yet — enter the exact membership ID.</CardDescription></CardHeader>
              <CardContent className="grid gap-4">
                <div className="rounded-lg bg-muted/45 p-3 text-sm">
                  {assignee ? `Assigned to membership ${assignee.id} · ${assignee.role}` : "Unassigned"}
                </div>
                <div className="grid gap-2">
                  <Input value={targetMembershipId} onChange={(event) => setTargetMembershipId(event.target.value)} placeholder="Membership ID" aria-label="Membership ID" disabled={actionsDisabled} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" disabled={actionsDisabled || busy !== null || !targetMembershipId.trim()} onClick={() => void doAssign(targetMembershipId.trim())}>
                      {busy === "assign" ? <LoaderCircle className="animate-spin" /> : <UserPlus />}Assign
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={actionsDisabled || busy !== null || !assignee} onClick={() => void doAssign(null)}>
                      {busy === "assign" ? <LoaderCircle className="animate-spin" /> : <UserMinus />}Unassign
                    </Button>
                  </div>
                </div>
                <form className="grid gap-2 border-t border-border pt-3" onSubmit={doHandOff}>
                  <label className="text-xs font-semibold text-muted-foreground">Hand off with a note</label>
                  <Input value={handoffNote} onChange={(event) => setHandoffNote(event.target.value)} maxLength={1000} placeholder="Note for the next teammate (optional)" aria-label="Hand-off note" disabled={actionsDisabled} />
                  <Button type="submit" size="sm" variant="secondary" disabled={actionsDisabled || busy !== null || !targetMembershipId.trim()}>
                    {busy === "handoff" ? <LoaderCircle className="animate-spin" /> : <UserCheck />}Hand off to membership ID above
                  </Button>
                </form>
                <div className="border-t border-border pt-3">
                  <Button type="button" size="sm" variant="secondary" disabled={actionsDisabled || busy !== null} onClick={() => void doSetStatus(conversation.status === "open" ? "closed" : "open")}>
                    {busy === "status" ? <LoaderCircle className="animate-spin" /> : null}
                    {conversation.status === "open" ? "Close conversation" : "Reopen conversation"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Automation resume</CardTitle><CardDescription>Owner/admin action. Recording a request never turns auto-reply back on by itself.</CardDescription></CardHeader>
              <CardContent>
                <form className="grid gap-2" onSubmit={doRequestResume}>
                  <Input value={resumeNote} onChange={(event) => setResumeNote(event.target.value)} maxLength={1000} placeholder="Note (optional)" aria-label="Resume request note" disabled={actionsDisabled} />
                  <Button type="submit" size="sm" variant="secondary" disabled={actionsDisabled || busy !== null}>
                    {busy === "resume" ? <LoaderCircle className="animate-spin" /> : null}Request automation resume
                  </Button>
                </form>
              </CardContent>
            </Card>

            <PreflightPanel preflightResult={preflightResult} onRetry={refresh} />

            <Card>
              <CardHeader><CardTitle>Contact</CardTitle><CardDescription>Read-only summary. The full record stays in Contacts.</CardDescription></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p className="text-base font-semibold">{identity.contact.name}</p>
                <p className="text-xs text-muted-foreground">{identity.contact.lifecycleStage}</p>
                <div className="rounded-lg bg-muted/45 p-3 text-xs">
                  <p>{identity.channel} · {identity.externalId}</p>
                  {identity.handle || identity.label ? <p className="mt-1 text-muted-foreground">{identity.label ?? identity.handle}</p> : null}
                </div>
                <Button asChild variant="secondary" className="mt-1"><Link href={`/crm/contacts/${identity.contact.id}`}>Open full contact profile<ArrowRight /></Link></Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}

function Composer({
  automationState,
  draft,
  draftText,
  draftDirty,
  actionsDisabled,
  busy,
  onDraftChange,
  onSave,
  onTakeOver,
}: {
  automationState: string;
  draft: ConversationResource["draft"];
  draftText: string;
  draftDirty: boolean;
  actionsDisabled: boolean;
  busy: string | null;
  onDraftChange: (text: string) => void;
  onSave: () => void;
  onTakeOver: () => void;
}) {
  const sendNotice = (
    <p className="text-xs leading-5 text-muted-foreground">
      Sending isn&apos;t available yet. Replies can be drafted and will be sendable once the messaging channel is
      connected and approved.
    </p>
  );

  if (actionsDisabled) {
    return <div className="grid gap-3">{sendNotice}</div>;
  }

  if (automationState === "otto_active") {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">Otto is currently handling this conversation. Take over to draft a reply yourself.</p>
        <Button type="button" onClick={onTakeOver} disabled={busy !== null} className="w-fit">
          {busy === "takeover" ? <LoaderCircle className="animate-spin" /> : <UserCheck />}Take over
        </Button>
        {sendNotice}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {draft && draft.authorKind !== "merchant_member" ? (
        <Badge variant="warning" className="w-fit">Otto-authored draft — not reviewed or sent</Badge>
      ) : null}
      <Textarea value={draftText} onChange={(event) => onDraftChange(event.target.value)} maxLength={4096} rows={6} placeholder="Write an internal reply draft…" aria-label="Reply draft" />
      <div className="flex items-center gap-3">
        <Button type="button" onClick={onSave} disabled={busy !== null || !draftDirty}>
          {busy === "draft" ? <LoaderCircle className="animate-spin" /> : <Save />}Save draft
        </Button>
        {draftDirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
      </div>
      {sendNotice}
    </div>
  );
}

function HistoryPanel({
  historyResult,
  onRetry,
}: {
  historyResult: HistoryResult;
  onRetry: () => void;
}) {
  if (!historyResult.ok) {
    return (
      <Card>
        <CardHeader><CardTitle>History could not load</CardTitle><CardDescription>{errorMessage(historyResult.error)}</CardDescription></CardHeader>
        <CardContent><Button type="button" variant="secondary" onClick={onRetry}><RefreshCw />Retry</Button></CardContent>
      </Card>
    );
  }
  const { messages, events } = historyResult.resource;
  return (
    <>
      <Card>
        <CardHeader><CardTitle>Messages</CardTitle><CardDescription>Chronological, oldest first. Text only — anything else shows a placeholder.</CardDescription></CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages recorded yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Control &amp; assignment timeline</CardTitle><CardDescription>Every assignment, hand-off, takeover, and status change on this conversation.</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No control events recorded yet.</p>
          ) : (
            events.map((event) => <EventRow key={event.id} event={event} />)
          )}
        </CardContent>
      </Card>
    </>
  );
}

function MessageBubble({ message }: { message: HistoryMessage }) {
  const content = messageText(message.contentJson);
  const inbound = message.direction === "inbound";
  return (
    <div
      className={`max-w-[85%] rounded-xl border p-3 text-sm ${
        inbound ? "self-start border-border bg-muted/45" : "self-end border-brand/25 bg-brand-soft text-brand-soft-foreground"
      }`}
    >
      <p className="whitespace-pre-wrap break-words">{"text" in content ? content.text : "Unsupported message type"}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">{inbound ? "Customer" : "Sent"} · {dateTimeLabel(message.receivedAt)}</p>
    </div>
  );
}

function EventRow({ event }: { event: HistoryEvent }) {
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <p>{eventDescription(event)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{dateTimeLabel(event.createdAt)}</p>
    </div>
  );
}

function PreflightPanel({
  preflightResult,
  onRetry,
}: {
  preflightResult: PreflightResult;
  onRetry: () => void;
}) {
  if (!preflightResult.ok) {
    return (
      <Card>
        <CardHeader><CardTitle>Diagnostics could not load</CardTitle><CardDescription>{errorMessage(preflightResult.error)}</CardDescription></CardHeader>
        <CardContent><Button type="button" variant="secondary" onClick={onRetry}><RefreshCw />Retry</Button></CardContent>
      </Card>
    );
  }
  const p = preflightResult.resource;
  const axes: { label: string; status: string }[] = [
    { label: "Your capability", status: p.internalCapability.status },
    { label: "Channel connection", status: p.connection.status },
    { label: "Privacy carrier (D8)", status: p.d8Carrier.status },
    { label: "Consent stop", status: p.consentStop.status },
    { label: "Do not disturb", status: p.doNotDisturb.status },
    { label: "Provider refusal history", status: p.providerRefusal.status },
    { label: "Frequency policy", status: p.frequency.status },
    { label: "Exact-match approval", status: p.exactApproval.status },
    { label: "Send eligibility", status: p.sendEligibility.status },
  ];
  return (
    <Card>
      <CardHeader><CardTitle>Send-readiness diagnostics</CardTitle><CardDescription>What the server currently knows. Unavailable/unknown is expected — most of these axes aren&apos;t wired yet.</CardDescription></CardHeader>
      <CardContent className="grid gap-2">
        {axes.map((axis) => (
          <div key={axis.label} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm">
            <span>{axis.label}</span>
            <Badge variant={axis.status === "pass" ? "success" : axis.status === "block" ? "destructive" : "outline"}>{axis.status}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
