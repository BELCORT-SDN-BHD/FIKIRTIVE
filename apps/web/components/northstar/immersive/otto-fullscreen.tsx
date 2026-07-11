"use client";

/**
 * 北极星 · 沉浸式全屏 Otto 工作面(`/otto` 原生重建)
 *
 * D2:dock 小窗与本页是**同一条 ottoStream** 的两种看法(小窗 vs 大窗),永不是两个对话。
 * 布局(§L2 Workbench):左 = 这条流(可按 campaign / 区过滤,composer 真发) ·
 * 右 = 当前 context 摘要(在看什么、过滤这条流、Otto 状态、待批、余额)。
 * 每条消息带 context chip,点 chip 深链回现场 —— 读面永不是死胡同。
 * §O3:本页路径上 dock 由外壳隐藏(不会两个 Otto 同屏)。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto(chip/行中性,hover=accent)。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUp, Bell, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar, type OttoMood } from "@/components/otto/OttoAvatar";
import { NS_CAMPAIGNS, campaignSummaryById, type NsOttoZone } from "@/components/northstar/_mock";
import { IMMERSIVE_BASE } from "./_kit";
import {
  appendToStream,
  balance,
  ottoContext,
  pendingApprovals,
  recentEvents,
  streamFor,
  useOttoWorking,
  useStore,
  type NsStreamFilter,
  type NsStreamMsg,
} from "./_store";

const GALLERY_PREFIX = "/northstar/";
const IMMERSIVE_PREFIX = "/northstar-immersive/";
function immersiveHref(href: string): string {
  return href.startsWith(GALLERY_PREFIX) ? IMMERSIVE_PREFIX + href.slice(GALLERY_PREFIX.length) : href;
}

/** 右栏可过滤这条流的重点区(点亮 = streamFor({zone}))。 */
const ZONE_FILTERS: NsOttoZone[] = ["Campaign", "Canvas", "Schedule", "Inbox", "CRM", "Analytics"];

function ContextChip({ ctx }: { ctx: NsStreamMsg["context"] }) {
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
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
    >
      {body}
    </Link>
  );
}

function StreamBubble({ m }: { m: NsStreamMsg }) {
  if (m.role === "owner") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <p className="max-w-[80%] rounded-[18px] rounded-br-[6px] bg-primary px-3.5 py-2 text-[14px] leading-[21px] text-primary-foreground">
          {m.text}
        </p>
        <div className="flex items-center gap-2">
          <ContextChip ctx={m.context} />
          <span className="text-[11px] text-muted-foreground">{m.at}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      <OttoAvatar size={24} mood={m.error ? "error" : "idle"} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        {m.text && (
          <p
            className={cn(
              "max-w-[80%] text-[14px] leading-[21px]",
              m.error ? "text-error-soft-foreground" : "text-foreground",
            )}
          >
            {m.text}
          </p>
        )}
        <div className="flex items-center gap-2">
          <ContextChip ctx={m.context} />
          <span className="text-[11px] text-muted-foreground">{m.at}</span>
        </div>
      </div>
    </div>
  );
}

export function OttoFullscreen() {
  useStore();
  const { working } = useOttoWorking();
  const [filter, setFilter] = React.useState<NsStreamFilter>({});
  const [draft, setDraft] = React.useState("");
  const [thinking, setThinking] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const timerRef = React.useRef<number | null>(null);

  const stream = streamFor(filter);
  const ctx = ottoContext();
  const ctxLabel = ctx ? ctx.selectedLabel ?? ctx.view : null;
  const pending = pendingApprovals();
  const events = recentEvents(6);
  const bal = balance();

  const activeCampaign = filter.campaignId ? campaignSummaryById(filter.campaignId) : undefined;
  const filterLabel = activeCampaign
    ? activeCampaign.name
    : filter.zone
      ? `${filter.zone} activity`
      : "Whole business";

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [stream, thinking]);
  React.useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  function send() {
    const text = draft.trim();
    if (!text || thinking) return;
    appendToStream({ role: "owner", text });
    setDraft("");
    setThinking(true);
    const prefix = ctxLabel ? `On ${ctxLabel} — ` : "";
    timerRef.current = window.setTimeout(() => {
      setThinking(false);
      appendToStream({
        role: "otto",
        text: `${prefix}on it. I'll lay out the options here and keep everything on one thread.`,
      });
    }, 1400);
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const mood: OttoMood = working || thinking ? "thinking" : "idle";

  return (
    <div className="flex h-full min-h-0">
      {/* 左:同一条流(可过滤)+ composer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-5">
          <OttoAvatar size={26} mood={mood} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">Otto</p>
            <p className="truncate text-[11px] text-muted-foreground">
              One thread · {filterLabel}
            </p>
          </div>
          {(filter.zone || filter.campaignId) && (
            <button
              type="button"
              onClick={() => setFilter({})}
              className="ml-auto rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
            >
              Clear filter
            </button>
          )}
        </header>

        <div ref={scrollRef} role="log" className="mx-auto min-h-0 w-full max-w-[680px] flex-1 overflow-y-auto px-5 py-6">
          <div className="space-y-5">
            {stream.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing on this filter yet. Clear it to see the whole thread with Otto.
              </div>
            ) : (
              stream.map((m) => <StreamBubble key={m.id} m={m} />)
            )}
            {thinking && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <OttoAvatar size={18} mood="thinking" />
                <span>Thinking…</span>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border px-5 py-3">
          <div className="mx-auto flex w-full max-w-[680px] items-end gap-2 rounded-[16px] border border-input bg-card p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message Otto"
              rows={1}
              className="max-h-32 min-h-[38px] w-full resize-none bg-transparent px-2 py-2 text-[14px] leading-[21px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            {thinking ? (
              <Button
                size="icon"
                variant="secondary"
                aria-label="Stop responding"
                className="size-9 shrink-0 rounded-full"
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
                className="size-9 shrink-0 rounded-full"
                onClick={send}
                disabled={!draft.trim()}
              >
                <ArrowUp strokeWidth={2.5} />
              </Button>
            )}
          </div>
          <p className="mx-auto mt-1.5 w-full max-w-[680px] px-1 text-[11px] font-medium text-muted-foreground">
            Shift+Enter to send · Enter for a new line
          </p>
        </div>
      </div>

      {/* 右:当前 context 摘要(过滤这条流 · Otto 状态 · 待批 · 最近活动 · 余额) */}
      <aside className="hidden w-[340px] shrink-0 flex-col overflow-y-auto border-l border-border bg-background lg:flex">
        <div className="space-y-5 px-5 py-6">
          {/* 在看什么(上下文桥) */}
          <section>
            <h2 className="mb-2 font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Right now
            </h2>
            <div className="rounded-[16px] border border-border bg-card p-4">
              <p className="text-[11px] font-medium text-muted-foreground">Otto is</p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {working ? "working — will ask before it spends" : "idle, ready for you"}
              </p>
              {ctxLabel && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-[11px] font-medium text-muted-foreground">Looking at</p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{ctxLabel}</p>
                </div>
              )}
            </div>
          </section>

          {/* 过滤这条流(D2:同一条流的不同看法) */}
          <section>
            <h2 className="mb-2 font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Filter this thread
            </h2>
            <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
              Same thread, narrowed. It&apos;s never a second conversation.
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <FilterChip
                label="Whole business"
                active={!filter.zone && !filter.campaignId}
                onClick={() => setFilter({})}
              />
            </div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">By campaign</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {NS_CAMPAIGNS.map((c) => (
                <FilterChip
                  key={c.id}
                  label={c.name}
                  active={filter.campaignId === c.id}
                  onClick={() =>
                    setFilter(filter.campaignId === c.id ? {} : { campaignId: c.id })
                  }
                />
              ))}
            </div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">By area</p>
            <div className="flex flex-wrap gap-1.5">
              {ZONE_FILTERS.map((z) => (
                <FilterChip
                  key={z}
                  label={z}
                  active={filter.zone === z}
                  onClick={() => setFilter(filter.zone === z ? {} : { zone: z })}
                />
              ))}
            </div>
          </section>

          {/* 待批(接回下一步动作,不做死胡同) */}
          <section>
            <h2 className="mb-2 font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Waiting on you
            </h2>
            <Link
              href={`${IMMERSIVE_BASE}/global/notifications`}
              className="flex items-center gap-2.5 rounded-[16px] border border-border bg-card p-4 transition-colors duration-[120ms] hover:bg-accent"
            >
              <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                <Bell className="size-[18px]" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {pending.length > 0 ? `${pending.length} to review` : "All caught up"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {pending[0]?.title ?? "Nothing needs your approval"}
                </p>
              </div>
            </Link>
          </section>

          {/* 最近活动(与 dock「Just now」同源) */}
          {events.length > 0 && (
            <section>
              <h2 className="mb-2 font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                Recent activity
              </h2>
              <ul className="space-y-1.5">
                {events.map((e) => (
                  <li key={e.at} className="flex gap-2 text-[12px] leading-4 text-muted-foreground">
                    <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-border" />
                    <span className="min-w-0">{e.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 余额(读面接回住户服务中心) */}
          <section>
            <Link
              href={`${IMMERSIVE_BASE}/account/credits`}
              className="flex items-center gap-2 rounded-[16px] border border-border bg-card px-4 py-3 transition-colors duration-[120ms] hover:bg-accent"
            >
              <span aria-hidden className="size-3.5 shrink-0 rounded-full bg-brand" />
              <span className="text-sm font-medium tabular-nums text-foreground">
                {bal.toLocaleString("en-MY")} credits
              </span>
              <span className="ml-auto text-xs font-semibold text-muted-foreground">Manage</span>
            </Link>
          </section>
        </div>
      </aside>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors duration-[120ms]",
        active
          ? "border-transparent bg-secondary text-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
