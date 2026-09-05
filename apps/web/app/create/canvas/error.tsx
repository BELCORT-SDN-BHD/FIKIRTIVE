"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { crashReportContext } from "@/lib/sentry-browser";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";

/**
 * 画布路由的错误边界 —— 2026-09-04 走查 P0-5「导航失败＝永远的骨架屏」。
 *
 * `app/create/canvas/page.tsx` 有 `<Suspense fallback={<DeepLinkFallback />}>` 却没有自己的
 * error boundary:服务端一次 502(Railway 冷启动 / 重启窗口)之后,那个骨架就永远转下去 ——
 * 商家看到的不是「出错了」,而是「这个产品坏了但不肯说」,而且**没有任何出路**:没有重试按钮,
 * 没有回头路,只能自己去猜要刷新。
 *
 * 这一页把那口井填上:一句人话 + 一颗「Try again」(走 Next 的 `reset()`,原地重挂这一段,
 * 不整页刷新) + 一条回 Create 的路。原始报错一个字不印给商家看(白标围栏,
 * `lib/__tests__/crash-boundary.test.ts` 全族扫),但照旧上报 Sentry —— 被 React 捕获的错误
 * 不算 unhandled,不显式上报这一路崩溃就是零信号。
 */
export default function CanvasError({
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
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{PRODUCT_VOCABULARY.canvas}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This canvas didn&apos;t open</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          It stopped loading part way through. Nothing you made was lost — everything is still saved. Try again, or go
          back and open it from Create.
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
            <Link href="/create">
              <ArrowLeft />
              Back to Create
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
