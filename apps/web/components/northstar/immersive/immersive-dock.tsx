"use client";

/**
 * 北极星 · 沉浸式常驻 Otto dock(§8d / §O6 · D2 单流小窗)
 *
 * 收起 48 圆点 ⇄ 展开 380×520 小窗。小窗 = 全局 Otto 单流的**小窗视图**(dock 小窗 /
 * `/otto` 全屏 / campaign 详情「对话」tab 都是同一条 ottoStream 的不同看法,永不是两个对话)。
 * 每条消息自动带 context chip(发生在哪个区 / 哪个 campaign);点 chip 深链回那个现场。
 * 右上 Maximize2 → `/otto` 全屏大窗(同一条流)。§O3:/otto 路径上 dock 由外壳隐藏。
 *
 * 铁律:coral 只属于 Otto(chip / 行中性,hover=accent 不 coral);动效 gate 在
 * prefers-reduced-motion;零后台 import。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUp, Check, Maximize2, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar, type OttoMood } from "@/components/otto/OttoAvatar";
import { useImmersive } from "./_context";
import {
  appendToStream,
  ottoBehavior,
  ottoContext,
  recentEvents,
  streamFor,
  useStore,
  type NsStreamMsg,
} from "./_store";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/* ── keyframes(与 _shared 同名循环共用) ── */
const KF_ID = "ns-immersive-dock-kf";
const KF = `@keyframes ns-badge-pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--brand) 45%, transparent); } 50% { box-shadow: 0 0 0 5px color-mix(in oklab, var(--brand) 0%, transparent); } }`;
function useKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(KF_ID)) return;
    const el = document.createElement("style");
    el.id = KF_ID;
    el.textContent = KF;
    document.head.appendChild(el);
  }, []);
}

const GALLERY_PREFIX = "/northstar/";
const IMMERSIVE_PREFIX = "/northstar-immersive/";
/** context chip 深链:把种子里的 /northstar/* href 改写成沉浸式路由(壳内不跳出)。 */
function immersiveHref(href: string): string {
  return href.startsWith(GALLERY_PREFIX) ? IMMERSIVE_PREFIX + href.slice(GALLERY_PREFIX.length) : href;
}

/* ── 一条消息的 context chip(点 chip 深链回现场;无 href 则静态展示) ── */
function ContextChip({ ctx, onNavigate }: { ctx: NsStreamMsg["context"]; onNavigate: () => void }) {
  const body = (
    <>
      <span className="font-mono text-[9px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {ctx.zone}
      </span>
      <span className="min-w-0 truncate">{ctx.label}</span>
    </>
  );
  if (!ctx.href) {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        {body}
      </span>
    );
  }
  return (
    <Link
      href={immersiveHref(ctx.href)}
      onClick={onNavigate}
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
    >
      {body}
    </Link>
  );
}

/* ── 面板里的一行消息(单流消息:owner 右 / otto 左 + context chip) ── */
function DockMessage({ m, onNavigate }: { m: NsStreamMsg; onNavigate: () => void }) {
  if (m.role === "owner") {
    return (
      <div className="flex flex-col items-end gap-1">
        <p className="max-w-[85%] rounded-[16px] rounded-br-[6px] bg-primary px-3 py-2 text-[13px] leading-[19px] text-primary-foreground">
          {m.text}
        </p>
        <ContextChip ctx={m.context} onNavigate={onNavigate} />
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <OttoAvatar size={20} mood={m.error ? "error" : "idle"} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        {m.text && (
          <p
            className={cn(
              "text-[13px] leading-[19px]",
              m.error ? "text-error-soft-foreground" : "text-foreground",
            )}
          >
            {m.text}
          </p>
        )}
        <ContextChip ctx={m.context} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

export interface ImmersiveDockHandle {
  open: (prompt?: string) => void;
}

/**
 * 常驻 dock。ref 暴露 open(prompt?);working 控制徽点脉冲。
 * fullHref = 全屏 Otto 页(点右上角放大跳过去,小窗与全屏读同一条 ottoStream)。
 */
export const ImmersiveDock = React.forwardRef<
  ImmersiveDockHandle,
  { working?: boolean; fullHref: string }
>(function ImmersiveDock({ working: workingProp = false, fullHref }, ref) {
  useKeyframes();
  useStore(); // 订阅共享 store:otto 工作态 / 事件流 / 单流 append 都触发重渲染
  const reduced = useReducedMotion();
  const immersive = useImmersive();
  // working 来自 shell 注入的 context(store 的 otto_working 事件),不再靠外部 prop 喂。
  const working = immersive?.ottoWorking ?? workingProp;
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [thinking, setThinking] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const timerRef = React.useRef<number | null>(null);

  // dock 小窗与 /otto 全屏读同一条 ottoStream(「share one state」为真)。
  const stream = streamFor();
  const lastEvent = recentEvents(1)[0];
  // 上下文桥(宪法 7):当前在看什么 → chip 显示 + 注入回复前缀,「这个」可解析。
  const ctx = ottoContext();
  const ctxLabel = ctx ? ctx.selectedLabel ?? ctx.view : null;

  React.useImperativeHandle(ref, () => ({
    open(prompt?: string) {
      setOpen(true);
      if (prompt != null) setDraft(prompt);
      window.setTimeout(() => inputRef.current?.focus(), 60);
    },
  }));

  // Esc 收起;不做 outside-click 关闭(常驻面板,点别处仍在)
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  React.useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, stream, thinking]);

  React.useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  function send() {
    const text = draft.trim();
    if (!text || thinking) return;
    // append 到共享 ottoStream(owner)→ /otto 全屏也看得到这条(状态同源)。
    // context chip 由当前 ottoContext 派生(zone + label),让这轮往来知道发生在哪个现场。
    appendToStream({ role: "owner", text });
    setDraft("");
    setThinking(true);
    // 上下文桥:知道正在看什么就把它当回复前缀,让「这个」有着落。
    const prefix = ctxLabel ? `On ${ctxLabel} — ` : "";
    timerRef.current = window.setTimeout(() => {
      setThinking(false);
      appendToStream({
        role: "otto",
        text: `${prefix}got it. I can draft that as a post or a full pack. Open the full workspace and I'll lay out the options.`,
      });
    }, 1400);
  }

  // 组合器约定(apps/web/AGENTS.md):Shift+Enter 发送,Enter 换行
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Otto 行为设置(账户 · Otto 行为面写它):dock 的作风提示随它可见地变。
  const behavior = ottoBehavior();
  const quiet = behavior.quietHours.enabled;
  const mood: OttoMood = working || thinking ? "thinking" : "idle";
  const badge = (working || thinking) && !quiet;
  // working 提示语随「自主级别」变;idle 时勿扰优先,其次回落静默。
  const label = working
    ? behavior.autonomy === "auto-in-routines"
      ? "Otto — working on your routines"
      : "Otto — working, will ask before it spends"
    : quiet
      ? `Otto — quiet until ${behavior.quietHours.to}`
      : "Otto — idle";

  return (
    <div ref={panelRef} className="fixed right-4 bottom-4 z-[70] flex flex-col items-end gap-2">
      {open && (
        <div
          role="dialog"
          aria-label="Otto"
          className="flex h-[520px] max-h-[calc(100dvh-96px)] w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-3xl border border-border bg-popover shadow-[var(--shadow-xl)]"
        >
          {/* header(56 = narration 解剖) */}
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <OttoAvatar size={24} mood={mood} />
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-semibold text-foreground">
              {thinking ? "Working…" : "Otto"}
            </span>
            <Button asChild variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Open full Otto">
              <Link href={fullHref} onClick={() => setOpen(false)}>
                <Maximize2 className="size-4" strokeWidth={2} />
              </Link>
            </Button>
            <button
              type="button"
              aria-label="Close Otto"
              onClick={() => setOpen(false)}
              className="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>

          {/* 上下文桥 chip:正在看什么(宪法 7);无 context 不占位 */}
          {ctxLabel && (
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-4 py-2">
              <span className="text-[11px] font-medium text-muted-foreground">Looking at</span>
              <span className="min-w-0 truncate rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-foreground">
                {ctxLabel}
              </span>
            </div>
          )}

          {/* messages = 全局单流(小窗视图) */}
          <div ref={scrollRef} role="log" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-4">
              <p className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
                One thread with Otto
              </p>
              {stream.map((m) => (
                <DockMessage key={m.id} m={m} onNavigate={() => setOpen(false)} />
              ))}
              {thinking && (
                <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <OttoAvatar size={16} mood="thinking" />
                  <span>Thinking…</span>
                </div>
              )}
            </div>
          </div>

          {/* composer */}
          <div className="shrink-0 border-t border-border p-3">
            <div className="flex items-end gap-2 rounded-[16px] border border-input bg-card p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Message Otto"
                rows={1}
                className="max-h-28 min-h-[36px] w-full resize-none bg-transparent px-2 py-1.5 text-[13px] leading-[19px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              {thinking ? (
                <Button
                  size="icon"
                  variant="secondary"
                  aria-label="Stop responding"
                  className="size-8 shrink-0 rounded-full"
                  onClick={() => {
                    if (timerRef.current) window.clearTimeout(timerRef.current);
                    setThinking(false);
                  }}
                >
                  <Square className="fill-current" strokeWidth={2} />
                </Button>
              ) : (
                <Button
                  size="icon"
                  aria-label="Send message"
                  className="size-8 shrink-0 rounded-full"
                  onClick={send}
                  disabled={!draft.trim()}
                >
                  <ArrowUp strokeWidth={2.5} />
                </Button>
              )}
            </div>
            <p className="mt-1.5 px-1 text-[11px] font-medium text-muted-foreground">
              Shift+Enter to send · Enter for a new line
            </p>
          </div>
        </div>
      )}

      {/* 收起态提示条:勿扰 > 工作态 > 最近一条事件。三者都读 store,设置改了立刻反映。 */}
      {!open && quiet ? (
        <div className="max-w-[260px] truncate rounded-full border border-border bg-secondary px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-[var(--shadow-sm)]">
          Quiet hours · won&apos;t ping until {behavior.quietHours.to}
        </div>
      ) : !open && working ? (
        <div className="max-w-[260px] truncate rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-foreground shadow-[var(--shadow-sm)]">
          {label}
        </div>
      ) : !open && lastEvent ? (
        <div className="max-w-[260px] truncate rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-[var(--shadow-sm)]">
          Just now · {lastEvent.label}
        </div>
      ) : null}

      {/* 收起圆点(48) */}
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-12 items-center justify-center rounded-full border border-border bg-card shadow-[var(--shadow-md)] transition-colors duration-[120ms] hover:bg-accent active:scale-[0.96]"
      >
        {open ? (
          <Check className="size-5 text-muted-foreground" strokeWidth={2} />
        ) : (
          <OttoAvatar size={26} mood={mood} />
        )}
        {badge && !open && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-2 ring-background"
            style={reduced ? undefined : { animation: "ns-badge-pulse 2s ease-in-out infinite" }}
          />
        )}
      </button>
    </div>
  );
});
