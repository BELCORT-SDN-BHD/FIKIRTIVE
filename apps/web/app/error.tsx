"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { crashReportContext } from "@/lib/sentry-browser";

/**
 * 页面错误边界(route error boundary)。根 layout 自己炸掉时接手的是 `global-error.tsx`;
 * 普通页面或组件抛错落在这里。
 *
 * r2(判官 r1 P1):这里从前把 `error.message` 原样印给商家看,而 Next 对 Client Component
 * 抛出的错误保留原始 message —— 于是一句 "BytePlus Seedance rate limit exceeded" 可以从供应商
 * 一路显示到商家的屏幕上。白标是产品决定:商家看到的是我们的产品,不是我们的供应商名单。
 * 所以文案一律通用,原始 message 只走 `captureException`(进 Sentry / 服务端日志)。
 *
 * 同时补上第二个洞:被 React 捕获的错误**不算** unhandled error,Sentry 不会自动收 ——
 * 不显式上报,这一路崩溃就是零信号,而「零信号」正是这一票要消灭的东西。
 */
export default function Error({
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
    // F42: shadcn tokens, not Vapor `text-dim`/`btn-primary` — text-dim is translucent white and
    // was illegible on the light `.gb` body, and btn-primary no longer exists post-migration.
    <main className="gb min-h-dvh flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold text-foreground">Something broke</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        This view could not be loaded. Your saved data is safe — nothing was lost.
      </p>
      {/* digest 是把商家截图里的这一串和服务端日志里的那一条对上的唯一钥匙。 */}
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      )}
      <Button onClick={reset}>Reload workbench</Button>
    </main>
  );
}
