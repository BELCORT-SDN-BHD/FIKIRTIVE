"use client";

/**
 * OttoPanelHost.tsx —— 面板里那些内容的**唯一状态持有者**。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4;票 #995(W2-8)。
 *
 * 为什么要有这一层:头部的「☰ 历史」、体里那段会话、底部的快捷 chips 讲的是同一件事 ——
 * 商家的会话。会话列表与会话流各存一份的那一天,商家会在同一块面板上看到列表里有、
 * 聊天里没有的会话。所以三处共用的东西(种子、会话、当前是哪一条)收在这里一份。
 *
 * 取数仍是**按需**的:面板挂在每一个商家表面上,把这几条查询放进共享 layout 就等于每一次
 * 页面渲染都跑一遍 Otto 的数据装配。第一次真的要画会话时才调一次 `loadOttoPanelSeed`。
 */

import * as React from "react";
import type { ChatThreadDTO } from "@/lib/types";
import { loadOttoPanelSeed } from "@/lib/otto-panel-seed";
import { loadOttoPanelContextName } from "@/lib/otto-panel-context";
import { startStreamedThread, type PendingFirstMessage } from "@/lib/otto-start-thread";
import {
  OttoPanelConversation,
  type OttoPanelConversationState,
  type PendingFirst,
} from "./OttoPanelConversation";
import { OttoPanelShell } from "./OttoPanelShell";
import { OttoQuickChips } from "./OttoQuickChips";
import { OttoThreadList } from "./OttoThreadList";
import { panelContextSubject, panelQuickChips } from "./panel-page";

type Seed = Extract<Awaited<ReturnType<typeof loadOttoPanelSeed>>, { projectId: string }>;

type Load =
  | { status: "loading" }
  | { status: "ready"; seed: Seed }
  | { status: "error"; message: string };

export function OttoPanelHost({
  location,
  children,
}: {
  /** 当前地址(与 `OttoPanelMount` 收到的是同一个字符串)。 */
  location: string;
  children: React.ReactNode;
}) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [threads, setThreads] = React.useState<ChatThreadDTO[]>([]);
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null);
  const [pendingFirst, setPendingFirst] = React.useState<PendingFirst | null>(null);
  // 「历史开着」与「按哪一刻分档」是同一件事:打开的那一下是一个事件,时间在那里读一次就
  // 定住了。在渲染里读 `Date.now()` 会让同一份列表在每次重画时可能换一档(跨午夜那一下)。
  const [historyOpenedAt, setHistoryOpenedAt] = React.useState<number | null>(null);
  const historyOpen = historyOpenedAt !== null;
  const [chipBusy, setChipBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 服务端动作自己不抛(它把失败折成 {error}),但网络那一段仍可能断。
      const result = await loadOttoPanelSeed().catch(() => ({ error: "Otto is not reachable right now." }));
      if (cancelled) return;
      if ("error" in result) {
        setLoad({ status: "error", message: result.error });
        return;
      }
      setLoad({ status: "ready", seed: result });
      setThreads(result.threads);
      setActiveThreadId(result.activeThreadId);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── 上下文 chip ──────────────────────────────────────────────────────────
  // 商家关掉之后,**本次会话**不再自动带上下文。这一条是「现在这一段对话」的事实,不是
  // 这台设备的偏好,所以它只活在内存里:不落 localStorage、不落库。刷新之后是新的一段。
  const [contextDismissed, setContextDismissed] = React.useState(false);
  const subject = React.useMemo(() => panelContextSubject(location), [location]);
  // 名字连同**它是谁的名字**一起存:换一页时不必先清空(那是一次 effect 里的 setState),
  // 读的时候对不上就当没读到 —— 上一页的战役名一帧都不会出现在这一页的 chip 上。
  const [objectName, setObjectName] = React.useState<{ objectId: string; name: string } | null>(null);

  React.useEffect(() => {
    if (!subject || subject.kind !== "object") return;
    const { objectKind, objectId } = subject;
    let cancelled = false;
    void (async () => {
      const found = await loadOttoPanelContextName(objectKind, objectId).catch(() => null);
      if (!cancelled && found) setObjectName({ objectId, name: found.name });
    })();
    return () => {
      cancelled = true;
    };
  }, [subject]);

  /** chip 上写的那个名字。对象页要等真名字回来 —— 没读到就不画 chip,不用 id 顶替。 */
  const contextLabel = subject === null
    ? null
    : subject.kind === "page"
      ? subject.label
      : objectName?.objectId === subject.objectId
        ? objectName.name
        : null;

  /** 这一轮要不要自动把商家看的这一页当上下文。关掉之后为 false —— 断言看这一条。 */
  const contextAttached = !contextDismissed && contextLabel !== null;

  // ── 会话 ────────────────────────────────────────────────────────────────
  const upsertThread = React.useCallback((thread: ChatThreadDTO) => {
    setThreads((current) => [thread, ...current.filter((t) => t.id !== thread.id)]);
  }, []);

  const handleThreadStarted = React.useCallback((thread: ChatThreadDTO) => {
    upsertThread(thread);
    setActiveThreadId(thread.id);
    setHistoryOpenedAt(null);
  }, [upsertThread]);

  const handleStreamStart = React.useCallback((thread: ChatThreadDTO, pending: PendingFirstMessage) => {
    handleThreadStarted(thread);
    setPendingFirst({ threadId: thread.id, ...pending });
  }, [handleThreadStarted]);

  const openNewChat = React.useCallback(() => {
    setActiveThreadId(null);
    setPendingFirst(null);
    setHistoryOpenedAt(null);
  }, []);

  const selectThread = React.useCallback((thread: ChatThreadDTO) => {
    setActiveThreadId(thread.id);
    setHistoryOpenedAt(null);
  }, []);

  // ── 快捷 chips ───────────────────────────────────────────────────────────
  const chips = React.useMemo(() => panelQuickChips(location), [location]);
  const seed = load.status === "ready" ? load.seed : null;

  const pickChip = React.useCallback(async (chip: { goalKey: string; label: string }) => {
    if (!seed || chipBusy) return;
    setChipBusy(true);
    try {
      // 与前门目标格子同一条路(`lib/otto-start-thread.ts`):建一条空会话,把 chip 那句话
      // 连同 goalKey 交给会话流发出去。这一步不花钱,计费在那一轮真的跑起来之后。
      const started = await startStreamedThread({
        projectId: seed.projectId,
        text: chip.label,
        goalKey: chip.goalKey,
      });
      if ("error" in started) return;
      handleStreamStart(started.thread, started.pending);
    } finally {
      setChipBusy(false);
    }
  }, [seed, chipBusy, handleStreamStart]);

  const conversationState: OttoPanelConversationState =
    load.status === "loading"
      ? { status: "loading" }
      : load.status === "error"
        ? { status: "error", message: load.message }
        : { status: "ready", seed: load.seed, threads, activeThreadId, pendingFirst };

  const panelBody = historyOpenedAt !== null && seed ? (
    <OttoThreadList
      projects={seed.projects}
      threads={threads}
      activeProjectId={seed.projectId}
      activeThreadId={activeThreadId}
      onSelectThread={selectThread}
      onNewChat={openNewChat}
      now={historyOpenedAt}
    />
  ) : (
    <OttoPanelConversation
      state={conversationState}
      onThreadStarted={handleThreadStarted}
      onStreamStart={handleStreamStart}
      onThreadUpdate={upsertThread}
      onActiveThreadChange={setActiveThreadId}
      onPendingFirstSent={() => setPendingFirst(null)}
    />
  );

  return (
    <OttoPanelShell
      panelBody={panelBody}
      quickChips={
        seed ? <OttoQuickChips chips={chips} disabled={chipBusy} onPick={(chip) => void pickChip(chip)} /> : null
      }
      // 历史入口只在真的有列表可开时才画 —— 种子还没到就没有历史可看(§3.4:没接上的东西不画)。
      onOpenHistory={seed ? () => setHistoryOpenedAt((at) => (at === null ? Date.now() : null)) : undefined}
      historyOpen={historyOpen}
      onNewChat={seed ? openNewChat : undefined}
      contextAttached={contextAttached}
      contextChip={
        contextAttached && contextLabel
          ? { label: contextLabel, onDismiss: () => setContextDismissed(true) }
          : undefined
      }
    >
      {children}
    </OttoPanelShell>
  );
}
