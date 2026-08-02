"use client";

/**
 * 沉浸式 · Onboarding 清单(首跑引导)
 *
 * gallery 里 onboarding/checklist 还是 stub,没有可复用内容组件 —— 内容照 account-ops 先例现建,
 * 严格照 Fable 区质量模板:§N6 页头、§D4 hairline 行、§V 文案口径。数据派生自 _mock(NS_BRAND),
 * 不发明品牌事实。
 *
 * 每一步 CTA 都指向真实沉浸式目的地,让引导连成产品流:
 *   Connect a channel → account/connections   Add a product → assets/brand-kit
 *   Make your first post → schedule/composer   See your numbers → analytics/overview
 * 完成态是本地演示 state(勾一步即时反馈,进度条与计数跟着走);零后台、零 coral(引导按钮走 INK)。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Plug, Package, Send, BarChart3, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/northstar/_shared";
import { NS_BRAND } from "@/components/northstar/_mock";
import { connections, useStore } from "../_store";

const BASE = "/northstar-immersive";

interface Step {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  cta: string;
  href: string;
  /** 该步的完成态由 store 真实连接态派生(勾选不可手动改),而非写死的布尔 */
  fromConnections?: boolean;
}

const STEPS: Step[] = [
  {
    id: "connect",
    icon: Plug,
    title: "Connect a channel",
    body: "Link Instagram, Facebook, TikTok or WhatsApp so Otto can post for you.",
    cta: "Manage connections",
    href: `${BASE}/account/connections`,
    fromConnections: true,
  },
  {
    id: "product",
    icon: Package,
    title: "Add a product",
    body: "Tell Otto what you sell — it becomes the brand memory behind every post.",
    cta: "Add product",
    href: `${BASE}/assets/brand-kit`,
  },
  {
    id: "post",
    icon: Send,
    title: "Make your first post",
    body: "Draft a caption, pick a channel and schedule it — start with one.",
    cta: "Make a post",
    href: `${BASE}/schedule/composer`,
  },
  {
    id: "numbers",
    icon: BarChart3,
    title: "See your numbers",
    body: "Once posts go out, your reach and engagement land here.",
    cta: "Open analytics",
    href: `${BASE}/analytics/overview`,
  },
];

export function OnboardingChecklist() {
  useStore();
  // 「连接渠道」步真读 store 连接态:任一渠道已连即视为完成(kill 手写 defaultDone)
  const channelConnected = connections().some((c) => c.status === "connected");
  const [done, setDone] = React.useState<Record<string, boolean>>({});

  const isStepDone = (step: Step) => (step.fromConnections ? channelConnected : Boolean(done[step.id]));

  const doneCount = STEPS.filter((s) => isStepDone(s)).length;
  const pct = Math.round((doneCount / STEPS.length) * 100);
  const allDone = doneCount === STEPS.length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title={`Welcome, ${NS_BRAND.owner.split(" ")[0]}`}
        subtitle={`Four quick steps to get ${NS_BRAND.name} posting. Do them in any order.`}
        meta={[`${doneCount} / ${STEPS.length} done`]}
      />

      {/* 进度条 */}
      <div className="mt-6 flex items-center gap-3">
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{pct}%</span>
      </div>

      {/* 步骤行 */}
      <div className="mt-8 overflow-hidden rounded-[18px] border border-border bg-card">
        {STEPS.map((step, i) => {
          const isDone = isStepDone(step);
          const Icon = step.icon;
          const circleClass = cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-[120ms]",
            isDone
              ? "border-brand bg-brand text-brand-foreground"
              : "border-border bg-background text-muted-foreground",
          );
          const circleInner = isDone ? (
            <Check className="size-4" strokeWidth={2.5} />
          ) : (
            <Icon className="size-4" strokeWidth={2} />
          );
          return (
            <div
              key={step.id}
              className={cn("flex items-start gap-4 px-5 py-5", i > 0 && "border-t border-border")}
            >
              {/* 连接步:圈是 store 派生的真实状态(用 CTA 去连,不手动勾);其余步:点了即时完成(演示反馈) */}
              {step.fromConnections ? (
                <span aria-hidden className={circleClass}>
                  {circleInner}
                </span>
              ) : (
                <button
                  type="button"
                  aria-pressed={isDone}
                  aria-label={isDone ? `Mark ${step.title} not done` : `Mark ${step.title} done`}
                  onClick={() => setDone((d) => ({ ...d, [step.id]: !d[step.id] }))}
                  className={cn(circleClass, "hover:border-foreground/40")}
                >
                  {circleInner}
                </button>
              )}

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-[15px] leading-[22px] font-semibold",
                    isDone ? "text-muted-foreground line-through decoration-border" : "text-foreground",
                  )}
                >
                  {step.title}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.body}</p>
              </div>

              <Button variant={isDone ? "ghost" : "secondary"} size="sm" asChild className="shrink-0">
                <Link href={step.href}>
                  {step.cta}
                  <ArrowRight strokeWidth={2} />
                </Link>
              </Button>
            </div>
          );
        })}
      </div>

      {/* 收尾:全做完 → 进产品;没做完 → 跳过引导直接开工 */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {allDone ? (
          <Button asChild>
            <Link href={`${BASE}/create/canvas`}>
              Start creating
              <ArrowRight strokeWidth={2} />
            </Link>
          </Button>
        ) : (
          <Button variant="secondary" asChild>
            <Link href={`${BASE}/create/canvas`}>Skip for now</Link>
          </Button>
        )}
        <p className="text-xs text-muted-foreground">You can come back to this anytime from Account.</p>
      </div>
    </div>
  );
}
