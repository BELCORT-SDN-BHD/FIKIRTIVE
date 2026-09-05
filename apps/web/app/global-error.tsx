"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { CrashPage } from "@/components/crash-page";
import { crashReportContext } from "@/lib/sentry-browser";
import "./globals.css";

/**
 * 最后一道错误边界(#793 — 上线债#1「仪表盘点亮」).
 *
 * app/error.tsx 接的是页面里抛出来的错;根 layout 本身炸掉时它也一起没了,商家看到的
 * 是一片白 —— 而我们这边一条信号都没有。global-error 是 Next.js 在那一刻唯一还会渲染
 * 的东西,所以它必须①自带 <html>/<body>(根 layout 已经不在了)②在这里把事件送出去。
 *
 * 它自己不能再崩:不读任何数据、不碰任何 provider。控件仍走 @/components/ui(#840 常令,
 * 与同族的 app/error.tsx 一致)—— 那一层只是 cva + Slot,不是崩溃的来源。
 *
 * 2026-09-05 走查 P2(FRONT-A14):与 `app/error.tsx` 渲染**同一个** `CrashPage`,所以
 * 两次崩溃长得一样、错误编号那一行叫同一个名字。注意这一页天生没有导轨与顶栏 ——
 * 根 layout(外壳所在)已经不存在了,这是 Next.js 的形状,不是可以补上的东西;
 * 有外壳的那一路是 `app/error.tsx`。
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error, crashReportContext(error, "global-error"));
  }, [error]);

  return (
    <html lang="en">
      <body className="gb">
        <CrashPage
          title="Something broke"
          body="The page could not be loaded. Your saved work is safe — nothing was lost."
          digest={error.digest}
          actionLabel="Reload page"
          onAction={() => window.location.reload()}
        />
      </body>
    </html>
  );
}
