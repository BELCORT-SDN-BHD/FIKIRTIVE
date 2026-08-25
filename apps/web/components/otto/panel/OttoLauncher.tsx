"use client";

/**
 * OttoLauncher.tsx — 面板收起时的那颗浮动图标。R22 里它就是 Otto 本人(pet)。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.2 末段;视觉权威 = R22 原型的 `.pet` 段
 * (L468-489 的 CSS、L5473-5482 的结构、L5933-5981 的行为)。
 *
 * 「拖」与「点」共用一次按下:位移小于阈值就是点击(开面板),超过就是拖动(吸边)。
 * 这一段判断放在这里,吸到哪一条边的算术在 `panel-geometry.ts`。
 *
 * ── 2026-08-25 Founder 实机反馈的两个病根,都在这个文件 ──────────────────────────
 *
 * ① **拖不动**。R22 那一版用 `next/image` 画云朵,渲染出来是一个真的 `<img>`,而 `<img>`
 *    默认 `draggable=true`。在 4300 端口那棵树上实测到的事件序列一字不差是:
 *
 *        pointerdown → pointermove → dragstart → pointercancel
 *
 *    浏览器在第一次 `pointermove` 之后就把这次手势收走去做原生图片拖拽,`pointerup` 永远
 *    不会来,存档里的 launcher 落点一动不动。所以云朵改成**内联 SVG**(内联 SVG 不是可
 *    原生拖拽的对象),按钮再补一发 `onDragStart` 兜底。内联还顺带换回了原型的眨眼动画 ——
 *    `<img>` 里的 `<g class="eyes">` 是外部文档,CSS 够不着。
 *
 * ② **半腰漂移**。出厂落点原来是 JS 算的:`launcherPosition(anchor, viewport)`。而 viewport
 *    只在挂载时量一次,量到 0 就被 `normalizeViewport` 安静地换成 1440×900,pet 从此钉在
 *    1368/828 —— 1280×720 的窗口里整颗在屏幕外,1512×982 的窗口里飘在离角落 90px 的半空。
 *    (实测:导航完成那一刻 `window.innerWidth === 0`,稍后才变 1280,而这中间不会有
 *    `resize` 事件。)原型对这件事根本不算:`.pet{position:fixed;right:22px;bottom:22px}`。
 *    所以**没被拖过的 pet 一律走 CSS 贴角**,一次测量都不需要;商家真的拖过之后才按比例
 *    算落点,那时视窗早就有真数了。
 */

import * as React from "react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Button } from "@/components/ui/button";
import {
  type LauncherAnchor,
  type Viewport,
  isDefaultLauncherAnchor,
  launcherMetrics,
  launcherPosition,
} from "./panel-geometry";

/** 按下到松手之间走了这么多像素以内,算点击不算拖动(原型 L5962:`Math.hypot(dx,dy)>6`)。 */
const CLICK_SLOP_PX = 6;

/** 原型 L5936-5937 那五句轮播,一字不改。 */
export const OTTO_PET_LINES = [
  "Need some help?",
  "Maybe ask me?",
  "Two Raya images just finished.",
  "I can plan Friday’s posts.",
  "Your batch is rendering — want a look?",
] as const;

/** 原型 L5945/L5949-5950:挂载后 4.5s 先说一句,之后每 14s 换一句,每句显示 5s。 */
export const OTTO_PET_FIRST_SAY_MS = 4500;
export const OTTO_PET_SAY_INTERVAL_MS = 14000;
export const OTTO_PET_SAY_HOLD_MS = 5000;

export interface OttoLauncherProps {
  anchor: LauncherAnchor;
  viewport: Viewport;
  hydrated: boolean;
  onOpen: () => void;
  /** 松手时的落点(图标左上角),由上层交给 `snapLauncher` 吸边。 */
  onRelease: (point: { x: number; y: number }) => void;
  variant?: "legacy" | "r22";
}

/** 两种外观共用的那一组按钮属性(标识、可及名字、拖/点的接线)。 */
type LauncherButtonProps = React.ComponentProps<"button"> & Record<`data-${string}`, string | undefined>;

/** 画出来要用的那一份:图标左上角在哪、这一次算不算拖动了。 */
interface DragState {
  x: number;
  y: number;
  moved: boolean;
}

/** 这一次按下的起点。它每一帧都要读、但一次都不该触发重画,所以住在 ref 里。 */
interface DragOrigin {
  pointerX: number;
  pointerY: number;
  /** 指针按在图标内部的偏移,拖动时保持不变,图标才不会跳到指针底下。 */
  offsetX: number;
  offsetY: number;
  moved: boolean;
}

/**
 * 拖 / 点共用的那一次按下。两种外观(legacy 的圆钮、r22 的 pet)共用这一份,
 * 免得同一段「这算点击还是拖动」的判断在一个文件里各写一遍。
 *
 * `onDragBegin` 在位移第一次越过阈值那一下响一次 —— pet 的说话气泡靠它收起来
 * (原型 L5962 的 `hideSay()` 也正是挂在这一刻)。它是一次事件,不是一个状态,
 * 所以在指针处理器里调,不在 effect 里 setState。
 */
function useLauncherDrag(onRelease: (point: { x: number; y: number }) => void, onDragBegin?: () => void) {
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const origin = React.useRef<DragOrigin | null>(null);

  const latest = React.useRef({ onRelease, onDragBegin });
  React.useEffect(() => {
    latest.current = { onRelease, onDragBegin };
  });

  // 浏览器在 pointerup **之后**才发 click,而那时拖动状态已经清干净了 —— 光看 state
  // 会把「拖完松手」当成「点了一下」,图标一拖就把面板打开。用一次性的旗子挡掉那一发。
  const swallowNextClick = React.useRef(false);

  React.useEffect(() => {
    if (!drag) return;

    function handleMove(event: PointerEvent) {
      const start = origin.current;
      if (!start) return;
      if (!start.moved) {
        // 阈值之内什么都不做(原型 L5962-5963:`if(!moved)return`)—— 手抖不该让图标滑走。
        if (Math.hypot(event.clientX - start.pointerX, event.clientY - start.pointerY) <= CLICK_SLOP_PX) return;
        start.moved = true;
        latest.current.onDragBegin?.();
      }
      setDrag({ x: event.clientX - start.offsetX, y: event.clientY - start.offsetY, moved: true });
    }

    function handleUp() {
      if (drag?.moved) {
        swallowNextClick.current = true;
        latest.current.onRelease({ x: drag.x, y: drag.y });
      }
      origin.current = null;
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

  function onPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    // 每一次新的按下都先把旗子清干净。`pointercancel`(手势被系统接管、页面滚起来)
    // 会走 handleUp 而**不**产生 click,旗子就那样留着,下一次真的点击被它吃掉 ——
    // 商家点了图标却什么都没发生。清在这里,因为这里是唯一「下一次点击开始了」的时刻。
    swallowNextClick.current = false;
    // 起点从 DOM 量,不从 props 算:出厂位置是 CSS 贴角的(见文件头 ②),那一路根本没有
    // left/top 可读。原型 L5957 也是这么做的(`pet.getBoundingClientRect()`)。
    const rect = event.currentTarget.getBoundingClientRect();
    origin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    setDrag({ x: rect.left, y: rect.top, moved: false });
  }

  function onClick(fire: () => void) {
    if (swallowNextClick.current) {
      swallowNextClick.current = false;
      return;
    }
    fire();
  }

  return { drag, onPointerDown, onClick };
}

export function OttoLauncher({ anchor, viewport, hydrated, onOpen, onRelease, variant = "legacy" }: OttoLauncherProps) {
  const metrics = launcherMetrics(variant);
  // pet 的说话气泡住在 `R22Pet` 里,而「开始拖了」这件事只有这一层知道。用一个 ref 把
  // 收气泡那一下交过来 —— 它是一次事件(原型 L5962 的 `hideSay()`),不是一个要同步的状态。
  const hideSay = React.useRef<(() => void) | null>(null);
  const { drag, onPointerDown, onClick } = useLauncherDrag(onRelease, () => hideSay.current?.());
  const resting = launcherPosition(anchor, viewport, metrics);

  // 出厂位置走 CSS 贴角,一次测量都不经过(文件头 ②)。拖过之后才用算出来的 left/top。
  const parked = variant === "r22" && !drag && isDefaultLauncherAnchor(anchor);
  const placement: React.CSSProperties = drag
    ? { left: drag.x, top: drag.y }
    : parked
      ? { right: metrics.margin, bottom: metrics.margin }
      : { left: resting.left, top: resting.top };

  const shared: LauncherButtonProps = {
    "data-otto-launcher": "",
    "data-otto-launcher-edge": anchor.edge,
    "data-otto-launcher-variant": variant,
    ...(hydrated ? { "data-otto-panel-hydrated": "" } : {}),
    ...(drag?.moved ? { "data-otto-launcher-dragging": "" } : {}),
    "aria-label": variant === "r22" ? "Otto — drag me, or click to chat" : "Ask Otto",
    title: variant === "r22" ? "Otto — drag me, or click to chat" : "Ask Otto",
    "aria-keyshortcuts": "Meta+J Control+J",
    // 原生图片/元素拖拽必须挡死,否则它会把这次指针手势整个收走(文件头 ①)。
    draggable: false,
    onDragStart: (event: React.DragEvent) => event.preventDefault(),
    onPointerDown,
    onClick: () => onClick(onOpen),
  };

  // 位置的过渡只在挂载后、且不在拖动中时开 —— 首帧套用存值不该滑一下,
  // 拖动中每一帧都在改位置,加过渡只会让图标追着指针跑。
  const positionTransition =
    hydrated && !drag
      ? ["left 180ms cubic-bezier(0.22, 1, 0.36, 1)", "top 180ms cubic-bezier(0.22, 1, 0.36, 1)"]
      : [];

  if (variant === "r22") {
    return (
      <R22Pet
        placement={placement}
        metrics={metrics}
        dragging={!!drag?.moved}
        hideSayRef={hideSay}
        positionTransition={positionTransition}
        buttonProps={shared}
      />
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      {...shared}
      style={{
        position: "fixed",
        ...placement,
        width: metrics.size,
        height: metrics.size,
        transition: ["background-color var(--dur-fast) ease-out", ...positionTransition].join(", "),
      }}
      // 层级与面板同一张表(见 OttoPanel 那段:壳内手搓的 fixed z-50 模态框才是对照物,
      // portal 到 body 的 ui/dialog 根本不在这个层叠上下文里)。导轨 40 < launcher 45 < 50。
      className="z-[45] size-12 touch-none rounded-full p-0 shadow-[var(--shadow-md)] active:cursor-grabbing"
    >
      <OttoAvatar size={26} mood="idle" />
    </Button>
  );
}

/**
 * R22 的 pet:一个 `position: fixed` 的外壳,里面是说话气泡 + 圆钮。
 *
 * 气泡必须是按钮的**兄弟**而不是子节点 —— 它比按钮宽得多,塞进按钮里既压不住圆形裁切,
 * 也会把一段装饰性文字读进按钮的可及名字里。外壳负责定位,圆钮负责手感。
 */
function R22Pet({
  placement,
  metrics,
  dragging,
  hideSayRef,
  positionTransition,
  buttonProps,
}: {
  placement: React.CSSProperties;
  metrics: { size: number; margin: number };
  dragging: boolean;
  hideSayRef: React.RefObject<(() => void) | null>;
  positionTransition: string[];
  buttonProps: LauncherButtonProps;
}) {
  const say = useOttoPetSay(hideSayRef);

  return (
    <div
      data-otto-launcher-pet=""
      // 落点是外壳的事实(定位在这一层),所以边也标在这一层,而不是只标在按钮上。
      data-otto-launcher-edge={buttonProps["data-otto-launcher-edge"]}
      {...(dragging ? { "data-otto-launcher-dragging": "" } : {})}
      style={{
        position: "fixed",
        ...placement,
        transition: positionTransition.join(", ") || undefined,
      }}
      className="r22-otto-pet"
    >
      <span data-otto-launcher-say="" aria-hidden className="r22-otto-pet-say" data-shown={say ? "" : undefined}>
        {say}
      </span>
      <Button
        unstyled
        type="button"
        {...buttonProps}
        style={{ width: metrics.size, height: metrics.size }}
        className="r22-otto-pet-btn"
      >
        <R22OttoCloud className="r22-otto-pet-cloud" blink />
      </Button>
    </div>
  );
}

/**
 * 说话气泡的节奏,逐字照原型 L5940-5951:挂载后 4.5s 说第一句,之后每 14s 换一句,
 * 每句显示 5s。开始拖的那一下由 `hideSayRef` 收起来(原型 L5962 的 `hideSay()`);
 * 面板开着时 launcher 整个不渲染,所以那一条守卫由「组件不存在」承担。
 */
function useOttoPetSay(hideSayRef: React.RefObject<(() => void) | null>): string | null {
  const [line, setLine] = React.useState<string | null>(null);
  const indexRef = React.useRef(0);

  React.useEffect(() => {
    let hold: ReturnType<typeof setTimeout> | null = null;
    const hide = () => {
      if (hold) clearTimeout(hold);
      setLine(null);
    };
    const show = () => {
      setLine(OTTO_PET_LINES[indexRef.current++ % OTTO_PET_LINES.length]!);
      if (hold) clearTimeout(hold);
      hold = setTimeout(hide, OTTO_PET_SAY_HOLD_MS);
    };
    const first = setTimeout(show, OTTO_PET_FIRST_SAY_MS);
    const loop = setInterval(show, OTTO_PET_SAY_INTERVAL_MS);
    hideSayRef.current = hide;
    return () => {
      hideSayRef.current = null;
      clearTimeout(first);
      clearInterval(loop);
      if (hold) clearTimeout(hold);
    };
  }, [hideSayRef]);

  return line;
}

/**
 * 原型那朵云,内联 SVG。坐标一字不差取自 R22 原型 L5477-5480。
 *
 * `blink` 只在 pet 上开:面板头那一份原型里没有 `<g class="eyes">` 包裹,也就不眨眼
 * (原型 L5436-5439,眼睛 `y="44"`)。颜色是硬编码的十六进制,原型三处 SVG 也是 ——
 * Otto 的橘色不跟随任何表面的主题变量走。
 */
export function R22OttoCloud({ className, blink = false }: { className?: string; blink?: boolean }) {
  return (
    <svg viewBox="0 0 120 110" aria-hidden="true" focusable="false" className={className}>
      <g fill="#EC5828">
        <ellipse cx="60" cy="64" rx="43" ry="22" />
        <circle cx="37" cy="52" r="18" />
        <circle cx="61" cy="40" r="24" />
        <circle cx="85" cy="53" r="17" />
      </g>
      <g className={blink ? "r22-otto-eyes" : undefined}>
        <rect x="51" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
        <rect x="66" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
      </g>
    </svg>
  );
}
