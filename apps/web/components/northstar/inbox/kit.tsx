"use client";

/**
 * 北极星原型 · 收件箱客服区共用件(仅 inbox 区页面使用)
 *
 * design-rules v3 依据:
 * §D4 表行(hairline list rows)· §FB7 骨架(shimmer 1.4s,≤3 块)
 * §8a coral sweep(一次性 ≤600ms;reduced motion = 静态描边)
 * §8b card landing(200ms spring,先占位再落卡)
 * §V3/V4 错误与空态 · §O 系:coral 只属于 Otto,答案溯源双重标注(色 + 文)
 *
 * 纯展示零后台;数据全部来自 ./mock-inbox(派生自 ../_mock)。
 * (Skeleton/DemoStateBar/ErrorPanel/useSweep 与排期区 kit 同形 —— 各区自持,
 *  待 scaffold 收编进 _shared 后统一,见 zone 报告。)
 */

import * as React from "react";
import { BookOpen, Check, CheckCheck, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { IB_CHANNELS, IB_TODAY, ibDoc, type IbChannel, type IbDelivery, type IbMessage } from "./mock-inbox";

/* ── keyframes(一次注入;.gb reduced-motion clamp 冻结循环) ─────────────── */
const KIT_KEYFRAMES_ID = "ns-inbox-keyframes";
const KIT_KEYFRAMES = `
@keyframes ns-ib-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes ns-ib-sweep {
  from {
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent);
    background-color: color-mix(in oklab, var(--brand-soft) 60%, transparent);
  }
  to { box-shadow: 0 0 0 2px transparent; background-color: transparent; }
}
`;

function useKitKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(KIT_KEYFRAMES_ID)) return;
    const el = document.createElement("style");
    el.id = KIT_KEYFRAMES_ID;
    el.textContent = KIT_KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

/* ── coral sweep(§8a) ─────────────────────────────────────────────────── */
export function useSweep(): { style: React.CSSProperties | undefined; fire: () => void } {
  useKitKeyframes();
  const reduced = useReducedMotion();
  const [active, setActive] = React.useState(false);

  const fire = React.useCallback(() => {
    setActive(true);
    window.setTimeout(() => setActive(false), 650);
  }, []);

  const style: React.CSSProperties | undefined = active
    ? reduced
      ? { boxShadow: "0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent)" }
      : { animation: "ns-ib-sweep 600ms ease-out 1" }
    : undefined;

  return { style, fire };
}

/* ── 骨架(§FB7) ───────────────────────────────────────────────────────── */
export function Skeleton({ shimmer = false, className }: { shimmer?: boolean; className?: string }) {
  useKitKeyframes();
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden
      className={cn("rounded-[10px] bg-muted", className)}
      style={
        shimmer
          ? {
              backgroundImage:
                "linear-gradient(90deg, var(--border) 25%, var(--card) 50%, var(--border) 75%)",
              backgroundSize: "200% 100%",
              animation: reduced ? undefined : "ns-ib-shimmer 1.4s ease-in-out infinite",
            }
          : undefined
      }
    />
  );
}

/** 会话行骨架:停在最终高度 */
export function ConversationRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
          <Skeleton className="size-9 rounded-full" shimmer={i === 0} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" shimmer={i === 1} />
            <Skeleton className="h-3 w-4/5" shimmer={i === 2} />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/* ── 错误面板(§D4:行内 13px + ghost Retry,外壳不消失) ─────────────────── */
export function ErrorPanel({ text, onRetry, className }: { text: string; onRetry: () => void; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-16 text-center", className)}>
      <CircleAlert className="size-5 text-error-soft-foreground" strokeWidth={2} />
      <p className="text-[13px] leading-[18px] font-medium text-error-soft-foreground" role="alert">
        {text}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="h-9 rounded-[10px] px-3.5 text-[13px] font-semibold text-foreground hover:bg-accent"
      >
        Try again
      </button>
    </div>
  );
}

/* ── 原型三态演示开关(PROGRAM §3.1) ────────────────────────────────────── */
export type DemoState = "data" | "loading" | "empty" | "error";

export function DemoStateBar({
  value,
  onChange,
  extra,
  className,
}: {
  value: DemoState;
  onChange: (v: DemoState) => void;
  /** 额外的演示动作按钮(如「来一条新消息」) */
  extra?: React.ReactNode;
  className?: string;
}) {
  const opts: { key: DemoState; label: string }[] = [
    { key: "data", label: "Data" },
    { key: "loading", label: "Loading" },
    { key: "empty", label: "Empty" },
    { key: "error", label: "Error" },
  ];
  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-[10] flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card py-1 pr-1 pl-3 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <span className="font-mono text-[10px] leading-none font-medium tracking-[0.08em] text-muted-foreground uppercase">
        原型三态
      </span>
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "h-6 rounded-full px-2.5 text-[11px] font-semibold",
            value === o.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
      {extra}
    </div>
  );
}

/* ── 渠道徽标(micro-mono 短码,零假 brand 图标) ─────────────────────────── */
export function ChannelTag({ channel, className }: { channel: IbChannel; className?: string }) {
  return (
    <span
      title={IB_CHANNELS[channel].label}
      className={cn(
        "inline-flex h-5 w-7 shrink-0 items-center justify-center rounded-[8px] bg-secondary font-mono text-[10px] leading-none font-medium tracking-[0.06em] text-secondary-foreground",
        className,
      )}
    >
      {IB_CHANNELS[channel].short}
    </span>
  );
}

/* ── 联系人头像(首字母;零外链图片) ────────────────────────────────────── */
export function ContactAvatar({ initials, size = 36, className }: { initials: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-muted-foreground",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
    >
      {initials}
    </span>
  );
}

/* ── 受理人(人或 Otto;Otto = 16px 云标记,§O4 marks 类) ────────────────── */
export function AssigneeChip({
  assignee,
  live = false,
  className,
}: {
  assignee: "otto" | "owner" | "none";
  live?: boolean;
  className?: string;
}) {
  if (assignee === "none") {
    return (
      <span className={cn("inline-flex h-6 items-center rounded-full border border-dashed border-border px-2 text-[11px] font-medium text-muted-foreground", className)}>
        Unassigned
      </span>
    );
  }
  if (assignee === "otto") {
    return (
      <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-card px-2 text-[11px] font-medium text-foreground", className)}>
        <OttoAvatar size={16} mood={live ? "thinking" : "idle"} />
        Otto
      </span>
    );
  }
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-card px-2 text-[11px] font-medium text-foreground", className)}>
      <span className="flex size-4 items-center justify-center rounded-full bg-secondary text-[8px] font-semibold text-muted-foreground">
        AR
      </span>
      Aisyah
    </span>
  );
}

/* ── 日期与时间(确定性格式化) ─────────────────────────────────────────── */
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** "08:12" → "8:12 am" */
export function fmtClock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** 列表相对时间:今天 → 时刻,昨天 → "Yesterday",更早 → "Sat 5 Jul" */
export function fmtWhen(day: string, time: string): string {
  if (day === IB_TODAY) return fmtClock(time);
  const diff = Math.round((utc(IB_TODAY).getTime() - utc(day).getTime()) / 86400000);
  if (diff === 1) return "Yesterday";
  const d = utc(day);
  return `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/** 线程日分隔:"Today" / "Yesterday" / "Saturday 5 July" */
export function fmtDayDivider(day: string): string {
  if (day === IB_TODAY) return "Today";
  const diff = Math.round((utc(IB_TODAY).getTime() - utc(day).getTime()) / 86400000);
  if (diff === 1) return "Yesterday";
  const d = utc(day);
  return `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/* ── 送达态(出站消息;read 用语义 info 色 = 状态,非装饰) ───────────────── */
export function DeliveryTicks({ delivery, className }: { delivery: IbDelivery; className?: string }) {
  const label = delivery === "sent" ? "Sent" : delivery === "delivered" ? "Delivered" : "Read";
  const Icon = delivery === "sent" ? Check : CheckCheck;
  return (
    <span title={label} className={cn("inline-flex items-center", className)}>
      <Icon
        className={cn("size-3.5", delivery === "read" ? "text-info" : "text-muted-foreground")}
        strokeWidth={2}
        aria-label={label}
      />
    </span>
  );
}

/* ── 答案溯源 chip(判决 7-8 / O-06:这句来自哪份 KnowledgeDoc) ──────────── */
export function SourceChip({
  docId,
  onOpen,
  className,
}: {
  docId: string;
  onOpen?: (docId: string) => void;
  className?: string;
}) {
  const doc = ibDoc(docId);
  if (!doc) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(docId)}
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-border bg-card px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <BookOpen className="size-3 shrink-0" strokeWidth={2} />
      <span className="truncate">
        via {doc.title} · v{doc.versions[0]?.v ?? 1}
      </span>
    </button>
  );
}

/* ── 消息气泡(§4 py12 px16;客户在左,出站在右;note 居中) ──────────────── */
export function MessageBubble({
  message,
  landing = false,
  sweepStyle,
  onOpenSource,
}: {
  message: IbMessage;
  /** §8b card landing(Otto 新回复) */
  landing?: boolean;
  sweepStyle?: React.CSSProperties;
  onOpenSource?: (docId: string) => void;
}) {
  const reduced = useReducedMotion();
  if (message.from === "note") {
    return (
      <div className="flex justify-center px-4 py-1">
        <span className="max-w-[420px] rounded-full bg-secondary px-3 py-1 text-center text-xs leading-4 text-muted-foreground">
          {message.text}
        </span>
      </div>
    );
  }

  const outbound = message.from !== "customer";
  const isOtto = message.from === "otto";
  return (
    <div className={cn("flex px-4 py-1", outbound ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[80%] flex-col gap-1", outbound && "items-end")}>
        <div
          className={cn(
            "rounded-[18px] px-4 py-3",
            outbound ? "bg-secondary text-foreground" : "border border-border bg-card text-foreground",
          )}
          style={{
            ...(landing && !reduced
              ? { animation: "fade-rise 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both" }
              : undefined),
            ...sweepStyle,
          }}
        >
          {message.media ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={message.media} alt="Photo from customer" className="max-w-[240px] rounded-[10px] border border-border" />
          ) : (
            <p className="text-[15px] leading-[22px] whitespace-pre-wrap">{message.text}</p>
          )}
        </div>
        <div className={cn("flex min-w-0 items-center gap-1.5 px-1", outbound && "flex-row-reverse")}>
          {isOtto && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <OttoAvatar size={16} mood="idle" />
              Otto
            </span>
          )}
          <span className="text-[11px] text-muted-foreground tabular-nums">{fmtClock(message.time)}</span>
          {outbound && message.delivery && <DeliveryTicks delivery={message.delivery} />}
          {isOtto && message.sourceDocId && <SourceChip docId={message.sourceDocId} onOpen={onOpenSource} />}
        </div>
      </div>
    </div>
  );
}

/* ── 气泡骨架(对话 loading 态) ─────────────────────────────────────────── */
export function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <Skeleton className="h-14 w-3/5 self-start rounded-[18px]" shimmer />
      <Skeleton className="h-14 w-1/2 self-end rounded-[18px]" shimmer />
      <Skeleton className="h-10 w-2/5 self-start rounded-[18px]" shimmer />
      <Skeleton className="h-14 w-3/5 self-end rounded-[18px]" />
    </div>
  );
}
