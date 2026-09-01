"use client";

/**
 * OttoPanelShell.tsx — 面板的 React 壳:状态、存档、快捷键、以及「挤而不盖」的版式。
 *
 * 规格:`docs/specs/wave2-shell.md` §3。
 *
 * 版式就是这一段的全部要点:主内容与面板是**两个并排的兄弟**,不是一层压一层。
 * 所以这里没有 `fixed inset-0`、没有遮罩、没有 `pointer-events: none` —— 面板开着的时候
 * 商家照样点得到底下的画布卡(G2 / §3.5 ①「Dock, don't cover」)。
 *
 * 挂载:这一票只把组件族建起来,**不改旧壳任何行为**。挂载点在换壳那几票里接。
 * 谁挂它,谁把主内容当 children 传进来:
 *
 *   <OttoPanelShell>{children}</OttoPanelShell>
 *
 * 面板里的会话流与输入框是插槽(`panelBody` / `panelFooter`),W2-8 / W2-9 接。
 */

import * as React from "react";
import {
  FALLBACK_VIEWPORT,
  type FloatingRect,
  type Viewport,
  clampPanelWidth,
  expandedPanelWidth,
} from "./panel-geometry";
import {
  type OttoPanelState,
  defaultOttoPanelState,
  dockPanel,
  readOttoPanelState,
  reconcileViewport,
  releaseFloatingPanel,
  releaseLauncher,
  setDockedWidth,
  setFloatingRect,
  setPanelOpen,
  togglePanelOpen,
  undockPanel,
  writeOttoPanelState,
} from "./panel-state";
import { OttoLauncher } from "./OttoLauncher";
import { OttoPanel, type OttoPanelContextChip } from "./OttoPanel";

/** 别的面要开合 Otto(左导航的 Ask Otto、Home 的按钮)就用这个,不各写一份状态。 */
export interface OttoPanelControls {
  open: boolean;
  mode: OttoPanelState["mode"];
  expanded: boolean;
  fullscreen: boolean;
  hydrated: boolean;
  /** 停靠时主内容被让开的宽度;关着或浮动时是 0。 */
  dockedWidth: number;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  toggleExpanded: () => void;
  toggleFullscreen: () => void;
}

const OttoPanelControlsContext = React.createContext<OttoPanelControls | null>(null);

/** 壳外面调用会拿到 null —— 那是「这一页没有面板」,不是错误。 */
export function useOttoPanelControls(): OttoPanelControls | null {
  return React.useContext(OttoPanelControlsContext);
}

function readViewport(): Viewport {
  if (typeof window === "undefined") return FALLBACK_VIEWPORT;
  return { width: window.innerWidth, height: window.innerHeight };
}

export interface OttoPanelShellProps {
  /** 主内容。被挤窄,永远不被盖住。 */
  children: React.ReactNode;
  /** 会话流 / 会话列表(W2-8)。 */
  panelBody?: React.ReactNode;
  /** 底部随页面变化的快捷 chips(W2-8)。 */
  quickChips?: React.ReactNode;
  /** 输入框(W2-9)。 */
  panelFooter?: React.ReactNode;
  /** Optional formal header composition. Used when the conversation title owns history switching. */
  panelHeader?: React.ReactNode;
  contextChip?: OttoPanelContextChip;
  contextAttached?: boolean;
  onOpenHistory?: () => void;
  historyOpen?: boolean;
  onNewChat?: () => void;
  headerBusy?: boolean;
  /**
   * 深链「到达」信号(`?otto=1`,规格书 §2.5;判官 r2 根因修复,PR #1086)——盖过
   * localStorage 记的上次开合状态。每次这个值相对上一次真的变化(且不是 `null`)都算一次
   * 新到达,必须开,不管这次到达发生在挂载时还是挂载之后——`OttoPanelHost` 挂在根 layout
   * 上跨软导航不卸载,Back/Forward 或第二次软导航到同一个深链地址都要认。传 `null` 或与
   * 上次相同的值 = 零动作,尤其是:商家自己关掉面板之后,没有新到达就不会被这个信号重新
   * 弹开(调用方 `OttoPanelHost` 负责判定「什么算一次新到达」,这里只认「值变了就开一次」)。
   *
   * 用下面那个独立 effect、而不是折进挂载 hydration 的那一步:两者都用函数式 `setState`
   * (`current => setPanelOpen(current, true)`),不管两个 effect 谁先谁后跑,后一个 updater
   * 总是读到前一个已经应用之后的值——不会互相覆盖,不需要挤在同一步里维护先后关系。
   */
  forceOpenSignal?: string | null;
}

export function OttoPanelShell({
  children,
  panelBody,
  quickChips,
  panelFooter,
  panelHeader,
  contextChip,
  contextAttached,
  onOpenHistory,
  historyOpen,
  onNewChat,
  headerBusy,
  forceOpenSignal,
}: OttoPanelShellProps) {
  // 首帧一律按默认值画(服务端不知道 localStorage,也不知道视窗有多大),
  // 挂载后再一次性套用存值 —— 这就是 `data-otto-panel-hydrated` 存在的理由。
  const [viewport, setViewport] = React.useState<Viewport>(FALLBACK_VIEWPORT);
  const [state, setState] = React.useState<OttoPanelState>(() => defaultOttoPanelState(FALLBACK_VIEWPORT));
  const [hydrated, setHydrated] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);

  // 这一次「多」的渲染正是 §3.3 要的:服务端不知道 localStorage、也不知道视窗多大,
  // 首帧只能画默认值,存值只能在挂载之后套上去 —— 那一步必然是一次挂载后的 setState。
  //
  // 判官 r3:这一步与下面的深链强开 effect 都在写同一个 `state`,改成函数式 `setState`
  // 而不是直接给值——今天的执行顺序本来就安全(这个 effect 的依赖是 `[]`,只在挂载时跑
  // 这一次;强开信号最早也要等 `OttoPanelHost` 的到达检测 effect 先跑完、再多一次渲染
  // 才可能非 null,所以这一步必然先于任何一次真的强开落地),但两处都用函数式,读这份
  // 代码的人不必去验证这条「谁先谁后」的前提才能确认它们不会互相覆盖。这一步本身不需要
  // 读 `current`(存档是权威来源,不是拿旧状态去合并)——函数式在这里只是把它从「谁跑在
  // 后面就赢」的隐性依赖里摘出来,不改变它算出来的值。
  React.useEffect(() => {
    const vp = readViewport();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上:挂载后套用存值,§3.3。
    setViewport(vp);
    setState(() => reconcileViewport(readOttoPanelState(vp), vp));
    setHydrated(true);
  }, []);

  // 深链强开(见上面 `forceOpenSignal` 的说明)——独立于挂载 hydration 之外的一个 effect,
  // 用函数式 `setState` 保证不管两个 effect 的先后顺序都正确叠加。`lastForceOpenSignalRef`
  // 只用来判定「这次是不是一个新信号」;`null` 或重复值本身不做任何事,把「什么算一次新
  // 到达」完全交给调用方(`OttoPanelHost`)判定。
  const lastForceOpenSignalRef = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (forceOpenSignal == null) return;
    if (forceOpenSignal === lastForceOpenSignalRef.current) return;
    lastForceOpenSignalRef.current = forceOpenSignal;
    setState((current) => setPanelOpen(current, true));
  }, [forceOpenSignal]);

  React.useEffect(() => {
    function handleResize() {
      const vp = readViewport();
      setViewport(vp);
      setState((current) => reconcileViewport(current, vp));
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 存档只在套用完存值之后写。少了这一条,首帧的默认值会在挂载前覆盖掉商家上次拖的宽度。
  React.useEffect(() => {
    if (!hydrated) return;
    writeOttoPanelState(state);
  }, [hydrated, state]);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Shift 排除掉:`Cmd/Ctrl+Shift+J` 是 Chrome 开发者工具,抢它没有任何好处。
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "j") return;
      event.preventDefault();
      if (state.open) {
        setExpanded(false);
        setFullscreen(false);
      }
      setState(togglePanelOpen);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.open]);

  const docked = state.mode === "docked";
  const dockedWidth = docked && state.open && !fullscreen
    ? expanded
      ? expandedPanelWidth(viewport.width)
      : clampPanelWidth(state.width, viewport.width)
    : 0;

  // 关掉面板就退出 Expand:Expand 是「现在读这张卡要更宽」,不是一个要记住的形态。
  const closePanel = React.useCallback(() => {
    setExpanded(false);
    setFullscreen(false);
    setState((current) => setPanelOpen(current, false));
  }, []);

  const togglePanel = React.useCallback(() => {
    if (state.open) {
      setExpanded(false);
      setFullscreen(false);
    }
    setState(togglePanelOpen);
  }, [state.open]);

  // Expand 是停靠形态的动作;浮动窗自己就能拖大,再叠一层临时宽度只会打架 ——
  // 所以在浮动时按 Expand 先吸回停靠。面板头部那颗按钮与外面的调用走同一条。
  const toggleExpanded = React.useCallback(() => {
    if (state.mode === "floating") {
      setState(dockPanel);
      setExpanded(true);
      return;
    }
    setExpanded((value) => !value);
  }, [state.mode]);

  const toggleFullscreen = React.useCallback(() => {
    setExpanded(false);
    if (state.mode === "floating") setState(dockPanel);
    setFullscreen((value) => !value);
  }, [state.mode]);

  const controls = React.useMemo<OttoPanelControls>(
    () => ({
      open: state.open,
      mode: state.mode,
      expanded,
      fullscreen,
      hydrated,
      dockedWidth,
      openPanel: () => setState((current) => setPanelOpen(current, true)),
      closePanel,
      togglePanel,
      toggleExpanded,
      toggleFullscreen,
    }),
    [state.open, state.mode, expanded, fullscreen, hydrated, dockedWidth, closePanel, togglePanel, toggleExpanded, toggleFullscreen],
  );

  function handleFloatRelease(rect: FloatingRect) {
    setState((current) => releaseFloatingPanel(current, rect, viewport));
  }

  return (
    <OttoPanelControlsContext.Provider value={controls}>
      {/* `items-start` 而不是默认的 stretch:主内容必须保持它挂载之前的高度行为(内容多高就多高,
          页面自己的 `min-h-dvh` / `h-dvh` 说了算)。被拉伸成一个确定高度会让页面里 `h-full` 那
          一类百分比高度突然解析成整屏,那是版式漂移,不是面板的活。面板自己带 `h-dvh`,不靠拉伸。 */}
      <div data-otto-panel-shell="" className="flex min-w-0 items-start">
        {/* 主内容。被面板挤窄靠的是 flex 排版本身,所以这里不需要任何定位、遮罩或宽度动画:
            动的是面板那一侧的宽度,主内容跟着让。里面仍是普通块级流,与挂载之前逐行一致。 */}
        <div
          data-otto-panel-main=""
          inert={fullscreen}
          aria-hidden={fullscreen || undefined}
          className="min-w-0 flex-1"
        >
          {children}
        </div>
        {state.open && (
          <OttoPanel
            state={state}
            viewport={viewport}
            hydrated={hydrated}
            expanded={expanded}
            fullscreen={fullscreen}
            width={docked ? dockedWidth : state.float.w}
            onResize={(width) => {
              setExpanded(false);
              setState((current) => setDockedWidth(current, width, viewport));
            }}
            onUndock={() => {
              setExpanded(false);
              setState((current) => undockPanel(current, viewport));
            }}
            onFloatMove={(rect) => setState((current) => setFloatingRect(current, rect, viewport))}
            onFloatRelease={handleFloatRelease}
            onToggleExpanded={toggleExpanded}
            onClose={closePanel}
            onOpenHistory={onOpenHistory}
            historyOpen={historyOpen}
            onNewChat={onNewChat}
            headerBusy={headerBusy}
            contextChip={contextChip}
            contextAttached={contextAttached}
            header={panelHeader}
            quickChips={quickChips}
            footer={panelFooter}
          >
            {panelBody}
          </OttoPanel>
        )}
      </div>
      {!state.open && (
        <OttoLauncher
          anchor={state.launcher}
          viewport={viewport}
          hydrated={hydrated}
          onOpen={() => setState((current) => setPanelOpen(current, true))}
          onRelease={(point) => setState((current) => releaseLauncher(current, point, viewport))}
        />
      )}
    </OttoPanelControlsContext.Provider>
  );
}
