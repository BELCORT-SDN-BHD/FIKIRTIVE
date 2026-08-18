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
import { History, Maximize2, Minimize2, SquarePen, X } from "lucide-react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Button } from "@/components/ui/button";
import { CHAT_SPEND_NOTE } from "@/lib/credit-format";
import { cn } from "@/lib/utils";
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
  /** 停靠时真正要用的宽度(Expand 已经算进去了)。 */
  width: number;
  onResize: (width: number) => void;
  onUndock: () => void;
  onFloatMove: (rect: FloatingRect) => void;
  onFloatRelease: (rect: FloatingRect) => void;
  onToggleExpanded: () => void;
  onClose: () => void;
  onOpenHistory?: () => void;
  onNewChat?: () => void;
  contextChip?: OttoPanelContextChip;
  /** 会话流。W2-8 接进来;没接上就是一片空,不编内容。 */
  children?: React.ReactNode;
  /** 输入框。它在,底部那句钱的实话才在 —— 没有地方花钱就没有那句话。 */
  footer?: React.ReactNode;
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
  width,
  onResize,
  onUndock,
  onFloatMove,
  onFloatRelease,
  onToggleExpanded,
  onClose,
  onOpenHistory,
  onNewChat,
  contextChip,
  children,
  footer,
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

  const frame: React.CSSProperties = floating
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
        aria-label="Otto"
        data-otto-panel=""
        data-otto-panel-mode={state.mode}
        {...(hydrated ? { "data-otto-panel-hydrated": "" } : {})}
        style={frame}
        className={cn(
          // 层级(#994 挂载票定表):导轨 z-40 < 面板 z-45 < `ui/dialog` 的遮罩与内容 z-50。
          // 面板现在停在每一个商家表面上,z-70(旧那颗 Otto 按钮的值)会让它盖住每一个模态框 ——
          // 模态框必须在最上面,所以面板退到 45:仍在导轨之上(浮动窗拖过去时压得住它),
          // 但任何 dialog 一开就在面板之上。
          "z-[45] flex min-h-0 flex-col overflow-hidden bg-card text-foreground",
          floating
            ? "rounded-[var(--radius-lg)] border border-border/80 shadow-[var(--shadow-lg,0_18px_44px_rgba(20,20,24,0.16))]"
            // 停靠形态没有任何脱离文档流的定位 —— 它就是排版里的一格(挤而不盖)。`sticky` 仍
            // 占位、仍把主内容挤窄,只是页面往下滚的时候面板头部不跟着滚出屏幕;`self-start`
            // 是它成立的前提(被 stretch 拉满高度的元素没有可粘的余量)。
            : "sticky top-0 h-dvh shrink-0 self-start border-l border-border",
        )}
      >
        {!floating && (
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
          onPointerDown={startHeaderDrag}
          className={cn(
            "flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2.5 select-none",
            drag && drag.kind !== "resize-docked" ? "cursor-grabbing" : "cursor-grab",
          )}
        >
          <OttoAvatar size={22} mood="idle" />
          <span className="mr-auto truncate text-[14px] font-semibold tracking-[-0.01em]">Otto</span>
          {onOpenHistory && (
            <PanelIconButton label="Conversation history" onClick={onOpenHistory}>
              <History className="size-4" strokeWidth={1.9} />
            </PanelIconButton>
          )}
          <PanelIconButton
            label={expanded ? "Collapse Otto" : "Expand Otto"}
            pressed={expanded}
            onClick={onToggleExpanded}
          >
            {expanded ? <Minimize2 className="size-4" strokeWidth={1.9} /> : <Maximize2 className="size-4" strokeWidth={1.9} />}
          </PanelIconButton>
          {onNewChat && (
            <PanelIconButton label="New chat" onClick={onNewChat}>
              <SquarePen className="size-4" strokeWidth={1.9} />
            </PanelIconButton>
          )}
          <PanelIconButton label="Close Otto" onClick={onClose}>
            <X className="size-4" strokeWidth={1.9} />
          </PanelIconButton>
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

        <div data-otto-panel-body="" className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>

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
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
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
