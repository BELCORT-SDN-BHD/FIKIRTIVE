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
import { OttoAnswerCard } from "./OttoAnswerCard";
import {
  OTTO_ANSWER_ERROR_NOTE,
  OTTO_ANSWER_ERROR_TITLE,
  OTTO_ANSWER_WAIT_LABEL,
  OTTO_ANSWER_WAIT_MS,
  ottoAnswerCopyText,
  ottoAnswerShouldFail,
  responseFor,
  type OttoAnswerSignals,
} from "./otto-answer";

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
  /**
   * 商家此刻在看的那一页的名字(导航里的名字,例如 "Approvals")。它做两件事:
   * 决定这一轮答案走哪一路(`responseFor`),以及底下那一行说的是哪一片工作区。
   * 认不出这一页时就是那句最通用的 "General workspace help",不编一个页名。
   */
  contextLabel?: string;
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
  contextLabel,
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

  if (fixture) return <R22FixtureConversation projectId={seed.projectId} threads={threads} activeThread={activeThread} contextLabel={contextLabel} onThreadStarted={onThreadStarted} onThreadUpdate={onThreadUpdate} />;

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
export const OTTO_PANEL_CONTEXT_DEFAULT = "General workspace help";
const OTTO_PANEL_CONTEXT_SUFFIX = " · no action will run from chat";
export const OTTO_PANEL_CONTEXT_NOTE = `${OTTO_PANEL_CONTEXT_DEFAULT}${OTTO_PANEL_CONTEXT_SUFFIX}`;

/**
 * 那句话的完整形状 = `<商家在看的这一页> · no action will run from chat`(原型 L6709 的
 * `$('#ottoContext').textContent=ottoContext+' · no action will run from chat'`)。
 * 认不出这一页时退回最通用的那半句 —— 边界那半句一个字不改,它在任何一页上都成立。
 */
export function ottoPanelContextNote(label?: string): string {
  return `${label?.trim() || OTTO_PANEL_CONTEXT_DEFAULT}${OTTO_PANEL_CONTEXT_SUFFIX}`;
}

/** 原型 L5464 的 placeholder,一字不改。 */
export const OTTO_PANEL_PLACEHOLDER = "Ask Otto — @ adds references";

/** fixture 那一面的时间锚点 —— 固定值,不用 `Date.now()`(同一次跑要能重现)。 */
const R22_FIXTURE_NOW = "2026-08-25T08:42:00.000Z";

/**
 * fixture 工作区自己的两个信号(见 `otto-answer.ts` 的 `OttoAnswerSignals`)。
 *
 * 它们不是占位:这个样本工作区的故事就是「没有例程在跑,Instagram 还没连上」——
 * 种子里那条 "Reconnect Instagram" 会话说的正是这件事。真接后端的那条路走
 * `OttoChatStream`,一个字都不经过这里。
 */
const R22_FIXTURE_SIGNALS: OttoAnswerSignals = { activeRoutines: 0, channelConnected: false };

/** 一条 fixture 回话把「按哪条上下文、答的哪句话」记在 payload 上,而不是把答案拍扁成一段字。 */
type OttoAnswerPayload = { ottoAnswer: { context: string; prompt: string } };

function answerPayloadOf(message: ChatThreadDTO["messages"][number]): OttoAnswerPayload["ottoAnswer"] | null {
  const payload = message.payload as Partial<OttoAnswerPayload> | null;
  const answer = payload?.ottoAnswer;
  return answer && typeof answer.prompt === "string" ? answer : null;
}

/**
 * 空态那三格起手卡,逐字取自原型 `starterHTML()`(L6709)的 `.otto-starter`。
 *
 * 每一格**两句字面**分开存:卡上画的是 `title` + `detail`,按下去发出去的是 `prompt`
 * —— 原型同一处这么分(`data-otto-starter` 存预填的提问句,`<b>`/`<span>` 存另外两句可见
 * 文案),因为可见文案是说给商家听的「这格是干嘛的」,不是真的要问 Otto 的那句话。三句
 * `prompt` 各自保证命中 `responseFor` 的一条真路由,不落到兜底的 "Workspace help"。
 */
const R22_STARTERS = [
  { title: "Explain what needs review", detail: "Read the approval and its source.", prompt: "Why is this waiting for review?" },
  { title: "Check routine boundaries", detail: "See what autonomous work may do.", prompt: "What changes while a routine is paused?" },
  { title: "Trace Otto IQ provenance", detail: "Find merchant-controlled knowledge and its source.", prompt: "Where did Otto learn this?" },
] as const;

/** 一轮还没落地的问答:等着的那句话、它按的是哪一页、以及这一次是不是重试。 */
type PendingTurn = { prompt: string; context: string; retrying: boolean };

function R22FixtureConversation({ projectId, threads, activeThread, contextLabel, onThreadStarted, onThreadUpdate }: { projectId: string; threads: ChatThreadDTO[]; activeThread: ChatThreadDTO | null; contextLabel?: string; onThreadStarted: (thread: ChatThreadDTO) => void; onThreadUpdate: (thread: ChatThreadDTO) => void }) {
  const [text, setText] = React.useState("");
  /** 正在想(`.otto-wait`)。原型是「发出去 → 等一下 → 落答案或落一句读不出来」。 */
  const [pending, setPending] = React.useState<PendingTurn | null>(null);
  /** 读不出来(`.otto-error`)。它留在会话里,带一颗 Retry —— 不是一句消失的 toast。 */
  const [failure, setFailure] = React.useState<PendingTurn | null>(null);
  const messages = activeThread?.messages ?? [];
  const context = contextLabel?.trim() || OTTO_PANEL_CONTEXT_DEFAULT;

  // 等待落地那一刻要读的是**最新**的会话,不是发起那一刻捕获的那份 —— 中间商家可能又
  // 说了一句。用 ref 把最新的交给定时器,免得把 effect 的依赖写成一串会自我重启的东西
  // (依赖里放对象 = 每次渲染都换新身份 = 定时器一直重开、永远等不到 560ms)。
  const latest = React.useRef({ activeThread, onThreadUpdate });
  React.useEffect(() => {
    latest.current = { activeThread, onThreadUpdate };
  });

  React.useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      setPending(null);
      // 读不出来长什么样,商家自己打一句带 error / fail 的话就看得到(原型同一条正则)。
      // 重试那一次不再触发 —— 否则 Retry 永远回到同一堵墙。
      if (!pending.retrying && ottoAnswerShouldFail(pending.prompt)) {
        setFailure(pending);
        return;
      }
      const { activeThread: thread, onThreadUpdate: update } = latest.current;
      if (!thread) return;
      const answer = responseFor(pending.context, pending.prompt, R22_FIXTURE_SIGNALS);
      const seq = thread.messages.length + 1;
      update({
        ...thread,
        updatedAt: R22_FIXTURE_NOW,
        status: "done",
        messages: [...thread.messages, {
          id: `${thread.id}-answer-${seq}`,
          role: "AGENT",
          kind: "TEXT",
          seq,
          // `text` 存的就是 Copy 出去的那一份全文:任何只读 `.text` 的地方(列表预览、
          // 导出)读到的与商家眼前那张卡逐字相同,不会各说各的。
          text: ottoAnswerCopyText(answer),
          payload: { ottoAnswer: { context: pending.context, prompt: pending.prompt } },
          genJobId: null,
          createdAt: R22_FIXTURE_NOW,
        }],
      });
    }, OTTO_ANSWER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  function send(forced?: string) {
    const clean = (forced ?? text).trim();
    if (!clean || pending) return;
    setFailure(null);
    const nextOrdinal = threads.reduce((highest, thread) => {
      const match = /^fixture-otto-(\d+)$/.exec(thread.id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0) + 1;
    const fixtureThreadId = activeThread?.id ?? `fixture-otto-${nextOrdinal}`;
    const seq = messages.length + 1;
    const said: ChatThreadDTO["messages"][number] = { id: `${fixtureThreadId}-user-${seq}`, role: "USER", kind: "TEXT", seq, text: clean, payload: null, genJobId: null, createdAt: R22_FIXTURE_NOW };
    // 商家那句话立刻上屏,答案随后到 —— 中间那段空白由 `.otto-wait` 顶着,不是一片死寂。
    if (activeThread) onThreadUpdate({ ...activeThread, messages: [...messages, said], updatedAt: R22_FIXTURE_NOW, status: "working" });
    else onThreadStarted({ id: fixtureThreadId, projectId, title: clean.length > 42 ? `${clean.slice(0, 39)}…` : clean, updatedAt: R22_FIXTURE_NOW, pinnedAt: null, status: "working", messages: [said] });
    setText("");
    setPending({ prompt: clean, context, retrying: false });
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
            {/* 空态逐字照原型 `starterHTML()`(L6709):一行上下文、一句大标题、一句说明、三格
                起手式。不是一颗假装 Otto 已经说过话的气泡 —— 他还没说过,也不替商家打招呼
                (原型这里没有称呼,只有边界与三条真能问的问题)。 */}
            {!messages.length ? <MessageScrollerItem messageId="fixture-welcome"><Message unstyled align="start"><MessageContent unstyled><Bubble unstyled align="start"><BubbleContent unstyled className="r22-otto-empty">
              <div className="r22-otto-context">{context} · explicit help, not a routine action</div>
              <h2>How can Otto help?</h2>
              <p>I can explain this workspace and point you to a shared action. I cannot claim an action ran unless you use that action.</p>
              <div className="r22-otto-starters">
                {R22_STARTERS.map((starter) => <Button unstyled key={starter.title} type="button" className="r22-otto-starter" onClick={() => send(starter.prompt)}><b>{starter.title}</b><span>{starter.detail}</span></Button>)}
              </div>
            </BubbleContent></Bubble></MessageContent></Message></MessageScrollerItem> : null}
            {messages.map((message) => {
              const user = message.role === "USER";
              // Otto 的回话是一张**结构化的卡**(原型 `answerHTML`),不是一段散文:
              // 标题说这是什么、要点说清边界、注脚说这一轮什么都没动,再加一排真动作。
              const answered = user ? null : answerPayloadOf(message);
              return <MessageScrollerItem key={message.id} messageId={String(message.id)} scrollAnchor={user}><Message unstyled align={user ? "end" : "start"}><MessageContent unstyled><Bubble unstyled align={user ? "end" : "start"}><BubbleContent unstyled className={user ? "r22-otto-msg-me" : "r22-otto-msg-otto"}>
                {answered
                  ? <OttoAnswerCard answerId={String(message.id)} answer={responseFor(answered.context, answered.prompt, R22_FIXTURE_SIGNALS)} />
                  : message.text}
              </BubbleContent></Bubble></MessageContent></Message></MessageScrollerItem>;
            })}
            {pending && (
              <MessageScrollerItem messageId="otto-wait">
                <p data-otto-panel-wait="" className="r22-otto-wait">
                  <span className="r22-otto-mini-ring" aria-hidden />
                  <span>{OTTO_ANSWER_WAIT_LABEL}</span>
                </p>
              </MessageScrollerItem>
            )}
            {failure && (
              <MessageScrollerItem messageId="otto-error">
                {/* 读不出来就说读不出来,并且**当场说清没有代价** —— 商家最怕的不是失败,
                    是不知道刚才那一下有没有花掉什么。Retry 就在这句话旁边。 */}
                <div role="alert" data-otto-panel-answer-error="" className="r22-otto-error">
                  <b>{OTTO_ANSWER_ERROR_TITLE}</b>
                  <span>{OTTO_ANSWER_ERROR_NOTE}</span>
                  <Button unstyled type="button" data-otto-panel-answer-retry="" onClick={() => { setFailure(null); setPending({ ...failure, retrying: true }); }}>
                    Retry
                  </Button>
                </div>
              </MessageScrollerItem>
            )}
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
        <Button unstyled type="submit" disabled={!text.trim() || pending !== null} aria-label="Send" className="r22-otto-composer-send">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 12.5v-9M4.2 7.2 8 3.4l3.8 3.8" /></svg>
        </Button>
      </div>
      <div className="r22-otto-compose-note"><span data-otto-panel-context-note="">{ottoPanelContextNote(contextLabel)}</span><span>Enter to send</span></div>
    </form>
  </div>;
}
