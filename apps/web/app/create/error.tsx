"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { crashReportContext } from "@/lib/sentry-browser";

/**
 * Create 首页的错误边界 —— 走查 P0-5 的同一个洞:`app/create/page.tsx` 也只有 Suspense 骨架,
 * 加载失败时同样会永远转下去。文案与出路见 `create/canvas/error.tsx`;这一页回的是 Otto,
 * 因为它自己就是 Create。
 */
export default function CreateError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, crashReportContext(error, "route-error"));
  }, [error]);

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-error-soft text-destructive">
          <AlertTriangle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Create</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Create didn&apos;t open</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          It stopped loading part way through. Nothing you made was lost — everything is still saved.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-muted-foreground">Error reference: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" onClick={reset}>
            <RefreshCw />
            Try again
          </Button>
          <Button asChild variant="secondary">
            <Link href="/otto">
              <ArrowLeft />
              Go to Otto
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
