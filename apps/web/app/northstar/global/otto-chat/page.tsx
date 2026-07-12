/* @nsPage district="全局横切" page="otto-chat" status="draft"
   sources="区划图·中央区;GOAL H0/H4" approvedAt="" pr="" */
"use client";

/**
 * Otto 聊天全页 — 与 Otto 的全屏对话工作面(中央区人工面)
 *
 * 清单要素:流式回复 / 命名思考子步骤(GOAL H0)/ 全部卡种
 * (GEN/PACK/RESEARCH/STORYBOARD/META/CAMPAIGN)/ 审批卡 / thread 切换 / ↑↔■ 中断。
 * design-rules:§L2 workbench(左 thread 轨 + 680 阅读列)/ §F9 composer
 * (Shift+Enter 发送)/ §O3 Otto home 全 mood、dock 隐藏(shell 已按路径隐藏)。
 */

import * as React from "react";
import { ArrowUp, Check, MessageCirclePlus, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { MockNote } from "@/components/northstar/_shared";
import { ApprovalFlow, ChatCard } from "@/components/northstar/global/chat-cards";
import { GenBar, useLanding } from "@/components/northstar/global/_fx";
import { NS_APPROVALS, type NsChatMessage } from "@/components/northstar/global/_data";
import {
  appendChatMessage,
  approveRequest,
  chatThreads,
  ottoWorking,
  startChatThread,
  useOttoWorking,
  useStore,
} from "@/components/northstar/immersive/_store";
import { useQueryParam } from "@/components/northstar/immersive/_kit";

/* ── 命名思考子步骤(GOAL H0):进行中逐步点亮,完成后整块保留为 trace ── */
function ThinkingSteps({ steps, activeIndex }: { steps: string[]; activeIndex: number }) {
  const done = activeIndex >= steps.length;
  return (
    <div className="w-full max-w-[480px] rounded-[14px] border border-border bg-card px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <OttoAvatar size={16} mood={done ? "idle" : "thinking"} />
        <span className="text-xs font-semibold text-foreground">
          {done ? `Worked through ${steps.length} steps` : "Working…"}
        </span>
        {!done && (
          <span className="ml-auto font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
            {Math.min(activeIndex + 1, steps.length)}/{steps.length}
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-1">
        {steps.map((s, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";
          if (state === "todo" && !done) return null;
          return (
            <li key={s} className="flex items-center gap-2 text-[13px] leading-[18px]">
              {state === "active" ? (
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-brand" />
              ) : (
                <Check className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
              )}
              <span className={state === "active" ? "font-medium text-foreground" : "text-muted-foreground"}>
                {s}
                {state === "active" ? "…" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── 气泡(§4:py 12 px 16;user 75% / agent 80%) ───────────────────── */
function UserBubble({ text, land }: { text: string; land?: boolean }) {
  const landing = useLanding();
  return (
    <div className="flex justify-end">
      <p
        style={land ? landing : undefined}
        className="max-w-[75%] rounded-[18px] rounded-br-[8px] bg-primary px-4 py-3 text-[15px] leading-[22px] text-primary-foreground"
      >
        {text}
      </p>
    </div>
  );
}

function OttoText({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className="flex max-w-[80%] items-start gap-2.5">
      <OttoAvatar size={22} mood={streaming ? "thinking" : "helpful"} className="mt-1 shrink-0" />
      <p className="min-w-0 text-[15px] leading-[22px] text-foreground">
        {text}
        {streaming && (
          <span aria-hidden className="ml-0.5 inline-block h-4 w-[2px] translate-y-[2px] animate-pulse bg-foreground/70" />
        )}
      </p>
    </div>
  );
}

function ErrorBubble({ text }: { text: string }) {
  return (
    <div className="flex max-w-[80%] items-start gap-2.5">
      <OttoAvatar size={22} mood="error" className="mt-1 shrink-0" />
      <div className="min-w-0 rounded-[14px] bg-error-soft px-4 py-3">
        <p className="text-sm leading-5 text-error-soft-foreground">{text}</p>
        <Button variant="ghost" size="sm" className="mt-1 -ml-2 h-8 text-error-soft-foreground">
          Try again
        </Button>
      </div>
    </div>
  );
}

/* ── 一条消息 ──────────────────────────────────────────────────────────── */
function Message({ m, land }: { m: NsChatMessage; land?: boolean }) {
  if (m.role === "user") return <UserBubble text={m.text ?? ""} land={land} />;
  if (m.error) return <ErrorBubble text={m.text ?? ""} />;
  return (
    <div className="space-y-3">
      {m.substeps && <ThinkingSteps steps={m.substeps} activeIndex={m.substeps.length} />}
      {m.text && <OttoText text={m.text} />}
      {m.card && (
        <div className="pl-8">
          <ChatCard kind={m.card} land={land} />
        </div>
      )}
      {m.approval && (
        <div className="pl-8">
          <ApprovalFlow
            title={NS_APPROVALS[0].title}
            detail={NS_APPROVALS[0].detail}
            impacts={NS_APPROVALS[0].impacts}
            credits={NS_APPROVALS[0].credits}
            kind="generation"
            // 批准 = 真扣 120 credits(全城联动)+ 从共享队列收走该条(通知/团队页同步)
            onSettled={(state) => approveRequest(NS_APPROVALS[0].id, state === "done" ? "approve" : "decline")}
          />
        </div>
      )}
    </div>
  );
}

/* ── 流式模拟(发送 → 思考子步骤 → 流式文本;■ 可中断) ─────────────── */
const LIVE_SUBSTEPS = ["Thinking", "Reading your brand memory", "Drafting reply"];
const LIVE_REPLY =
  "Here's a quick take. Post the kaya croissant tomorrow at 9am while the morning crowd is scrolling, and keep the gift box teaser for Friday payday. Want me to draft both posts now?";

type Phase = "idle" | "thinking" | "streaming";

function OttoChatContent() {
  useStore(); // 与 dock 共读同一份 store chatThreads(§「Dock and this chat share one state」为真)
  const otto = useOttoWorking(); // 订阅全城 Otto 工作态(status 行 + dock 同源)
  const initialThread = useQueryParam("thread"); // 深链 ?thread → 初始选中(替代硬编码 [0])
  // ?thread 直接作初值:useQueryParam=useSearchParams(本页已被 <Suspense> 包着,SSR 渲 fallback、
  // 客户端才渲本体),故初值化里读 ?thread 无 SSR/client 初值不一致。派生初值取代旧的「挂载后 setState
  // 切换到深链 thread」,消掉 set-state-in-effect 的级联渲染(也去掉切换那一帧的闪跳)。
  const [threadId, setThreadId] = React.useState<string>(() => {
    const threads = chatThreads();
    if (initialThread && threads.some((t) => t.id === initialThread)) return initialThread;
    return threads[0].id;
  });
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [stepIdx, setStepIdx] = React.useState(0);
  const [liveText, setLiveText] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const timers = React.useRef<number[]>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const threads = chatThreads();
  const thread = threads.find((t) => t.id === threadId);
  const baseMessages = thread?.messages ?? [];
  const isNewChat = !!thread && thread.messages.length === 0;

  const clearTimers = React.useCallback(() => {
    for (const t of timers.current) window.clearInterval(t);
    timers.current = [];
  }, []);
  React.useEffect(() => clearTimers, [clearTimers]);

  // append 进共享 store thread(dock 与本页同源;canvas 生成事件另经 eventLog)
  const pushExtra = React.useCallback(
    (m: NsChatMessage) => appendChatMessage(threadId, m),
    [threadId],
  );

  const scrollToEnd = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, []);

  const settle = (finalText: string) => {
    setPhase("idle");
    setLiveText("");
    ottoWorking(false); // 全城神经:Otto 收工(dock 徽点熄灭 + 活动流落一条)
    pushExtra({ id: `x-${Date.now()}-otto`, role: "otto", substeps: LIVE_SUBSTEPS, text: finalText });
    scrollToEnd();
  };

  const beginStream = () => {
    setPhase("streaming");
    const words = LIVE_REPLY.split(" ");
    let n = 0;
    const streamTimer = window.setInterval(() => {
      n += 1;
      setLiveText(words.slice(0, n).join(" "));
      scrollToEnd();
      if (n >= words.length) {
        window.clearInterval(streamTimer);
        settle(words.join(" "));
      }
    }, 45);
    timers.current.push(streamTimer);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || phase !== "idle") return;
    setDraft("");
    pushExtra({ id: `x-${Date.now()}`, role: "user", text });
    ottoWorking(true, "Otto is drafting a reply"); // 全城神经:Otto 开工(dock 徽点脉冲)
    setPhase("thinking");
    setStepIdx(0);
    setLiveText("");
    scrollToEnd();

    const stepTimer = window.setInterval(() => {
      setStepIdx((i) => {
        if (i + 1 < LIVE_SUBSTEPS.length) return i + 1;
        window.clearInterval(stepTimer);
        beginStream();
        return LIVE_SUBSTEPS.length;
      });
    }, 750);
    timers.current.push(stepTimer);
  };

  const stop = React.useCallback(() => {
    clearTimers();
    const partial = liveText;
    const text = partial ? `${partial}…` : "Stopped. Nothing was generated. Ask again anytime.";
    setPhase("idle");
    setLiveText("");
    ottoWorking(false); // 中断也让全城神经归位
    pushExtra({ id: `x-${Date.now()}-stop`, role: "otto", text });
  }, [clearTimers, liveText, pushExtra]);

  const switchThread = (id: string) => {
    if (phase !== "idle") stop();
    setThreadId(id);
  };

  const newChat = () => {
    if (phase !== "idle") stop();
    setThreadId(startChatThread()); // 在共享 store 里真开一条 thread(dock 也看得到)
  };

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 城规(§F9):composer Shift+Enter = 发送,Enter = 换行
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* thread 轨 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border">
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Chats</span>
          <button
            type="button"
            onClick={newChat}
            aria-label="New chat"
            className="flex size-8 items-center justify-center rounded-[10px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
          >
            <MessageCirclePlus className="size-[18px]" strokeWidth={2} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {threads.map((t) => {
            const active = t.id === threadId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => switchThread(t.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-baseline gap-2 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-[120ms]",
                  active ? "bg-secondary" : "hover:bg-accent",
                )}
              >
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px] leading-[18px]",
                    active ? "font-semibold text-foreground" : "font-normal text-muted-foreground",
                  )}
                >
                  {t.title}
                </span>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">{t.updatedAt}</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* 对话列 */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-6">
          <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">{thread?.title ?? "New chat"}</h1>
          {/* 全城 Otto 工作态:working 时亮起(与 dock 徽点同源),否则显示同源提示 */}
          {otto.working ? (
            <span
              role="status"
              className="hidden shrink-0 items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand md:inline-flex"
            >
              <OttoAvatar size={14} mood="thinking" />
              {otto.label}
            </span>
          ) : (
            <span className="hidden shrink-0 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground md:inline">
              Dock and this chat share one state
            </span>
          )}
        </div>

        <div ref={scrollRef} role="log" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[680px] space-y-5 px-6 py-6">
            {isNewChat && phase === "idle" && (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <OttoAvatar size={64} mood="idle" />
                <p className="text-[28px] leading-[34px] font-bold tracking-[-0.02em] text-foreground">
                  What are we making today?
                </p>
                <p className="max-w-[420px] text-sm text-muted-foreground">
                  Ask for a post, a campaign or research. Otto explains costs before anything is generated.
                </p>
              </div>
            )}
            {/* 已含 dock / 本页 append 的 live 消息(store 同源);live 消息(id 前缀 x-)带落地动效 */}
            {baseMessages.map((m) => (
              <Message key={m.id} m={m} land={m.id.startsWith("x-")} />
            ))}
            {phase === "thinking" && <ThinkingSteps steps={LIVE_SUBSTEPS} activeIndex={stepIdx} />}
            {phase === "streaming" && <OttoText text={liveText} streaming />}
          </div>
        </div>

        {/* composer(§8c:narration 位于 composer 之上) */}
        <div className="shrink-0 border-t border-border">
          <div className="mx-auto w-full max-w-[680px] px-6 py-4">
            {phase !== "idle" && (
              <div role="status" className="mb-2 flex items-center gap-2">
                <OttoAvatar size={20} mood="thinking" />
                <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-muted-foreground">
                  {phase === "thinking"
                    ? `${LIVE_SUBSTEPS[Math.min(stepIdx, LIVE_SUBSTEPS.length - 1)]}…`
                    : "Writing reply…"}
                </span>
                <GenBar />
              </div>
            )}
            <div className="flex items-end gap-2 rounded-[18px] border border-input bg-card p-2 shadow-[var(--shadow-xs)] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Message Otto"
                rows={1}
                className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-2 py-2.5 text-[15px] leading-[22px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              {phase === "idle" ? (
                <Button size="icon" aria-label="Send message" className="size-9 shrink-0 rounded-full" onClick={send}>
                  <ArrowUp strokeWidth={2.5} />
                </Button>
              ) : (
                <Button
                  size="icon"
                  variant="secondary"
                  aria-label="Stop responding"
                  className="size-9 shrink-0 rounded-full"
                  onClick={stop}
                >
                  <Square className="fill-current" strokeWidth={2} />
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-xs font-medium text-muted-foreground">Shift+Enter to send · Enter for a new line</p>
          </div>
        </div>
      </section>

      <MockNote path="/northstar/global/otto-chat" />
    </div>
  );
}

// Suspense 边界:OttoChatContent 用 useQueryParam(useSearchParams)读 ?thread=。
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <OttoChatContent />
    </React.Suspense>
  );
}
