"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Megaphone, Plus, RefreshCw, Unplug } from "lucide-react";
import { listBroadcastRuns } from "@/lib/customer-broadcast-ui-actions";
import type { getMemberDirectory } from "@/lib/customer-broadcast-gateway";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  dateTimeLabel,
  errorMessage,
  isDenialErrorCode,
  purposeLabel,
  roleLabel,
  runStatusPresentation,
} from "./broadcast-format";

type ListResult = Awaited<ReturnType<typeof listBroadcastRuns>>;
type ListSuccess = Extract<ListResult, { ok: true }>;
type Run = ListSuccess["resource"][number];
type DirectoryResult = Awaited<ReturnType<typeof getMemberDirectory>>;

function DeniedState({ message }: { message: string }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM Broadcasts</p>
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
}: {
  initialRuns: ListResult;
  initialDirectory: DirectoryResult;
}) {
  const [runs, setRuns] = useState<Run[]>(initialRuns.ok ? initialRuns.resource : []);
  const [errorCode, setErrorCode] = useState<string | null>(initialRuns.ok ? null : initialRuns.error);
  const [loading, setLoading] = useState(false);

  // Denial gets the deliberately indistinguishable "not available" page. Placed after the hooks
  // so hook order is stable across renders.
  if (!initialRuns.ok && isDenialErrorCode(initialRuns.error)) {
    return <DeniedState message={errorMessage(initialRuns.error)} />;
  }

  const directory = initialDirectory.ok ? initialDirectory.resource : null;
  const selfRole = directory?.self.role ?? null;
  const nameFor = (membershipId: string): string =>
    directory?.members.find((m) => m.membershipId === membershipId)?.displayName ?? `Member ${membershipId.slice(0, 6)}`;
  const isOwner = selfRole === "owner";

  async function refresh() {
    setLoading(true);
    try {
      const result = await listBroadcastRuns({});
      if (!result.ok) setErrorCode(result.error);
      else {
        setRuns(result.resource);
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
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">CRM</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Broadcasts</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Plan a broadcast to a segment, freeze the audience, and run a simulated send. Fikirtive never sends to real customers here — every send in this workbench is simulated.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" onClick={() => void refresh()} disabled={loading} aria-label="Refresh">
              <RefreshCw className={loading ? "animate-spin" : undefined} />Refresh
            </Button>
            {isOwner ? (
              <Button asChild><Link href="/crm/broadcasts/new"><Plus />New broadcast</Link></Button>
            ) : (
              <Button disabled title="Only an owner can create a broadcast."><Plus />New broadcast</Button>
            )}
          </div>
        </header>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
          <Unplug className="mt-0.5 size-4 shrink-0" />
          <span>No messaging channel is connected in this workspace. Broadcasts here run as simulated sends only — no message reaches a real customer, and provider quota (messaging tier) reads as unavailable.</span>
        </div>

        {!isOwner ? (
          <p className="mt-4 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
            You are signed in as {selfRole ? roleLabel(selfRole).toLowerCase() : "a non-owner"}. You can review broadcasts, but only an owner can create, freeze, confirm, or run one.
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
              {isOwner ? "Create your first broadcast to choose a segment and template, then run a simulated send." : "No broadcast has been created in this workspace yet."}
            </p>
            {isOwner ? (
              <Button asChild className="mt-5"><Link href="/crm/broadcasts/new"><Plus />New broadcast</Link></Button>
            ) : null}
          </section>
        ) : (
          <section className="mt-6 grid gap-3">
            {runs.map((run) => {
              const status = runStatusPresentation(run.status);
              return (
                <Link key={run.id} href={`/crm/broadcasts/${run.id}`} className="block">
                  <Card className="transition-colors hover:bg-secondary/40">
                    <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          <Badge variant="outline">{purposeLabel(run.purpose)}</Badge>
                          <Badge variant="outline">{run.channel}</Badge>
                        </div>
                        <p className="mt-2 truncate text-sm text-muted-foreground">
                          Created by {nameFor(run.createdByMembershipId)} · {dateTimeLabel(run.createdAt)}
                        </p>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
