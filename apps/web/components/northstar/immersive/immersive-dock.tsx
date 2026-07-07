"use client";

/**
 * 北极星 · 沉浸式常驻 Otto dock(§8d / §O6)
 *
 * 跟随每一条路由(fixed 右下角);收起 48 圆点 ⇄ 展开为「聊天面板」(不是画廊的
 * 动作历史列表 + 「Open Otto」文字,而是真能打字、Otto 真会流式回话的一小块工作面)。
 * openOtto(prompt?) 由外壳注入:任意页面点「问 Otto」都能带一句预填开面板(不自动发送)。
 *
 * 复用:气泡/卡片来自 global/chat-cards(ChatCard、ApprovalFlow)与 OttoAvatar;
 * 收起圆点与徽点脉冲照抄 global/demo-dock 的 DockButton 视觉规格。
 * 铁律:coral 只属于 Otto;动效 gate 在 prefers-reduced-motion;零后台。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUp, Check, Maximize2, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar, type OttoMood } from "@/components/otto/OttoAvatar";
import { ChatCard } from "@/components/northstar/global/chat-cards";
import { NS_CHAT_THREADS, type NsChatMessage } from "@/components/northstar/global/_data";

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

/* ── 面板里的一行消息(紧凑版气泡 + 复用 ChatCard) ── */
function DockMessage({ m }: { m: NsChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[16px] rounded-br-[6px] bg-primary px-3 py-2 text-[13px] leading-[19px] text-primary-foreground">
          {m.text}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <OttoAvatar size={20} mood={m.error ? "error" : "idle"} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
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
        {m.card && <ChatCard kind={m.card} />}
      </div>
    </div>
  );
}

export interface ImmersiveDockHandle {
  open: (prompt?: string) => void;
}

/**
 * 常驻 dock。ref 暴露 open(prompt?);working 控制徽点脉冲。
 * fullHref = 全屏 Otto 页(点右上角放大跳过去,面板与全页同一份 thread)。
 */
export const ImmersiveDock = React.forwardRef<
  ImmersiveDockHandle,
  { working?: boolean; fullHref: string }
>(function ImmersiveDock({ working = false, fullHref }, ref) {
  useKeyframes();
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [sent, setSent] = React.useState<NsChatMessage[]>([]);
  const [thinking, setThinking] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const timerRef = React.useRef<number | null>(null);

  const thread = NS_CHAT_THREADS[0];

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
  }, [open, sent, thinking]);

  React.useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  function send() {
    const text = draft.trim();
    if (!text || thinking) return;
    setSent((prev) => [...prev, { id: `u-${prev.length}`, role: "user", text }]);
    setDraft("");
    setThinking(true);
    timerRef.current = window.setTimeout(() => {
      setThinking(false);
      setSent((prev) => [
        ...prev,
        {
          id: `o-${prev.length}`,
          role: "otto",
          text: "Got it. I can draft that as a post or a full pack. Open the full workspace and I'll lay out the options.",
        },
      ]);
    }, 1400);
  }

  // 组合器约定(apps/web/AGENTS.md):Shift+Enter 发送,Enter 换行
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const mood: OttoMood = working || thinking ? "thinking" : "idle";
  const badge = working || thinking;
  const label = working ? "Otto — working" : "Otto — idle";

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

          {/* messages */}
          <div ref={scrollRef} role="log" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-4">
              <p className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
                {thread.title}
              </p>
              {thread.messages
                .filter((m) => !m.approval)
                .map((m) => (
                  <DockMessage key={m.id} m={m} />
                ))}
              {sent.map((m) => (
                <DockMessage key={m.id} m={m} />
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
