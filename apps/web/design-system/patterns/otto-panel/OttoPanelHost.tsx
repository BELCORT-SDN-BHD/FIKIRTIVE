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
 * **会话取数**按面板开合来,不是挂载一次就够:面板挂在每一个商家表面上,把这几条查询放进
 * 共享 layout 就等于每一次页面渲染都跑一遍 Otto 的数据装配,包括商家一次都没点开面板的
 * 那些次 —— 所以那一份取数(`loadOttoPanelSeed`)不跟这一层的挂载走,这一层是无条件挂的。
 * 真正该跟的信号是 `useOttoPanelControls().open` 从关到开的那一下:每次打开都重取一次,
 * 不是只在首次挂载时取一次。种子里带着 `balanceUsd`,商家去 /billing 充了值回来,关开一次
 * 面板就该看见新的数字(面板会话自己没有余额刷新订阅,理由见 `OttoPanelConversation.tsx`
 * 顶部)。读 `open` 的那个小组件(`PanelOpenWatcher`,定义在下面)必须挂在 `OttoPanelShell`
 * 的 children 里才够得到那个 hook —— 这一层自己是 `OttoPanelShell` 的调用者,不是它的
 * 后代,读不到 Provider 往下发的值。
 *
 * 这条纪律管的是**会话取数**,不是这一层发出的每一个请求(#1200 判官 P2-5:原话写成
 * 「取数不能跟着挂载走」,而展开信号偏偏就跟着挂载走,读起来像自相矛盾)。展开信号
 * (`fetchPanelThreadPending`,FRONT-A14)**必须**跟挂载走:它回答的是「这次到访要不要
 * 展开」,而面板还没开的时候没有别的时机可问 —— 它是一次不带参数、不落库、不轮询的读,
 * 与上面那份重取讲的是两件事。
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
import { fetchPanelThreadPending, panelDismissedThisSession, rememberPanelDismissed } from "@/lib/otto-panel-activity";
import { loadOttoPanelSeed } from "@/lib/otto-panel-seed";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { startStreamedThread, type PendingFirstMessage } from "@/lib/otto-start-thread";
import { deleteCoworkThread, renameCoworkThread, setCoworkThreadPinned } from "@/lib/otto-client-actions";
import {
  deleteProject as deleteProjectAction,
  renameProject as renameProjectAction,
  setProjectPinned as setProjectPinnedAction,
} from "@/lib/actions";
import { nextActiveThreadId } from "@/lib/thread-list";
import { isCanvasThread, isPanelThread } from "@/lib/otto-thread-surface";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";
import { OttoConfirmDialog, OttoRenameDialog } from "@/components/otto/OttoPromptDialog";
import type { OttoPanelConversationState, PendingFirst } from "./OttoPanelConversation";
import { OttoPanelShell, useOttoPanelControls } from "./OttoPanelShell";
import { OttoQuickChips } from "./OttoQuickChips";
import { OttoThreadList } from "./OttoThreadList";
import { formatPanelScope, panelContextSubject, panelQuickChips } from "./panel-page";

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

/**
 * 报「面板现在开着还是关着」给 `OttoPanelHost`。必须挂在 `OttoPanelShell` 的 children 里
 * 才够得到 `useOttoPanelControls()` —— 那个 context 由 `OttoPanelShell` 自己的 Provider
 * 往下发,只喂给它的后代;`OttoPanelHost` 是 Shell 的调用者,不是后代,读不到。不画任何东西。
 */
function PanelOpenWatcher({ onOpenChange }: { onOpenChange: (open: boolean, hydrated: boolean) => void }) {
  const controls = useOttoPanelControls();
  const open = controls?.open ?? false;
  // `hydrated` 一起报上去:存档套用那一步(收起→展开,或反过来)不是商家的动作,
  // 调用方要靠它把「商家自己关的」与「hydration 落地」分开(#1200 判官 P2-4)。
  const hydrated = controls?.hydrated ?? false;
  React.useEffect(() => {
    onOpenChange(open, hydrated);
  }, [open, hydrated, onOpenChange]);
  return null;
}

type Seed = Extract<Awaited<ReturnType<typeof loadOttoPanelSeed>>, { projectId: string }>;

type Load =
  | { status: "loading" }
  | { status: "ready"; seed: Seed }
  | { status: "error"; message: string };

/** 深链一次性消费的三个信号(规格书 §2.2/§2.5):`/?otto=1&project=P&thread=T`。 */
type DeepLink = {
  /** `?otto=1` —— 这次访问必须打开面板,不管 localStorage 上次记了什么。 */
  forceOpen: boolean;
  projectId: string | undefined;
  threadId: string | undefined;
};

/** `location` 可能带 query(与 `OttoPanelMount` 收到的是同一个字符串),只看那一段。 */
function parseDeepLink(location: string): DeepLink {
  const qIndex = location.indexOf("?");
  const query = new URLSearchParams(qIndex >= 0 ? location.slice(qIndex + 1) : "");
  return {
    forceOpen: query.get("otto") === "1",
    projectId: query.get("project") ?? undefined,
    threadId: query.get("thread") ?? undefined,
  };
}

/**
 * 这一次 `location` 算不算「带着深链」——`null` 就是「不带,没有到达可言」。
 *
 * 判官 r2(PR #1086 最新一条):三个信号里只要有一个在场,这次地址就是一次深链;三者的
 * 具体取值(尤其 `forceOpen`)也计入这个签名,所以「裸 project」与「同一个 project 但带
 * `otto=1`」是两次不同的到达——各自都要触发一轮新的处理,不会因为 project 没变就被判定
 * 成同一次到达的重渲染。
 */
function deepLinkSignature(deepLink: DeepLink): string | null {
  if (!deepLink.forceOpen && deepLink.projectId === undefined && deepLink.threadId === undefined) return null;
  return `${deepLink.forceOpen ? "1" : "0"}|${deepLink.projectId ?? ""}|${deepLink.threadId ?? ""}`;
}

export function OttoPanelHost({
  location,
  children,
}: {
  /** 当前地址(与 `OttoPanelMount` 收到的是同一个字符串)。 */
  location: string;
  children: React.ReactNode;
}) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const seed = load.status === "ready" ? load.seed : null;
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
  /** 整理会话(W2-11 收编导轨:重命名 / 置顶 / 删除 —— 与 `OttoNav.tsx` 同一批动作函数)。 */
  const [renameThreadTarget, setRenameThreadTarget] = React.useState<ChatThreadDTO | null>(null);
  const [deleteThreadTarget, setDeleteThreadTarget] = React.useState<ChatThreadDTO | null>(null);
  /** 整理项目,同一批(`@/lib/actions` 的 renameProject / setProjectPinned / deleteProject)。 */
  const [renameProjectTarget, setRenameProjectTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = React.useState<{ id: string; name: string } | null>(null);
  /** 面板此刻开着还是关着 —— 由 `PanelOpenWatcher`(挂在下面 `children` 旁边)报上来。 */
  const [open, setOpen] = React.useState(false);

  // 判官 r2(PR #1086 最新一条,根因修复):`location` 本来就随 `useSearchParams()` 响应式
  // 更新(`MerchantAppShell` → `pathWithQuery`),这一层挂在根 layout 上跨软导航不卸载
  // ——之前把深链冻结在 `useState(() => parseDeepLink(location))` 的挂载初值里,等于只认
  // 「这一层第一次挂载时地址栏说了什么」,Back/Forward 或第二次软导航到同一个
  // `/?otto=1&project=P&thread=T` 因此被无视(被删的 otto-new-conversation-routing.test.ts
  // 277-320 行钉的正是这类重访)。改成每次 `location` 变化都重新解析,不冻结。
  const deepLink = React.useMemo(() => parseDeepLink(location), [location]);
  const signature = React.useMemo(() => deepLinkSignature(deepLink), [deepLink]);

  // signature 已经被处理成一次「到达」——地址栏参数一旦消失就清空,让同一组值下次再出现
  // 时(而不是这次渲染的重复)重新算一次新到达,不是「已经处理过」。
  const consumedSignatureRef = React.useRef<string | null>(null);
  // 最近一次未消费到达排定的 {projectId, threadId}——被下面的取数 effect 消费一次就清空
  // (`null` 就是「没有覆盖,走默认:当前 project 最近一条」,#1022 的默认路径不变)。
  const pendingSelectRef = React.useRef<{ projectId: string | undefined; threadId: string | undefined } | null>(null);
  // 每一次真到达都 +1——哪怕面板已经开着(裸 project/thread 到达不碰 `open`),取数 effect
  // 也要能重跑,不必等一次「关到开」的转折。
  const [fetchTrigger, setFetchTrigger] = React.useState(0);
  // 面板必须展开的**两个**理由共用这一个 token:带 `otto=1` 的深链到达(商家点名要开),
  // 以及「本页有进行中的对话」(FRONT-A14 的真信号,见下面那个 effect)。给 Shell 的是一个
  // 每次都换新的字符串(计数器而非签名本身),这样同一组深链参数在离开地址栏后再次出现,
  // 也照样算一次新到达而不是「Shell 已经见过这串值」——Shell 不需要知道任何重置规则,
  // 只认「这个值变了」,也不需要知道这一次是哪个理由让它开的。
  const forceOpenTokenRef = React.useRef(0);
  const [forceOpenToken, setForceOpenToken] = React.useState<string | null>(null);
  const forceOpen = React.useCallback(() => {
    forceOpenTokenRef.current += 1;
    setForceOpenToken(String(forceOpenTokenRef.current));
  }, []);

  React.useEffect(() => {
    if (signature === null) {
      // 判官 r4(PR #1086 最新一条,「pending 复活」反向回归):r4 那处修法让被取消的取数
      // 原样保留 pendingSelectRef,好让强开之后真正落地的那次还能用上——但如果地址栏此刻
      // 已经不带任何深链参数了,这份「留着待用」的 pending 就该跟着归零,不能活过深链本身
      // 的寿命。不然:到达 A 被取消(存档关闭,或到达后立刻被商家手关)→ 软导航到一个无
      // 深链参数的地址 → 商家自己手动开一次面板(不是新到达,该走默认路径)→ 却读到 A
      // 留下的 pendingSelectRef,把商家带回一条早就翻篇的旧深链会话。
      //
      // 语义:pending 的生命周期与「URL 还挂着这个深链」绑定——参数还在,取消了可以留着
      // 复用(r4 修的那条);参数一旦离开地址栏,不管有没有被消费,一切归零。
      consumedSignatureRef.current = null;
      pendingSelectRef.current = null;
      return;
    }
    if (signature === consumedSignatureRef.current) return; // 同一次到达的重渲染,零动作
    consumedSignatureRef.current = signature;
    pendingSelectRef.current = { projectId: deepLink.projectId, threadId: deepLink.threadId };
    setFetchTrigger((n) => n + 1);
    if (deepLink.forceOpen) forceOpen();
  }, [signature, deepLink, forceOpen]);

  // 「这个商家有进行中的面板对话 → 展开」(FRONT-A14,`docs/specs/frontend-baseline.md` §5)。
  //
  // 这一条从前读的是深链 `?otto=1`,Founder 2026-09-04 追认那是**近似**:`?otto=1` 说的是
  // 「商家点名要开面板」(`/otto` 那条旧地址重定向过来的落点),不是「这里有一段正在跑的
  // 对话」——商家在 Library 留着一条在跑的对话、离开再回来,面板不展开。现在读的是真信号:
  // 服务端按 `ownerId` 查在途 GenJob + 面板自己的对话(`lib/thread-activity.ts`),客户端
  // 一个参数都不传,租户只信服务端 principal。
  //
  // 口径是**全店**,不是「本页」(#1200 判官 P2-1/P2-2):那句服务端判据不带 project,面板
  // 落座那一侧(`loadOttoPanelSeed`)因此也放宽到全店 —— 两处必须是同一句话,不然信号说
  // 「有」、落座在当前 project 里选不到,弹开的是一块空面板。
  //
  // **不新增轮询**(#544):挂载时问一次。`OttoPanelHost` 挂在商家壳根部,整页加载挂一次、
  // 软导航不卸载,所以「每次挂载问一次」正好就是「每次到访问一次」。答案是「有」就走与深链
  // 同一条强开路(`forceOpen()`)——存档记着关也照样开,与 Founder 原话的「或」一致;答案是
  // 「没有」就什么都不做,默认收起那一条(`defaultOttoPanelState`)自然生效。
  //
  // 商家自己关过一次就不再问(#1200 判官 P2-4):同一程里 /create 与画布往返都是整页加载,
  // 每一次都会重跑这个 effect,而在跑的那单生成还在跑 —— 于是刚被商家关掉的面板一次次被
  // 同一个信号弹回来。自动展开是建议,商家的手是决定;记号存在 sessionStorage,寿命就是这
  // 一程(`panelDismissedThisSession`)。深链 `?otto=1` 不受影响,它是商家点名要开。
  React.useEffect(() => {
    if (panelDismissedThisSession()) return;
    const controller = new AbortController();
    void fetchPanelThreadPending(controller.signal).then((pending) => {
      if (!controller.signal.aborted && pending) forceOpen();
    });
    return () => controller.abort();
  }, [forceOpen]);

  // 面板从开到关只有一个来源:商家自己(头部 ✕ / launcher / `Cmd+J`,都走 `OttoPanelShell`
  // 的 `setPanelOpen(current, false)`)。所以这一下转折就是「商家已手动关闭」,记进这一程。
  // `hydrated` 之前不算:那一步是把 localStorage 的存档套到首帧默认值上,不是商家的动作。
  const panelWasOpenRef = React.useRef(false);
  const handlePanelOpenChange = React.useCallback((next: boolean, hydrated: boolean) => {
    if (hydrated) {
      if (panelWasOpenRef.current && !next) rememberPanelDismissed();
      panelWasOpenRef.current = next;
    }
    setOpen(next);
  }, []);

  // 打开的每一下都重取一次,不是只在这一层挂载时取一次(见本文件顶部「取数按面板开合来」)。
  // `open` 从 false 变 true 才会真的发一次请求;从 true 变 false 只是把这一效果的依赖标记
  // 为已变,函数体自己早退,不发请求 —— 关掉面板不该顺手再打一次数据装配。`fetchTrigger`
  // 是第二条能让这个 effect 重跑的信号:面板已经开着时一次裸 project/thread 到达不会翻动
  // `open`,但同样要用新的 select 重取一次。
  //
  // 判官 r3(PR #1086 最新一条,刀锋竞态):硬着陆 + localStorage 存档为关时,Shell 首帧
  // 默认 open=true、hydration 随后才写 false——这一拍间这个 effect 会把 pendingSelectRef
  // 消费掉发起第一次取数,随即被那次关闭的 cleanup 取消(下面的 `cancelled`);force
  // signal 强开后触发的第二次取数(真正落地、提交进状态的那次)如果发现 pendingSelectRef
  // 已经被第一次(被取消的那次)清空,就会收 `undefined`、落回默认会话,深链等于白读。
  // 修法:pending 只能被**提交成功的取数**消费——被取消的那次原样保留 pendingSelectRef,
  // 留给下一次真正落地的取数继续用;只有在结果真的写进状态之前,才把它清空(而且要核对
  // 没有被更新的到达顶替过,不然会吞掉一个还没来得及跑的更新到达)。
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const startedWithSelect = pendingSelectRef.current;
    const select = startedWithSelect ?? undefined;
    void (async () => {
      // 服务端动作自己不抛(它把失败折成 {error}),但网络那一段仍可能断。
      const result = await loadOttoPanelSeed(select).catch(() => ({ error: "Otto is not reachable right now." }));
      if (cancelled) return; // 这次取数被后来的关闭顶掉了——pendingSelectRef 原样留着,
      // 不清:下一次真正落地的取数(强开之后的那次)还要用它,不能收一个空的默认路径。
      // 这次取数确实要提交了——它排定的 select 已经用掉,可以清了;但只在没人在这次取数
      // 飞行途中排了一个更新的到达时才清(那种情况下 pendingSelectRef 早就不是
      // `startedWithSelect` 了,清掉的话会把还没来得及跑的那次新到达吞掉)。
      if (pendingSelectRef.current === startedWithSelect) {
        pendingSelectRef.current = null;
      }
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
  }, [open, fetchTrigger]);

  // ── 头部那一行:只在它带得来新信息时才画 ──────────────────────────────────
  //
  // 判官 r1 [P2] 的裁定今天仍然成立:chip 写「On this page: Raya promo」时,商家读到的是
  // 「Otto 看得见我这一页」;关掉它读到的是「Otto 不再看了」。两句话都不成立 —— 服务端
  // 没有任何读者会因为这一页是哪一页而改变这一轮的上下文(`buildOttoContext` 的入参里
  // 没有 `surface`/`subjectRef`;引擎里这两个名字出现 0 次)。
  //
  // 这一行说的是**位置**,不是「Otto 读得到什么」。两段不是同一件事,别把整条读成「归属」
  // (判官 #1247 K7 P2-2):第一段(`Canvas` / `Workspace`)才是这一条对话的归属,取自
  // `active.surface`;第二段是名字,而两态取法不同 ——
  //   · `surface === "canvas"` → `Canvas · <画布名>`,画布名跟着这条对话走(`active.projectId`);
  //   · `surface === "panel"`  → `Workspace · <页面名>`,页面名跟着**商家此刻打开的那一页**走
  //     (`panelContextSubject(location)`,导航表那一份权威),同一条工作区对话在不同页面上
  //     读到的第二段就不一样 —— 它说的是「你现在在哪一页」,不是「这条对话属于哪一页」;
  //   · 新对话、以及来路不明的老行(`surface === null`)→ 一行都不画。
  //
  // 为什么老行不画(判官 P2-1):「不是 panel」里混着「确知是画布」与「查不出来」两种东西。
  // 把后者标成任何一边都是替一件我们并不知道真假的事作证。说出口的话只认 `isCanvasThread`
  // 与 `isPanelThread`;而「要不要自动续它」那个不出声的决定照旧只认 `isPanelThread`。
  //
  // 工作区那一半是清单 G1(P1-010,FRONT-A14 家族)的原文要求:商家在两种对话之间来回时,
  // 面板要一直写着「这一段属于哪里」——只在画布那一态出声,就等于让工作区对话看起来像是
  // 「没有归属」。判官 P2-4 上一轮把它收窄成单态并挂起待裁,清单这一轮把它接回来;
  // Founder 走查 FRONT-A14 时可改判(登记在 `docs/specs/frontend-baseline.md` §5)。
  //
  // 页面名只有导航表一份权威(`panelContextSubject` → `everyNavDestination()`),这里一个
  // 字面量都不写。导航里没有名字的那几面(首页、个人资料)或者对象页 → 只剩 `Workspace`
  // 一个词,不编一个名字。
  const scopeChip = React.useMemo(() => {
    const active = activeThreadId ? threads.find((t) => t.id === activeThreadId) ?? null : null;
    if (!active) return undefined;
    if (isCanvasThread(active.surface)) {
      // 画布名从种子里那份项目清单取(那是这个商家自己的项目,已经按 ownerId 查出来过);
      // 取不到名字就只写 `Canvas` —— 不编一个名字,也不去多查一次库。
      return {
        label: formatPanelScope(PRODUCT_VOCABULARY.canvas, seed?.projects.find((p) => p.id === active.projectId)?.name),
        hint: "This conversation belongs to a canvas.",
      };
    }
    if (!isPanelThread(active.surface)) return undefined;
    const subject = panelContextSubject(location);
    return {
      label: formatPanelScope(PRODUCT_VOCABULARY.workspace, subject?.kind === "page" ? subject.label : null),
      hint: "This conversation belongs to the workspace, not to a canvas.",
    };
  }, [activeThreadId, threads, seed, location]);

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

  // ── 整理会话:重命名 / 置顶 / 删除(W2-11)────────────────────────────────────
  //
  // Shared actions 纪律:动作函数与 `OttoNav.tsx` 的 `handleRenameThread` /
  // `handleSetThreadPinned` / `handleDeleteThread` 是同三个(`@/lib/otto-client-actions`),
  // 这里不重写业务层,只是这一份状态(`threads`)自己的乐观更新 + 失败回滚 —— 面板与旧导轨
  // 各自持一份 React state,回滚这一步没法共用。

  const requestRenameThread = React.useCallback((id: string) => {
    const target = threads.find((t) => t.id === id);
    if (target) setRenameThreadTarget(target);
  }, [threads]);

  const requestDeleteThread = React.useCallback((id: string) => {
    const target = threads.find((t) => t.id === id);
    if (target) setDeleteThreadTarget(target);
  }, [threads]);

  const setThreadPinned = React.useCallback(async (id: string, pinned: boolean) => {
    const snapshot = threads;
    const pinnedAt = pinned ? new Date().toISOString() : null;
    setThreads((items) => items.map((t) => (t.id === id ? { ...t, pinnedAt } : t)));
    const result = await setCoworkThreadPinned(id, pinned);
    if ("error" in result) {
      setThreads(snapshot);
      setThreadError(result.error);
    }
  }, [threads]);

  const renameThread = React.useCallback(async (id: string, title: string): Promise<string | null> => {
    const clean = title.trim();
    if (!clean) return "Enter a conversation name.";
    const snapshot = threads;
    setThreads((items) => items.map((t) => (t.id === id ? { ...t, title: clean } : t)));
    try {
      const result = await renameCoworkThread(id, clean);
      if ("error" in result) {
        setThreads(snapshot);
        return result.error;
      }
      return null;
    } catch {
      setThreads(snapshot);
      throw new Error("The conversation rename response was lost.");
    }
  }, [threads]);

  const deleteThread = React.useCallback(async (id: string): Promise<string | null> => {
    const snapshot = threads;
    const snapshotActive = activeThreadId;
    const next = nextActiveThreadId(threads, id, activeThreadId);
    setThreads((items) => items.filter((t) => t.id !== id));
    if (activeThreadId === id) setActiveThreadId(next);
    try {
      const result = await deleteCoworkThread(id);
      if ("error" in result) {
        setThreads(snapshot);
        setActiveThreadId(snapshotActive);
        return result.error;
      }
      return null;
    } catch {
      setThreads(snapshot);
      setActiveThreadId(snapshotActive);
      throw new Error("The conversation deletion response was lost.");
    }
  }, [threads, activeThreadId]);

  // ── 整理项目:重命名 / 置顶 / 删除(W2-11)────────────────────────────────────
  //
  // 面板里「项目」这一层今天只在会话历史的分组标题上露面(`OttoThreadList` 的 project
  // header)——查过 Home「接着做」那一列(纯 `<Link>`,零控件)与 Library(那页是跨项目的
  // 素材墙,压根不列项目)之后,这里是唯一还能挂得上控件的地方,不是新发明一处。

  /** 重取一次种子 —— 删除项目牵连太多(会连它名下的会话一起消失),客户端手工推演这份状态
   *  容易出错,不如让服务端(已经在 `deleteProject` 里 `revalidatePath` 过)重新说一次真相。 */
  const reloadSeed = React.useCallback(async () => {
    const result = await loadOttoPanelSeed().catch(() => ({ error: "Otto is not reachable right now." }));
    if ("error" in result) {
      setLoad({ status: "error", message: result.error });
      return;
    }
    setLoad({ status: "ready", seed: result });
    setThreads(result.threads);
    setActiveThreadId(result.activeThreadId);
  }, []);

  const requestRenameProject = React.useCallback((id: string) => {
    const target = seed?.projects.find((p) => p.id === id);
    if (target) setRenameProjectTarget(target);
  }, [seed]);

  const requestDeleteProject = React.useCallback((id: string) => {
    const target = seed?.projects.find((p) => p.id === id);
    if (target) setDeleteProjectTarget(target);
  }, [seed]);

  const setProjectPinned = React.useCallback(async (id: string, pinned: boolean) => {
    const pinnedAt = pinned ? new Date().toISOString() : null;
    setLoad((current) =>
      current.status === "ready"
        ? { ...current, seed: { ...current.seed, projects: current.seed.projects.map((p) => (p.id === id ? { ...p, pinnedAt } : p)) } }
        : current,
    );
    const result = await setProjectPinnedAction(id, pinned);
    if ("error" in result) {
      setThreadError(result.error);
      await reloadSeed();
    }
  }, [reloadSeed]);

  const renameProject = React.useCallback(async (id: string, name: string): Promise<string | null> => {
    try {
      const result = await renameProjectAction(id, name);
      if ("error" in result) return result.error;
      setLoad((current) =>
        current.status === "ready"
          ? { ...current, seed: { ...current.seed, projects: current.seed.projects.map((p) => (p.id === id ? { ...p, name: result.name } : p)) } }
          : current,
      );
      return null;
    } catch {
      throw new Error(`The ${PRODUCT_VOCABULARY.canvas} rename response was lost.`);
    }
  }, []);

  const deleteProject = React.useCallback(async (id: string): Promise<string | null> => {
    try {
      const result = await deleteProjectAction(id);
      if ("error" in result) return result.error;
      await reloadSeed();
      return null;
    } catch {
      throw new Error(`The ${PRODUCT_VOCABULARY.canvas} deletion response was lost.`);
    }
  }, [reloadSeed]);

  // ── 快捷 chips ───────────────────────────────────────────────────────────
  const chips = React.useMemo(() => panelQuickChips(location), [location]);

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
        // FRONT-A14:chip 是**面板**上的入口,它开的是面板自己的对话。
        surface: "panel",
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
          onRenameThread={requestRenameThread}
          onSetThreadPinned={(id, pinned) => void setThreadPinned(id, pinned)}
          onDeleteThread={requestDeleteThread}
          onRenameProject={requestRenameProject}
          onSetProjectPinned={(id, pinned) => void setProjectPinned(id, pinned)}
          onDeleteProject={requestDeleteProject}
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
      // 只有「打开的是一条**归属确知**的对话」时才有这一行(画布或工作区);`scopeChip`
      // 自己就是 undefined(种子还没到时 `threads` 是空的,同样落到 undefined),不必再包一层。
      contextChip={scopeChip}
      // 历史入口只在真的有列表可开时才画 —— 种子还没到就没有历史可看(§3.4:没接上的东西不画)。
      onOpenHistory={seed ? toggleHistory : undefined}
      historyOpen={historyOpen}
      onNewChat={seed ? openNewChat : undefined}
      // 正在把一条会话的消息取回来时,头部这两颗会改变「现在显示哪一条」的按钮先禁掉。
      // 真正的守卫是意图号(见上面 `claimIntent`);禁用只是让这一下不必发生。
      headerBusy={openingThreadId !== null}
      forceOpenSignal={forceOpenToken}
    >
      <PanelOpenWatcher onOpenChange={handlePanelOpenChange} />
      {children}
      {/* 整理会话的两个对话框 —— 与 `OttoNav.tsx`/`OttoApp.tsx` 的会话删改弹窗一字不差
          (同一份文案,不是重写一份),挂在这里而不是 `OttoPanelShell` 之外:面板是常驻的,
          对话框只在商家真的点了改名/删除才浮现。 */}
      <OttoRenameDialog
        open={!!renameThreadTarget}
        onOpenChange={(open) => { if (!open) setRenameThreadTarget(null); }}
        title="Rename conversation"
        description="This only changes the label shown in the conversation history."
        label="Conversation name"
        initialValue={renameThreadTarget?.title ?? ""}
        onSubmit={async (title) => {
          if (!renameThreadTarget) return null;
          return renameThread(renameThreadTarget.id, title);
        }}
      />
      <OttoConfirmDialog
        open={!!deleteThreadTarget}
        onOpenChange={(open) => { if (!open) setDeleteThreadTarget(null); }}
        title="Permanently delete conversation?"
        description={deleteThreadTarget ? `Otto will delete "${deleteThreadTarget.title}" and its messages.` : ""}
        impacts={[
          "The conversation and its messages are permanently deleted.",
          `${PRODUCT_VOCABULARY.canvas} nodes and generated media are detached from this conversation.`,
          "Generated library assets stay available.",
        ]}
        confirmText={deleteThreadTarget?.title}
        confirmLabel="Delete conversation"
        confirmingLabel="Deleting…"
        tone="danger"
        onConfirm={async () => {
          if (!deleteThreadTarget) return null;
          return deleteThread(deleteThreadTarget.id);
        }}
      />
      <OttoRenameDialog
        open={!!renameProjectTarget}
        onOpenChange={(open) => { if (!open) setRenameProjectTarget(null); }}
        title={`Rename ${PRODUCT_VOCABULARY.canvas}`}
        description="This only changes the sidebar name. Your chats, canvas, and assets stay where they are."
        label={`${PRODUCT_VOCABULARY.canvas} name`}
        initialValue={renameProjectTarget?.name ?? ""}
        onSubmit={async (name) => {
          if (!renameProjectTarget) return null;
          return renameProject(renameProjectTarget.id, name);
        }}
      />
      <OttoConfirmDialog
        open={!!deleteProjectTarget}
        onOpenChange={(open) => { if (!open) setDeleteProjectTarget(null); }}
        title={`Permanently delete ${PRODUCT_VOCABULARY.canvas}?`}
        description={deleteProjectTarget ? `Otto will delete "${deleteProjectTarget.name}" and everything scoped to that ${PRODUCT_VOCABULARY.canvas}.` : ""}
        impacts={[
          `The ${PRODUCT_VOCABULARY.canvas} record is permanently deleted.`,
          `Its chats, nodes, jobs, and ${PRODUCT_VOCABULARY.canvas}-scoped media records are deleted.`,
          "Global library assets and credit ledger rows are not deleted here.",
        ]}
        confirmText={deleteProjectTarget?.name}
        confirmLabel={`Delete ${PRODUCT_VOCABULARY.canvas}`}
        confirmingLabel="Deleting…"
        tone="danger"
        onConfirm={async () => {
          if (!deleteProjectTarget) return null;
          return deleteProject(deleteProjectTarget.id);
        }}
      />
    </OttoPanelShell>
  );
}
