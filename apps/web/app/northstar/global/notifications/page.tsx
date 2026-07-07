/* @nsPage district="全局横切" page="notifications" status="draft"
   sources="G-11;harmony-01 §四④;宪法 11 v2.6①" approvedAt="" pr="" */
"use client";

/**
 * 通知与审批入口 — 待我批的事 + Otto 替我做完的事,一处可见
 *
 * 清单要素:审批队列入口(ApprovalRequest 一个原语两个表面:这里 + 聊天卡)、
 * Otto 动作时间线(与 dock 同源);形态最薄,不发明独立通知系统。
 * design-rules:§FB6 影响清单必列 / §V5 花钱文案(按钮即收据)/ §O4 coral 预算
 * (唯一 brand 按钮 = 待批生成卡的 Approve)/ §8b 新时间线行落地。
 * 交互:批 / 取消走完整状态机;卡落定后离队,清空即空态;完成的事落进时间线顶部。
 */

import * as React from "react";
import Link from "next/link";
import { BellOff, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, MockNote } from "@/components/northstar/_shared";
import { ApprovalFlow } from "@/components/northstar/global/chat-cards";
import { useLanding } from "@/components/northstar/global/_fx";
import {
  NS_APPROVALS,
  NS_OTTO_ACTIONS,
  type NsApprovalRequest,
  type NsOttoAction,
} from "@/components/northstar/global/_data";

/** 落定后离队的缓冲(收据看得见,再让位给空态) */
const LEAVE_MS = 2200;

function TimelineRow({ action, land }: { action: NsOttoAction; land?: boolean }) {
  const landing = useLanding();
  return (
    <Link
      href={action.href ?? "#"}
      style={land ? landing : undefined}
      className="flex items-baseline gap-3 rounded-[10px] px-3 py-3 transition-colors duration-[120ms] hover:bg-accent"
    >
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{action.text}</span>
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{action.at}</span>
    </Link>
  );
}

export default function Page() {
  const [queue, setQueue] = React.useState<NsApprovalRequest[]>(NS_APPROVALS);
  const [timeline, setTimeline] = React.useState<NsOttoAction[]>(NS_OTTO_ACTIONS);
  const [landedIds, setLandedIds] = React.useState<string[]>([]);
  const timers = React.useRef<number[]>([]);

  React.useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  const settle = (req: NsApprovalRequest, state: "done" | "cancelled") => {
    if (state === "done") {
      const entry: NsOttoAction = {
        id: `oa-live-${req.id}`,
        text: req.kind === "generation" ? "Generated 3 Merdeka videos" : "Scheduled 2 approved posts",
        at: "just now",
        href: req.kind === "generation" ? "/northstar/assets/library" : "/northstar/schedule/plan",
      };
      setTimeline((t) => [entry, ...t]);
      setLandedIds((ids) => [...ids, entry.id]);
    }
    // 收据留一拍再离队(§FB6:结果即反馈,不需要 toast)
    timers.current.push(
      window.setTimeout(() => {
        setQueue((qs) => qs.filter((r) => r.id !== req.id));
      }, LEAVE_MS),
    );
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-10">
      {/* §N6 页头:标题 + 待批计数 pill;空/满都渲染 */}
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
        <Button variant="ghost" size="sm" asChild>
          <Link href="/northstar/global/otto-chat">
            <MessageSquare strokeWidth={2} />
            View in chat
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

      {/* ── Otto 替我做完的事(与 dock 同一条时间线,不另造通知系统) ── */}
      <div className="mt-10 flex items-baseline gap-3">
        <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
          Otto&rsquo;s recent actions
        </h2>
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          Same feed as the dock · click a row to jump to what changed
        </p>
      </div>
      <div className="mt-2 -mx-3">
        {timeline.map((a, i) => (
          <React.Fragment key={a.id}>
            {i > 0 && <div className="mx-3 border-t border-border" />}
            <TimelineRow action={a} land={landedIds.includes(a.id)} />
          </React.Fragment>
        ))}
      </div>

      <p className="mt-10 font-mono text-[11px] leading-[16px] tracking-[0.02em] text-muted-foreground">
        规则回执:ApprovalRequest 一个原语两个表面(此页与聊天同卡)· 时间线与 dock 同源,
        零独立通知系统 · coral 预算:唯一 brand 按钮在待批生成卡(§O4)· 排期确认走 INK ·
        影响清单必列 + 花钱按钮即收据(§FB6/§V5)。
      </p>

      <MockNote path="/northstar/global/notifications" />
    </div>
  );
}
