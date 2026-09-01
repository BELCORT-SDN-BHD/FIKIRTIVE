"use client";

/**
 * Production Canvas shell. FlowCanvas remains the only spatial/generation kernel; this file only
 * joins it to the real Otto conversation and the small amount of route/account state around it.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Coins } from "lucide-react";
import { CREATE_NAV_HREF } from "@fikirtive/core/navigation";
import { getMyAccount } from "@/lib/account-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
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
  const activeCanvas = runtimeContext.projects.find((project) => project.id === runtimeContext.activeProjectId);

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

      <main className="relative flex min-h-0 flex-1 flex-col">
        <FlowCanvas
          projectId={runtimeContext.activeProjectId}
          entities={entities}
          activeThreadId={activeThread?.id ?? null}
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
          onNewConversation={() => {
            setActiveThread(null);
            setPendingFirst(null);
            setComposerReferences([]);
            replaceCanvasUrl();
          }}
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
        />
      </main>
    </div>
  );
}

export default NorthstarCanvasWorkspace;
