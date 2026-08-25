"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/**
 * 面板底下那句常驻的话,逐字取自 R22 原型 L5466 的 `#ottoContext`。
 *
 * 它替掉的是上一版那句把工程脚手架的名字直接怼到商家眼前的话 —— 那既不是他要知道的事,
 * 也不是他读得懂的词(那个词本身不再出现在这个文件里,连注释里也不留,`r22-extended-
 * surfaces.test.ts` 是逐字扫源码的)。这一面是不是样本数据由顶栏那枚
 * 「Prototype · sample data」徽章说,和面板里这句话讲的是两件事:这句讲的是**边界**
 * ——在这里聊天不会替你动任何东西。
 */
export const OTTO_PANEL_CONTEXT_NOTE = "General workspace help · no action will run from chat";
/** 原型 L5464 的 placeholder,一字不改。 */
export const OTTO_PANEL_PLACEHOLDER = "Ask Otto — @ adds references";

/** 前门那三格,寄存器照原型 `.otto-starter`(一行标题 + 一行说明)。 */
const R22_STARTERS = [
  { title: "Plan this week’s posts", detail: "Otto drafts a shape you can approve or change" },
  { title: "Explain what is waiting for me", detail: "Approvals, held connections, anything blocked" },
  { title: "Turn a product into a campaign", detail: "One product, three posts, one schedule" },
] as const;

function R22FixtureConversation({ userName, projectId, threads, activeThread, onThreadStarted, onThreadUpdate }: { userName: string; projectId: string; threads: ChatThreadDTO[]; activeThread: ChatThreadDTO | null; onThreadStarted: (thread: ChatThreadDTO) => void; onThreadUpdate: (thread: ChatThreadDTO) => void }) {
  const [text, setText] = React.useState("");
  const messages = activeThread?.messages ?? [];

  function send(forced?: string) {
    const clean = (forced ?? text).trim();
    if (!clean) return;
    const now = "2026-08-25T08:42:00.000Z";
    const nextOrdinal = threads.reduce((highest, thread) => {
      const match = /^fixture-otto-(\d+)$/.exec(thread.id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0) + 1;
    const fixtureThreadId = activeThread?.id ?? `fixture-otto-${nextOrdinal}`;
    // 回话的寄存器 = 原型 `responseFor()` 的说明型答案:讲这一页的事、讲边界,
    // 不讲「deterministic」「server」这类只有写代码的人才说的词。
    const reply = "Here is what I can see on this page, and what I would do next. Nothing runs from here — when something needs to happen, it comes back as a card you approve first.";
    const nextMessages: ChatThreadDTO["messages"] = [...messages, { id: `${fixtureThreadId}-user-${messages.length + 1}`, role: "USER", kind: "TEXT", seq: messages.length + 1, text: clean, payload: null, genJobId: null, createdAt: now }, { id: `${fixtureThreadId}-agent-${messages.length + 2}`, role: "AGENT", kind: "TEXT", seq: messages.length + 2, text: reply, payload: null, genJobId: null, createdAt: now }];
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
          <MessageScrollerContent className="r22-otto-thread">
            {/* 空态照原型 `.otto-empty`(L5473 那一段的兄弟):一句大标题、一句说明、三格起手式。
                不是一颗假装 Otto 已经说过话的气泡 —— 他还没说过。 */}
            {!messages.length ? <MessageScrollerItem messageId="fixture-welcome"><Message unstyled align="start"><MessageContent unstyled><Bubble unstyled align="start"><BubbleContent unstyled className="r22-otto-empty">
              <h2>Hi {userName}</h2>
              <p>Ask about anything on this page, or start with one of these.</p>
              <div className="r22-otto-starters">
                {R22_STARTERS.map((starter) => <Button unstyled key={starter.title} type="button" className="r22-otto-starter" onClick={() => send(starter.title)}><b>{starter.title}</b><span>{starter.detail}</span></Button>)}
              </div>
            </BubbleContent></Bubble></MessageContent></Message></MessageScrollerItem> : null}
            {messages.map((message) => { const user = message.role === "USER"; return <MessageScrollerItem key={message.id} messageId={String(message.id)} scrollAnchor={user}><Message unstyled align={user ? "end" : "start"}><MessageContent unstyled><Bubble unstyled align={user ? "end" : "start"}><BubbleContent unstyled className={user ? "r22-otto-msg-me" : "r22-otto-msg-otto"}>{message.text}</BubbleContent></Bubble></MessageContent></Message></MessageScrollerItem>; })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
    {/* 输入框在**底部**,是这根 flex 列的最后一格(原型 `.op-foot`)。父级
        `[data-otto-panel-body]` 必须是 flex 列,否则上面那格的 `flex-1` 是废的,
        整段会贴着顶走 —— 那正是 2026-08-25 Founder 看到的「输入框浮在上面」。 */}
    <form data-otto-panel-composer="" onSubmit={submit} className="r22-otto-foot">
      <label className="sr-only" htmlFor="r22-otto-fixture-composer">Ask Otto</label>
      <div className="r22-otto-composer">
        <Input unstyled id="r22-otto-fixture-composer" value={text} onChange={(event) => setText(event.target.value)} placeholder={OTTO_PANEL_PLACEHOLDER} className="r22-otto-composer-input" />
        <Button unstyled type="submit" disabled={!text.trim()} aria-label="Send" className="r22-otto-composer-send">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 12.5v-9M4.2 7.2 8 3.4l3.8 3.8" /></svg>
        </Button>
      </div>
      <div className="r22-otto-compose-note"><span>{OTTO_PANEL_CONTEXT_NOTE}</span><span>Enter to send</span></div>
    </form>
  </div>;
}
