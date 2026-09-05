"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * 崩溃页的共用形状 —— 2026-09-05 走查 P2「崩溃页两套不一致」(验收 FRONT-A14)。
 *
 * 仓库里本来有两套崩溃页:
 *   ① 路由段自己的那九个 boundary(`app/create/error.tsx`、`app/campaign/error.tsx`、
 *      `app/crm/<节>/error.tsx` …)—— 一张卡、一颗警告图标、一行 `Error reference: <digest>`;
 *   ② 兜底的那两个(`app/error.tsx`、`app/global-error.tsx`)—— 居中裸文字、没有卡、
 *      错误编号那一行的措辞还不一样(`Reference:`)。
 *
 * `/brand` 没有自己的 boundary,崩起来落的正是第②套 —— 于是同一个产品里两次崩溃长得不一样,
 * 而商家最需要报给我们的那串编号,在两处叫两个名字。这个组件把第②套收进第①套的形状里:
 * **形状与措辞只有这一处作者**,两个兜底 boundary 都渲染它(`lib/__tests__/crash-boundary.test.ts`
 * 逐字钉住「两处渲染同一组件」)。
 *
 * 这一层不认识 Sentry、不读任何数据、不碰任何 provider —— `global-error` 是根 layout 已经
 * 没了之后唯一还会渲染的东西,它引进来的每一样都必须自己不会再崩。上报仍留在两个 boundary
 * 各自的 `useEffect` 里(两处的 `surface` tag 不同,不能合并)。
 */
export function CrashPage({
  title,
  body,
  digest,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  /** Next.js 给的错误编号。它是把商家截图里的那一串和服务端日志里的那一条对上的唯一钥匙。 */
  digest?: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section
        data-crash-page
        className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8"
      >
        <span className="grid size-11 place-items-center rounded-xl bg-error-soft text-destructive">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
        {digest ? (
          <p className="mt-3 font-mono text-xs text-muted-foreground">Error reference: {digest}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" onClick={onAction}>
            <RefreshCw aria-hidden="true" />
            {actionLabel}
          </Button>
        </div>
      </section>
    </main>
  );
}
