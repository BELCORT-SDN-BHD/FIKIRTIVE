"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { crashReportContext } from "@/lib/sentry-browser";
import "./globals.css";

/**
 * 最后一道错误边界(#793 — 上线债#1「仪表盘点亮」).
 *
 * app/error.tsx 接的是页面里抛出来的错;根 layout 本身炸掉时它也一起没了,商家看到的
 * 是一片白 —— 而我们这边一条信号都没有。global-error 是 Next.js 在那一刻唯一还会渲染
 * 的东西,所以它必须①自带 <html>/<body>(根 layout 已经不在了)②在这里把事件送出去。
 *
 * 它自己不能再崩:不引任何组件、不读任何数据,只用 token class + 一个原生 <button>。
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error, crashReportContext(error, "global-error"));
  }, [error]);

  return (
    <html lang="en">
      <body className="gb">
        <main className="min-h-dvh flex flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">Something broke</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            The page could not be loaded. Your saved work is safe — nothing was lost.
          </p>
          {/* digest 是把商家截图里的这一串和服务端日志里的那一条对上的唯一钥匙。 */}
          {error.digest && (
            <p className="text-xs text-muted-foreground">
              Reference: <span className="font-mono">{error.digest}</span>
            </p>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Reload page
          </button>
        </main>
      </body>
    </html>
  );
}
