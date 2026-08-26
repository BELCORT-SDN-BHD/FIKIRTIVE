"use client";

import Link from "next/link";
import { useState } from "react";
import { orgRolesAllow } from "@fikirtive/core/org-roles";
import { AlertCircle, ArrowLeft, ArrowRight, Megaphone, Plus, RefreshCw, Unplug } from "lucide-react";
import { listBroadcastRuns } from "@/lib/customer-broadcast-ui-actions";
import type { getMemberDirectory, listChannelScopes } from "@/lib/customer-broadcast-gateway";
import { getCustomerBroadcastReport } from "@/lib/customer-broadcast-report-ui-actions";
import {
  channelConnectionFrom,
  channelConnectionHeadline,
  channelUnavailableCopy,
  hasChannelAccountOnFile,
  type ChannelAccountsResult,
} from "@/lib/crm-channel-connection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  channelLabel,
  dateTimeLabel,
  errorMessage,
  isDenialErrorCode,
  purposeLabel,
  runStatusPresentation,
} from "./broadcast-format";

type ListResult = Awaited<ReturnType<typeof listBroadcastRuns>>;
type ListSuccess = Extract<ListResult, { ok: true }>;
type Run = ListSuccess["resource"][number];
type DirectoryResult = Awaited<ReturnType<typeof getMemberDirectory>>;
type ScopesResult = Awaited<ReturnType<typeof listChannelScopes>>;

/** #727 — why a broadcast needs a channel, in the words the composer already used. */
const NO_CHANNEL_LEAD = "A broadcast goes out through a connected channel account.";

function DeniedState({ message }: { message: string }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[var(--r22-track-caps)] text-muted-foreground">CRM Broadcasts</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This workspace is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Button asChild className="mt-6" variant="secondary"><Link href="/otto"><ArrowLeft />Return to Otto</Link></Button>
      </section>
    </main>
  );
}

export default function BroadcastListPage({
  initialRuns,
  initialDirectory,
  initialReportRunIds,
  initialChannelScopes,
}: {
  initialRuns: ListResult;
  initialDirectory: DirectoryResult;
  initialReportRunIds: string[];
  initialChannelScopes: ScopesResult;
}) {
  const [runs, setRuns] = useState<Run[]>(initialRuns.ok ? initialRuns.resource : []);
  const [reportRunIds, setReportRunIds] = useState(() => new Set(initialReportRunIds));
  const [errorCode, setErrorCode] = useState<string | null>(initialRuns.ok ? null : initialRuns.error);
  const [loading, setLoading] = useState(false);

  // Denial gets the deliberately indistinguishable "not available" page. Placed after the hooks
  // so hook order is stable across renders.
  if (!initialRuns.ok && isDenialErrorCode(initialRuns.error)) {
    return <DeniedState message={errorMessage(initialRuns.error)} />;
  }

  const directory = initialDirectory.ok ? initialDirectory.resource : null;
  const nameFor = (membershipId: string): string =>
    directory?.members.find((m) => m.membershipId === membershipId)?.displayName ?? `Member ${membershipId.slice(0, 6)}`;
  const selfRoles = directory ? (directory.self.roles ?? [directory.self.role]) : [];
  const canManage = orgRolesAllow(selfRoles, "broadcast.manage");
  // #727 — read once, and let both the banner and the "New broadcast" entry follow it.
  const connection = channelConnectionFrom(initialChannelScopes as ChannelAccountsResult);
  // The composer's Create button needs a channelScopeId, and a workspace with no channel account
  // has no dropdown to pick one from. Inviting a merchant in there was a form they could never
  // finish (#687 same shape), so with zero accounts the entry explains instead of beckoning.
  //
  // 判官 r2 P1-1: this gate asks about the ACCOUNT (identity), not the connection. A lapsed
  // connection still leaves a scope the composer can name and submit, and the run is simulated
  // either way — taking the form away there would invent a refusal the server does not make.
  // A read that FAILED is not a reason to remove an action either: only a confirmed zero is.
  const newBroadcastBlockedReason = !canManage
    ? "Broadcast management access is required."
    : hasChannelAccountOnFile(connection) === false
      ? channelUnavailableCopy(NO_CHANNEL_LEAD)
      : null;

  async function refresh() {
    setLoading(true);
    try {
      const result = await listBroadcastRuns({});
      if (!result.ok) setErrorCode(result.error);
      else {
        const reports = await Promise.all(
          result.resource.map(async (run) => ({
            id: run.id,
            report: await getCustomerBroadcastReport({ broadcastRunId: run.id }),
          })),
        );
        setRuns(result.resource);
        setReportRunIds(new Set(reports.filter(({ report }) => report.ok).map(({ id }) => id)));
        setErrorCode(null);
      }
    } catch {
      setErrorCode("NETWORK");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/otto" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="size-4" />Return to Otto
            </Link>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[var(--r22-track-caps)] text-brand-strong">CRM</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[var(--r22-track-display-lg)] sm:text-4xl">Broadcasts</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Plan a broadcast to a segment, freeze the audience, and run a simulated send. Fikirtive never sends to real customers here — every send in this workbench is simulated.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" onClick={() => void refresh()} disabled={loading} aria-label="Refresh">
              <RefreshCw className={loading ? "animate-spin" : undefined} />Refresh
            </Button>
            {newBroadcastBlockedReason === null ? (
              <Button asChild><Link href="/crm/broadcasts/new"><Plus />New broadcast</Link></Button>
            ) : (
              <Button disabled title={newBroadcastBlockedReason}><Plus />New broadcast</Button>
            )}
          </div>
        </header>

        {/* #727 — the connection clause is read from the workspace's channel accounts. The
            simulated-send clause is a product fact that holds whether or not a channel exists,
            so it is stated on its own instead of being presented as a consequence. */}
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
          <Unplug className="mt-0.5 size-4 shrink-0" />
          <span>{channelConnectionHeadline(connection)} Broadcasts here run as simulated sends only — no message reaches a real customer, and provider quota (messaging tier) reads as unavailable.</span>
        </div>

        {!canManage ? (
          <p className="mt-4 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
            You can review broadcasts, but your current access cannot create, freeze, confirm, or run one.
          </p>
        ) : null}

        {errorCode && !isDenialErrorCode(errorCode) ? (
          <p className="mt-4 text-sm text-destructive">{errorMessage(errorCode)}</p>
        ) : null}

        {runs.length === 0 ? (
          <section className="mt-6 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
            <Megaphone className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No broadcasts yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {!canManage
                ? "No broadcast has been created in this workspace yet."
                : (newBroadcastBlockedReason ??
                  "Create your first broadcast to choose a segment and template, then run a simulated send.")}
            </p>
            {newBroadcastBlockedReason === null ? (
              <Button asChild className="mt-5"><Link href="/crm/broadcasts/new"><Plus />New broadcast</Link></Button>
            ) : null}
          </section>
        ) : (
          <section className="mt-6 grid gap-3">
            {runs.map((run) => {
              const status = runStatusPresentation(run.status);
              return (
                <Card key={run.id}>
                  <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Link href={`/crm/broadcasts/${run.id}`} className="min-w-0 flex-1 rounded-lg outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          <Badge variant="outline">{purposeLabel(run.purpose)}</Badge>
                          <Badge variant="outline">{channelLabel(run.channel)}</Badge>
                        </div>
                        <p className="mt-2 truncate text-sm text-muted-foreground">
                          Created by {nameFor(run.createdByMembershipId)} · {dateTimeLabel(run.createdAt)}
                        </p>
                      </div>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                      {reportRunIds.has(run.id) ? (
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/crm/reports/${run.id}`}>View report</Link>
                        </Button>
                      ) : null}
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
