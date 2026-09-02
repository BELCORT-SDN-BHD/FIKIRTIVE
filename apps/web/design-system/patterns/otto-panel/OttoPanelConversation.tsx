"use client";

/**
 * OttoPanelConversation.tsx — 面板体里那段会话。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4;票 #994(W2-7)第 6 项、#995(W2-8)。
 *
 * 这里**没有第二套聊天**:前门是 `OttoFrontDoor`、会话是 `OttoChatStream`,与 `/otto` 那一页
 * 用的是同一对组件、同一条 `ottoTurn` 服务端动作(Shared actions 纪律)。这个文件只做旧壳
 * `OttoView` 左窗格那几行做的事:没有会话时画前门,有会话时画会话流。
 *
 * W2-8 起它**不再自己持有状态**:会话列表(`OttoThreadList`)与这一段读的是同一份会话,
 * 状态因此收在 `OttoPanelHost` 一处。两处各存一份的那一天,商家会在同一块面板上看到列表
 * 里有、聊天里没有的会话。
 */

import * as React from "react";
import type { ChatThreadDTO } from "@/lib/types";
import type { OttoPanelSeed } from "@/lib/otto-panel-seed";
import type { PendingFirstMessage } from "@/lib/otto-start-thread";
import { OttoChatStream } from "@/components/otto/OttoChatStream";
import { OttoFrontDoor } from "@/components/otto/OttoFrontDoor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";

/** 前门刚建好的会话要自动发出去的第一句话,和 `OttoView` 用的是同一条交接。 */
export type PendingFirst = PendingFirstMessage & { threadId: string };

export type OttoPanelConversationState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      seed: OttoPanelSeed;
      threads: ChatThreadDTO[];
      activeThreadId: string | null;
      pendingFirst: PendingFirst | null;
    };

export interface OttoPanelConversationProps {
  state: OttoPanelConversationState;
  /** 新会话建好了(前门那条路)。 */
  onThreadStarted: (thread: ChatThreadDTO) => void;
  /** 新会话建好了,并且第一句话要由会话流发出去。 */
  onStreamStart: (thread: ChatThreadDTO, pending: PendingFirstMessage) => void;
  /** 会话有了新内容(标题、时间、消息)。 */
  onThreadUpdate: (thread: ChatThreadDTO) => void;
  /** 换一条会话;null = 回到前门。 */
  onActiveThreadChange: (threadId: string | null) => void;
  onPendingFirstSent: () => void;
}

export function OttoPanelConversation({
  state,
  onThreadStarted,
  onStreamStart,
  onThreadUpdate,
  onActiveThreadChange,
  onPendingFirstSent,
}: OttoPanelConversationProps) {
  if (state.status === "loading") {
    return (
      <div data-otto-panel-conversation="loading" className="flex flex-col gap-3 px-4 py-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <Skeleton className="h-20 w-full rounded-[var(--radius-card)]" />
        <span className="sr-only">Opening your conversation…</span>
      </div>
    );
  }
  if (state.status === "error") {
    // 说真话:不画一个空的输入框假装能用。
    return (
      <div data-otto-panel-conversation="error" className="p-4">
        <Alert role="alert" variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { seed, threads, activeThreadId, pendingFirst } = state;
  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  return (
    <div data-otto-panel-conversation="ready" className="flex min-h-0 flex-1 flex-col">
      {activeThread ? (
        <OttoChatStream
          key={activeThread.id}
          // 会话自己的 project,不是面板默认那个 —— 列表覆盖每一个 project,选中别的
          // project 里那一条时,这一轮必须算在它自己的 project 上。
          projectId={activeThread.projectId}
          entities={seed.entities}
          thread={activeThread}
          balanceUsd={seed.balanceUsd}
          onNewConversation={() => onActiveThreadChange(null)}
          onRefresh={async () => {
            const fresh = await getCoworkThreadClient(activeThread.id);
            if (!fresh) return;
            onThreadUpdate(fresh);
            onActiveThreadChange(fresh.id);
          }}
          onThreadUpdate={onThreadUpdate}
          onBalanceRefresh={notifyBalanceRefresh}
          pendingFirst={
            pendingFirst && pendingFirst.threadId === activeThread.id
              ? { text: pendingFirst.text, goalKey: pendingFirst.goalKey, entityIds: pendingFirst.entityIds }
              : undefined
          }
          onPendingFirstSent={onPendingFirstSent}
        />
      ) : (
        <OttoFrontDoor
          projectId={seed.projectId}
          balanceUsd={seed.balanceUsd}
          entities={seed.entities}
          userName={seed.userName}
          onThreadStarted={onThreadStarted}
          onStreamStart={onStreamStart}
        />
      )}
    </div>
  );
}
