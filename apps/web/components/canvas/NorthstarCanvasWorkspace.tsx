"use client";

/**
 * Production Canvas shell. FlowCanvas remains the only spatial/generation kernel; this file only
 * joins it to the real Otto conversation and the small amount of route/account state around it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Coins } from "lucide-react";
import { CREATE_NAV_HREF } from "@fikirtive/core/navigation";
import { getMyAccount } from "@/lib/account-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import {
  CANVAS_OTTO_DOCK_ATTR,
  CANVAS_OTTO_DOCK_VAR,
  canvasOttoDockPx,
} from "@/lib/canvas-otto-dock";
import type { ChatThreadDTO, EntityDTO } from "@/lib/types";
import {
  upsertComposerReferences,
  type OttoComposerReference,
} from "@/lib/canvas-chat-reference";
import FlowCanvas from "./FlowCanvas";
import { canvasHref } from "./canvas-href";
import {
  CanvasOttoOverlay,
  type CanvasPendingFirst,
} from "./CanvasOttoOverlay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ImmersiveCanvasRuntimeContext = {
  projects: Array<{ id: string; name: string }>;
  threads: Array<{
    id: string;
    projectId: string;
    title: string;
    updatedAt: string;
    pinnedAt: string | null;
  }>;
  activeProjectId: string;
  activeThreadId: string | null;
  initialBalance: number;
  initialBalanceUsd: number;
  activeThread: ChatThreadDTO | null;
  pendingFirst: CanvasPendingFirst | null;
};

export function NorthstarCanvasWorkspace({
  runtimeContext,
  entities = [],
}: {
  runtimeContext: ImmersiveCanvasRuntimeContext;
  entities?: EntityDTO[];
}) {
  const [balance, setBalance] = useState({
    credits: runtimeContext.initialBalance,
    usd: runtimeContext.initialBalanceUsd,
  });
  const [activeThread, setActiveThread] = useState<ChatThreadDTO | null>(runtimeContext.activeThread);
  const [pendingFirst, setPendingFirst] = useState<CanvasPendingFirst | null>(runtimeContext.pendingFirst);
  const [composerReferences, setComposerReferences] = useState<OttoComposerReference[]>([]);
  /**
   * 哪几条对话此刻有付费生成在跑(走查 P0-1)。
   *
   * 这个文件是唯一同时挂着 `FlowCanvas` 与 `CanvasOttoOverlay` 的地方,所以也是唯一能把
   * 「Otto 那边批准了一张卡」这件事告诉画板的地方。从前它只接了余额那一条线:商家按下
   * 「Generate · 1 credit」,余额掉了、卡片说 ✓ Done,而画板一片空白,按 F5 图才出现。
   *
   * 画板要的机制**早就写好了**:`FlowCanvas` 收到 `activity` 一翻 true 就重读画板,服务端的
   * chat→canvas 桥(`syncOttoCanvasNodes`)把那张在飞的占位卡放上去;翻 false 再读一次,
   * 产出把占位卡换掉。这里只是把那句话接上,没有第二套机制、没有任何钱路变化。
   */
  const [busyThreadIds, setBusyThreadIds] = useState<Set<string>>(() => new Set());
  const activeCanvas = runtimeContext.projects.find((project) => project.id === runtimeContext.activeProjectId);

  /**
   * 把「Otto 输入框占掉了底边多少」量出来交给画布(2026-09-03 走查 D1,`lib/canvas-otto-dock.ts`
   * 有病根全文)。这里是唯一同时挂着 FlowCanvas 与 Otto 覆盖层的地方,所以也是唯一知道这两样
   * 东西在同一个角落里排队的地方。
   *
   * 量、而不是写死一个偏移:输入框会随附引用、贴图与报错长高,写死的偏移在它长高的第一天就
   * 又把工具条盖回去。ResizeObserver 同时盯着画布面和输入框,所以窗口变化与输入框变高都会
   * 立刻重算。前厅(未开对话)与对话流是两个不同的元素,`activeThread` 一换就重新找一次。
   */
  const surfaceRef = useRef<HTMLElement | null>(null);
  const dockThreadKey = activeThread?.id ?? null;
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const dock = surface.querySelector<HTMLElement>(`[${CANVAS_OTTO_DOCK_ATTR}]`);
    if (!dock) {
      surface.style.removeProperty(CANVAS_OTTO_DOCK_VAR);
      return;
    }
    const write = () => {
      surface.style.setProperty(
        CANVAS_OTTO_DOCK_VAR,
        `${canvasOttoDockPx(surface.getBoundingClientRect(), dock.getBoundingClientRect())}px`,
      );
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(surface);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      surface.style.removeProperty(CANVAS_OTTO_DOCK_VAR);
    };
  }, [dockThreadKey]);

  const replaceCanvasUrl = useCallback((threadId?: string) => {
    window.history.replaceState(
      window.history.state,
      "",
      canvasHref(runtimeContext.activeProjectId, threadId ? { threadId } : undefined),
    );
  }, [runtimeContext.activeProjectId]);

  const refreshBalance = useCallback(async () => {
    notifyBalanceRefresh();
    const account = await getMyAccount();
    if (!("error" in account)) {
      setBalance({ credits: account.balance, usd: account.balanceUsd });
    }
  }, []);

  const handleThreadChange = useCallback((thread: ChatThreadDTO) => {
    setActiveThread(thread);
    if (pendingFirst?.handoffId && thread.messages.length > 0) {
      setPendingFirst(null);
      replaceCanvasUrl(thread.id);
    }
  }, [pendingFirst, replaceCanvasUrl]);

  const handleStreamStart = useCallback((
    thread: ChatThreadDTO,
    pending: Omit<CanvasPendingFirst, "handoffId">,
  ) => {
    setPendingFirst(pending);
    setActiveThread(thread);
    replaceCanvasUrl(thread.id);
  }, [replaceCanvasUrl]);

  const setThreadGenerationActivity = useCallback((threadId: string, active: boolean) => {
    setBusyThreadIds((current) => {
      if (current.has(threadId) === active) return current;
      const next = new Set(current);
      if (active) next.add(threadId); else next.delete(threadId);
      return next;
    });
  }, []);

  const addComposerReferences = useCallback((refs: Omit<OttoComposerReference, "requestId">[]) => {
    const requested = refs.map((ref) => ({ ...ref, requestId: crypto.randomUUID() }));
    setComposerReferences((current) => upsertComposerReferences(current, requested));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
        <Button asChild variant="ghost" size="sm" className="px-2">
          <Link href={CREATE_NAV_HREF}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Create
          </Link>
        </Button>
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
          {activeCanvas?.name ?? "Canvas"}
        </span>
        <div className="flex-1" />
        <Badge
          variant="outline"
          aria-live="polite"
          className="font-mono text-[11px] font-medium text-muted-foreground tabular-nums"
        >
          <Coins aria-hidden="true" />
          {balance.credits.toLocaleString()} credits
        </Badge>
      </header>

      <main ref={surfaceRef} className="relative flex min-h-0 flex-1 flex-col">
        <FlowCanvas
          projectId={runtimeContext.activeProjectId}
          entities={entities}
          activeThreadId={activeThread?.id ?? null}
          activity={busyThreadIds}
          skin="gb"
          onBalanceRefresh={refreshBalance}
          onReferenceInChat={activeThread ? addComposerReferences : undefined}
          defaultComposerOpen={false}
        />
        <CanvasOttoOverlay
          projectId={runtimeContext.activeProjectId}
          entities={entities}
          balanceUsd={balance.usd}
          activeThread={activeThread}
          pendingFirst={pendingFirst}
          composerReferences={composerReferences}
          onThreadChange={handleThreadChange}
          onStreamStart={handleStreamStart}
          // Keep the durable handoff in the URL until the streamed turn is visible in the
          // persisted thread. OttoChatStream guards this mount with its own sent ref; retaining
          // the handoff here makes a lost/failed first request recoverable on refresh.
          onPendingFirstSent={() => {}}
          onComposerReferencesConsumed={(requestIds) => {
            setComposerReferences((current) => current.filter((ref) => !ref.requestId || !requestIds.includes(ref.requestId)));
          }}
          onBalanceRefresh={refreshBalance}
          onGenerationActivityChange={(active) => {
            const threadId = activeThread?.id;
            if (threadId) setThreadGenerationActivity(threadId, active);
          }}
        />
      </main>
    </div>
  );
}

export default NorthstarCanvasWorkspace;
