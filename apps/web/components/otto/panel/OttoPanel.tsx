"use client";

/**
 * OttoPanel.tsx — 面板本体。受控组件:它自己不存任何几何,只把指针动作翻译成
 * `panel-geometry.ts` 的纯函数调用,再把结果交回上层。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.1(形态)、§3.2(拖动语义)、§3.4(结构)。
 *
 * 两个形态共用同一段 DOM:
 *   - docked —— 普通流里的一个 flex 兄弟。它**挤**主内容,不是**盖**主内容:
 *     没有 `position: fixed`、没有遮罩、没有 `pointer-events: none`(§3.5 ①,G2)。
 *   - floating —— `position: fixed` 的自由窗,主内容不再被挤,但也不被遮住(仍可点)。
 *
 * 会话流与输入框是插槽:这一票只建壳,聊天在 W2-8 / W2-9 接进来。没有接上的东西就不画,
 * 不摆一个按了没反应的按钮。
 */

import * as React from "react";
import { ChevronDown, History, Maximize2, Minimize2, Plus, X } from "lucide-react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Button } from "@/components/ui/button";
import { CHAT_SPEND_NOTE } from "@/lib/credit-format";
import { cn } from "@/lib/utils";
import { R22OttoCloud } from "./OttoLauncher";
import {
  RESIZE_HANDLES,
  RESIZE_HANDLE_CURSOR,
  type FloatingRect,
  type ResizeHandle,
  type Viewport,
  clampFloatingRect,
  clampPanelWidth,
  floatingRectFromDocked,
  resizeFloatingRect,
  shouldShowDockHint,
  widthFromResizePointer,
} from "./panel-geometry";
import type { OttoPanelState } from "./panel-state";

/** 上下文 chip:面板知道商家正在看哪一页(V1 只做「路由 + 对象名」这一层)。 */
export interface OttoPanelContextChip {
  label: string;
  onDismiss?: () => void;
}

export interface OttoPanelProps {
  state: OttoPanelState;
  viewport: Viewport;
  /** 挂载后套用存值才为 true;transition 只在这之后开启,避免宽度跳一下。 */
  hydrated: boolean;
  /** Expand 是这一刻的事,不进存档,所以由上层单独给。 */
  expanded: boolean;
  /**
   * R22 的 Expand 不是「宽一点」,是**全屏接管**(原型 `setFullscreen`,L5867-5881):
   * 面板脱离排版铺满视窗,同级内容 `inert`,焦点关在面板里,Esc 退回停靠。
   *
   * 铺满这一步没有过渡 —— 408px 的抽屉与整屏之间没有一个读得出意思的中间态,拉一段
   * 220ms 的宽度动画只会让人等。停靠形态自己那条开合过渡照旧(见下面 `frame`)。
   */
  fullscreen?: boolean;
  /** 停靠时真正要用的宽度(Expand 已经算进去了)。 */
  width: number;
  onResize: (width: number) => void;
  onUndock: () => void;
  onFloatMove: (rect: FloatingRect) => void;
  onFloatRelease: (rect: FloatingRect) => void;
  onToggleExpanded: () => void;
  onClose: () => void;
  onOpenHistory?: () => void;
  /** 历史列表现在是不是开着(头部那颗 ☰ 的按下态)。 */
  historyOpen?: boolean;
  /**
   * R22 的会话切换器(`OttoRoomSwitcher`)。它是头部这一格自己的浮层,挂在 `<header>`
   * 里而不是 portal 出去 —— 全屏时的焦点陷阱按「面板这棵子树」算,portal 出去的内容
   * 正好落在陷阱外面。上层只在它该开的时候把节点传进来。
   */
  roomSwitcher?: React.ReactNode;
  /** 切换器那一层的 DOM id,给标题按钮的 `aria-controls` 用。 */
  roomsId?: string;
  onNewChat?: () => void;
  /** 头部显示的会话名(R22)。没有会话时是原型那句 "New conversation"。 */
  title?: string;
  /** 面板正在把一条会话的消息取回来 —— 会改变「现在显示哪一条」的那两颗先禁掉。 */
  headerBusy?: boolean;
  contextChip?: OttoPanelContextChip;
  /**
   * 这一轮会不会自动把商家看的这一页当上下文(W2-8)。
   *
   * 它与 `contextChip` 有没有画**不是同一件事**:这一页本来就没有可说的上下文时两者都是空,
   * 但商家亲手关掉之后,「不再自动带上下文」是一条要能被断言的状态,而不是「少了一个 div」。
   */
  contextAttached?: boolean;
  /** 会话流。W2-8 接进来;没接上就是一片空,不编内容。 */
  children?: React.ReactNode;
  /** 底部那几颗随页面变化的快捷 chips(W2-8)。在输入框之上、体之下。 */
  quickChips?: React.ReactNode;
  /** 输入框。它在,底部那句钱的实话才在 —— 没有地方花钱就没有那句话。 */
  footer?: React.ReactNode;
  variant?: "legacy" | "r22";
}

type DragSession =
  | { kind: "resize-docked" }
  | { kind: "pending-undock"; pointerX: number; pointerY: number }
  | { kind: "move"; pointerX: number; pointerY: number; rect: FloatingRect }
  | { kind: "resize-float"; handle: ResizeHandle; pointerX: number; pointerY: number; rect: FloatingRect };

/** 头部要拖多少像素才算「脱离」,而不是手抖。 */
const UNDOCK_THRESHOLD_PX = 4;
/** 键盘按一下方向键改多少宽度。 */
const KEYBOARD_RESIZE_STEP_PX = 16;

export function OttoPanel({
  state,
  viewport,
  hydrated,
  expanded,
  fullscreen = false,
  width,
  onResize,
  onUndock,
  onFloatMove,
  onFloatRelease,
  onToggleExpanded,
  onClose,
  onOpenHistory,
  historyOpen = false,
  roomSwitcher,
  roomsId,
  onNewChat,
  title,
  headerBusy = false,
  contextChip,
  contextAttached = false,
  children,
  quickChips,
  footer,
  variant = "legacy",
}: OttoPanelProps) {
  const [drag, setDrag] = React.useState<DragSession | null>(null);
  const [dockHint, setDockHint] = React.useState(false);
  const floating = state.mode === "floating";

  // 拖动过程中要读的东西每一帧都可能变,而监听器只在拖动开始/结束时挂卸。
  // 用一个 ref 把「最新的」交给监听器,免得每次 pointermove 都重挂一次 window 监听。
  const latest = React.useRef({ state, viewport, onResize, onUndock, onFloatMove, onFloatRelease });
  React.useEffect(() => {
    latest.current = { state, viewport, onResize, onUndock, onFloatMove, onFloatRelease };
  });
  // 松手时用的是**最后一次算出来的**矩形,不是 state 里那份 —— React 的 setState 是异步的,
  // 从 state 读会读到落后一帧的位置,吸附判定就会在边界上偶尔判错。
  const lastRect = React.useRef<FloatingRect | null>(null);

  React.useEffect(() => {
    if (!drag) return;

    function handleMove(event: PointerEvent) {
      const now = latest.current;
      if (!drag) return;

      if (drag.kind === "resize-docked") {
        now.onResize(widthFromResizePointer(event.clientX, now.viewport.width));
        return;
      }

      if (drag.kind === "pending-undock") {
        const dx = event.clientX - drag.pointerX;
        const dy = event.clientY - drag.pointerY;
        if (Math.abs(dx) < UNDOCK_THRESHOLD_PX && Math.abs(dy) < UNDOCK_THRESHOLD_PX) return;
        // 脱离后窗体的起点,必须和 `undockPanel` 算出来的那一份逐字一致,
        // 否则窗体会在松手那一刻跳一下。
        const detached = floatingRectFromDocked(now.state.width, now.viewport);
        now.onUndock();
        lastRect.current = detached;
        setDrag({ kind: "move", pointerX: event.clientX, pointerY: event.clientY, rect: detached });
        return;
      }

      if (drag.kind === "move") {
        const next = clampFloatingRect(
          {
            ...drag.rect,
            x: drag.rect.x + (event.clientX - drag.pointerX),
            y: drag.rect.y + (event.clientY - drag.pointerY),
          },
          now.viewport,
        );
        lastRect.current = next;
        setDockHint(shouldShowDockHint(next, now.viewport));
        now.onFloatMove(next);
        return;
      }

      const resized = resizeFloatingRect(
        drag.rect,
        drag.handle,
        event.clientX - drag.pointerX,
        event.clientY - drag.pointerY,
        now.viewport,
      );
      lastRect.current = resized;
      now.onFloatMove(resized);
    }

    function handleUp() {
      const now = latest.current;
      if (drag && (drag.kind === "move" || drag.kind === "resize-float")) {
        now.onFloatRelease(lastRect.current ?? now.state.float);
      }
      lastRect.current = null;
      setDockHint(false);
      setDrag(null);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [drag]);

  function startHeaderDrag(event: React.PointerEvent<HTMLElement>) {
    // 头部上的按钮是按钮,不是把手。
    if ((event.target as HTMLElement | null)?.closest("button")) return;
    if (event.button !== 0) return;
    if (floating) {
      setDrag({ kind: "move", pointerX: event.clientX, pointerY: event.clientY, rect: state.float });
    } else {
      setDrag({ kind: "pending-undock", pointerX: event.clientX, pointerY: event.clientY });
    }
  }

  function startDockedResize(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    setDrag({ kind: "resize-docked" });
  }

  function handleResizeKey(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? KEYBOARD_RESIZE_STEP_PX : -KEYBOARD_RESIZE_STEP_PX;
    // 从**生效中**的宽度起跳,不是从存档宽。Expand 打开时这两个数不一样,按存档宽算会让
    // 第一下方向键把面板从 864px 猛缩回 376px —— 那不是「宽一点」,那是跳一下。
    onResize(clampPanelWidth(width + delta, viewport.width));
  }

  // ── 全屏接管(原型 L5867-5890)────────────────────────────────────────────
  //
  // 三件事一起才叫「全屏」,少一件就只是一块更大的方块:
  //   ① 铺满视窗(下面 `frame`);
  //   ② 对读屏与键盘也是一层浮层(`role="dialog"` + `aria-modal`,同级内容由
  //      `OttoPanelShell` 打上 `inert`);
  //   ③ 焦点走不出去(下面这道 Tab 陷阱),而且进来的第一下就落在能打字的地方。
  const panelRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (!fullscreen) return;
    const node = panelRef.current;
    if (!node) return;
    // 进全屏第一件事:光标落进输入框(原型 L5880)。找不到输入框就退回面板自己,
    // 至少焦点还在这一层里,而不是留在身后那块已经 `inert` 的内容上。
    const composer = node.querySelector<HTMLElement>("[data-otto-panel-composer] input, [data-otto-panel-composer] textarea");
    (composer ?? node).focus?.();
  }, [fullscreen]);

  React.useEffect(() => {
    if (!fullscreen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const node = panelRef.current;
      if (!node) return;
      const items = [...node.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[href]")]
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [fullscreen]);

  const frame: React.CSSProperties = fullscreen
    ? { position: "fixed", inset: 0, width: "auto", height: "auto", transition: "none" }
    : floating
    ? {
        position: "fixed",
        left: state.float.x,
        top: state.float.y,
        width: state.float.w,
        height: state.float.h,
        transition: "none",
      }
    : {
        width,
        transition: hydrated ? "width 200ms var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1))" : "none",
      };

  return (
    <>
      {dockHint && (
        <div
          data-otto-panel-dock-hint=""
          aria-hidden
          className="pointer-events-none fixed top-0 right-0 z-[46] h-full w-[2px] bg-brand"
        />
      )}
      <aside
        ref={panelRef}
        aria-label="Otto"
        data-otto-panel=""
        data-otto-panel-mode={state.mode}
        data-otto-panel-variant={variant}
        {...(hydrated ? { "data-otto-panel-hydrated": "" } : {})}
        {...(contextAttached ? { "data-otto-panel-context-attached": "" } : {})}
        {...(fullscreen ? { "data-otto-panel-fullscreen": "", role: "dialog", "aria-modal": true, tabIndex: -1 } : {})}
        style={frame}
        className={cn(
          // 层级(#994 挂载票定表,判官 r1 P3-3 修正因果):导轨 z-40 < 面板 z-45 < 模态框 z-50。
          //
          // 先说清楚**谁不在这条表里**:`ui/dialog` 走 Radix Portal 挂到 `<body>` 上,而商家壳
          // 整个装在 `app/layout.tsx` 那个 `relative z-10` 的 div 里 —— 那是一个层叠上下文,
          // 里面的数字再大也只在里面排队。所以旧的 z-70 从来压不住 `ui/dialog`,「不改就盖住每一个
          // 模态框」是句错话。
          //
          // 真正会被盖住的是**壳内**那两处手搓的 `fixed inset-0 z-50` 模态框 ——
          // `OttoStuff.tsx`(Choose a product)与 `stuff/AddAssetDialog.tsx`(Add asset)。
          // 它们和面板同在那个 z-10 上下文里,z-70 的面板确实会压在它们上面(它们正是 W2-12
          // 要收编成 `ui/dialog` 的那一批)。面板退到 45,这两处就回到面板之上;
          // 45 仍在导轨 40 之上,浮动窗拖过导轨时压得住它。
          "z-[45] flex min-h-0 flex-col overflow-hidden bg-card text-foreground",
          // 全屏那一层要盖住导轨(z-40)与停靠面板(z-45)之外的一切壳内内容,所以自己
          // 抬到 55 —— 仍在手搓模态框(z-50)之上、`ui/dialog` 那条 Portal 之外的世界里。
          fullscreen
            ? "z-[55] border-0"
            : floating
            ? "rounded-[var(--radius-lg)] border border-border/80 shadow-[var(--shadow-lg,0_18px_44px_rgba(20,20,24,0.16))]"
            // 停靠形态没有任何脱离文档流的定位 —— 它就是排版里的一格(挤而不盖)。`sticky` 仍
            // 占位、仍把主内容挤窄,只是页面往下滚的时候面板头部不跟着滚出屏幕;`self-start`
            // 是它成立的前提(被 stretch 拉满高度的元素没有可粘的余量)。
            : "sticky top-0 h-dvh shrink-0 self-start border-l border-border",
        )}
      >
        {!floating && variant !== "r22" && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Otto panel"
            tabIndex={0}
            data-otto-panel-resize=""
            onPointerDown={startDockedResize}
            onKeyDown={handleResizeKey}
            // 命中区 6px,摸到之后长到 12px —— 抓住了就不容易掉(§3.1)。
            className="absolute top-0 left-0 z-10 h-full w-[6px] cursor-col-resize outline-none hover:w-3 hover:bg-brand/20 focus-visible:w-3 focus-visible:bg-brand/30"
          />
        )}

        <header
          data-otto-panel-header=""
          onPointerDown={variant === "r22" ? undefined : startHeaderDrag}
          className={cn(
            // `relative`:会话切换器是这一格自己的浮层,贴着头部下沿定位(原型 L466 的
            // `.otto-rooms{position:absolute;top:45px;left:40px}`)。
            "relative flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2.5 select-none",
            drag && drag.kind !== "resize-docked" ? "cursor-grabbing" : "cursor-grab",
          )}
        >
          {variant === "r22" ? <R22OttoCloud className="r22-otto-head-cloud" /> : <OttoAvatar size={22} mood="idle" />}
          {/* 原型 L5443 的 `roomBtn`:标题本身就是会话切换器的入口(标题 + ⌄),而不是一个
              读不出上下文的死字「Otto」加一颗单独的 ☰。功能没有第二套 —— 按下去调的仍是
              `onOpenHistory`,和 legacy 那颗 ☰ 同一条线。 */}
          {variant === "r22" && onOpenHistory ? (
            <Button
              unstyled
              type="button"
              data-otto-panel-title=""
              aria-expanded={historyOpen}
              {...(roomsId ? { "aria-controls": roomsId } : {})}
              aria-label="Open conversation switcher"
              disabled={headerBusy}
              onClick={onOpenHistory}
              className="r22-otto-head-title"
            >
              <span className="truncate">{title ?? "New conversation"}</span>
              <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.8} />
            </Button>
          ) : (
            <span className="mr-auto truncate text-[14px] font-semibold tracking-[-0.01em]">
              {variant === "r22" ? (title ?? "New conversation") : "Otto"}
            </span>
          )}
          {variant === "r22" && <span className="ml-auto" />}
          {onOpenHistory && variant !== "r22" && (
            <PanelIconButton
              label="Conversation history"
              pressed={historyOpen}
              disabled={headerBusy}
              onClick={onOpenHistory}
            >
              <History className="size-4" strokeWidth={1.9} />
            </PanelIconButton>
          )}
          {onNewChat && (
            // 原型 L5447 的 `#ottoNew`,可及名字用它的原话 "New conversation" —— 面板里
            // 每一处讲的都是 conversation(改名/删除弹窗也是),不该只有这一颗叫 chat。
            <PanelIconButton label="New conversation" disabled={headerBusy} onClick={onNewChat}>
              <Plus className="size-4" strokeWidth={1.9} />
            </PanelIconButton>
          )}
          {/* Expand 在原型里是一颗写着字的按钮(L5451,按下变 "Restore")。它在 R22 里不再
              被藏起来 —— 停靠 408px 读不下一张审批卡时,商家需要这一颗。 */}
          {variant === "r22" ? (
            <Button
              unstyled
              type="button"
              aria-label={expanded ? "Restore Otto" : "Expand Otto"}
              aria-pressed={expanded}
              onClick={onToggleExpanded}
              className="r22-otto-head-expand"
            >
              {expanded ? "Restore" : "Expand"}
            </Button>
          ) : (
            <PanelIconButton
              label={expanded ? "Collapse Otto" : "Expand Otto"}
              pressed={expanded}
              onClick={onToggleExpanded}
            >
              {expanded ? <Minimize2 className="size-4" strokeWidth={1.9} /> : <Maximize2 className="size-4" strokeWidth={1.9} />}
            </PanelIconButton>
          )}
          <PanelIconButton label="Close Otto" onClick={onClose}>
            <X className="size-4" strokeWidth={1.9} />
          </PanelIconButton>
          {roomSwitcher}
        </header>

        {contextChip && (
          <div
            data-otto-panel-context=""
            className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-[12.5px] text-muted-foreground"
          >
            <span className="truncate">On this page: {contextChip.label}</span>
            {contextChip.onDismiss && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={contextChip.onDismiss}
                aria-label="Stop using this page as context"
                className="ml-auto size-7 rounded-[8px] text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" strokeWidth={2} />
              </Button>
            )}
          </div>
        )}

        {/* R22 的体是一根 flex 列,不是一块自己滚的方块。
            这一条是「composer 在底部」的承重梁:体里那棵树(`OttoPanelConversation`)的根
            带着 `flex min-h-0 flex-1 flex-col`,可是父级不是 flex 容器时那个 `flex-1` 是废的 ——
            于是整段会话按内容高度贴在顶上,输入框跟着浮到面板上沿,底下空一大片。原型
            (L457-458)里 `.op-body` 与 `.op-foot` 是 `.op-inner` 这根列的两格,输入框永远在底。
            滚动交给里面的 message scroller,所以这一层 `overflow-hidden`,不叠第二个滚动区。 */}
        <div
          data-otto-panel-body=""
          className={cn(
            "min-h-0 flex-1",
            variant === "r22" ? "flex flex-col overflow-hidden" : "overflow-y-auto",
          )}
        >
          {children}
        </div>

        {quickChips}

        {footer && (
          <div data-otto-panel-footer="" className="shrink-0 border-t border-border px-3 py-2.5">
            {footer}
            <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{CHAT_SPEND_NOTE}</p>
          </div>
        )}

        {floating &&
          RESIZE_HANDLES.map((handle) => (
            <FloatResizeHandle
              key={handle}
              handle={handle}
              onStart={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                setDrag({ kind: "resize-float", handle, pointerX: event.clientX, pointerY: event.clientY, rect: state.float });
              }}
            />
          ))}
      </aside>
    </>
  );
}

function PanelIconButton({
  label,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      className="size-8 rounded-[10px] text-muted-foreground hover:text-foreground"
    >
      {children}
    </Button>
  );
}

/** 八个把手贴在浮动窗四边四角。命中区 6px,角上 12px。 */
const HANDLE_BOX: Record<ResizeHandle, string> = {
  n: "top-0 left-0 h-[6px] w-full",
  s: "bottom-0 left-0 h-[6px] w-full",
  e: "top-0 right-0 h-full w-[6px]",
  w: "top-0 left-0 h-full w-[6px]",
  ne: "top-0 right-0 size-3",
  nw: "top-0 left-0 size-3",
  se: "bottom-0 right-0 size-3",
  sw: "bottom-0 left-0 size-3",
};

function FloatResizeHandle({
  handle,
  onStart,
}: {
  handle: ResizeHandle;
  onStart: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      data-otto-panel-float-resize={handle}
      aria-hidden
      onPointerDown={onStart}
      style={{ cursor: RESIZE_HANDLE_CURSOR[handle] }}
      className={cn("absolute z-20", HANDLE_BOX[handle])}
    />
  );
}
