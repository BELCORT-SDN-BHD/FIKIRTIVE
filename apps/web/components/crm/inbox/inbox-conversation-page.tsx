"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { orgRolesAllow } from "@fikirtive/core/org-roles";
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
} from "@/lib/customer-inbox-ui-actions";
import type { getMemberDirectory, listChannelScopes } from "@/lib/customer-inbox-gateway";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  channelConnectionFrom,
  channelConnectionHeadline,
  type ChannelAccountsResult,
} from "@/lib/crm-channel-connection";
import { axisStatusPresentation, channelLabel } from "@/lib/crm-labels";
import {
  controlBadgePresentation,
  dateTimeLabel,
  errorMessage,
  eventDescription,
  isDenialErrorCode,
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
type DirectoryResult = Awaited<ReturnType<typeof getMemberDirectory>>;
type ScopesResult = Awaited<ReturnType<typeof listChannelScopes>>;
type DirectoryMember = Extract<DirectoryResult, { ok: true }>["resource"]["members"][number];

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
  initialDirectory,
  initialChannelScopes,
}: {
  conversationId: string;
  initialState: ConversationInitialState;
  initialDirectory: DirectoryResult;
  initialChannelScopes: ScopesResult;
}) {
  if (!initialState.conversation.ok) {
    if (isDenialErrorCode(initialState.conversation.error)) return <DetailUnavailable />;
    return (
      <DetailErrorState
        conversationId={conversationId}
        code={initialState.conversation.error}
        initialDirectory={initialDirectory}
        channelScopes={initialChannelScopes}
      />
    );
  }
  return (
    <ConversationWorkspace
      conversationId={conversationId}
      initialConversation={initialState.conversation.resource}
      initialHistory={initialState.history}
      initialPreflight={initialState.preflight}
      initialDirectory={initialDirectory}
      channelScopes={initialChannelScopes}
    />
  );
}

/** Spec §7.2 `error` row: the authority read (getConversation) failed with a code that
 *  isn't a denial — keep a generic page shell (nav + eyebrow, no contact-specific header
 *  since that data never loaded) and offer Retry with the stable error code visible.
 *  A successful retry re-fetches history/preflight alongside the conversation and mounts
 *  the real workspace, same as the initial server-side read would have. */
function DetailErrorState({
  conversationId,
  code,
  initialDirectory,
  channelScopes,
}: {
  conversationId: string;
  code: string;
  initialDirectory: DirectoryResult;
  channelScopes: ScopesResult;
}) {
  const [currentCode, setCurrentCode] = useState(code);
  const [retrying, setRetrying] = useState(false);
  const [loaded, setLoaded] = useState<{
    conversation: ConversationResource;
    history: HistoryResult;
    preflight: PreflightResult;
  } | null>(null);

  async function retry() {
    setRetrying(true);
    try {
      const [conv, hist, pre] = await Promise.all([
        getConversation({ conversationId }),
        getHistory({ conversationId }),
        getConversationPreflight({ conversationId }),
      ]);
      if (!conv.ok) {
        setCurrentCode(conv.error);
        return;
      }
      setLoaded({ conversation: conv.resource, history: hist, preflight: pre });
    } catch {
      // Transport failure, not a structured error code — keep showing the last known code.
    } finally {
      setRetrying(false);
    }
  }

  if (loaded) {
    return (
      <ConversationWorkspace
        conversationId={conversationId}
        initialConversation={loaded.conversation}
        initialHistory={loaded.history}
        initialPreflight={loaded.preflight}
        initialDirectory={initialDirectory}
        channelScopes={channelScopes}
      />
    );
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-6xl">
        <Link href="/crm/inbox" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" />Back to Inbox
        </Link>
        <header className="mt-4 border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM · Conversation</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">This conversation could not load</h1>
        </header>
        <section className="mt-6 rounded-[var(--radius-card)] border border-dashed border-destructive/40 bg-card px-6 py-14 text-center shadow-sm">
          <AlertCircle className="mx-auto size-8 text-destructive" />
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">{errorMessage(currentCode)}</p>
          <p className="mt-2 text-xs font-mono text-muted-foreground">Error code: {currentCode}</p>
          <Button className="mt-5" type="button" variant="secondary" onClick={() => void retry()} disabled={retrying}>
            {retrying ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Retry
          </Button>
        </section>
      </div>
    </main>
  );
}

function ConversationWorkspace({
  conversationId,
  initialConversation,
  initialHistory,
  initialPreflight,
  initialDirectory,
  channelScopes,
}: {
  conversationId: string;
  initialConversation: ConversationResource;
  initialHistory: HistoryResult;
  initialPreflight: PreflightResult;
  initialDirectory: DirectoryResult;
  channelScopes: ScopesResult;
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

  // Fix 4 (poll/mutation race guard): each refresh() call captures a monotonically
  // increasing sequence number when it starts. If a newer refresh has since started by the
  // time this call's responses land — regardless of which round-trip actually finishes
  // first — this call's results are discarded instead of applied, so a slow poll response
  // can never revert state a faster, more recent mutation-triggered refresh already set.
  const refreshSeqRef = useRef(0);

  const refresh = useCallback(async (): Promise<ConversationResource | null> => {
    const seq = (refreshSeqRef.current += 1);
    try {
      const [conv, hist, pre] = await Promise.all([
        getConversation({ conversationId }),
        getHistory({ conversationId }),
        getConversationPreflight({ conversationId }),
      ]);
      if (seq !== refreshSeqRef.current) return null;
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
      if (seq === refreshSeqRef.current) setRefreshFailed(true);
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

  async function doSaveDraft() {
    // Fix 1: pin the CAS base to the revision that was current when THIS edit started
    // (draftRevisionAtEditStartRef), not `conversation.draft?.revision`. The latter tracks
    // whatever the 20s poll last saw, which can silently advance past a concurrent
    // teammate's committed draft while the user is still typing — using it here would make
    // the server's CAS check pass against that fresher revision and overwrite the
    // teammate's change instead of failing closed with CAS_CONFLICT.
    const draftBaseRevision = draftRevisionAtEditStartRef.current;
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
  const conversationUnassigned = conversation.assigneeMembership === null;
  // 判官 r3 P2 — this gate is the server's `requireMemberAssignment` rule (draft, status,
  // resume, take over). It is NOT the rule for claiming or handing off a conversation, which
  // assignConversation/handOffConversation judge separately, so the assignment card below
  // carries its own per-action checks instead of riding this one.
  const actionsDisabledReason =
    capabilityStatus === "block"
      ? conversationUnassigned
        ? "No one has taken this conversation yet. Take it below, and then you can draft a reply."
        : "You can view this conversation, but only the assigned teammate can act on it right now."
      : !preflightOk
        ? "Replying and status changes are disabled until capability can be confirmed — diagnostics could not load."
        : null;
  // Widened to `string`: the service currently types connection.status as the single
  // literal "unknown" (no provider exists yet), which would make a "pass" comparison
  // a compile error. The check stays honest/future-proof for whenever a connection
  // axis can report "pass".
  const connectionStatus: string = preflightOk ? preflightResult.resource.connection.status : "unknown";
  // #727 判官 r2 P1-2 — the banner below used to read `connectionStatus !== "pass"` and print
  // "Not connected yet". The service hard-codes this axis to `unknown`
  // (`stored_evidence_unavailable`), so the page was turning "we do not know" into a statement of
  // fact — the same failure #727 fixes on the list pages, on a page that was not even covered by
  // the guard. Workspace connection now comes from the one authority; this axis says only what it
  // is, which is that THIS conversation's own provider link is unconfirmed.
  const connection = channelConnectionFrom(channelScopes as ChannelAccountsResult);
  const conversationLinkConfirmed = connectionStatus === "pass";
  // Spec §7.3: the three freshness timestamps are server-supplied and returned separately —
  // never merged into one synthetic "last synced" value. A missing value renders as an
  // honest "no X yet", not a fabricated fallback date.
  const freshness = preflightOk ? preflightResult.resource.freshness : null;
  const control = controlBadgePresentation(conversation.automationState);
  const status = statusPresentation(conversation.status);
  const identity = conversation.contactIdentity;
  const assignee = conversation.assigneeMembership;

  // #725 — the same read-only member directory the broadcast workbench already reads (#27).
  // A membership the directory doesn't contain is never given a fabricated name: it is
  // described as a member who is no longer listed, and the internal id stays off screen.
  const directory = initialDirectory.ok ? initialDirectory.resource : null;
  const members: DirectoryMember[] = directory?.members ?? [];
  const memberName = (membershipId: string | null | undefined): string | null =>
    members.find((member) => member.membershipId === membershipId)?.displayName ?? null;
  const assigneeLabel = assignee
    ? `Assigned to ${memberName(assignee.id) ?? "a team member who is no longer listed"} · ${assignee.role}`
    : "Unassigned";
  // The server accepts an assignment or hand-off target only if that membership can reply in
  // the Inbox — customer-inbox-service.ts requireAssignableMembership refuses anyone else with
  // RESOURCE_NOT_FOUND. Offering a creator or approver here would invite the merchant to pick
  // someone the assignment is guaranteed to reject. Same capability function as the server, so
  // there is no second copy of the rule to drift.
  // The server also refuses a target that already holds the conversation (assignConversation and
  // handOffConversation both fail INVALID_ARGUMENT when target === current assignee), so the
  // person already holding it is not an option to hand it to.
  const assignableMembers = members.filter(
    (member) => orgRolesAllow(member.roles, "inbox.reply") && member.membershipId !== assignee?.id,
  );
  const directoryFailed = !initialDirectory.ok;

  // 判官 r2 P2 — one shared list of legal TARGETS, but each action carries its own actor rule,
  // because the server's rules for the two differ (customer-inbox-service.ts assignConversation
  // vs handOffConversation). A member without inbox.manage who is already the assignee may
  // legitimately hand the conversation on, yet Assign would be refused for the same person and
  // the same target. Every check below calls the same `orgRolesAllow` the server calls; no
  // second copy of the rule lives here.
  const selfRoles = directory?.self.roles ?? [];
  const selfMembershipId = directory?.self.membershipId ?? null;
  const canManageInbox = orgRolesAllow(selfRoles, "inbox.manage");
  const canReply = orgRolesAllow(selfRoles, "inbox.reply");
  const isAssignee = assignee !== null && assignee.id === selfMembershipId;
  const selectedTarget = targetMembershipId.trim();
  // assignConversation: reply capability, and without inbox.manage only claiming an unassigned
  // conversation for yourself.
  const canAssignSelected =
    canReply && selectedTarget !== "" && selectedTarget !== assignee?.id &&
    (canManageInbox || (selectedTarget === selfMembershipId && assignee === null));
  // The same call with a null target is how unassigning happens, and it is manage-only.
  const canUnassign = canReply && canManageInbox && assignee !== null;
  // handOffConversation: reply capability, and without inbox.manage you must be the one holding
  // the conversation right now.
  const canHandOffSelected =
    canReply && selectedTarget !== "" && selectedTarget !== assignee?.id && (canManageInbox || isAssignee);
  const assignmentRuleNote = canManageInbox
    ? null
    : assignee === null
      ? "You can take this conversation yourself. Only a workspace owner or admin can assign it to someone else."
      : isAssignee
        ? "You are holding this conversation, so you can hand it to a teammate. Only a workspace owner or admin can reassign or unassign it."
        : "A teammate is holding this conversation. Only a workspace owner or admin can reassign it.";

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-6xl">
        <Link href="/crm/inbox" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" />Back to Inbox
        </Link>

        <header className="mt-4 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM · Conversation</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{identity.contact.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{channelLabel(identity.channel)} · {identity.externalId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            <Badge variant={control.variant}>{control.label}</Badge>
          </div>
        </header>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />Last message: {conversation.lastMessageAt ? dateTimeLabel(conversation.lastMessageAt) : "No messages yet"}</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />Last provider event: {freshness ? (freshness.lastProviderEventAt ? dateTimeLabel(freshness.lastProviderEventAt) : "No provider events yet") : "Unknown — diagnostics could not load"}</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />Connection health check: {freshness ? (freshness.lastHealthCheckedAt ? dateTimeLabel(freshness.lastHealthCheckedAt) : "No health check has run yet") : "Unknown — diagnostics could not load"}</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />This screen loaded: {freshness ? dateTimeLabel(freshness.lastDataLoadedAt) : "Unknown — diagnostics could not load"}</span>
        </div>

        {connection.kind !== "connected" || !conversationLinkConfirmed ? (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
            <Unplug className="mt-0.5 size-4 shrink-0" />
            <span>
              {channelConnectionHeadline(connection)}
              {conversationLinkConfirmed
                ? ""
                : " This conversation's own provider link is not confirmed, so nothing here reflects live provider traffic."}
            </span>
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
            <HistoryPanel historyResult={historyResult} onRetry={refresh} resolveMemberName={memberName} />

            <Card>
              <CardHeader><CardTitle>Reply draft</CardTitle><CardDescription>Internal only — see the note below.</CardDescription></CardHeader>
              <CardContent>
                <Composer
                  draft={conversation.draft}
                  draftText={draftText}
                  draftDirty={draftDirty}
                  actionsDisabled={actionsDisabled}
                  busy={busy}
                  saveDisabled={conflictNotice !== null}
                  onDraftChange={onDraftChange}
                  onSave={doSaveDraft}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid content-start gap-5">
            <Card>
              <CardHeader><CardTitle>Assignment &amp; status</CardTitle><CardDescription>Pick a teammate by name. Assigning pauses nothing on its own.</CardDescription></CardHeader>
              <CardContent className="grid gap-4">
                <div className="rounded-lg bg-muted/45 p-3 text-sm">
                  {assigneeLabel}
                </div>
                <div className="grid gap-2">
                  {directoryFailed ? (
                    <p className="text-sm text-muted-foreground">
                      The team-member list could not be loaded, so this conversation cannot be assigned right now.
                    </p>
                  ) : assignableMembers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No teammate in this workspace can take a conversation yet. Only teammates who can reply in the
                      Inbox can be assigned one.
                    </p>
                  ) : (
                    <>
                      <Select value={targetMembershipId} onValueChange={setTargetMembershipId} disabled={!canReply}>
                        <SelectTrigger className="w-full" aria-label="Assign to">
                          <SelectValue placeholder="Select a teammate…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {assignableMembers.map((member) => (
                              <SelectItem key={member.membershipId} value={member.membershipId}>
                                {member.displayName}{member.isSelf ? " (you)" : ""} · {member.role}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Only teammates who can reply in the Inbox are listed.</p>
                    </>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" disabled={busy !== null || !canAssignSelected} onClick={() => void doAssign(selectedTarget)}>
                      {busy === "assign" ? <LoaderCircle className="animate-spin" /> : <UserPlus />}Assign
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={busy !== null || !canUnassign} onClick={() => void doAssign(null)}>
                      {busy === "assign" ? <LoaderCircle className="animate-spin" /> : <UserMinus />}Unassign
                    </Button>
                  </div>
                  {assignmentRuleNote ? <p className="text-xs text-muted-foreground">{assignmentRuleNote}</p> : null}
                </div>
                <form className="grid gap-2 border-t border-border pt-3" onSubmit={doHandOff}>
                  <label className="text-xs font-semibold text-muted-foreground">Hand off with a note</label>
                  <Input value={handoffNote} onChange={(event) => setHandoffNote(event.target.value)} maxLength={1000} placeholder="Note for the next teammate (optional)" aria-label="Hand-off note" disabled={!canReply} />
                  <Button type="submit" size="sm" variant="secondary" disabled={busy !== null || !canHandOffSelected}>
                    {busy === "handoff" ? <LoaderCircle className="animate-spin" /> : <UserCheck />}Hand off to the selected teammate
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
                  <p>{channelLabel(identity.channel)} · {identity.externalId}</p>
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

/** #791-2: the "Otto is currently handling this conversation / Take over" branch is gone.
 *  It could only render when automationState was `otto_active`, which nothing in the product
 *  ever writes — so the composer promised an assistant that never answered a single customer.
 *  Every conversation is drafted by a person, which is what this composer now says. */
function Composer({
  draft,
  draftText,
  draftDirty,
  actionsDisabled,
  busy,
  saveDisabled,
  onDraftChange,
  onSave,
}: {
  draft: ConversationResource["draft"];
  draftText: string;
  draftDirty: boolean;
  actionsDisabled: boolean;
  busy: string | null;
  // True while a conflictNotice (stale/committed-elsewhere draft) is showing — Save must
  // stay disabled until the user reloads, matching the "never silently overwrite" guarantee.
  saveDisabled: boolean;
  onDraftChange: (text: string) => void;
  onSave: () => void;
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

  return (
    <div className="grid gap-3">
      {draft && draft.authorKind !== "merchant_member" ? (
        <Badge variant="warning" className="w-fit">Otto-authored draft — not reviewed or sent</Badge>
      ) : null}
      <Textarea value={draftText} onChange={(event) => onDraftChange(event.target.value)} maxLength={4096} rows={6} placeholder="Write an internal reply draft…" aria-label="Reply draft" />
      <div className="flex items-center gap-3">
        <Button type="button" onClick={onSave} disabled={busy !== null || !draftDirty || saveDisabled}>
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
  resolveMemberName,
}: {
  historyResult: HistoryResult;
  onRetry: () => void;
  resolveMemberName: (membershipId: string) => string | null;
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
            events.map((event) => <EventRow key={event.id} event={event} resolveMemberName={resolveMemberName} />)
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
        inbound ? "self-start border-border bg-muted/45" : "self-end border-primary bg-primary text-primary-foreground"
      }`}
    >
      <p className="whitespace-pre-wrap break-words">{"text" in content ? content.text : "Unsupported message type"}</p>
      <p className={`mt-1.5 text-xs ${inbound ? "text-muted-foreground" : "text-primary-foreground/70"}`}>{inbound ? "Customer" : "Sent"} · {dateTimeLabel(message.receivedAt)}</p>
    </div>
  );
}

function EventRow({
  event,
  resolveMemberName,
}: {
  event: HistoryEvent;
  resolveMemberName: (membershipId: string) => string | null;
}) {
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <p>{eventDescription(event, resolveMemberName)}</p>
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
    // #728 — the row used to carry "(D8)", the internal number for the privacy-carrier design.
    // It told the merchant nothing they could look up; the axis name alone is the honest label.
    { label: "Privacy carrier", status: p.d8Carrier.status },
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
        {axes.map((axis) => {
          // #728 — the same axis vocabulary the broadcast workbench renders, from the same
          // map. This panel used to print the stored value (`risk`, `unavailable`) while the
          // workbench said "At risk" about the identical fact.
          const presentation = axisStatusPresentation(axis.status);
          return (
            <div key={axis.label} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm">
              <span>{axis.label}</span>
              <Badge variant={presentation.variant}>{presentation.label}</Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
