"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FolderKanban,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Video as VideoIcon,
  XCircle,
} from "lucide-react";
import { displayCredits } from "@fikirtive/core/spend";
import {
  confirmCampaignGeneration,
  type CampaignGenQuote,
  type ConfirmCampaignGenerationResult,
} from "@/lib/campaign-generation-confirm";
import type { BatchInterruption } from "@/lib/factory-batch";
import { getCampaign } from "@/lib/campaign-view-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CampaignNav } from "./campaign-nav";

type DetailResult = Awaited<ReturnType<typeof getCampaign>>;
type QuoteResult = { ok: true; quote: CampaignGenQuote } | { error: string };
type BatchResult = Extract<ConfirmCampaignGenerationResult, { ok: true }>["result"];

export default function CampaignConfirmPage({
  campaignId,
  detail,
  quote,
}: {
  campaignId: string;
  detail: DetailResult;
  quote: QuoteResult;
}) {
  if ("error" in detail) {
    return (
      <Shell>
        <section className="mt-7 rounded-[var(--radius-card)] border border-error-soft bg-card p-6 shadow-sm">
          <AlertCircle className="size-6 text-destructive" />
          <h1 className="mt-4 text-2xl font-semibold">This campaign is not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">{detail.error}</p>
          <Button asChild variant="secondary" className="mt-5">
            <Link href="/campaign"><ArrowLeft />Back to campaigns</Link>
          </Button>
        </section>
      </Shell>
    );
  }
  return <ConfirmWorkspace campaignId={campaignId} initial={detail} initialQuote={quote} />;
}

function ConfirmWorkspace({
  campaignId,
  initial,
  initialQuote,
}: {
  campaignId: string;
  initial: Extract<DetailResult, { ok: true }>;
  initialQuote: QuoteResult;
}) {
  const campaign = initial.campaign;
  const projects = campaign.grouped.projects;
  const entriesById = useMemo(
    () => Object.fromEntries((campaign.plan?.entries ?? []).map((entry) => [entry.id, entry])),
    [campaign.plan],
  );
  const [quoteSnapshot, setQuoteSnapshot] = useState<QuoteResult>(initialQuote);

  // Quote lines are the server-authoritative review snapshot. Do not filter them through the
  // separately loaded detail snapshot: those reads happen in parallel and could observe
  // different plan versions. Optional hook/platform labels may come from detail; paid content
  // always renders from line.brief and is bound by the quote fingerprint.
  const approvedLines = "ok" in quoteSnapshot ? quoteSnapshot.quote.lines : [];
  const totalDisplayCredits = "ok" in quoteSnapshot ? quoteSnapshot.quote.totalDisplayCredits : 0;
  const contentFingerprint = "ok" in quoteSnapshot ? quoteSnapshot.quote.contentFingerprint : "";

  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>("error" in initialQuote ? initialQuote.error : null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [interruption, setInterruption] = useState<BatchInterruption | null>(null);

  // The server derives the stable batch id, stable per-entry identities, and a fresh attempt id.
  // The browser returns only the server-rendered total + opaque content fingerprint; it never
  // supplies generation content, model, price, or an idempotency key.
  async function confirm() {
    if (!projectId) {
      setError("Choose a destination project first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await confirmCampaignGeneration({
        campaignId,
        projectId,
        expectedTotalCredits: totalDisplayCredits,
        expectedContentFingerprint: contentFingerprint,
      });
      if (!("ok" in response)) {
        if (response.quote) setQuoteSnapshot({ ok: true, quote: response.quote });
        if (response.partial) {
          setResult(response.partial.partial);
          setInterruption(response.partial);
        }
        setError(response.error);
        return;
      }
      setQuoteSnapshot({ ok: true, quote: response.quote });
      setResult(response.result);
      setInterruption(null);
    } catch {
      // A transport failure cannot prove zero dispatch. The stable server-derived keys make a
      // retry safe, but the UI must say the outcome is unknown rather than inventing $0.
      setError("We couldn't confirm the result. Some items may have started; retry to reconcile them safely.");
    } finally {
      setBusy(false);
    }
  }

  // ── empty / degraded states ────────────────────────────────────────────────
  if (approvedLines.length === 0) {
    return (
      <Shell>
        <ConfirmHeader campaign={campaign} />
        <EmptyState
          icon={<Sparkles className="mx-auto size-6 text-muted-foreground" />}
          title="No approved entries to generate yet"
          body="Approve the plan entries you want to create on the campaign detail page, then come back here to generate them."
          campaignId={campaignId}
        />
      </Shell>
    );
  }

  if (projects.length === 0) {
    return (
      <Shell>
        <ConfirmHeader campaign={campaign} />
        <EmptyState
          icon={<FolderKanban className="mx-auto size-6 text-muted-foreground" />}
          title="Group a project into this campaign first"
          body="Generations need a home. On the campaign detail page, group a project into this campaign — then its generations land inside it."
          campaignId={campaignId}
        />
      </Shell>
    );
  }

  // ── results view (honest server-confirmed outcomes) ───────────────────────
  if (result) {
    const reservedThisRun = displayCredits(result.totalCredits);
    const currentUnknown = interruption?.current === "unknown";
    const zeroDispatchConfirmed = result.dispatched === 0 && !currentUnknown;
    const resultTitle = interruption
      ? result.dispatched > 0 || currentUnknown
        ? "Generation partly started"
        : "Generation did not start"
      : "Generation started";

    return (
      <Shell>
        <ConfirmHeader campaign={campaign} />
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{resultTitle}</CardTitle>
            <CardDescription>
              {result.dispatched} dispatched · {result.reused} reused · {result.failed} could not start
              {interruption ? ` · ${interruption.notStarted} not started` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {zeroDispatchConfirmed ? (
              <div className="rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm text-info-soft-foreground">
                <strong>Nothing was charged.</strong> The server confirmed that no new generation job was dispatched.
              </div>
            ) : interruption ? (
              <div className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
                Confirmed reserved before the interruption: <strong>{reservedThisRun} credits</strong>.
                {currentUnknown
                  ? " One item's start status could not be confirmed and may also have reserved credits. A retry will reuse it if it exists."
                  : " The remaining items did not start."}
              </div>
            ) : (
              <div className="rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm text-info-soft-foreground">
                Reserved this run: <strong>{reservedThisRun} credits</strong>. Reused and failed items charged nothing.
                Any item that fails is refunded automatically.
              </div>
            )}
            {result.cells.map((cell) => {
              const line = approvedLines[cell.index];
              const entry = line ? entriesById[line.entryId] : undefined;
              return (
                <div key={cell.index} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{entry?.hook || `Entry ${cell.index + 1}`}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{line?.brief}</p>
                    {cell.error ? <p className="mt-1 text-xs text-destructive">{friendlyCellError(cell.error)}</p> : null}
                  </div>
                  <CellStatus status={cell.status} credits={displayCredits(cell.credits)} />
                </div>
              );
            })}
            <div className="flex flex-wrap gap-3">
              {result.failed > 0 || interruption ? (
                <Button type="button" onClick={() => confirm()} disabled={busy}>
                  {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  {interruption ? "Retry remaining items" : "Retry failed items"}
                </Button>
              ) : null}
              <Button asChild variant="secondary">
                <Link href={`/campaign/${campaignId}`}><ArrowLeft />Back to campaign</Link>
              </Button>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── review + confirm ───────────────────────────────────────────────────────
  return (
    <Shell>
      <ConfirmHeader campaign={campaign} />

      <div className="mt-6 rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm leading-6 text-info-soft-foreground">
        <ShieldCheck className="mb-1 inline size-4" /> The server checks the approved content, models, and prices again
        when you confirm. If anything changed, nothing starts until you review the updated plan. You only pay when a
        generation finishes, never on errors, and each item generates at most once.
      </div>
      {error ? <div className="mt-4 rounded-xl border border-error-soft bg-error-soft p-4 text-sm text-destructive">{error}</div> : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Approved entries to generate</CardTitle>
            <CardDescription>{approvedLines.length} item{approvedLines.length === 1 ? "" : "s"}, each priced from the live model config.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {approvedLines.map((line) => {
              const entry = entriesById[line.entryId];
              return (
                <div key={line.entryId} className="rounded-xl border border-border bg-muted/25 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">{line.kind === "video" ? <VideoIcon className="size-3" /> : <ImageIcon className="size-3" />}{line.kind}</Badge>
                      <span className="text-xs text-muted-foreground">{entry?.platform} · {entry?.format}</span>
                    </span>
                    <span className="text-sm font-semibold">{line.displayCredits} credits</span>
                  </div>
                  <p className="mt-3 text-sm font-semibold">{entry?.hook || "Untitled entry"}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{line.brief}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Model: {line.model}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <aside className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Confirm generation</CardTitle>
              <CardDescription>Charged to your credit balance. Finished generations land in the chosen project.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <label className="grid gap-2 text-xs font-semibold text-muted-foreground">
                Destination project
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger><SelectValue placeholder="Choose a project" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-2xl font-semibold tracking-tight">{totalDisplayCredits} credits</span>
              </div>
              <Button type="button" className="w-full" disabled={busy || !projectId} onClick={() => confirm()}>
                {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                Confirm · {totalDisplayCredits} credits
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link href={`/campaign/${campaignId}`}><ArrowLeft />Back without generating</Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-7xl">
        <CampaignNav current="detail" />
        {children}
      </div>
    </main>
  );
}

function ConfirmHeader({ campaign }: { campaign: Extract<DetailResult, { ok: true }>["campaign"] }) {
  return (
    <header className="mt-7 border-b border-border pb-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">Confirm generation</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{campaign.name}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
        Turn this campaign&apos;s approved plan entries into real generations.
      </p>
    </header>
  );
}

function EmptyState({ icon, title, body, campaignId }: { icon: React.ReactNode; title: string; body: string; campaignId: string }) {
  return (
    <Card className="mt-6">
      <CardContent className="px-5 py-10 text-center">
        {icon}
        <h2 className="mt-3 text-sm font-semibold">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
        <Button asChild variant="secondary" className="mt-5">
          <Link href={`/campaign/${campaignId}`}><ArrowLeft />Back to campaign detail</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Map the shared spend-gate errors to copy that is accurate for THIS flow. */
function friendlyCellError(raw: string): string {
  if (/different content/i.test(raw)) {
    return "This entry's plan changed since it was last generated. Undo the edit, or generate it into a different project.";
  }
  return raw;
}

function CellStatus({ status, credits }: { status: "queued" | "reused" | "text" | "error"; credits: number }) {
  if (status === "queued") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-info-soft-foreground">
        <LoaderCircle className="size-4 animate-spin" /> Generating · {credits} cr
      </span>
    );
  }
  if (status === "reused") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-success-soft-foreground">
        <CheckCircle2 className="size-4" /> Already done · 0 cr
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-destructive">
      <XCircle className="size-4" /> Not started · 0 cr
    </span>
  );
}
