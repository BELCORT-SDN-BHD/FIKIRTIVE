"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { buildSegment, deleteSegment, listSegments, previewSegment } from "@/lib/segment-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";

type ListResult = Awaited<ReturnType<typeof listSegments>>;
type ListSuccess = Extract<ListResult, { ok: true }>;
type SegmentItem = ListSuccess["segments"][number];
type PreviewResult = Awaited<ReturnType<typeof previewSegment>>;
type PreviewSuccess = Extract<PreviewResult, { ok: true }>;
type SegmentLeafRule =
  | { kind: "lifetime_spend"; comparison: "at_least" | "more_than"; amountMyr: number }
  | { kind: "last_order_recency"; withinDays: number }
  | { kind: "channel"; channel: string }
  | { kind: "tag"; tag: string }
  | { kind: "contactability"; value: "contactable" | "not_contactable" };
type SegmentRuleGroup = {
  match: "all" | "any";
  rules: SegmentLeafRule[];
  /** #758 — the merchant's optional exclusion, off unless he turns it on. */
  excludeReportedOptOut?: boolean;
};
type RuleKind = SegmentLeafRule["kind"];

type DraftRule =
  | { id: number; kind: "lifetime_spend"; comparison: "at_least" | "more_than"; amountMyr: string }
  | { id: number; kind: "last_order_recency"; withinDays: string }
  | { id: number; kind: "channel"; channel: string }
  | { id: number; kind: "tag"; tag: string }
  | { id: number; kind: "contactability"; value: "contactable" | "not_contactable" };

/**
 * #716 — the one sentence this page never said. A merchant who records an opt-out on a contact,
 * or imports one in a CSV, has to be told here what that record does and does not do.
 */
const KNOWN_OPT_OUT_RULE_NOTE =
  "Known opt-out means the customer opted out through their own channel. An opt-out you recorded yourself keeps the contact in the list, marked reported opt-out — open the contact to see its consent history.";

/**
 * #758 — the optional tightening the Founder ruled for on top of #496 option B. It is the
 * merchant's own choice, off by default, and the copy says whose record it is: turning it on
 * excludes contacts on evidence the customer never gave, which is the merchant's call to make
 * and nobody else's.
 */
const REPORTED_OPT_OUT_EXCLUSION_LABEL = "Also exclude opt-outs I recorded myself";
/**
 * r2 判官 P1 — the last clause used to promise that a customer who opted out through her own
 * channel is "out either way". A merchant may build a segment on known opt-out, and there she is
 * selected on purpose, so the sentence was false on a legal segment — the exact overclaim #768
 * bans. Every clause here now states only what this screen does: what it changes, and what it
 * leaves alone. `segment-reported-optout-exclusion.test.ts` fences the claim, not the wording.
 */
const REPORTED_OPT_OUT_EXCLUSION_NOTE =
  "Off by default. An opt-out you or a CSV import recorded is not confirmed by the customer, so while this is off it removes nobody from this segment. Turn it on and this segment leaves those contacts out of its count, its preview, and any broadcast built from it. Nothing else changes: what the consent record decides about a contact stays exactly as it is.";

type DraftGroup = { match: "all" | "any"; rules: DraftRule[]; excludeReportedOptOut: boolean };
type SettledPreview = { key: string; result: PreviewSuccess | null; error: string | null };
type DraftPreviewRequest = SettledPreview & { status: "loading" | "settled" };
type RetryFence = {
  operation: "create" | "update";
  segmentId: string;
  segmentProof?: string;
  name: string;
  rulesKey: string;
};

const RULE_LABELS: Record<RuleKind, string> = {
  lifetime_spend: "Lifetime spend",
  last_order_recency: "Last order recency",
  channel: "Channel",
  tag: "Tag",
  contactability: "Consent selection",
};

function newDraftRule(kind: RuleKind, id: number): DraftRule {
  switch (kind) {
    case "lifetime_spend":
      return { id, kind, comparison: "at_least", amountMyr: "500" };
    case "last_order_recency":
      return { id, kind, withinDays: "30" };
    case "channel":
      return { id, kind, channel: "whatsapp" };
    case "tag":
      return { id, kind, tag: "vip" };
    case "contactability":
      return { id, kind, value: "contactable" };
  }
}

function initialDraft(): DraftGroup {
  // Never on by default: the product does not decide for the merchant who is worth keeping.
  return { match: "all", rules: [newDraftRule("contactability", 1)], excludeReportedOptOut: false };
}

function draftFromRules(group: SegmentRuleGroup): DraftGroup {
  return {
    match: group.match,
    excludeReportedOptOut: group.excludeReportedOptOut === true,
    rules: group.rules.map((rule, index): DraftRule => {
      const id = index + 1;
      switch (rule.kind) {
        case "lifetime_spend":
          return { ...rule, id, amountMyr: String(rule.amountMyr) };
        case "last_order_recency":
          return { ...rule, id, withinDays: String(rule.withinDays) };
        default:
          return { ...rule, id };
      }
    }),
  };
}

function normalizeRuleText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function compileDraft(draft: DraftGroup): SegmentRuleGroup | null {
  if (draft.rules.length === 0) return null;
  const rules = draft.rules.map((rule): SegmentLeafRule | null => {
    switch (rule.kind) {
      case "lifetime_spend": {
        const amountMyr = rule.amountMyr.trim() === "" ? Number.NaN : Number(rule.amountMyr);
        return Number.isFinite(amountMyr) && amountMyr >= 0 && Number(amountMyr.toFixed(2)) === amountMyr
          ? { kind: rule.kind, comparison: rule.comparison, amountMyr }
          : null;
      }
      case "last_order_recency": {
        const withinDays = rule.withinDays.trim() === "" ? Number.NaN : Number(rule.withinDays);
        return Number.isSafeInteger(withinDays) && withinDays > 0 ? { kind: rule.kind, withinDays } : null;
      }
      case "channel": {
        const channel = normalizeRuleText(rule.channel);
        return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(channel) ? { kind: rule.kind, channel } : null;
      }
      case "tag": {
        const tag = normalizeRuleText(rule.tag);
        return tag.length > 0 && tag.length <= 80 && !/[\u0000-\u001f\u007f]/.test(tag)
          ? { kind: rule.kind, tag }
          : null;
      }
      case "contactability":
        return { kind: rule.kind, value: rule.value };
    }
  });
  if (!rules.every((rule): rule is SegmentLeafRule => rule !== null)) return null;
  // Canonical shape: the key is sent only when the option is on, so a segment saved with it off
  // is byte-for-byte the segment the merchant would have saved before this option existed.
  return draft.excludeReportedOptOut
    ? { match: draft.match, rules, excludeReportedOptOut: true }
    : { match: draft.match, rules };
}

function isSuccess<T extends { error: string } | { ok: true }>(result: T): result is Extract<T, { ok: true }> {
  return "ok" in result;
}

function DeniedState({ message }: { message: string }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Customer segments
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This workspace is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Button asChild className="mt-6" variant="secondary">
          <Link href="/otto">
            <ArrowLeft />
            Return to Otto
          </Link>
        </Button>
      </section>
    </main>
  );
}

export default function SegmentsPage({ initialState }: { initialState: ListResult }) {
  if (!isSuccess(initialState)) return <DeniedState message={initialState.error} />;
  return <SegmentsWorkspace initialState={initialState} />;
}

function SegmentsWorkspace({ initialState }: { initialState: ListSuccess }) {
  const [segments, setSegments] = useState<SegmentItem[]>(initialState.segments);
  const [totalContactCount, setTotalContactCount] = useState(initialState.totalContactCount);
  const [selectedId, setSelectedId] = useState<string | null>(initialState.segments[0]?.id ?? null);
  const [selectedRequest, setSelectedRequest] = useState<SettledPreview | null>(null);
  const [selectedRetry, setSelectedRetry] = useState(0);
  const selectedSequence = useRef(0);

  const [name, setName] = useState("");
  const [draft, setDraft] = useState<DraftGroup>(initialDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const nextRuleId = useRef(2);
  const [nextSegmentId, setNextSegmentId] = useState(initialState.nextSegmentId);
  const [nextSegmentProof, setNextSegmentProof] = useState(initialState.nextSegmentProof);
  const [previewRequest, setPreviewRequest] = useState<DraftPreviewRequest | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const previewSequence = useRef(0);
  const [saving, setSaving] = useState(false);
  const [retryFence, setRetryFence] = useState<RetryFence | null>(null);
  const [refreshingDraft, setRefreshingDraft] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SegmentItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteSubmittingRef = useRef(false);

  const selected = segments.find((segment) => segment.id === selectedId) ?? null;
  const selectedRulesKey = selected?.rules ? JSON.stringify(selected.rules) : null;
  const selectedRequestKey = selectedRulesKey ? `${selectedRetry}:${selectedId}:${selectedRulesKey}` : null;
  const compiledRules = useMemo(() => compileDraft(draft), [draft]);
  const rulesKey = compiledRules ? JSON.stringify(compiledRules) : null;
  const selectedPreview = selectedRequest?.key === selectedRequestKey ? selectedRequest.result : null;
  const selectedError = selectedRequest?.key === selectedRequestKey ? selectedRequest.error : null;
  const selectedLoading = Boolean(selectedRequestKey && selectedRequest?.key !== selectedRequestKey);
  const preview = previewRequest?.key === rulesKey ? previewRequest.result : null;
  const previewKey = preview ? rulesKey : null;
  const previewError = previewRequest?.key === rulesKey ? previewRequest.error : null;
  const previewLoading = Boolean(
    rulesKey && previewRequest?.key === rulesKey && previewRequest.status === "loading",
  );

  useEffect(() => {
    const sequence = ++selectedSequence.current;
    if (!selectedRulesKey || !selectedRequestKey) return;
    void previewSegment(JSON.parse(selectedRulesKey) as SegmentRuleGroup)
      .then((result) => {
        if (sequence !== selectedSequence.current) return;
        setSelectedRequest({
          key: selectedRequestKey,
          result: isSuccess(result) ? result : null,
          error: isSuccess(result) ? null : result.error,
        });
      })
      .catch(() => {
        if (sequence !== selectedSequence.current) return;
        setSelectedRequest({
          key: selectedRequestKey,
          result: null,
          error: "The contact preview could not load. Please retry.",
        });
      });
  }, [selectedRequestKey, selectedRulesKey]);

  useEffect(() => {
    const sequence = ++previewSequence.current;
    if (!rulesKey) return;

    const timer = window.setTimeout(() => {
      if (sequence !== previewSequence.current) return;
      setPreviewRequest({ key: rulesKey, status: "loading", result: null, error: null });
      void previewSegment(JSON.parse(rulesKey) as SegmentRuleGroup)
        .then((result) => {
          if (sequence !== previewSequence.current) return;
          setPreviewRequest({
            key: rulesKey,
            status: "settled",
            result: isSuccess(result) ? result : null,
            error: isSuccess(result) ? null : result.error,
          });
        })
        .catch(() => {
          if (sequence !== previewSequence.current) return;
          setPreviewRequest({
            key: rulesKey,
            status: "settled",
            result: null,
            error: "The live preview could not load. Please retry.",
          });
        });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [previewRetry, rulesKey]);

  useEffect(() => {
    let stopped = false;
    let syncing = false;
    async function syncSegments() {
      if (stopped || syncing || document.visibilityState === "hidden") return;
      syncing = true;
      try {
        const result = await listSegments();
        if (!stopped && isSuccess(result)) {
          setSegments(result.segments);
          setTotalContactCount(result.totalContactCount);
        }
      } catch {
        // Keep the last truthful view; the next bounded poll or window focus retries.
      } finally {
        syncing = false;
      }
    }

    const timer = window.setInterval(syncSegments, 5_000);
    window.addEventListener("focus", syncSegments);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", syncSegments);
    };
  }, []);

  function updateRule(index: number, updated: DraftRule) {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule, ruleIndex) => (ruleIndex === index ? updated : rule)),
    }));
    setSaveError(null);
    setSavedNotice(null);
  }

  function replaceRuleKind(index: number, kind: RuleKind) {
    const id = draft.rules[index]?.id ?? nextRuleId.current++;
    updateRule(index, newDraftRule(kind, id));
  }

  function resetEditor() {
    setEditingId(null);
    setName("");
    setDraft(initialDraft());
    nextRuleId.current = 2;
    setRetryFence(null);
    setSaveError(null);
  }

  function editSelectedSegment() {
    if (!selected?.rules || selected.status !== "ready") return;
    setEditingId(selected.id);
    setName(selected.name);
    setDraft(draftFromRules(selected.rules));
    nextRuleId.current = selected.rules.rules.length + 1;
    setRetryFence(null);
    setSaveError(null);
    setSavedNotice(null);
  }

  async function saveCurrentSegment() {
    if (!compiledRules || !rulesKey || !preview || previewKey !== rulesKey || !name.trim()) return;
    const attempt: RetryFence = retryFence ?? (editingId
      ? {
          operation: "update",
          segmentId: editingId,
          name: name.trim(),
          rulesKey,
        }
      : {
          operation: "create",
          segmentId: nextSegmentId,
          segmentProof: nextSegmentProof,
          name: name.trim(),
          rulesKey,
        });
    setSaving(true);
    setSaveError(null);
    setSavedNotice(null);
    try {
      const result = await buildSegment({
        operation: attempt.operation,
        segmentId: attempt.segmentId,
        segmentProof: attempt.segmentProof,
        name: attempt.name,
        rules: JSON.parse(attempt.rulesKey) as SegmentRuleGroup,
      });
      if (!isSuccess(result)) {
        setRetryFence(attempt);
        setSaveError(result.error);
        return;
      }

      const saved: SegmentItem = {
        ...result.segment,
        status: "ready",
        matchedCount: preview.matchedCount,
        contactableCount: preview.contactableCount,
        knownOptOutCount: preview.knownOptOutCount,
        excludedByConsentCount: preview.excludedByConsentCount,
        unresolvedLegacyOptOutCount: preview.unresolvedLegacyOptOutCount,
        reportedOptOutCount: preview.reportedOptOutCount,
        excludedByReportedOptOutCount: preview.excludedByReportedOptOutCount,
      };
      setSegments((current) =>
        attempt.operation === "update"
          ? current.map((segment) => (segment.id === saved.id ? saved : segment))
          : [saved, ...current.filter((segment) => segment.id !== saved.id)],
      );
      setSelectedId(saved.id);
      if ("nextSegmentId" in result) {
        setNextSegmentId(result.nextSegmentId);
        setNextSegmentProof(result.nextSegmentProof);
      }
      resetEditor();
      setSavedNotice(`“${saved.name}” is ${attempt.operation === "update" ? "updated" : "saved"}.`);
    } catch {
      setRetryFence(attempt);
      setSaveError("The save request could not finish. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  /** #718 — the delete the page never had. Soft delete on the server; the list here is only
   *  re-rendered after the server confirms, so a failure never shows a segment as gone. */
  async function confirmDelete() {
    if (!pendingDelete || deleteSubmittingRef.current) return;
    deleteSubmittingRef.current = true;
    const target = pendingDelete;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteSegment({ segmentId: target.id });
      if (!isSuccess(result)) {
        setDeleteError(result.error);
        return;
      }
      setSegments((current) => {
        const remaining = current.filter((segment) => segment.id !== target.id);
        setSelectedId((currentId) => (currentId === target.id ? remaining[0]?.id ?? null : currentId));
        return remaining;
      });
      if (editingId === target.id) resetEditor();
      setPendingDelete(null);
      setSavedNotice(`“${target.name}” is deleted.`);
    } catch {
      setDeleteError("The delete request could not finish. Please retry.");
    } finally {
      deleteSubmittingRef.current = false;
      setDeleting(false);
    }
  }

  async function startFreshDraft() {
    if (!retryFence) return;
    setRefreshingDraft(true);
    setSaveError(null);
    try {
      const result = await listSegments();
      if (!isSuccess(result)) {
        setSaveError(result.error);
        return;
      }

      const recovered = result.segments.find((segment) => segment.id === retryFence.segmentId);
      setSegments(result.segments);
      setTotalContactCount(result.totalContactCount);
      setNextSegmentId(result.nextSegmentId);
      setNextSegmentProof(result.nextSegmentProof);
      setRetryFence(null);
      if (retryFence.operation === "update" && recovered?.rules) {
        setEditingId(recovered.id);
        setSelectedId(recovered.id);
        setName(recovered.name);
        setDraft(draftFromRules(recovered.rules));
        nextRuleId.current = recovered.rules.rules.length + 1;
        setSavedNotice(`Latest saved version of “${recovered.name}” loaded.`);
      } else if (recovered) {
        setSelectedId(recovered.id);
        resetEditor();
        setSavedNotice(`“${recovered.name}” is saved.`);
      } else {
        setSavedNotice("A fresh draft id is ready. Your name and rules are unchanged.");
      }
    } catch {
      setSaveError("A fresh draft could not be issued. Please retry.");
    } finally {
      setRefreshingDraft(false);
    }
  }

  const draftLocked = saving || refreshingDraft || retryFence !== null;
  const saveReady = Boolean(
    name.trim() && compiledRules && preview && previewKey === rulesKey && !saving && !refreshingDraft,
  );

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/otto"
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Return to Otto
            </Link>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Customer segments</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Build one-level, deterministic rules and see exactly who matches before you save.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
              <p className="text-xs text-muted-foreground">Contacts</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{totalContactCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
              <p className="text-xs text-muted-foreground">Saved</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{segments.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
              <p className="text-xs text-muted-foreground">Facts connected</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">3 / 5</p>
            </div>
          </div>
        </header>

        <div className="mt-6 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
          Last order recency and tags are not connected yet. Rules using either fact stay visible and
          show zero matches instead of guessing from last seen activity.
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
          <Card className="min-w-0 p-0">
            <CardHeader className="border-b border-border p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Saved segments</CardTitle>
                  <CardDescription className="mt-1">Live counts are recalculated from connected facts.</CardDescription>
                </div>
                <Badge variant="outline">Custom only</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              {segments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-5 py-9 text-center">
                  <Users className="mx-auto size-6 text-muted-foreground" />
                  <h2 className="mt-3 text-sm font-semibold">No saved segments yet</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Build your first rule group on this page. Hot right now, Win-back, and VIP presets
                    are not connected in this slice.
                  </p>
                </div>
              ) : (
                <div className="grid gap-2">
                  {segments.map((segment) => {
                    const active = segment.id === selectedId;
                    return (
                      <Button
                        key={segment.id}
                        type="button"
                        variant={active ? "secondary" : "ghost"}
                        aria-pressed={active}
                        onClick={() => setSelectedId(segment.id)}
                        // #717 — the width constraint is load-bearing: without it the button
                        // grows to whatever the name is, the inner `truncate` never bites, and
                        // one long name pushes the whole 375px page into a permanent sideways
                        // scroll. Keeps old over-long rows harmless too.
                        className="h-auto min-h-16 w-full min-w-0 max-w-full justify-start whitespace-normal rounded-xl px-4 py-3 text-left shadow-none active:scale-[0.99]"
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{segment.name}</span>
                            <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {segment.phrase}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-lg font-semibold tabular-nums">{segment.matchedCount}</span>
                            <span className="text-[11px] text-muted-foreground">matched</span>
                          </span>
                        </span>
                      </Button>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 rounded-xl bg-muted/60 px-4 py-3 text-xs leading-5 text-muted-foreground">
                Built-in Hot right now, Win-back, and VIP segments are not built yet. No placeholder
                rows are counted as real segments.
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{selected ? selected.name : "Segment contacts"}</CardTitle>
                  <CardDescription className="mt-1">
                    {selected ? selected.phrase : "Select a saved segment to inspect its current matches."}
                  </CardDescription>
                </div>
                {selected ? (
                  <div className="flex shrink-0 gap-2">
                    {selected.status === "ready" ? (
                      <Button type="button" size="sm" variant="secondary" disabled={draftLocked} onClick={editSelectedSegment}>
                        Edit segment
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={draftLocked || deleting}
                      onClick={() => { setDeleteError(null); setPendingDelete(selected); }}
                    >
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {!selected ? (
                <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
                  Select a saved segment to see the connected contact preview.
                </div>
              ) : selected.status === "unavailable" ? (
                <div className="rounded-xl bg-error-soft px-4 py-4 text-sm text-error-soft-foreground">
                  These stored rules are unavailable. They match zero contacts until corrected.
                </div>
              ) : selectedLoading ? (
                <div className="grid gap-3" aria-live="polite">
                  <div className="h-14 animate-pulse rounded-xl bg-muted" />
                  <div className="h-14 animate-pulse rounded-xl bg-muted" />
                  <span className="sr-only">Calculating segment contacts</span>
                </div>
              ) : selectedError ? (
                <div className="rounded-xl border border-destructive/25 bg-error-soft p-4 text-sm text-error-soft-foreground">
                  <p>{selectedError}</p>
                  <Button
                    type="button"
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelectedRetry((value) => value + 1)}
                  >
                    <RefreshCw />
                    Retry preview
                  </Button>
                </div>
              ) : selectedPreview ? (
                <ContactPreview preview={selectedPreview} />
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="mt-5">
          <CardHeader className="border-b border-border pb-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {editingId ? "Edit segment" : "New segment"}
                </p>
                <CardTitle className="mt-2">{editingId ? "Update this rule group" : "Build a rule group"}</CardTitle>
                <CardDescription className="mt-1">
                  Choose All or Any. Nested groups are intentionally not supported.
                </CardDescription>
              </div>
              <Select
                value={draft.match}
                disabled={draftLocked}
                onValueChange={(value) => {
                  setDraft((current) => ({ ...current, match: value as "all" | "any" }));
                  setSaveError(null);
                }}
              >
                <SelectTrigger className="w-full sm:w-44" aria-label="Rule matching mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Match all rules</SelectItem>
                  <SelectItem value="any">Match any rule</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          <CardContent className="grid gap-6 pt-2 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="min-w-0">
              <fieldset disabled={draftLocked} className="min-w-0 border-0 p-0">
                <div className="grid gap-3">
                  {draft.rules.map((rule, index) => (
                    <RuleEditor
                      key={rule.id}
                      rule={rule}
                      index={index}
                      onChange={(updated) => updateRule(index, updated)}
                      onKindChange={(kind) => replaceRuleKind(index, kind)}
                      onRemove={() => {
                        setDraft((current) => ({
                          ...current,
                          rules: current.rules.filter((_, ruleIndex) => ruleIndex !== index),
                        }));
                        setSaveError(null);
                      }}
                    />
                  ))}
                </div>
                <Button
                  type="button"
                  className="mt-3"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const id = nextRuleId.current++;
                    setDraft((current) => ({
                      ...current,
                      rules: [...current.rules, newDraftRule("contactability", id)],
                    }));
                    setSaveError(null);
                  }}
                >
                  <Plus />
                  Add rule
                </Button>
                {!compiledRules ? (
                  <p className="mt-3 text-sm text-destructive" role="alert">
                    Add at least one complete rule. Days must be positive whole numbers; spend must be zero or more.
                    Spend supports up to two decimal places.
                  </p>
                ) : null}

                {/* #758 — one optional tightening, outside the rule list because it is not a
                    rule: it never selects anyone, it only removes people the rules selected. */}
                <div className="mt-5 rounded-xl border border-border bg-card p-3 shadow-xs sm:p-4">
                  <div className="flex items-start justify-between gap-4">
                    <label htmlFor="segment-exclude-reported-opt-out" className="text-sm font-semibold">
                      {REPORTED_OPT_OUT_EXCLUSION_LABEL}
                    </label>
                    <Switch
                      id="segment-exclude-reported-opt-out"
                      aria-label={REPORTED_OPT_OUT_EXCLUSION_LABEL}
                      checked={draft.excludeReportedOptOut}
                      disabled={draftLocked}
                      onCheckedChange={(checked) => {
                        setDraft((current) => ({ ...current, excludeReportedOptOut: checked }));
                        setSaveError(null);
                        setSavedNotice(null);
                      }}
                    />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {REPORTED_OPT_OUT_EXCLUSION_NOTE}
                  </p>
                </div>

                <div className="mt-6">
                  <label htmlFor="segment-name" className="text-sm font-semibold">
                    Segment name
                  </label>
                  <Input
                    id="segment-name"
                    className="mt-2"
                    value={name}
                    // #717 — same bound as the contact name field. The server enforces it too;
                    // this only stops the merchant reaching a rejection they can't see coming.
                    maxLength={200}
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaveError(null);
                      setSavedNotice(null);
                    }}
                    placeholder="For example, repeat WhatsApp buyers"
                  />
                </div>
              </fieldset>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button type="button" disabled={!saveReady} onClick={saveCurrentSegment}>
                  {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
                  {saving
                    ? "Saving…"
                    : retryFence
                      ? `Retry exact ${retryFence.operation}`
                      : editingId
                        ? "Update segment"
                        : "Save segment"}
                </Button>
                {retryFence ? (
                  <Button type="button" variant="secondary" disabled={refreshingDraft} onClick={startFreshDraft}>
                    {refreshingDraft ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                    {refreshingDraft
                      ? "Checking…"
                      : retryFence.operation === "update"
                        ? "Refresh latest"
                        : "Use a fresh draft"}
                  </Button>
                ) : null}
                {editingId && !retryFence ? (
                  <Button type="button" variant="ghost" disabled={saving} onClick={resetEditor}>
                    Cancel edit
                  </Button>
                ) : null}
                {!preview || previewKey !== rulesKey ? (
                  <p className="text-xs text-muted-foreground">A current successful preview is required before save.</p>
                ) : null}
              </div>
              {saveError ? (
                <p className="mt-3 rounded-xl bg-error-soft px-4 py-3 text-sm text-error-soft-foreground" role="alert">
                  {saveError} Your exact name and rules are locked for a safe retry. Retry the exact request,
                  or {retryFence?.operation === "update" ? "refresh the latest saved version" : "use a fresh draft"} before editing.
                </p>
              ) : null}
              {savedNotice ? (
                <p className="mt-3 flex items-center gap-2 rounded-xl bg-success-soft px-4 py-3 text-sm text-success-soft-foreground" role="status">
                  <Check className="size-4" />
                  {savedNotice}
                </p>
              ) : null}
            </div>

            <section className="min-w-0 rounded-[var(--radius-card)] border border-border bg-muted/35 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Live preview</h2>
                <Badge variant={preview && previewKey === rulesKey ? "success" : "outline"}>
                  {previewLoading ? "Calculating" : preview && previewKey === rulesKey ? "Current" : "Waiting"}
                </Badge>
              </div>
              {previewLoading ? (
                <div className="mt-5 grid grid-cols-2 gap-3" aria-live="polite">
                  <div className="h-20 animate-pulse rounded-xl bg-muted" />
                  <div className="h-20 animate-pulse rounded-xl bg-muted" />
                  <span className="sr-only">Calculating segment preview</span>
                </div>
              ) : previewError ? (
                <div className="mt-5 rounded-xl bg-error-soft px-4 py-3 text-sm text-error-soft-foreground" role="alert">
                  <p>{previewError}</p>
                  <Button
                    type="button"
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    onClick={() => setPreviewRetry((value) => value + 1)}
                  >
                    <RefreshCw />
                    Retry preview
                  </Button>
                </div>
              ) : preview && previewKey === rulesKey ? (
                <div className="mt-5">
                  <p className="rounded-xl bg-card px-4 py-3 text-sm font-medium leading-6 shadow-xs">
                    {preview.phrase}
                  </p>
                  <ContactPreview preview={preview} />
                </div>
              ) : (
                <p className="mt-5 text-sm leading-6 text-muted-foreground">
                  Complete a valid rule to calculate a server-owned phrase and current matches. Invalid drafts never run a query.
                </p>
              )}
            </section>
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => { if (!next && !deleting) { setPendingDelete(null); setDeleteError(null); } }}
      >
        <AlertDialogContent className="max-w-[520px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This segment leaves your list. Contacts are never deleted, and broadcasts you already
              sent keep the audience they were sent to.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert variant="warning" density="compact">
            <AlertTitle>Automations stop using this segment</AlertTitle>
            <AlertDescription>
              Any automation still targeting this segment stops sending and records why, until you
              point it at another one. Nothing goes out to an audience you removed.
            </AlertDescription>
          </Alert>
          {deleteError ? (
            <Alert variant="destructive" density="compact" role="alert">
              <AlertTitle>Segment wasn&apos;t deleted</AlertTitle>
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={deleting}>
              Cancel
            </AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
              {deleting ? "Deleting…" : "Delete segment"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

export function ContactPreview({ preview }: { preview: PreviewSuccess }) {
  return (
    <div className="mt-4">
      <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold tabular-nums">
        {/*
          #792 r4 — this number used to be labelled "contactable", which is a promise the count
          does not make. It is `!isKnownOptOut(truth)` (segment-actions.ts) and nothing more: a
          contact with do-not-disturb switched on is counted here, and whether anyone can
          actually be messaged is decided later by the four send-eligibility axes. So the label
          says exactly what was measured — and it now reads as the pair it always was with the
          exclusion beside it.
        */}
        {preview.matchedCount} of {preview.totalContactCount} contacts matched · {preview.contactableCount} with no known opt-out · {preview.excludedByConsentCount} known opt-out excluded
        {preview.reportedOptOutCount > 0
          ? ` · ${preview.reportedOptOutCount} reported opt-out still included`
          : ""}
        {/*
          #758 — the merchant's own exclusion is counted and named separately from the consent
          exclusion beside it. One number is what the consent record decided; this one is what
          the merchant chose, and the same contact is never in both.
        */}
        {preview.excludedByReportedOptOutCount > 0
          ? ` · ${preview.excludedByReportedOptOutCount} reported opt-out excluded by your choice`
          : ""}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Unknown consent stays included. {KNOWN_OPT_OUT_RULE_NOTE} Do not disturb is checked at send time and does not filter this segment.
        {preview.unresolvedLegacyOptOutCount > 0
          ? ` ${preview.unresolvedLegacyOptOutCount} of them opted out before consent history was kept, so they stay out until the customer opts in again.`
          : ""}
        {preview.excludedByReportedOptOutCount > 0
          ? " You chose to exclude the opt-outs you recorded yourself, so this segment leaves them out here and in every broadcast built from it."
          : ""}
      </p>
      {/*
        #726 — the two numbers a merchant compares are counted over two different groups of
        people. Saying so is the fix; quietly making them look identical is what let a frozen
        audience disagree with the page that promised it.
      */}
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {/*
          This sentence names the POPULATION the numbers above were reckoned over, so a merchant
          comparing them with a broadcast's numbers knows why they differ. Two rounds got it
          wrong, in opposite directions:

          r6 said "with a confirmed identity … and no known opt-out". The consent clause is
          false. `selectedIntoAudience` (consent-authority.ts) deliberately KEEPS known opt-outs
          in when the merchant went looking for them — "everyone who opted out" is a real,
          working segment — and a real-database test pins four opted-out contacts entering a
          frozen audience (consent-single-authority.test.ts). Worse, the broadcast number this
          sentence explains IS a count of excluded known opt-outs, so a population defined as
          having none of them is self-contradicting.

          Before that it said "the contacts it can reach", which promised delivery no number
          here measures.

          What actually narrows a broadcast's population is one line in
          customer-broadcast-service.ts: `if (sendTargets.length === 0) continue`, where a send
          target is an identity on the run's channel that the channel itself has confirmed
          (#803 — a number the merchant typed is stored and searchable, not an address). That
          is a targeting fact about the address book, not a consent decision and not a promise
          of arrival, so that is all the sentence claims.
        */}
        These counts cover every contact you have. A broadcast counts only the contacts with a confirmed identity on the channel it sends from, so its own numbers can be lower.
      </p>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Evaluated {preview.evaluatedAt.replace("T", " ").replace(".000Z", " UTC")}
      </p>
      {preview.contacts.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
          No connected contacts match these rules.
        </p>
      ) : (
        <>
          {/* #819 — the cut is now a fact in the payload (`returned`/`hasMore`), not something
              each surface works out for itself. The page reads the same fact Otto is handed, so
              the two mouths cannot drift apart. */}
          {preview.hasMore ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Showing the first {preview.returned} of {preview.matchedCount} matched contacts.
            </p>
          ) : null}
          <ul className={`grid gap-2 ${preview.hasMore ? "mt-2" : "mt-4"}`}>
          {preview.contacts.map((contact) => (
            <li key={contact.id} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{contact.name}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {contact.channels.length > 0 ? contact.channels.join(" · ") : "No live identity"}
                </p>
              </div>
              {/*
                Every row here MATCHED, and a matched contact is exactly what the broadcast
                freeze turns into an audience member. So the badge may only describe this
                contact's consent standing — never claim an exclusion. A merchant is allowed to
                select the people who opted out; on that segment the old "excluded" wording said
                the opposite of what the freeze on the same rules did. Whether such a member can
                actually be messaged is decided later, by the four send-eligibility axes.
              */}
              <Badge variant={contact.contactable && !contact.reportedOptOut ? "success" : "warning"}>
                {contact.contactable
                  ? contact.reportedOptOut
                    ? "Included · reported opt-out"
                    : "Included"
                  : contact.unresolvedLegacyOptOut
                    ? "Included · opted out before consent history"
                    : "Included · known opt-out"}
              </Badge>
            </li>
          ))}
          </ul>
        </>
      )}
    </div>
  );
}

function RuleEditor({
  rule,
  index,
  onChange,
  onKindChange,
  onRemove,
}: {
  rule: DraftRule;
  index: number;
  onChange: (rule: DraftRule) => void;
  onKindChange: (kind: RuleKind) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-xs sm:p-4">
      <div className="grid gap-3 sm:grid-cols-[11rem_1fr_auto] sm:items-center">
        <Select value={rule.kind} onValueChange={(value) => onKindChange(value as RuleKind)}>
          <SelectTrigger className="w-full" aria-label={`Rule ${index + 1} type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RULE_LABELS) as RuleKind[]).map((kind) => (
              <SelectItem key={kind} value={kind}>
                {RULE_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <RuleValueEditor rule={rule} onChange={onChange} />
        <Button type="button" size="icon" variant="ghost" onClick={onRemove} aria-label={`Remove rule ${index + 1}`}>
          <Trash2 />
        </Button>
      </div>
      {rule.kind === "last_order_recency" || rule.kind === "tag" ? (
        <p className="mt-2 text-xs text-warning-soft-foreground">This fact is unavailable today and matches zero contacts.</p>
      ) : null}
    </div>
  );
}

function RuleValueEditor({ rule, onChange }: { rule: DraftRule; onChange: (rule: DraftRule) => void }) {
  switch (rule.kind) {
    case "lifetime_spend":
      return (
        <div className="grid grid-cols-[1fr_minmax(7rem,0.8fr)] gap-2">
          <Select
            value={rule.comparison}
            onValueChange={(value) => onChange({ ...rule, comparison: value as "at_least" | "more_than" })}
          >
            <SelectTrigger className="w-full" aria-label="Spend comparison">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="at_least">At least</SelectItem>
              <SelectItem value="more_than">More than</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={rule.amountMyr}
            onChange={(event) => onChange({ ...rule, amountMyr: event.target.value })}
            aria-label="Lifetime spend in MYR"
            placeholder="MYR"
          />
        </div>
      );
    case "last_order_recency":
      return (
        <Input
          type="number"
          min="1"
          step="1"
          value={rule.withinDays}
          onChange={(event) => onChange({ ...rule, withinDays: event.target.value })}
          aria-label="Last order within days"
          placeholder="Days"
        />
      );
    case "channel":
      return (
        <Input
          value={rule.channel}
          onChange={(event) => onChange({ ...rule, channel: event.target.value })}
          aria-label="Contact channel"
          placeholder="whatsapp"
        />
      );
    case "tag":
      return (
        <Input
          value={rule.tag}
          onChange={(event) => onChange({ ...rule, tag: event.target.value })}
          aria-label="Contact tag"
          placeholder="vip"
        />
      );
    case "contactability":
      return (
        <div>
          <Select
            value={rule.value}
            onValueChange={(value) => onChange({ ...rule, value: value as "contactable" | "not_contactable" })}
          >
            <SelectTrigger className="w-full" aria-label="Consent selection value">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contactable">Not known opt-out</SelectItem>
              <SelectItem value="not_contactable">Known opt-out</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{KNOWN_OPT_OUT_RULE_NOTE}</p>
        </div>
      );
  }
}
