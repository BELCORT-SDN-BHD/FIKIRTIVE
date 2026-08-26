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
 * 取数按**面板开合**来,不是挂载一次就够:面板挂在每一个商家表面上,把这几条查询放进
 * 共享 layout 就等于每一次页面渲染都跑一遍 Otto 的数据装配,包括商家一次都没点开面板的
 * 那些次 —— 所以取数不能跟着这一层(`OttoPanelHost`)的挂载走,这一层是无条件挂的。真正
 * 该跟的信号是 `useOttoPanelControls().open` 从关到开的那一下:每次打开都重取一次,不是
 * 只在首次挂载时取一次。种子里带着 `balanceUsd`,商家去 /billing 充了值回来,关开一次
 * 面板就该看见新的数字(面板会话自己没有余额刷新订阅,理由见 `OttoPanelConversation.tsx`
 * 顶部)。读 `open` 的那个小组件(`PanelOpenWatcher`,定义在下面)必须挂在 `OttoPanelShell`
 * 的 children 里才够得到那个 hook —— 这一层自己是 `OttoPanelShell` 的调用者,不是它的
 * 后代,读不到 Provider 往下发的值。
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
import { deleteCoworkThread, renameCoworkThread, setCoworkThreadPinned } from "@/lib/otto-client-actions";
import {
  deleteProject as deleteProjectAction,
  renameProject as renameProjectAction,
  setProjectPinned as setProjectPinnedAction,
} from "@/lib/actions";
import { nextActiveThreadId } from "@/lib/thread-list";
import { OttoConfirmDialog, OttoRenameDialog } from "@/components/otto/OttoPromptDialog";
import type { OttoPanelConversationState, PendingFirst } from "./OttoPanelConversation";
import { OttoPanelShell, useOttoPanelControls } from "./OttoPanelShell";
import { OttoQuickChips } from "./OttoQuickChips";
import { OttoThreadList } from "./OttoThreadList";
import { OTTO_ROOMS_ID, OttoRoomSwitcher } from "./OttoRoomSwitcher";
import { panelContextSubject, panelQuickChips } from "./panel-page";
import { readR22WorkspaceDirectory } from "@/components/r22/r22-workspace-fixture";
import {
  buildOttoResearchThread,
  nextOttoResearchOrdinal,
  takeOttoSiteResearchRequest,
} from "@/components/otto/conversation/otto-research";

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
function PanelOpenWatcher({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const open = useOttoPanelControls()?.open ?? false;
  React.useEffect(() => {
    onOpenChange(open);
  }, [open, onOpenChange]);
  return null;
}

type Seed = Extract<Awaited<ReturnType<typeof loadOttoPanelSeed>>, { projectId: string }>;

const R22_FIXTURE_SEED: Seed = {
  projectId: "fixture-raya",
  entities: [],
  projects: [{ id: "fixture-raya", name: "Raya launch", pinnedAt: null }],
  threads: [
    { id: "fixture-otto-raya", projectId: "fixture-raya", title: "Raya launch plan", updatedAt: "2026-08-24T12:40:00.000Z", pinnedAt: "2026-08-24T12:41:00.000Z", status: "done", messages: [{ id: "fixture-otto-raya-user", role: "USER", kind: "TEXT", seq: 1, text: "Help me shape the Raya launch into three clear posts.", payload: null, genJobId: null, createdAt: "2026-08-24T12:39:00.000Z" }, { id: "fixture-otto-raya-agent", role: "AGENT", kind: "TEXT", seq: 2, text: "Start with the market-stall story, follow with the scent pairing, then close with the gift deadline.", payload: null, genJobId: null, createdAt: "2026-08-24T12:40:00.000Z" }] },
    { id: "fixture-otto-connect", projectId: "fixture-raya", title: "Reconnect Instagram", updatedAt: "2026-08-23T08:15:00.000Z", pinnedAt: null, status: "done", messages: [{ id: "fixture-otto-connect-user", role: "USER", kind: "TEXT", seq: 1, text: "Why is Instagram held?", payload: null, genJobId: null, createdAt: "2026-08-23T08:14:00.000Z" }, { id: "fixture-otto-connect-agent", role: "AGENT", kind: "TEXT", seq: 2, text: "The provider has not confirmed this workspace connection. Reconnect from Settings before anything can publish.", payload: null, genJobId: null, createdAt: "2026-08-23T08:15:00.000Z" }] },
    // creation 线程(Founder 2026-08-26 裁决第 1/2 条):它与上面两条是**分开的线程**,
    // 但同列在这一张表里,行尾带一条回它自己那块板的路。归属写在消息的 payload 上
    // (`ottoCanvas`),判断只有 `otto-thread-state.ts` 一处。
    { id: "fixture-canvas-raya", projectId: "fixture-raya", title: "Raya market stall shots", updatedAt: "2026-08-25T08:20:00.000Z", pinnedAt: null, status: "working", messages: [{ id: "fixture-canvas-raya-user", role: "USER", kind: "TEXT", seq: 1, text: "Four shots of the candles on the market stall, warm morning light.", payload: { ottoCanvas: { projectId: "fixture-raya", projectName: "Raya launch" } }, genJobId: null, createdAt: "2026-08-25T08:19:00.000Z" }, { id: "fixture-canvas-raya-agent", role: "AGENT", kind: "TEXT", seq: 2, text: "Two are on the board. The other two are still going.", payload: null, genJobId: null, createdAt: "2026-08-25T08:20:00.000Z" }] },
  ],
  activeThreadId: null,
  balanceUsd: 250,
  userName: "Nadia",
};

const R22_OTTO_FIXTURE_KEY = "r22:otto-panel:v1";
const R22_OTTO_FIXTURE_UPDATED_AT = "2026-08-25T08:42:00.000Z";
type R22OttoFixtureState = { projects: Seed["projects"]; threads: ChatThreadDTO[]; activeThreadId: string | null };

function readR22OttoFixture(workspaceId: string): R22OttoFixtureState | null {
  try {
    const stored = window.sessionStorage.getItem(`${R22_OTTO_FIXTURE_KEY}:${workspaceId}`);
    return stored ? JSON.parse(stored) as R22OttoFixtureState : null;
  } catch { return null; }
}

function writeR22OttoFixture(workspaceId: string, value: R22OttoFixtureState): void {
  try { window.sessionStorage.setItem(`${R22_OTTO_FIXTURE_KEY}:${workspaceId}`, JSON.stringify(value)); } catch { /* The visual fixture remains usable without storage. */ }
}

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
  variant = "legacy",
}: {
  /** 当前地址(与 `OttoPanelMount` 收到的是同一个字符串)。 */
  location: string;
  children: React.ReactNode;
  variant?: "legacy" | "r22";
}) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const fixture = process.env.NODE_ENV !== "production" && new URLSearchParams(location.split("?", 2)[1] ?? "").get("fixture") === "r22";
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
  const [fixtureWorkspaceId, setFixtureWorkspaceId] = React.useState("batik-house");
  const [fixtureLoaded, setFixtureLoaded] = React.useState(false);
  const fixtureFailedOnceRef = React.useRef(false);
  const fixtureLoadState = new URLSearchParams(location.split("?", 2)[1] ?? "").get("ottoState");

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
  // 只有带 `otto=1` 的到达才会强开面板。给 Shell 的是一个每次真到达都换新的字符串(计数器
  // 而非签名本身),这样同一组深链参数在离开地址栏后再次出现,也照样算一次新到达而不是
  // 「Shell 已经见过这串值」——Shell 不需要知道任何重置规则,只认「这个值变了」。
  const forceOpenTokenRef = React.useRef(0);
  const [forceOpenToken, setForceOpenToken] = React.useState<string | null>(null);

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
    if (deepLink.forceOpen) {
      forceOpenTokenRef.current += 1;
      setForceOpenToken(String(forceOpenTokenRef.current));
    }
  }, [signature, deepLink]);

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
      let result: Seed | { error: string };
      if (fixture) {
        if (fixtureLoadState === "permission") result = { error: "Otto is not available to this workspace member. No conversation history was exposed." };
        else if (fixtureLoadState === "error" && !fixtureFailedOnceRef.current) {
          fixtureFailedOnceRef.current = true;
          result = { error: "Otto could not load this workspace conversation. Nothing is guessed in its place; retry is safe." };
        } else {
          const workspaceId = readR22WorkspaceDirectory().activeId;
          const stored = readR22OttoFixture(workspaceId);
          setFixtureWorkspaceId(workspaceId);
          result = stored ? { ...R22_FIXTURE_SEED, projects: stored.projects, threads: stored.threads, activeThreadId: stored.activeThreadId } : workspaceId === "batik-house" ? R22_FIXTURE_SEED : { ...R22_FIXTURE_SEED, projects: [{ id: `fixture-${workspaceId}`, name: "Workspace project", pinnedAt: null }], projectId: `fixture-${workspaceId}`, threads: [], activeThreadId: null };
          // Otto IQ 上按下「Ask Otto to read your site」留下的那个条(裁决第 3 条的第一个
          // 入口)。它在这里变成一条线程并当场打开 —— 商家按完那颗按钮期待的是「Otto 已经
          // 在做了」,而不是一块自己去把网址再打一遍的空白面板。取一次就没了,所以再开一次
          // 面板不会重复开线程。
          const requestedSite = takeOttoSiteResearchRequest();
          if (requestedSite) {
            const base = result;
            const thread = buildOttoResearchThread({
              projectId: base.projectId,
              site: requestedSite,
              said: `Read ${requestedSite} and sort what you find into Otto IQ.`,
              ordinal: nextOttoResearchOrdinal(base.threads),
              now: R22_OTTO_FIXTURE_UPDATED_AT,
            });
            result = { ...base, threads: [thread, ...base.threads], activeThreadId: thread.id };
          }
        }
      } else result = await loadOttoPanelSeed(select).catch(() => ({ error: "Otto is not reachable right now." }));
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
      if (fixture) setFixtureLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [fixture, fixtureLoadState, open, fetchTrigger]);

  React.useEffect(() => {
    if (!fixture || !fixtureLoaded || load.status !== "ready") return;
    writeR22OttoFixture(fixtureWorkspaceId, { projects: load.seed.projects, threads, activeThreadId });
  }, [activeThreadId, fixture, fixtureLoaded, fixtureWorkspaceId, load, threads]);

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
    if (fixture) {
      setActiveThreadId(thread.id);
      setHistoryOpenedAt(null);
      return;
    }
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
  }, [activeThreadId, claimIntent, fixture, upsertThread]);

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
    const pinnedAt = pinned ? (fixture ? R22_OTTO_FIXTURE_UPDATED_AT : new Date().toISOString()) : null;
    setThreads((items) => items.map((t) => (t.id === id ? { ...t, pinnedAt } : t)));
    if (fixture) return;
    const result = await setCoworkThreadPinned(id, pinned);
    if ("error" in result) {
      setThreads(snapshot);
      setThreadError(result.error);
    }
  }, [fixture, threads]);

  const renameThread = React.useCallback(async (id: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    const snapshot = threads;
    setThreads((items) => items.map((t) => (t.id === id ? { ...t, title: clean } : t)));
    if (fixture) return;
    const result = await renameCoworkThread(id, clean);
    if ("error" in result) {
      setThreads(snapshot);
      setThreadError(result.error);
    }
  }, [fixture, threads]);

  const deleteThread = React.useCallback(async (id: string) => {
    const snapshot = threads;
    const snapshotActive = activeThreadId;
    const next = nextActiveThreadId(threads, id, activeThreadId);
    setThreads((items) => items.filter((t) => t.id !== id));
    if (activeThreadId === id) setActiveThreadId(next);
    if (fixture) return;
    const result = await deleteCoworkThread(id);
    if ("error" in result) {
      setThreads(snapshot);
      setActiveThreadId(snapshotActive);
      setThreadError(result.error);
    }
  }, [threads, activeThreadId, fixture]);

  // ── 整理项目:重命名 / 置顶 / 删除(W2-11)────────────────────────────────────
  //
  // 面板里「项目」这一层今天只在会话历史的分组标题上露面(`OttoThreadList` 的 project
  // header)——查过 Home「接着做」那一列(纯 `<Link>`,零控件)与 Library(那页是跨项目的
  // 素材墙,压根不列项目)之后,这里是唯一还能挂得上控件的地方,不是新发明一处。

  /** 重取一次种子 —— 删除项目牵连太多(会连它名下的会话一起消失),客户端手工推演这份状态
   *  容易出错,不如让服务端(已经在 `deleteProject` 里 `revalidatePath` 过)重新说一次真相。 */
  const reloadSeed = React.useCallback(async () => {
    if (fixture) {
      setLoad({ status: "ready", seed: R22_FIXTURE_SEED });
      setThreads(R22_FIXTURE_SEED.threads);
      setActiveThreadId(R22_FIXTURE_SEED.activeThreadId);
      return;
    }
    const result = await loadOttoPanelSeed().catch(() => ({ error: "Otto is not reachable right now." }));
    if ("error" in result) {
      setLoad({ status: "error", message: result.error });
      return;
    }
    setLoad({ status: "ready", seed: result });
    setThreads(result.threads);
    setActiveThreadId(result.activeThreadId);
  }, [fixture]);

  const requestRenameProject = React.useCallback((id: string) => {
    const target = seed?.projects.find((p) => p.id === id);
    if (target) setRenameProjectTarget(target);
  }, [seed]);

  const requestDeleteProject = React.useCallback((id: string) => {
    const target = seed?.projects.find((p) => p.id === id);
    if (target) setDeleteProjectTarget(target);
  }, [seed]);

  const setProjectPinned = React.useCallback(async (id: string, pinned: boolean) => {
    const pinnedAt = pinned ? (fixture ? R22_OTTO_FIXTURE_UPDATED_AT : new Date().toISOString()) : null;
    setLoad((current) =>
      current.status === "ready"
        ? { ...current, seed: { ...current.seed, projects: current.seed.projects.map((p) => (p.id === id ? { ...p, pinnedAt } : p)) } }
        : current,
    );
    if (fixture) return;
    const result = await setProjectPinnedAction(id, pinned);
    if ("error" in result) {
      setThreadError(result.error);
      await reloadSeed();
    }
  }, [fixture, reloadSeed]);

  const renameProject = React.useCallback(async (id: string, name: string) => {
    if (fixture) {
      setLoad((current) => current.status === "ready" ? { ...current, seed: { ...current.seed, projects: current.seed.projects.map((project) => project.id === id ? { ...project, name } : project) } } : current);
      return;
    }
    const result = await renameProjectAction(id, name);
    if ("error" in result) {
      setThreadError(result.error);
      return;
    }
    setLoad((current) =>
      current.status === "ready"
        ? { ...current, seed: { ...current.seed, projects: current.seed.projects.map((p) => (p.id === id ? { ...p, name: result.name } : p)) } }
        : current,
    );
  }, [fixture]);

  const deleteProject = React.useCallback(async (id: string) => {
    if (fixture) {
      setLoad((current) => current.status === "ready" ? { ...current, seed: { ...current.seed, projects: current.seed.projects.filter((project) => project.id !== id) } } : current);
      setThreads((current) => current.filter((thread) => thread.projectId !== id));
      return;
    }
    const result = await deleteProjectAction(id);
    if ("error" in result) {
      setThreadError(result.error);
      return;
    }
    await reloadSeed();
  }, [fixture, reloadSeed]);

  // ── 这一页叫什么名字 ──────────────────────────────────────────────────────
  //
  // 只用它做两件**不代替商家做决定**的事:回话按话题分路(`responseFor`),以及底下那一行
  // 说清这是哪一片工作区。它不是上下文 chip —— chip 说的是「Otto 看得见这一页」,那句话
  // 今天仍然不成立(理由在上面那一整段),所以 chip 仍然不画。
  //
  // 认不出这一页、或者停在一个对象页上(`/campaign/<id>`)时给空:对象的真名字要读库,
  // 而这里没有取数;编一个页名比不说更糟。
  const contextSubject = React.useMemo(() => panelContextSubject(location), [location]);
  const contextLabel = contextSubject?.kind === "page" ? contextSubject.label : undefined;

  // ── 快捷 chips ───────────────────────────────────────────────────────────
  const chips = React.useMemo(() => panelQuickChips(location), [location]);

  const pickChip = React.useCallback(async (chip: { goalKey: string; label: string }) => {
    if (!seed || chipBusy) return;
    if (fixture) {
      const now = "2026-08-25T08:42:00.000Z";
      const ordinal = threads.reduce((highest, thread) => {
        const match = /^fixture-chip-(\d+)$/.exec(thread.id);
        return match ? Math.max(highest, Number(match[1])) : highest;
      }, 0) + 1;
      const thread: ChatThreadDTO = { id: `fixture-chip-${ordinal}`, projectId: seed.projectId, title: chip.label, updatedAt: now, pinnedAt: null, status: "done", messages: [{ id: `fixture-chip-${ordinal}-user-1`, role: "USER", kind: "TEXT", seq: 1, text: chip.label, payload: null, genJobId: null, createdAt: now }, { id: `fixture-chip-${ordinal}-agent-2`, role: "AGENT", kind: "TEXT", seq: 2, text: "This deterministic fixture opened a local conversation. No Otto action or server request was sent.", payload: null, genJobId: null, createdAt: now }] };
      setChipError(null);
      handleThreadStarted(thread);
      return;
    }
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
  }, [seed, chipBusy, fixture, handleStreamStart, handleThreadStarted, threads]);

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
  // R22 的历史是头部那一层浮层(`OttoRoomSwitcher`),不再盖住会话 —— 切一条会话本来是
  // 「换个话题接着聊」,让商家先失去正在读的那一段再去列表里找回来是把一次切换做成了一次
  // 中断。legacy 壳照旧盖住,那是它自己的形态。
  const roomsOverlay = variant === "r22";
  const panelBody = (
    <>
      <div
        data-otto-panel-conversation-wrap=""
        className="min-h-0 flex-1 flex-col"
        style={{ display: historyOpen && !roomsOverlay ? "none" : "flex" }}
      >
        <React.Suspense fallback={<ConversationFallback />}>
          <OttoPanelConversation
            state={conversationState}
            fixture={fixture}
            contextLabel={contextLabel}
            onThreadStarted={handleThreadStarted}
            onStreamStart={handleStreamStart}
            onThreadUpdate={upsertThread}
            onActiveThreadChange={setActiveThreadId}
            onPendingFirstSent={() => setPendingFirst(null)}
            onRetry={fixture && fixtureLoadState === "permission" ? undefined : () => { setLoad({ status: "loading" }); setFetchTrigger((value) => value + 1); }}
          />
        </React.Suspense>
      </div>
      {historyOpenedAt !== null && seed && !roomsOverlay && (
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

  // R22 的会话切换器 —— 与上面那份列表读的是同一份会话、同一批动作函数,只是形状换成了
  // 原型那一层浮层(搜索 / Today / Recent / 一句尾注 / 新对话)。两处**不可能**不一致:
  // 状态只有这里一份。
  const roomSwitcher = roomsOverlay && historyOpenedAt !== null && seed ? (
    <OttoRoomSwitcher
      projects={seed.projects}
      threads={threads}
      activeThreadId={activeThreadId}
      now={historyOpenedAt}
      fixture={fixture}
      openingThreadId={openingThreadId}
      error={threadError}
      onSelectThread={(thread) => void selectThread(thread)}
      onNewChat={openNewChat}
      onRenameThread={requestRenameThread}
      onSetThreadPinned={(id, pinned) => void setThreadPinned(id, pinned)}
      onDeleteThread={requestDeleteThread}
      onRenameProject={requestRenameProject}
      onSetProjectPinned={(id, pinned) => void setProjectPinned(id, pinned)}
      onDeleteProject={requestDeleteProject}
    />
  ) : null;

  return (
    <OttoPanelShell
      variant={variant}
      panelBody={panelBody}
      roomSwitcher={roomSwitcher}
      roomsId={roomsOverlay ? OTTO_ROOMS_ID : undefined}
      // R22 的面板只有三格:头、会话体、体底那格输入框(原型 L5433-5469)。这一排 chips
      // 是插在体和 footer 之间的第四格,而 r22 的 composer 住在体里面 —— 画出来就落在输入框
      // **下面**,读起来像第二个 footer。原型没有这一排,所以 r22 不画它。
      //
      // 起手式没有被删掉:没有会话时,体里画的就是起手格(fixture 是 `.r22-otto-starters`,
      // 真接后端是 `OttoFrontDoor` 那四个目标格),两处走的都是这一份 `GOAL_PRESETS`。
      // legacy 壳的版式不变,那一排照旧。
      quickChips={
        variant !== "r22" && seed ? (
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
      // 头部读的是**现在开着的那一条**会话的名字(原型 L5443 的 `#ottoTitle`),
      // 没有会话时是原型那句 "New conversation" —— 不是一个读不出上下文的死字「Otto」。
      panelTitle={threads.find((thread) => thread.id === activeThreadId)?.title}
      // 正在把一条会话的消息取回来时,头部这两颗会改变「现在显示哪一条」的按钮先禁掉。
      // 真正的守卫是意图号(见上面 `claimIntent`);禁用只是让这一下不必发生。
      headerBusy={openingThreadId !== null}
      forceOpenSignal={forceOpenToken}
    >
      <PanelOpenWatcher onOpenChange={setOpen} />
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
          if (!renameThreadTarget) return;
          await renameThread(renameThreadTarget.id, title);
          setRenameThreadTarget(null);
        }}
      />
      <OttoConfirmDialog
        open={!!deleteThreadTarget}
        onOpenChange={(open) => { if (!open) setDeleteThreadTarget(null); }}
        title="Permanently delete conversation?"
        description={deleteThreadTarget ? `Otto will delete "${deleteThreadTarget.title}" and its messages.` : ""}
        impacts={[
          "The conversation and its messages are permanently deleted.",
          "Canvas cards and generated media are detached from this conversation.",
          "Generated library assets stay available.",
        ]}
        confirmText={deleteThreadTarget?.title}
        confirmLabel="Delete conversation"
        confirmingLabel="Deleting..."
        tone="danger"
        onConfirm={async () => {
          if (!deleteThreadTarget) return;
          await deleteThread(deleteThreadTarget.id);
          setDeleteThreadTarget(null);
        }}
      />
      <OttoRenameDialog
        open={!!renameProjectTarget}
        onOpenChange={(open) => { if (!open) setRenameProjectTarget(null); }}
        title="Rename project"
        description="This only changes the sidebar name. Your chats, canvas cards, and assets stay where they are."
        label="Project name"
        initialValue={renameProjectTarget?.name ?? ""}
        onSubmit={async (name) => {
          if (!renameProjectTarget) return;
          await renameProject(renameProjectTarget.id, name);
          setRenameProjectTarget(null);
        }}
      />
      <OttoConfirmDialog
        open={!!deleteProjectTarget}
        onOpenChange={(open) => { if (!open) setDeleteProjectTarget(null); }}
        title="Permanently delete project?"
        description={deleteProjectTarget ? `Otto will delete "${deleteProjectTarget.name}" and its project-scoped work.` : ""}
        impacts={[
          "The project record is permanently deleted.",
          "Its chats, canvas cards, jobs, and project media records are deleted.",
          "Global library assets and credit ledger rows are not deleted here.",
        ]}
        confirmText={deleteProjectTarget?.name}
        confirmLabel="Delete project"
        confirmingLabel="Deleting..."
        tone="danger"
        onConfirm={async () => {
          if (!deleteProjectTarget) return;
          await deleteProject(deleteProjectTarget.id);
          setDeleteProjectTarget(null);
        }}
      />
    </OttoPanelShell>
  );
}
