"use client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";

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
  /** Explicit non-production parity mode. It keeps the composer interactive without calling server actions. */
  fixture?: boolean;
  /** 新会话建好了(前门那条路)。 */
  onThreadStarted: (thread: ChatThreadDTO) => void;
  /** 新会话建好了,并且第一句话要由会话流发出去。 */
  onStreamStart: (thread: ChatThreadDTO, pending: PendingFirstMessage) => void;
  /** 会话有了新内容(标题、时间、消息)。 */
  onThreadUpdate: (thread: ChatThreadDTO) => void;
  /** 换一条会话;null = 回到前门。 */
  onActiveThreadChange: (threadId: string | null) => void;
  onPendingFirstSent: () => void;
  onRetry?: () => void;
}

export function OttoPanelConversation({
  state,
  fixture = false,
  onThreadStarted,
  onStreamStart,
  onThreadUpdate,
  onActiveThreadChange,
  onPendingFirstSent,
  onRetry,
}: OttoPanelConversationProps) {
  if (state.status === "loading") {
    return (
      <p data-otto-panel-conversation="loading" className="px-4 py-6 text-[13px] text-muted-foreground">
        Opening your conversation…
      </p>
    );
  }
  if (state.status === "error") {
    // 说真话:不画一个空的输入框假装能用。
    return <div data-otto-panel-conversation="error" className="px-4 py-6 text-[13px] text-muted-foreground"><p>{state.message}</p>{onRetry ? <Button unstyled type="button" className="mt-3 rounded-lg border border-[#dddee6] bg-white px-3 py-2 text-[11.5px] text-[#16171c]" onClick={onRetry}>Retry</Button> : null}</div>;
  }

  const { seed, threads, activeThreadId, pendingFirst } = state;
  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  if (fixture) return <R22FixtureConversation userName={seed.userName} projectId={seed.projectId} threads={threads} activeThread={activeThread} onThreadStarted={onThreadStarted} onThreadUpdate={onThreadUpdate} />;

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

function R22FixtureConversation({ userName, projectId, threads, activeThread, onThreadStarted, onThreadUpdate }: { userName: string; projectId: string; threads: ChatThreadDTO[]; activeThread: ChatThreadDTO | null; onThreadStarted: (thread: ChatThreadDTO) => void; onThreadUpdate: (thread: ChatThreadDTO) => void }) {
  const [text, setText] = React.useState("");
  const messages = activeThread?.messages ?? [];

  function send() {
    const clean = text.trim();
    if (!clean) return;
    const now = "2026-08-25T08:42:00.000Z";
    const nextOrdinal = threads.reduce((highest, thread) => {
      const match = /^fixture-otto-(\d+)$/.exec(thread.id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0) + 1;
    const fixtureThreadId = activeThread?.id ?? `fixture-otto-${nextOrdinal}`;
    const nextMessages: ChatThreadDTO["messages"] = [...messages, { id: `${fixtureThreadId}-user-${messages.length + 1}`, role: "USER", kind: "TEXT", seq: messages.length + 1, text: clean, payload: null, genJobId: null, createdAt: now }, { id: `${fixtureThreadId}-agent-${messages.length + 2}`, role: "AGENT", kind: "TEXT", seq: messages.length + 2, text: "This is a deterministic visual reply. No conversation or action was sent to the server.", payload: null, genJobId: null, createdAt: now }];
    if (activeThread) onThreadUpdate({ ...activeThread, messages: nextMessages, updatedAt: now, status: "done" });
    else onThreadStarted({ id: fixtureThreadId, projectId, title: clean.length > 42 ? `${clean.slice(0, 39)}…` : clean, updatedAt: now, pinnedAt: null, status: "done", messages: nextMessages });
    setText("");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send();
  }

  return <div data-otto-panel-conversation="fixture" className="flex min-h-0 flex-1 flex-col">
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-3 px-4 py-5">
            {!messages.length ? <MessageScrollerItem messageId="fixture-welcome"><Message unstyled align="start"><MessageContent unstyled><Bubble unstyled align="start" className="mr-8"><BubbleContent unstyled className="rounded-xl border border-[#e8e9ef] bg-white px-3 py-2 text-[12.5px] leading-5 text-[#32343b]">Hi {userName}. I can help shape the work on this page.</BubbleContent></Bubble></MessageContent></Message></MessageScrollerItem> : null}
            {messages.map((message) => { const user = message.role === "USER"; return <MessageScrollerItem key={message.id} messageId={String(message.id)} scrollAnchor={user}><Message unstyled align={user ? "end" : "start"}><MessageContent unstyled><Bubble unstyled align={user ? "end" : "start"} className={user ? "ml-8" : "mr-8"}><BubbleContent unstyled className={user ? "rounded-xl bg-[#16171c] px-3 py-2 text-[12.5px] leading-5 text-white" : "rounded-xl border border-[#e8e9ef] bg-white px-3 py-2 text-[12.5px] leading-5 text-[#32343b]"}>{message.text}</BubbleContent></Bubble></MessageContent></Message></MessageScrollerItem>; })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
    <form onSubmit={submit} className="border-t border-[#e8e9ef] p-3">
      <label className="sr-only" htmlFor="r22-otto-fixture-composer">Ask Otto</label>
      <Textarea unstyled id="r22-otto-fixture-composer" rows={3} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Ask Otto anything…" className="w-full resize-none rounded-[10px] border border-[#dddee6] bg-white px-3 py-2 text-[12.5px] outline-none focus:border-[#686d79]" />
      <div className="mt-2 flex items-center justify-between gap-3"><span className="text-[10.5px] text-[#686d79]">Visual fixture · nothing is sent</span><Button unstyled type="submit" disabled={!text.trim()} className="min-h-8 rounded-lg bg-[#16171c] px-3 text-[11.5px] font-semibold text-white transition-transform duration-100 active:scale-[.97] disabled:opacity-40 motion-reduce:active:scale-100">Send</Button></div>
    </form>
  </div>;
}
