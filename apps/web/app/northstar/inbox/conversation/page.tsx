/* @nsPage district="收件箱客服区" page="conversation" status="draft"
   sources="P2-4;O-06 判决;判决 7-8;harmony-01 §四③" approvedAt="" pr="" */
"use client";

/**
 * 对话视图 — 单会话工作面:人和 Otto 同台接客。
 * 清单元素:消息流(方向 / 媒体 / 送达态)· AI 接管开关 · 转人工 ·
 *   人插手自动化即停(硬规则)· 答案溯源(这句来自哪份 KnowledgeDoc)。
 *
 * 硬规则演示(harmony-01 §四③ / O-06):AI 接管开着时,店主一旦在 composer 里落笔,
 *   自动化立即停 → 顶部弹「Otto paused — you took over」coral 横幅。这不是可配置项,是铁律。
 * 活演示:「Simulate a new message」→ Otto 读知识库(叙述条)→ 落一条带溯源的回复(card landing)。
 * 三态齐全 · coral 只属于 Otto · 纯展示零后台。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, MessageSquarePlus, Send, ShieldCheck, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { OttoNarrationBar } from "@/components/northstar/_shared";
import {
  ChannelTag,
  ContactAvatar,
  DemoStateBar,
  ErrorPanel,
  MessageBubble,
  ThreadSkeleton,
  fmtDayDivider,
  useReducedMotion,
  useSweep,
} from "@/components/northstar/inbox/kit";
import {
  IB_CONVERSATIONS,
  IB_DEMO_INCOMING,
  ibDoc,
  type IbMessage,
} from "@/components/northstar/inbox/mock-inbox";

const CONVERSATION = IB_CONVERSATIONS[0]; // Mei Ling Tan · WhatsApp · Otto handling

let seq = 100;
const nextId = () => `m-live-${seq++}`;

function groupByDay(messages: IbMessage[]): { day: string; items: IbMessage[] }[] {
  const out: { day: string; items: IbMessage[] }[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.day === m.day) last.items.push(m);
    else out.push({ day: m.day, items: [m] });
  }
  return out;
}

/** 答案溯源抽屉:这句来自哪份 KnowledgeDoc(判决 7-8 / O-06) */
function SourceDrawer({ docId, onClose }: { docId: string | null; onClose: () => void }) {
  const doc = docId ? ibDoc(docId) : undefined;
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-soft-foreground">
            <BookOpen className="size-3.5" strokeWidth={2} />
            Answer source
          </div>
          <DialogTitle>{doc?.title}</DialogTitle>
          <DialogDescription>
            Otto wrote its reply from this knowledge doc. Every AI answer is traceable to a doc you control.
          </DialogDescription>
        </DialogHeader>
        {doc && (
          <div className="rounded-[12px] border border-border bg-secondary/50 p-3 text-[13px] leading-[19px] text-foreground">
            {doc.excerpt}
          </div>
        )}
        {doc && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Version {doc.versions[0]?.v} · cited {doc.citedCount} times
            </span>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/northstar/inbox/knowledge">Open in knowledge base</Link>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<"data" | "loading" | "error">("data");
  const [messages, setMessages] = React.useState<IbMessage[]>(CONVERSATION.messages);
  const [aiOn, setAiOn] = React.useState(true);
  const [pausedByHuman, setPausedByHuman] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [ottoWorking, setOttoWorking] = React.useState(false);
  const [landingId, setLandingId] = React.useState<string | null>(null);
  const [sourceDocId, setSourceDocId] = React.useState<string | null>(null);
  const [handoffOpen, setHandoffOpen] = React.useState(false);

  const reduced = useReducedMotion();
  const sweep = useSweep();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const scrollToEnd = React.useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  React.useEffect(() => {
    scrollToEnd();
  }, [messages, scrollToEnd]);

  // 硬规则:AI 接管开着时,人一落笔 → 自动化立即停
  const onDraftChange = (v: string) => {
    setDraft(v);
    if (v.length > 0 && aiOn && !pausedByHuman) {
      setPausedByHuman(true);
      setAiOn(false);
      setOttoWorking(false);
    }
  };

  // 演示:客户来新消息 → 若 AI 在管,Otto 读库回复
  const simulateIncoming = () => {
    const inbound: IbMessage = {
      id: nextId(),
      from: "customer",
      text: IB_DEMO_INCOMING.customer,
      day: "2026-07-07",
      time: "11:52",
    };
    setMessages((prev) => [...prev, inbound]);

    if (aiOn && !pausedByHuman) {
      setOttoWorking(true);
    }
  };

  // 叙述条走完 → Otto 落回复
  const onOttoSettle = () => {
    const id = nextId();
    const reply: IbMessage = {
      id,
      from: "otto",
      text: IB_DEMO_INCOMING.ottoReply,
      day: "2026-07-07",
      time: "11:52",
      delivery: "delivered",
      sourceDocId: IB_DEMO_INCOMING.sourceDocId,
    };
    setMessages((prev) => [...prev, reply]);
    setOttoWorking(false);
    setLandingId(id);
    sweep.fire();
    window.setTimeout(() => setLandingId(null), 700);
  };

  // 人发送:把 draft 落成 owner 消息
  const sendOwner = () => {
    const text = draft.trim();
    if (!text) return;
    const msg: IbMessage = {
      id: nextId(),
      from: "owner",
      text,
      day: "2026-07-07",
      time: "11:53",
      delivery: "sent",
    };
    setMessages((prev) => [...prev, msg]);
    setDraft("");
  };

  const resumeOtto = () => {
    setPausedByHuman(false);
    setAiOn(true);
    setDraft("");
  };

  const grouped = groupByDay(messages);

  return (
    <div className="mx-auto flex h-full w-full max-w-[880px] flex-col px-6 pt-4 pb-3">
      {/* 会话头:联系人 + 渠道 + AI 接管开关 + 转人工 */}
      <header className="flex items-center gap-3 border-b border-border pb-4">
        <Button variant="ghost" size="icon" className="size-9 shrink-0" asChild>
          <Link href="/northstar/inbox/shared" aria-label="Back to inbox">
            <ArrowLeft strokeWidth={2} />
          </Link>
        </Button>
        <ContactAvatar initials={CONVERSATION.initials} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-foreground">{CONVERSATION.contactName}</span>
            <ChannelTag channel={CONVERSATION.channel} />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {CONVERSATION.tags.join(" · ") || "Customer"} · RM{CONVERSATION.totalOrdersMyr.toLocaleString()} lifetime
          </p>
        </div>

        {/* AI 接管开关 */}
        <label className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card py-1.5 pr-2.5 pl-2.5">
          <OttoAvatar size={18} mood={aiOn && !pausedByHuman ? "thinking" : "idle"} />
          <span className="text-[12px] font-semibold text-foreground">AI reply</span>
          <Switch
            checked={aiOn && !pausedByHuman}
            onCheckedChange={(v) => {
              setAiOn(v);
              if (v) setPausedByHuman(false);
              else setOttoWorking(false);
            }}
            aria-label="Let Otto reply automatically"
          />
        </label>

        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setHandoffOpen(true)}>
          <UserRound strokeWidth={2} />
          Assign
        </Button>
      </header>

      {/* 人插手自动停 — coral 横幅(硬规则) */}
      {pausedByHuman && (
        <div
          role="status"
          className="mt-3 flex items-center gap-2.5 rounded-[12px] border border-brand/30 bg-brand-soft px-3.5 py-2.5"
          style={reduced ? undefined : { animation: "fade-rise 200ms cubic-bezier(0.34,1.56,0.64,1) both" }}
        >
          <OttoAvatar size={20} mood="idle" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-brand-soft-foreground">Otto paused. You took over.</p>
            <p className="text-[12px] leading-[16px] text-brand-soft-foreground/80">
              The moment a person steps in, Otto stops replying on this conversation. It stays paused until you turn AI reply back on.
            </p>
          </div>
          <Button variant="ghost" size="sm" className="shrink-0 text-brand-soft-foreground hover:bg-brand/10" onClick={resumeOtto}>
            Resume Otto
          </Button>
        </div>
      )}

      {/* 消息流 */}
      <div ref={scrollRef} className="-mx-6 mt-1 min-h-0 flex-1 overflow-y-auto px-6">
        {demo === "loading" && <ThreadSkeleton />}
        {demo === "error" && (
          <ErrorPanel text="Couldn't load this conversation." onRetry={() => setDemo("data")} />
        )}
        {demo === "data" && (
          <div className="flex flex-col gap-1 py-4">
            {grouped.map((g) => (
              <React.Fragment key={g.day}>
                <div className="flex justify-center py-2">
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    {fmtDayDivider(g.day)}
                  </span>
                </div>
                {g.items.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    landing={m.id === landingId}
                    sweepStyle={m.id === landingId ? sweep.style : undefined}
                    onOpenSource={setSourceDocId}
                  />
                ))}
              </React.Fragment>
            ))}

            {/* Otto 正在读库回复:叙述条 */}
            {ottoWorking && (
              <div className="flex justify-start px-4 py-2">
                <OttoNarrationBar
                  key={messages.length}
                  steps={IB_DEMO_INCOMING.narration}
                  stepMs={900}
                  onSettle={onOttoSettle}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer — 人一落笔即停 Otto */}
      {demo === "data" && (
        <div className="shrink-0 border-t border-border pt-3">
          {aiOn && !pausedByHuman && (
            <div className="mb-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <ShieldCheck className="size-3.5 text-brand-soft-foreground" strokeWidth={2} />
              Otto is replying to routine questions. Start typing to take over.
            </div>
          )}
          <div className="flex items-end gap-2 rounded-[16px] border border-border bg-card p-2">
            <textarea
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder="Type a reply…"
              rows={1}
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-[20px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <Button size="icon" className="size-9 shrink-0" disabled={!draft.trim()} onClick={sendOwner} aria-label="Send reply">
              <Send strokeWidth={2} />
            </Button>
          </div>
        </div>
      )}

      {/* 演示动作:来一条新消息(仅当 last 不是 owner/otto 尾时才有意义) */}
      <DemoStateBar
        value={demo}
        onChange={(v) => setDemo(v as "data" | "loading" | "error")}
        extra={
          <button
            type="button"
            onClick={simulateIncoming}
            disabled={demo !== "data" || ottoWorking}
            className="ml-1 inline-flex h-6 items-center gap-1 rounded-full bg-secondary px-2.5 text-[11px] font-semibold text-foreground hover:bg-accent disabled:opacity-40"
          >
            <MessageSquarePlus className="size-3" strokeWidth={2} />
            New message
          </button>
        }
      />

      <SourceDrawer docId={sourceDocId} onClose={() => setSourceDocId(null)} />

      {/* 转人工 dialog */}
      <Dialog open={handoffOpen} onOpenChange={setHandoffOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign this conversation</DialogTitle>
            <DialogDescription>Hand it to a teammate, or let Otto keep handling it.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            {[
              { icon: <OttoAvatar size={18} mood="idle" />, name: "Otto", desc: "Auto-replies from your knowledge base" },
              { icon: <span className="flex size-[18px] items-center justify-center rounded-full bg-secondary text-[9px] font-semibold text-muted-foreground">AR</span>, name: "Aisyah", desc: "Shop owner" },
              { icon: <UserRound className="size-[18px] text-muted-foreground" strokeWidth={2} />, name: "Unassigned", desc: "Leave it in the shared queue" },
            ].map((o) => (
              <button
                key={o.name}
                type="button"
                onClick={() => setHandoffOpen(false)}
                className="flex items-center gap-2.5 rounded-[12px] border border-border bg-card px-3 py-2.5 text-left hover:bg-accent"
              >
                {o.icon}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-foreground">{o.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{o.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
