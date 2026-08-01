"use client";

/**
 * 沉浸式 · 通知与审批中心(native rebuild)
 *
 * gallery 版把此页套进 GalleryFrame + 带 MockNote/图纸陈列脚注;产品里原生重建:
 * 「待我批的事」+「Otto 最近替我做的事」+「本会话活动流」三段,一处可见,读面不是死胡同。
 *
 * ENDGAME 契约(总令 Z1 / 蓝图 §五〇):
 *  - ApprovalRequest 一个原语两个表面 —— 此页与 dock / 聊天卡共用同一队列(pendingApprovals),
 *    从任一处批,live reflection 同步全城(团队审批工作台 / 首页「awaiting approval」同源缩短)。
 *  - Otto 动作时间线 = D2 单流(streamFor 的 otto 消息),与 dock 同源;点一行深链回现场,
 *    不发明独立通知系统。「Open Otto」→ 真 Otto 对话(#609:壳内假 Otto 全屏面已退场)。
 *  - coral 预算:唯一 brand 按钮 = 待批生成卡的 Approve(§O4);排期确认走 INK。零后台 import。
 */

import * as React from "react";
import Link from "next/link";
import { Activity, BellOff, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/northstar/_shared";
import { ApprovalFlow } from "@/components/northstar/global/chat-cards";
import type { NsApprovalRequest } from "@/components/northstar/global/_data";
import {
  approveRequest,
  pendingApprovals,
  recentEvents,
  streamFor,
  useStore,
  type NsAssistIntent,
} from "@/components/northstar/immersive/_store";
import { OttoAssist } from "@/components/northstar/immersive/otto-assist";

const BASE = "/northstar-immersive";
const GALLERY_PREFIX = "/northstar/";
const IMMERSIVE_PREFIX = "/northstar-immersive/";

/** 深链回现场时把 `/northstar/*` 改写成沉浸式路由(与 dock / 全屏 Otto 同规矩)。 */
function immersiveHref(href: string): string {
  return href.startsWith(GALLERY_PREFIX) ? IMMERSIVE_PREFIX + href.slice(GALLERY_PREFIX.length) : href;
}

/** 落定后离队的缓冲(收据看得见,再让共享 store 收走该条) */
const LEAVE_MS = 2200;

export function ImmersiveNotifications() {
  useStore(); // 审批队列 + Otto 单流 + 活动流的单一源(与 dock / 团队页 / 首页同源)
  const queue = pendingApprovals();
  const events = recentEvents(20);
  // Otto 最近替我做的事:D2 单流里 otto 说话的消息,最新在前(与 dock 同一条流)。
  // 直接派生(小数组过滤);store 变更由 useStore() 触发重渲染,始终反映当前流。
  const ottoActions = streamFor()
    .filter((m) => m.role === "otto")
    .slice()
    .reverse()
    .slice(0, 6);
  const timers = React.useRef<number[]>([]);

  // §O7 Otto 帮我:一屏审批 + 时间线,老板不确定先动哪个。给零打字出路:Otto 用真实队列答。
  const assistIntents = React.useMemo<NsAssistIntent[]>(() => {
    const first = queue[0];
    return [
      {
        id: "notif-triage",
        label: "What should I do first?",
        prompt: "What needs me most right now?",
        reply: first
          ? `Start with "${first.title}". ${first.credits ? `It spends ${first.credits} credits, so it waits for your ok. ` : ""}${queue.length > 1 ? `${queue.length - 1} more after that.` : "That's the only one waiting."}`
          : "Nothing is waiting on you, you're all caught up. I'll ask here before anything spends credits or goes out.",
      },
      {
        id: "notif-recap",
        label: "Recap what Otto did",
        prompt: "Recap what you did",
        // 锚在流里每条消息自带的真实相对时间戳(ottoActions[0].at,如 "18m ago"),不硬报「今天」——
        // 这只是流的最近 N 条,并非「今天办的 N 件事」,谎报时间会把几小时前甚至更早的动作说成今天。
        reply: ottoActions.length
          ? `Here are the last ${ottoActions.length} ${ottoActions.length === 1 ? "thing" : "things"} I did — newest first. The most recent, ${ottoActions[0].at}, was "${ottoActions[0].text}". Tap any row below to see exactly what changed.`
          : "I haven't done anything yet. Anything I do will show up here and in the dock.",
      },
    ];
  }, [queue, ottoActions]);

  React.useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  const settle = (req: NsApprovalRequest, state: "done" | "cancelled") => {
    // 卡内回执留一拍(§FB6:结果即反馈),再提交进共享 store —— 队列全城缩短、
    // 生成类真扣额度(全城联动),落定事件进活动流。
    timers.current.push(
      window.setTimeout(() => {
        approveRequest(req.id, state === "done" ? "approve" : "decline");
      }, LEAVE_MS),
    );
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-10">
      {/* 页头:标题 + 待批计数 pill + 进全屏 Otto */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl leading-[30px] font-bold tracking-[-0.02em] text-foreground">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approvals waiting on you, and what Otto finished. All in one place.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex h-7 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold tabular-nums",
            queue.length > 0 ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {queue.length} waiting
        </span>
        <div className="flex-1" />
        {/* 不确定先动哪个?让 Otto 带上下文帮你分诊(§O7,零打字意图 chip 在 dock) */}
        <OttoAssist zone="Inbox" label="Ask Otto" intents={assistIntents} />
        <Button variant="ghost" size="sm" asChild>
          <Link href="/otto">
            <Sparkles strokeWidth={2} />
            Open Otto
          </Link>
        </Button>
      </header>

      {/* ── 待我批的事(一个原语两个表面:与聊天里的审批卡同一张) ── */}
      <h2 className="mt-8 text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
        Needs your approval
      </h2>
      <div className="mt-3 space-y-4">
        {queue.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="All caught up."
            body="Otto asks here before anything spends credits or goes out."
            className="rounded-[18px] border border-border bg-card py-12"
          />
        ) : (
          queue.map((req) => (
            <ApprovalFlow
              key={req.id}
              title={req.title}
              detail={req.detail}
              impacts={req.impacts}
              credits={req.credits}
              kind={req.kind}
              onSettled={(state) => settle(req, state)}
              className="max-w-none"
            />
          ))
        )}
      </div>

      {/* ── Otto 替我做完的事(D2 单流的 otto 消息,与 dock 同源;点一行深链回现场) ── */}
      <div className="mt-10 flex items-baseline gap-3">
        <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
          Otto&rsquo;s recent actions
        </h2>
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          Same stream as the dock · click a row to jump to what changed
        </p>
      </div>
      {ottoActions.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 rounded-[14px] border border-border bg-card px-4 py-3.5 text-[13px] leading-[18px] text-muted-foreground">
          <Sparkles className="size-4 shrink-0" strokeWidth={2} />
          Nothing from Otto yet. Anything Otto does shows up here and in the dock.
        </p>
      ) : (
        <div className="mt-2 -mx-3">
          {ottoActions.map((m, i) => (
            <React.Fragment key={m.id}>
              {i > 0 && <div className="mx-3 border-t border-border" />}
              <Link
                href={m.context.href ? immersiveHref(m.context.href) : "/otto"}
                className="flex items-baseline gap-3 rounded-[10px] px-3 py-3 transition-colors duration-[120ms] hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{m.text}</span>
                <span className="shrink-0 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {m.context.label}
                </span>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">{m.at}</span>
              </Link>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* ── 活动流(共享 store eventLog 实时渲染:你在城里做的每件事,一行一条) ── */}
      <div className="mt-10 flex items-baseline gap-3">
        <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">Activity</h2>
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          Live from this session · newest first
        </p>
      </div>
      {events.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 rounded-[14px] border border-border bg-card px-4 py-3.5 text-[13px] leading-[18px] text-muted-foreground">
          <Activity className="size-4 shrink-0" strokeWidth={2} />
          Nothing yet. Anything you approve, spend or connect shows up here live.
        </p>
      ) : (
        <ul className="mt-2 -mx-3">
          {events.map((e, i) => (
            <li
              key={e.at}
              className={cn("flex items-baseline gap-3 px-3 py-3", i > 0 && "border-t border-border")}
            >
              <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground" />
              <span className="min-w-0 flex-1 text-sm text-foreground">{e.label}</span>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">just now</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
