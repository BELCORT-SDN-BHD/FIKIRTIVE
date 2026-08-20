"use client";

/**
 * OttoPanelConversation.tsx — 面板体里那段会话。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4;票 #994(W2-7)第 6 项。
 *
 * 这里**没有第二套聊天**:前门是 `OttoFrontDoor`、会话是 `OttoChatStream`,与 `/otto` 那一页
 * 用的是同一对组件、同一条 `ottoTurn` 服务端动作(Shared actions 纪律)。这个文件只做旧壳
 * `OttoView` 左窗格那几行做的事:没有会话时画前门,有会话时画会话流,以及把新建的会话接上。
 *
 * 取数是**按需**的:面板真的要画会话时才调 `loadOttoPanelSeed`。面板挂在每一个商家表面上,
 * 把这几条查询放进共享 layout 就等于每一次页面渲染都跑一遍 Otto 的数据装配 —— 包括商家
 * 今天一次都没点开过面板的那些次。
 *
 * **取几次,说准确**(判官 r1 P3-5):不是「整个 SPA 生命周期内只取一次」。面板收起时
 * `OttoPanel` 整个卸载(#1002 的契约),这个组件跟着走,所以**关一次再开一次 = 取两次**
 * (实测钉在 `otto-panel-mount.test.ts` 的「关一次再开一次」那条)。路由之间切换不重取,
 * 因为壳不卸载。
 *
 * 为什么不缓存掉那第二次:种子里带 `balanceUsd`,而这里的会话没有自己的余额订阅
 * (`OttoChatStream` 只是把它当普通 prop 传给审批卡)。缓存 = 把 credits 数字冻在第一次
 * 开面板那一刻,商家充完值回来还在读旧数 —— 在一个花钱的面上,这比 5 条查询贵得多。
 * 正解是先订阅 `subscribeBalanceRefresh` 再缓存,那是面板会话 plumbing 的活,W2-8(#995)
 * owns 它;本票不在它头上先做半套。
 *
 * 会话历史列表、上下文 chip、快捷 chips 都不在这里 —— 那是 W2-8(#995);窄版审批卡是 W2-9。
 */

import * as React from "react";
import type { ChatThreadDTO } from "@/lib/types";
import { loadOttoPanelSeed } from "@/lib/otto-panel-seed";
import { OttoChatStream } from "@/components/otto/OttoChatStream";
import { OttoFrontDoor } from "@/components/otto/OttoFrontDoor";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";

type Seed = Extract<Awaited<ReturnType<typeof loadOttoPanelSeed>>, { projectId: string }>;

type LoadState =
  | { status: "loading" }
  | { status: "ready"; seed: Seed }
  | { status: "error"; message: string };

/** 前门刚建好的会话要自动发出去的第一句话,和 `OttoView` 用的是同一条交接。 */
type PendingFirst = { threadId: string; text: string; goalKey?: string; entityIds?: string[] };

export function OttoPanelConversation() {
  const [load, setLoad] = React.useState<LoadState>({ status: "loading" });
  const [threads, setThreads] = React.useState<ChatThreadDTO[]>([]);
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null);
  const [pendingFirst, setPendingFirst] = React.useState<PendingFirst | null>(null);

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

  const handleThreadStarted = React.useCallback((thread: ChatThreadDTO) => {
    setThreads((current) => [thread, ...current.filter((t) => t.id !== thread.id)]);
    setActiveThreadId(thread.id);
  }, []);

  if (load.status === "loading") {
    return (
      <p data-otto-panel-conversation="loading" className="px-4 py-6 text-[13px] text-muted-foreground">
        Opening your conversation…
      </p>
    );
  }
  if (load.status === "error") {
    // 说真话:不画一个空的输入框假装能用。
    return (
      <p data-otto-panel-conversation="error" className="px-4 py-6 text-[13px] text-muted-foreground">
        {load.message}
      </p>
    );
  }

  const { seed } = load;
  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  return (
    <div data-otto-panel-conversation="ready" className="flex min-h-0 flex-1 flex-col">
      {activeThread ? (
        <OttoChatStream
          key={activeThread.id}
          projectId={seed.projectId}
          entities={seed.entities}
          thread={activeThread}
          balanceUsd={seed.balanceUsd}
          onNewConversation={() => setActiveThreadId(null)}
          onRefresh={async () => {
            const fresh = await getCoworkThreadClient(activeThread.id);
            if (!fresh) return;
            setThreads((current) => [fresh, ...current.filter((t) => t.id !== fresh.id)]);
            setActiveThreadId(fresh.id);
          }}
          onThreadUpdate={(updated) =>
            setThreads((current) => [updated, ...current.filter((t) => t.id !== updated.id)])
          }
          pendingFirst={
            pendingFirst && pendingFirst.threadId === activeThread.id
              ? { text: pendingFirst.text, goalKey: pendingFirst.goalKey, entityIds: pendingFirst.entityIds }
              : undefined
          }
          onPendingFirstSent={() => setPendingFirst(null)}
        />
      ) : (
        <OttoFrontDoor
          projectId={seed.projectId}
          balanceUsd={seed.balanceUsd}
          entities={seed.entities}
          userName={seed.userName}
          onThreadStarted={handleThreadStarted}
          onStreamStart={(thread, pending) => {
            handleThreadStarted(thread);
            setPendingFirst({ threadId: thread.id, ...pending });
          }}
        />
      )}
    </div>
  );
}
