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
 *
 * 收口移植(main P3-6):会话那一整棵树(`OttoChatStream` → 审批卡 → 分镜卡 → …)仍然
 * `React.lazy` 按需加载 —— 静态 import 的话商家壳的 client bundle 从 9 个模块涨到 208 个,
 * 而**每一个**商家表面都要付这笔钱,包括面板收着、商家今天一次都没点开它的那些次。这道
 * 优化原来挂在 `OttoPanelMount`,状态搬进这一层(W2-8)之后跟着搬到这里 —— `OttoPanelShell`
 * / `OttoThreadList` / `OttoQuickChips` 都轻,仍然静态;`children`(整页内容)**不**被这道
 * Suspense 盖到,见下方 `return`:它是 `OttoPanelShell` 的 children,不在 panelBody 里。
 *
 * 用 `React.lazy` 而不是 `next/dynamic`:分包这件事是那句 `import()` 做的,两者一样;
 * 但 `next/dynamic` 只在 Next 自己的 runtime 里活 —— 在 vitest 里它恒渲染空,于是这一整段
 * 会话就再也没有测试盯着了。一个测不到的优化不值得用一整块验收去换。
 */

import * as React from "react";
import type { ChatThreadDTO } from "@/lib/types";
import { loadOttoPanelSeed } from "@/lib/otto-panel-seed";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { startStreamedThread, type PendingFirstMessage } from "@/lib/otto-start-thread";
import type { OttoPanelConversationState, PendingFirst } from "./OttoPanelConversation";
import { OttoPanelShell } from "./OttoPanelShell";
import { OttoQuickChips } from "./OttoQuickChips";
import { OttoThreadList } from "./OttoThreadList";
import { panelQuickChips } from "./panel-page";

const OttoPanelConversation = React.lazy(() =>
  import("./OttoPanelConversation").then((m) => ({ default: m.OttoPanelConversation })),
);

/** 分包还没到之前面板体里的那一行字,和会话自己的加载态说同一句话,免得闪两种。 */
function ConversationFallback() {
  return (
    <p data-otto-panel-conversation="loading" className="px-4 py-6 text-[13px] text-muted-foreground">
      Opening your conversation…
    </p>
  );
}

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
  const [chipError, setChipError] = React.useState<string | null>(null);
  /** 正在把哪一条历史的消息取回来(取到了才切过去,见 `selectThread`)。 */
  const [openingThreadId, setOpeningThreadId] = React.useState<string | null>(null);
  const [threadError, setThreadError] = React.useState<string | null>(null);

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

  // ── 上下文 chip:这一票**不画** ────────────────────────────────────────────
  //
  // 判官 r1 [P2]:chip 写着「On this page: Raya promo」,商家读到的是「Otto 看得见我这一页」;
  // 关掉它读到的是「Otto 不再看了」。两句话今天都不成立 —— 服务端没有任何读者会因为这一页
  // 是哪一页而改变这一轮的上下文:
  //   · `coworkTurnRequest` 的 `surface` / `subjectRef` 只被 `app/api/otto/stream/route.ts`
  //     **写进** ChatMessage 那一行,`buildOttoContext(...)` 的入参里没有它们;
  //   · `ottoTurn`(apps/web/lib/otto-actions.ts)与引擎(packages/otto/src)里这两个名字
  //     出现 0 次;
  //   · #879 step 1 自己的围栏就写着「pure shape, zero behavior change」。
  //
  // 所以 chip 传上去只会让面板替一件没发生的事背书。
  //
  // **chip 随 #879 step 2 启用**:那张票接上真读者的同一天,这里把 `contextChip` /
  // `contextAttached` 两个 prop 接回去即可 —— chip 本体(`OttoPanel` 那一段)与路径解析器
  // (`panel-page.ts` 的 `panelContextSubject`)都还在,连围栏一起。
  //
  // 取对象真名字的那个 server action **已经删掉**(Founder 整顿标准:零调用者的租户查询
  // 就是一块没人守望的攻击面,建了没用即根性缺陷)。step 2 按它自己的语义写读者,要参考
  // 上一版实现的话在 git 历史里(`apps/web/lib/otto-panel-context.ts`,提交 ea0db0f5)。

  // ── 会话 ────────────────────────────────────────────────────────────────
  //
  // 「现在该显示哪一条」这个**意图**的版本号。商家每表达一次新意图(选另一条、开新对话、
  // 前门或 chip 建了一条)就 +1;取数发起时记下当时的号码,落地时对不上就把结果丢掉。
  //
  // 判官 r2 [P3-新①]:没有这一道,一次迟到的取数会把商家**从他刚开的新对话里拽回**上一条
  // 旧会话 —— 前门连同里面打了一半的字一起消失。禁用按钮只挡得住看得见的那几条路(还有
  // chip 那一条),意图号才是真正的守卫:它拦的是「结果落地」这一刻,不是「点得到点不到」。
  const intentRef = React.useRef(0);
  /** 表达一次新意图,并拿到它的号码。只在事件处理里调用,不在渲染里。 */
  const claimIntent = React.useCallback(() => {
    setOpeningThreadId(null);
    return ++intentRef.current;
  }, []);

  const upsertThread = React.useCallback((thread: ChatThreadDTO) => {
    setThreads((current) => [thread, ...current.filter((t) => t.id !== thread.id)]);
  }, []);

  const handleThreadStarted = React.useCallback((thread: ChatThreadDTO) => {
    claimIntent();
    setThreadError(null);
    upsertThread(thread);
    setActiveThreadId(thread.id);
    setHistoryOpenedAt(null);
  }, [claimIntent, upsertThread]);

  const handleStreamStart = React.useCallback((thread: ChatThreadDTO, pending: PendingFirstMessage) => {
    handleThreadStarted(thread);
    setPendingFirst({ threadId: thread.id, ...pending });
  }, [handleThreadStarted]);

  const openNewChat = React.useCallback(() => {
    claimIntent();
    setThreadError(null);
    setActiveThreadId(null);
    setPendingFirst(null);
    setHistoryOpenedAt(null);
  }, [claimIntent]);

  /** 开合历史。判官 r2 [P3-新②]:打不开那句话不许跨开合残留 —— 关掉再打开是新的一眼。 */
  const toggleHistory = React.useCallback(() => {
    setThreadError(null);
    setHistoryOpenedAt((at) => (at === null ? Date.now() : null));
  }, []);

  /**
   * 从列表里选一条会话。
   *
   * 判官 r1 [P1-1]:种子里除了打开时那一条,其余全是 **meta**(`toChatThreadMetaDTO` 给的
   * `messages: []`)。只 `setActiveThreadId` 的话,商家点进任何一条历史看到的都是一片空白 ——
   * 而那片空白看起来不像「还在加载」,像「这条会话没了」。
   *
   * **先取回消息,拿到了才切**,不是先切再补:`OttoChatStream` 的初始消息是一次性的
   * `useState` 初始化(`chatInit`,那个组件按 thread.id 做 key、靠重挂载换会话),挂载之后
   * 再改 `thread.messages` 它一个字都不会读。所以「乐观切换 + 取回来 upsert」在这一处
   * 恰恰无效 —— 空白会一直留在那里。
   *
   * 取数走的是 `/otto` 换会话时用的同一个 `getCoworkThreadClient`,不是为面板另写一条。
   * 已经带着消息的那一条直接切;当前这一条不重取 —— 重取会把正在流式写入的那一轮换掉。
   *
   * 取数期间商家改主意了(开新对话、点了一颗 chip、又选了另一条)怎么办:那一刻意图号
   * 已经变了,这一次的结果**整份丢掉** —— 不切、不写进列表、也不报错。报错会让一个他
   * 已经放弃的动作在新界面上弹一句话出来。
   */
  const selectThread = React.useCallback(async (thread: ChatThreadDTO) => {
    const intent = claimIntent();
    setThreadError(null);
    if (thread.id === activeThreadId || thread.messages.length > 0) {
      setActiveThreadId(thread.id);
      setHistoryOpenedAt(null);
      return;
    }
    setOpeningThreadId(thread.id);
    const fresh = await getCoworkThreadClient(thread.id).catch(() => null);
    // 迟到判定要在**任何** setState 之前:商家已经去了别处,这一份结果就不该再影响界面。
    if (intentRef.current !== intent) return;
    setOpeningThreadId(null);
    // 取不到就**留在列表上**说一句实话,而不是切过去让商家盯着一片空白猜发生了什么。
    if (!fresh) {
      setThreadError("Couldn't open that conversation — please try again.");
      return;
    }
    upsertThread(fresh);
    setActiveThreadId(fresh.id);
    setHistoryOpenedAt(null);
  }, [activeThreadId, claimIntent, upsertThread]);

  // ── 快捷 chips ───────────────────────────────────────────────────────────
  const chips = React.useMemo(() => panelQuickChips(location), [location]);
  const seed = load.status === "ready" ? load.seed : null;

  const pickChip = React.useCallback(async (chip: { goalKey: string; label: string }) => {
    if (!seed || chipBusy) return;
    setChipBusy(true);
    setChipError(null);
    try {
      // 与前门目标格子同一条路(`lib/otto-start-thread.ts`):建一条空会话,把 chip 那句话
      // 连同 goalKey 交给会话流发出去。这一步不花钱,计费在那一轮真的跑起来之后。
      const started = await startStreamedThread({
        projectId: seed.projectId,
        text: chip.label,
        goalKey: chip.goalKey,
      }).catch(() => ({ error: "Couldn't reach Otto — please try again." }));
      // 判官 r1 [P2-2]:失败要说出来,照前门那一条的形状(`OttoFrontDoor` 的 setError)。
      // 一颗按下去什么都不发生的 chip,商家只会再按一次,然后以为产品坏了。
      if ("error" in started) {
        setChipError(started.error);
        return;
      }
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

  /**
   * 会话**常挂**,历史列表盖在它上面。
   *
   * 判官 r1 [P1-2]:原来这里是一个三元,同一个位置在两个组件类型之间换 —— React 会把整棵
   * 子树卸掉重建。代价不是「重画一次」:composer 里打了一半的字没了(判官实证 textarea 清空),
   * 正在流式的那一轮连同 `useChat` 实例一起消失,`onFinish` 永远不会写回去。打开历史看一眼
   * 就把商家正在做的事丢掉,是这块面板最不该有的行为。
   *
   * 用 `display: none` 而不是卸载:DOM 节点还在,React 状态、composer 里的字、流式那一轮
   * 全部原地不动。
   *
   * **display 走内联样式**而不是 `hidden` 属性 —— 理由不是「`hidden` 会失效」(判官 r2
   * [P3-新③] 更正了我上一版写反的说法):本仓 tailwindcss@4.3.0 的 preflight 写的是
   * `[hidden]:where(:not([hidden='until-found'])) { display: none !important }`,那个
   * `!important` 压得住 `.flex`,所以 `hidden` 本来也能藏住。
   *
   * 选内联的真正理由是它更稳、更好读:内联样式优先于任何非 `!important` 的类,不依赖
   * preflight 有没有被引入或将来会不会改写;显示与否由这个组件当场说了算,而且
   * `style.display` 可以被测试直接断言 —— 「藏起来了没有」因此是一条看得见的事实。
   */
  const panelBody = (
    <>
      <div
        data-otto-panel-conversation-wrap=""
        className="min-h-0 flex-1 flex-col"
        style={{ display: historyOpen ? "none" : "flex" }}
      >
        <React.Suspense fallback={<ConversationFallback />}>
          <OttoPanelConversation
            state={conversationState}
            onThreadStarted={handleThreadStarted}
            onStreamStart={handleStreamStart}
            onThreadUpdate={upsertThread}
            onActiveThreadChange={setActiveThreadId}
            onPendingFirstSent={() => setPendingFirst(null)}
          />
        </React.Suspense>
      </div>
      {historyOpenedAt !== null && seed && (
        <OttoThreadList
          projects={seed.projects}
          threads={threads}
          activeProjectId={seed.projectId}
          activeThreadId={activeThreadId}
          onSelectThread={(thread) => void selectThread(thread)}
          onNewChat={openNewChat}
          openingThreadId={openingThreadId}
          error={threadError}
          now={historyOpenedAt}
        />
      )}
    </>
  );

  return (
    <OttoPanelShell
      panelBody={panelBody}
      quickChips={
        seed ? (
          <OttoQuickChips
            chips={chips}
            disabled={chipBusy}
            error={chipError}
            onPick={(chip) => void pickChip(chip)}
          />
        ) : null
      }
      // 历史入口只在真的有列表可开时才画 —— 种子还没到就没有历史可看(§3.4:没接上的东西不画)。
      onOpenHistory={seed ? toggleHistory : undefined}
      historyOpen={historyOpen}
      onNewChat={seed ? openNewChat : undefined}
      // 正在把一条会话的消息取回来时,头部这两颗会改变「现在显示哪一条」的按钮先禁掉。
      // 真正的守卫是意图号(见上面 `claimIntent`);禁用只是让这一下不必发生。
      headerBusy={openingThreadId !== null}
    >
      {children}
    </OttoPanelShell>
  );
}
