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
  assistContextView,
  assistOwnerToken,
  escortTo,
  hasAssistApplyHandler,
  ottoBehavior,
  ottoContext,
  recentEvents,
  runAssistApply,
  streamFor,
  useStore,
  type NsAssistApply,
  type NsAssistIntent,
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
  // §O7 Apply:跑完一个带 apply 的意图后暂存产出,composer 上方浮出一颗 Apply 钮。
  // 绑定产出它的源 owner token + 源表面人话名(缺陷#2 二轮):Apply 只能填回那个源表面,
  // 换页/换面后既不错填别面、也不谎报成功;honest 消息用 sourceLabel 指名回哪一屏重开。
  const [pendingApply, setPendingApply] = React.useState<{
    apply: NsAssistApply;
    owner: string;
    sourceLabel: string | null;
  } | null>(null);
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
  // §O7 assist 承接:某个动脑面点开了「Otto 帮我」→ 拿它带来的意图 chip / Apply 上下文。
  const assist = assistContextView();
  const assistLabel = assist?.entityLabel ?? assist?.zone ?? ctxLabel;
  // 当前登记的源 owner token(缺陷#2 二轮的跨表面守卫读它)。
  const currentAssistOwner = assistOwnerToken();

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

  // 跨表面守卫(缺陷#2 二轮):登记的 assist owner 换了(导航去别的动脑面 → 源面卸载 owner→null,
  // 或别面点开 Otto → owner→新 token)就清掉上一面残留的 pendingApply。那颗写着 A 摘要的 Apply
  // 钮不再飘到 B 上诱点(点了本会错填 B 或空转打假成功)。dock 订阅 store,故 owner 一变即触发。
  React.useEffect(() => {
    setPendingApply((prev) => (prev && prev.owner !== currentAssistOwner ? null : prev));
  }, [currentAssistOwner]);

  // §O7 意图 chip:一键跑一个 surface-specific 意图(零打字)。落一轮往来进单流;
  // 带 apply 则浮出 Apply 钮;带 landsOn 则 §8e escort 到现场看它落地。
  function runIntent(intent: NsAssistIntent) {
    if (thinking) return;
    appendToStream({ role: "owner", text: intent.prompt });
    setThinking(true);
    setPendingApply(null);
    // §8e 发送处接线判定:意图声明了「工作落在别处」= 新鲜前台可执行指示 → 导航一次。
    // (自由打字不 escort:没有诚实的目标信号,导航只跟随已声明的 landsOn。)
    // 护栏:landsOn 与 in-place Apply 互斥。escort 会导航离开源表面 → 源 OttoAssist 卸载、
    // 其 onApply 回调随之失效。故 escort 意图绝不浮出 in-place Apply 钮(即便 zone 作者误把
    // 两字段都写在同一意图上),否则那颗钮点了只会空转 + 打假成功(缺陷#2)。
    const escorting = Boolean(intent.landsOn);
    if (intent.landsOn) escortTo(intent.landsOn.surface, intent.landsOn.label);
    // 缺陷#2 二轮:把这颗意图绑定到当前登记的源 owner + 源表面名(意图 chip 只来自当前 assist,
    // 故此刻的 owner/label 就是产出方)。Apply 落回时凭它校验同源,拒绝跨表面错填。
    const sourceOwner = assistOwnerToken();
    const sourceLabel = assistLabel;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setThinking(false);
      appendToStream({ role: "otto", text: intent.reply });
      if (intent.apply && !escorting && sourceOwner) {
        setPendingApply({ apply: intent.apply, owner: sourceOwner, sourceLabel });
      }
    }, 1400);
  }

  // §O7 Apply:把 Otto 产出交回原表面(zone 的 onApply 填字段 + fire useSweep)。
  // 只填字段,不发不花——落回后留一条确认,提醒店主亲手发。
  function applyPending() {
    if (!pendingApply) return;
    // 护栏:这颗产出只能填回产出它的那个源表面。两道门一起关(缺陷#2 二轮):
    //  (a) 源表面已卸载 → assistApplyHandler 被 clearAssist 置 null(hasAssistApplyHandler 为假);
    //  (b) 源表面被别的动脑面顶替 → assistApplyHandler 现在是 B 的 onApply(owner token 变了)。
    // 任一门开着都别回填 —— 对 null handler 空转、或把 A 的 patch 灌进 B 的 onApply(patch 形状
    // 各区自解释,B 读到不认识的键 = 垃圾填充)都是「打假成功」。诚实告知、指名回哪屏重开。
    const sameSource = hasAssistApplyHandler() && assistOwnerToken() === pendingApply.owner;
    if (!sameSource) {
      appendToStream({
        role: "otto",
        text: pendingApply.sourceLabel
          ? `${pendingApply.sourceLabel} isn't open anymore, so I couldn't fill it in. Open it again and I'll drop this straight in.`
          : "That screen isn't open anymore, so I couldn't fill it in. Open it again and I'll drop this straight in.",
      });
      setPendingApply(null);
      return;
    }
    runAssistApply(pendingApply.apply);
    appendToStream({
      role: "otto",
      text: pendingApply.sourceLabel
        ? `Filled it into ${pendingApply.sourceLabel}. Review it there and send when you're ready — nothing goes out until you do.`
        : "Filled it in. Review and send when you're ready — nothing goes out until you do.",
    });
    setPendingApply(null);
  }

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

          {/* §O7 意图 chip:某个动脑面点开「Otto 帮我」时浮出的 2-3 个零打字路径 */}
          {assist && assist.intents.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-3 pt-2.5">
              {assist.intents.map((intent) => (
                <button
                  key={intent.id}
                  type="button"
                  onClick={() => runIntent(intent)}
                  disabled={thinking}
                  className="rounded-full bg-secondary px-2.5 py-1 text-[12px] font-medium text-secondary-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  {intent.label}
                </button>
              ))}
            </div>
          )}

          {/* §O7 Apply:Otto 产出回填原表面(只填字段;发/花仍要店主点) */}
          {pendingApply && (
            <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 pt-2.5">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted-foreground">
                {pendingApply.apply.summary}
              </span>
              <Button size="sm" className="h-8 shrink-0" onClick={applyPending}>
                Apply
              </Button>
            </div>
          )}

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
