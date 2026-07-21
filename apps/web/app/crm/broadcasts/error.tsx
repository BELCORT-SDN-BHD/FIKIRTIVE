"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function BroadcastsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-error-soft text-destructive">
          <AlertTriangle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM Broadcasts</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Broadcasts could not load</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Nothing was changed. Retry the owner-scoped request, or return to Otto.
        </p>
        {error.digest ? <p className="mt-3 font-mono text-xs text-muted-foreground">Error reference: {error.digest}</p> : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" onClick={reset}><RefreshCw />Retry</Button>
          <Button asChild variant="secondary"><Link href="/otto"><ArrowLeft />Return to Otto</Link></Button>
        </div>
      </section>
    </main>
  );
}
