"use client";

/**
 * 北极星原型 · 创作区 — 区内共用小件
 *
 * DemoStateBar   设计审六条「三态齐全」的页内演示切换器(live / loading / empty / error)
 * Skeleton       §FB7 骨架(shimmer 渐变,reduced-motion 冻结)
 * ErrorPanel     §V3 错误三槽(what happened / money line / what now)
 * InkNarrationPill  canvas 专用叙述胶囊(§O5:ink pill + 16px 无眼 coral glyph)
 * FeedbackControls  GOAL J1:👍 绿持久 + Add a note;👎 Bad result
 * SpendConfirmDialog §FB6/§V5 花费确认(金额逐字进 impacts list,brand 键 = 启动 Otto 工作)
 *
 * 铁律:纯展示、零后台;coral 只属于 Otto;动效 gate 在 prefers-reduced-motion。
 */

import * as React from "react";
import { Check, CircleAlert, Flag, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInsideImmersive } from "../immersive/_context";
import { brandCheckChips } from "../assets/_data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ── shared keyframes(注入一次;.gb reduced-motion clamp 冻结循环) ── */
const KEYFRAMES_ID = "ns-create-keyframes";
const KEYFRAMES = `
@keyframes ns-create-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes ns-create-slide { 0% { left: -40%; } 100% { left: 100%; } }
@keyframes ns-create-land { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes ns-create-sweep {
  from { box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent); background-color: color-mix(in oklab, var(--brand-soft) 60%, transparent); }
  to { box-shadow: 0 0 0 2px transparent; background-color: transparent; }
}
`;

export function useCreateKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(KEYFRAMES_ID)) return;
    const el = document.createElement("style");
    el.id = KEYFRAMES_ID;
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/** §8b card landing:落卡动画 class(reduced motion 自动被 clamp 冻结) */
export const LAND_STYLE: React.CSSProperties = {
  animation: "ns-create-land 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
};

/** §8a coral sweep:一次性,≤600ms */
export const SWEEP_STYLE: React.CSSProperties = {
  animation: "ns-create-sweep 600ms cubic-bezier(0.22, 1, 0.36, 1) 1 both",
};

/* ────────────────────────────────────────────────────────────────────────
 * DemoStateBar — 三态演示切换器(原型专用小件,mono 标注防误认产品控件)
 * ──────────────────────────────────────────────────────────────────────── */
export type DemoState = "live" | "loading" | "empty" | "error";

export function DemoStateBar({
  state,
  onChange,
  className,
}: {
  state: DemoState;
  onChange: (s: DemoState) => void;
  className?: string;
}) {
  // 沉浸式产品外壳内不出现原型三态演示 chrome(与 _shared/analytics/campaign 同规矩)。
  if (useInsideImmersive()) return null;
  const states: DemoState[] = ["live", "loading", "empty", "error"];
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        三态演示
      </span>
      <div className="flex rounded-[10px] border border-border bg-card p-0.5">
        {states.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={cn(
              "h-[26px] rounded-lg px-3 text-xs font-semibold transition-colors duration-[120ms]",
              state === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Skeleton — §FB7(同形同角,shimmer 1.4s)
 * ──────────────────────────────────────────────────────────────────────── */
export function Skeleton({
  className,
  shimmer = true,
  style,
}: {
  className?: string;
  shimmer?: boolean;
  style?: React.CSSProperties;
}) {
  useCreateKeyframes();
  return (
    <div
      aria-hidden
      className={cn("rounded-[10px]", shimmer ? "" : "bg-muted", className)}
      style={
        shimmer
          ? {
              background:
                "linear-gradient(90deg, var(--border) 25%, var(--card) 50%, var(--border) 75%)",
              backgroundSize: "200% 100%",
              animation: "ns-create-shimmer 1.4s ease-in-out infinite",
              ...style,
            }
          : style
      }
    />
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * ErrorPanel — §V3 三槽错误(panel chrome 保留,ghost retry)
 * ──────────────────────────────────────────────────────────────────────── */
export function ErrorPanel({
  what,
  money,
  onRetry,
  className,
}: {
  what: string;
  money?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-2 rounded-[14px] bg-error-soft p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[13px] leading-[18px] font-medium text-error-soft-foreground">
        <CircleAlert className="size-4 shrink-0" strokeWidth={2} />
        <span>
          {what}
          {money ? ` ${money}` : ""}
        </span>
      </div>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="h-8 px-3 text-[13px]">
          Try again
        </Button>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * InkNarrationPill — canvas 叙述胶囊(§O5:ink pill radius 999 + 16px 无眼 glyph)
 * ──────────────────────────────────────────────────────────────────────── */
export function InkNarrationPill({
  text,
  counter,
  className,
}: {
  text: string;
  counter?: string;
  className?: string;
}) {
  useCreateKeyframes();
  const reduced = useReducedMotion();
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-full bg-primary px-4 py-2 shadow-[var(--shadow-md)]",
        className,
      )}
    >
      <span aria-hidden className="size-4 shrink-0 rounded-[7px] bg-brand" />
      <span className="text-[13px] leading-[18px] font-medium text-primary-foreground">
        {reduced ? "Working…" : text}
      </span>
      {counter ? (
        <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-primary-foreground/80 tabular-nums">
          {counter}
        </span>
      ) : (
        !reduced && (
          <span
            aria-hidden
            className="relative h-[5px] w-12 overflow-hidden rounded-full bg-primary-foreground/20"
          >
            <span
              className="absolute top-0 h-full w-[40%] rounded-full bg-brand"
              style={{ animation: "ns-create-slide 1.3s ease-in-out infinite" }}
            />
          </span>
        )
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * FeedbackControls — GOAL J1(👍 绿持久 + note;👎 Bad result;🚩 flag)
 * ──────────────────────────────────────────────────────────────────────── */
export type FeedbackValue = "up" | "down" | null;

export function FeedbackControls({
  value,
  onChange,
  withFlag = false,
  className,
}: {
  value: FeedbackValue;
  onChange: (v: FeedbackValue) => void;
  withFlag?: boolean;
  className?: string;
}) {
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [noteSaved, setNoteSaved] = React.useState(false);
  const [flagged, setFlagged] = React.useState(false);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Good result"
          aria-pressed={value === "up"}
          onClick={() => {
            const next = value === "up" ? null : "up";
            onChange(next);
            setNoteOpen(next === "up");
            if (next !== "up") setNoteSaved(false);
          }}
          className={cn(
            "flex size-7 items-center justify-center rounded-lg transition-colors duration-[120ms]",
            value === "up"
              ? "bg-success-soft text-success-soft-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <ThumbsUp className="size-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label="Bad result"
          aria-pressed={value === "down"}
          onClick={() => {
            onChange(value === "down" ? null : "down");
            setNoteOpen(false);
          }}
          className={cn(
            "flex size-7 items-center justify-center rounded-lg transition-colors duration-[120ms]",
            value === "down"
              ? "bg-error-soft text-error-soft-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <ThumbsDown className="size-3.5" strokeWidth={2} />
        </button>
        {withFlag && (
          <button
            type="button"
            aria-label="Flag this result"
            aria-pressed={flagged}
            onClick={() => setFlagged((f) => !f)}
            className={cn(
              "flex size-7 items-center justify-center rounded-lg transition-colors duration-[120ms]",
              flagged
                ? "bg-error-soft text-error-soft-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Flag className="size-3.5" strokeWidth={2} />
          </button>
        )}
        {value === "down" && (
          <span className="text-xs font-medium text-error-soft-foreground">Bad result</span>
        )}
        {flagged && value !== "down" && (
          <span className="text-xs font-medium text-error-soft-foreground">Flagged for review</span>
        )}
      </div>
      {value === "up" && noteOpen && !noteSaved && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setNoteSaved(true);
          }}
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note (optional)"
            className="h-8 w-44 rounded-[10px] border border-input bg-card px-2.5 text-[13px] text-foreground shadow-[var(--shadow-xs)] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
          <Button type="submit" variant="secondary" size="sm" className="h-8 px-3 text-xs">
            Save
          </Button>
        </form>
      )}
      {value === "up" && noteSaved && (
        <span className="text-xs text-muted-foreground">Note saved</span>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * BrandCheckRow — 连接器 2(C-08):生成前品牌校验一行 pass/warn chips。
 * 确定性假规则(assets/_data.brandCheckChips),读 BRAND_KIT;不是 Otto 的作品,
 * 所以零 coral —— pass 走 success-soft、warn 走 warning-soft。
 * ──────────────────────────────────────────────────────────────────────── */
function BrandCheckRow({ seedText }: { seedText: string }) {
  const chips = React.useMemo(() => brandCheckChips(seedText), [seedText]);
  if (chips.length === 0) return null;
  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground">Brand check</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span
            key={c.id}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-[16px] font-medium",
              c.level === "warn"
                ? "bg-warning-soft text-warning-soft-foreground"
                : "bg-success-soft text-success-soft-foreground",
            )}
          >
            {c.level === "warn" ? (
              <TriangleAlert className="size-3 shrink-0" strokeWidth={2} />
            ) : (
              <Check className="size-3 shrink-0" strokeWidth={2} />
            )}
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * SpendConfirmDialog — §FB6 tier 3 money + §V5 spend arc ④⑤
 * brand 主键:确认即启动 Otto 生成工作(FB5 允许的唯一 brand 场景)。
 * `subject` = 正在生成什么(prompt / 素材名),供品牌校验行判 logo/色偏离;
 * 缺省回落 title,四个创作区花费弹窗零改动也带上校验(连接器 2 一处接线全覆盖)。
 * ──────────────────────────────────────────────────────────────────────── */
export type GenTier = "speed" | "quality";

/** Quality 档在 Speed 基础上加 50% credits(N-Grok「双档=要」判决;确定性,不猜价)。 */
export function tierCredits(baseCredits: number, tier: GenTier): number {
  return tier === "quality" ? Math.round(baseCredits * 1.5) : baseCredits;
}

export function SpendConfirmDialog({
  open,
  onOpenChange,
  title,
  ask,
  impacts,
  confirmLabel,
  onConfirm,
  baseCredits,
  onConfirmTier,
  subject,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  ask: string;
  impacts: string[];
  confirmLabel: string;
  onConfirm: () => void;
  /** 传入 = 启用 Speed/Quality 双档;dialog 自算价差、把选中档与最终 credits 交回 onConfirmTier。 */
  baseCredits?: number;
  onConfirmTier?: (tier: GenTier, credits: number) => void;
  /** 生成什么(prompt / 素材名),供品牌校验行判 logo/色偏离;缺省回落 title。 */
  subject?: string;
}) {
  // [B0-82 lint 适配 · 照 #255 先例] 弹窗本地态(tier)下沉 SpendConfirmBody:Radix Dialog
  // 关即卸载、开即新挂,useState 初值 "speed" 即「每次开弹窗回到 Speed(便宜档),不跨次
  // 残留上一次选择」,替代原 open-effect 同步重置(set-state-in-effect 正解——态绑挂载
  // 生命周期,immersive-shell §L4 注释所称 React 官方首选 remount 形态;关闭动画期实例
  // 仍在、画面不变,重开 = 新实例 = 回到 Speed)。
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <SpendConfirmBody
          onOpenChange={onOpenChange}
          title={title}
          ask={ask}
          impacts={impacts}
          confirmLabel={confirmLabel}
          onConfirm={onConfirm}
          baseCredits={baseCredits}
          onConfirmTier={onConfirmTier}
          subject={subject}
        />
      </DialogContent>
    </Dialog>
  );
}

function SpendConfirmBody({
  onOpenChange,
  title,
  ask,
  impacts,
  confirmLabel,
  onConfirm,
  baseCredits,
  onConfirmTier,
  subject,
}: {
  onOpenChange: (v: boolean) => void;
  title: string;
  ask: string;
  impacts: string[];
  confirmLabel: string;
  onConfirm: () => void;
  baseCredits?: number;
  onConfirmTier?: (tier: GenTier, credits: number) => void;
  subject?: string;
}) {
  const tiered = typeof baseCredits === "number" && !!onConfirmTier;
  const [tier, setTier] = React.useState<GenTier>("speed");
  const finalCredits = tiered ? tierCredits(baseCredits!, tier) : 0;

  return (
    <>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{ask}</DialogDescription>
        </DialogHeader>
        <div className="rounded-[14px] bg-secondary/70 p-4">
          <p className="text-xs font-semibold text-muted-foreground">What happens</p>
          <ul className="mt-2 space-y-1.5">
            {impacts.map((line) => (
              <li key={line} className="text-[13px] leading-[18px] text-foreground">
                {line}
              </li>
            ))}
          </ul>
        </div>
        <BrandCheckRow seedText={subject ?? title} />
        {tiered && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Speed or quality</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                { id: "speed" as GenTier, label: "Speed", sub: "Faster draft" },
                { id: "quality" as GenTier, label: "Quality", sub: "Sharper, slower" },
              ]).map((t) => {
                const c = tierCredits(baseCredits!, t.id);
                const on = tier === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTier(t.id)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-[14px] border p-3 text-left transition-colors duration-[120ms]",
                      on ? "border-foreground bg-secondary" : "border-border hover:bg-accent",
                    )}
                  >
                    <span className="text-sm font-semibold text-foreground">{t.label}</span>
                    <span className="text-xs text-muted-foreground">{t.sub}</span>
                    <span className="mt-1 font-mono text-[11px] leading-[14px] font-medium text-foreground tabular-nums">
                      {c} credits
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <DialogFooter className="flex-row justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="brand"
            size="sm"
            onClick={() => (tiered ? onConfirmTier!(tier, finalCredits) : onConfirm())}
          >
            {tiered ? `Confirm generate · ${finalCredits} credits` : confirmLabel}
          </Button>
        </DialogFooter>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * SectionLabel — micro-mono 小节标(§N2 group label 形制)
 * ──────────────────────────────────────────────────────────────────────── */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}
