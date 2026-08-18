"use client";

/**
 * OttoLauncher.tsx — 面板收起时的那颗浮动圆形图标。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.2 末段。48px 圆形、`OttoAvatar`、默认右下,
 * 可任意拖动、松手吸附到最近的左/右边缘并保留高低。面板打开时它不画。
 *
 * 「拖」与「点」共用一次按下:位移小于阈值就是点击(开面板),超过就是拖动(吸边)。
 * 这一段判断放在这里,吸到哪一条边的算术在 `panel-geometry.ts`。
 */

import * as React from "react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Button } from "@/components/ui/button";
import {
  LAUNCHER_SIZE,
  type LauncherAnchor,
  type Viewport,
  launcherPosition,
} from "./panel-geometry";

/** 按下到松手之间走了这么多像素以内,算点击不算拖动。 */
const CLICK_SLOP_PX = 4;

export interface OttoLauncherProps {
  anchor: LauncherAnchor;
  viewport: Viewport;
  hydrated: boolean;
  onOpen: () => void;
  /** 松手时的落点(图标左上角),由上层交给 `snapLauncher` 吸边。 */
  onRelease: (point: { x: number; y: number }) => void;
}

interface DragState {
  /** 指针按在图标内部的偏移,拖动时保持不变,图标才不会跳到指针底下。 */
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

export function OttoLauncher({ anchor, viewport, hydrated, onOpen, onRelease }: OttoLauncherProps) {
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const resting = launcherPosition(anchor, viewport);

  const latest = React.useRef({ onRelease });
  React.useEffect(() => {
    latest.current = { onRelease };
  });

  React.useEffect(() => {
    if (!drag) return;

    function handleMove(event: PointerEvent) {
      setDrag((current) => {
        if (!current) return current;
        const x = event.clientX - current.offsetX;
        const y = event.clientY - current.offsetY;
        const moved =
          current.moved ||
          Math.abs(event.clientX - current.startX) > CLICK_SLOP_PX ||
          Math.abs(event.clientY - current.startY) > CLICK_SLOP_PX;
        return { ...current, x, y, moved };
      });
    }

    function handleUp() {
      setDrag((current) => {
        if (current?.moved) latest.current.onRelease({ x: current.x, y: current.y });
        return null;
      });
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

  const dragged = drag?.moved === true;
  const left = drag ? drag.x : resting.left;
  const top = drag ? drag.y : resting.top;

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      data-otto-launcher=""
      data-otto-launcher-edge={anchor.edge}
      {...(hydrated ? { "data-otto-panel-hydrated": "" } : {})}
      aria-label="Ask Otto"
      title="Ask Otto"
      aria-keyshortcuts="Meta+J Control+J"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        setDrag({
          offsetX: event.clientX - left,
          offsetY: event.clientY - top,
          startX: event.clientX,
          startY: event.clientY,
          x: left,
          y: top,
          moved: false,
        });
      }}
      onClick={() => {
        // 刚拖完的那一次松手也会走 click —— 那不是要开面板。
        if (dragged) return;
        onOpen();
      }}
      style={{
        position: "fixed",
        left,
        top,
        width: LAUNCHER_SIZE,
        height: LAUNCHER_SIZE,
        // 位置的过渡只在挂载后、且不在拖动中时开 —— 首帧套用存值不该滑一下,
        // 拖动中每一帧都在改位置,加过渡只会让图标追着指针跑。
        transition: [
          "background-color var(--dur-fast) ease-out",
          ...(hydrated && !drag
            ? ["left 180ms cubic-bezier(0.22, 1, 0.36, 1)", "top 180ms cubic-bezier(0.22, 1, 0.36, 1)"]
            : []),
        ].join(", "),
      }}
      className="z-[70] size-12 touch-none rounded-full p-0 shadow-[var(--shadow-md)] active:cursor-grabbing"
    >
      <OttoAvatar size={26} mood="idle" />
    </Button>
  );
}
