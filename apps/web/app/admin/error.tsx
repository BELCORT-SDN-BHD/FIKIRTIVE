"use client";

import Link from "next/link";
import { AlertTriangle, History, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="gb min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[760px] gap-5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-[10px] border border-destructive/30 bg-error-soft text-destructive">
            <AlertTriangle className="size-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Admin diagnostics</p>
            <h1 className="mt-1 text-2xl font-semibold leading-tight">Admin data failed to load</h1>
          </div>
        </div>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <p className="text-sm leading-6 text-muted-foreground">
            City Hall could not read one of the admin data sources. The most likely causes are a
            database query failure, a stale client bundle after deploy, or Railway/service logs being
            temporarily unavailable. No customer action was performed by this page.
          </p>
          <dl className="mt-4 grid gap-3 text-sm">
            <div>
              <dt className="font-medium text-foreground">Visible error</dt>
              <dd className="mt-1 break-words text-muted-foreground">{error.message || "Unexpected admin render error."}</dd>
            </div>
            {error.digest ? (
              <div>
                <dt className="font-medium text-foreground">Next.js digest</dt>
                <dd className="mt-1 font-mono text-xs text-muted-foreground">{error.digest}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold text-foreground">What to check next</h2>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
            <p>1. Reload admin data once. If it recovers, the failure was likely transient.</p>
            <p>2. Open System Health for queue, spend, and BytePlus pack signals.</p>
            <p>3. Open Audit for the last admin/system action before the failure.</p>
            <p>4. Check Railway web and worker logs for server-action or database errors around this time.</p>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={reset}>
            <RefreshCw className="size-4" />
            Reload admin data
          </Button>
          <Button asChild variant="secondary">
            <Link href="/admin/system">
              <Server className="size-4" />
              System Health
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/admin/audit">
              <History className="size-4" />
              Audit
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
