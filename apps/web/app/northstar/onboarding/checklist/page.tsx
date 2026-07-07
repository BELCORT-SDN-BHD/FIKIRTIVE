/* @nsPage district="Onboarding + 登录" page="checklist" status="draft"
   sources="GM-05 判决「要」;harmony-06 §三" approvedAt="" pr="" */
"use client";

/**
 * 开店完成度(onboarding)— 新店主的开店 checklist,做完即消失。
 *
 * 依据:PAGE-INVENTORY 十二·Onboarding 行 2 + harmony-06 §三(GM-05)。
 * 三件事:品牌包填了 / 第一个产品建了 / 第一条内容发了 —— 完成度环 + 做完永久隐藏。
 * GM 三条不可协商边界(harmony-06 §三总纲):
 *   ① 永不做 XP/等级/排行榜/徽章墙 —— 这里只有一个进度环 + 三张任务卡;
 *   ② 一切可关 —— 卡右上「隐藏」把它收起(设置里可再开);
 *   ③ 永不打断工作流 —— 无弹窗、无拦路;庆祝是路过的(success mood 一下就归位)。
 * 克制点(GM-05):HubSpot 验证过的专业形态;三件全绿 → 完成态,提示「以后不再出现」。
 * archetype:居中 560 列(front-door 邻近);进度环用内联 SVG,coral 只属完成弧(Otto 的燃料感克制版:此处用 primary ink 环 + 单点 coral 完成标,不违 coral law —— 进度是用户的成就)。
 * 零后台:任务态本地,页底演示器可切「进行中 / 全完成 / 已隐藏」。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, EyeOff, ImageIcon, PackageOpen, Send, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { MockNote, OttoDock } from "@/components/northstar/_shared";
import { NS_BRAND } from "@/components/northstar/_mock";

type TaskState = "done" | "active" | "todo";

interface Task {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  cta: string;
  href: string;
  doneNote: string;
}

const TASKS: Task[] = [
  {
    id: "brand",
    icon: ImageIcon,
    title: "Tell Otto about your shop",
    body: "Add your name, logo and the voice you want. Otto uses this in everything it makes.",
    cta: "Set up brand",
    href: "/northstar/assets/brand-kit",
    doneNote: "Brand set. Otto knows your voice.",
  },
  {
    id: "product",
    icon: PackageOpen,
    title: "Add your first product",
    body: "One photo and a price is enough. It becomes the star of your first posts.",
    cta: "Add product",
    href: "/northstar/assets/brand-memory",
    doneNote: "First product added.",
  },
  {
    id: "post",
    icon: Send,
    title: "Publish your first post",
    body: "Ask Otto to draft one, tweak it, and send it out. You approve before anything goes live.",
    cta: "Make a post",
    href: "/northstar/create/canvas",
    doneNote: "First post is live. Nice.",
  },
];

/* ── 完成度环(内联 SVG;primary ink 环 + coral 完成点;reduced-motion 由 .gb clamp 冻结 transition) ── */
function CompletionRing({ done, total, complete }: { done: number; total: number; complete: boolean }) {
  const size = 76;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = done / total;
  const offset = c * (1 - pct);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--secondary)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={complete ? "var(--brand)" : "var(--primary)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 400ms cubic-bezier(0.22,1,0.36,1), stroke 200ms" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {complete ? (
          <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft">
            <Check className="size-4 text-brand-soft-foreground" strokeWidth={3} />
          </span>
        ) : (
          <span className="text-[18px] font-bold tracking-[-0.02em] text-foreground tabular-nums">
            {done}
            <span className="text-sm font-semibold text-muted-foreground">/{total}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/* ── 单任务卡(three states:done / active / todo) ── */
function TaskCard({ task, state }: { task: Task; state: TaskState }) {
  const Icon = task.icon;
  const done = state === "done";
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-[14px] border p-4 transition-colors duration-[120ms]",
        done ? "border-border bg-secondary/40" : state === "active" ? "border-border bg-card shadow-[var(--shadow-xs)]" : "border-border bg-card",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-[12px]",
          done ? "bg-success-soft" : "bg-secondary",
        )}
      >
        {done ? (
          <Check className="size-[18px] text-success-soft-foreground" strokeWidth={3} />
        ) : (
          <Icon className="size-[18px] text-muted-foreground" strokeWidth={2} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-semibold text-foreground", done && "text-muted-foreground line-through decoration-border")}>
          {task.title}
        </div>
        <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
          {done ? task.doneNote : task.body}
        </p>
      </div>

      {!done && (
        <Button asChild size="sm" variant={state === "active" ? "default" : "secondary"} className="shrink-0">
          <Link href={task.href}>
            {task.cta}
            <ArrowRight />
          </Link>
        </Button>
      )}
    </div>
  );
}

type Demo = "progress" | "complete" | "hidden";

export default function Page() {
  const [demo, setDemo] = React.useState<Demo>("progress");
  const [dismissed, setDismissed] = React.useState(false);

  // 演示态 → 任务态映射(progress: 第一件已完成、第二件进行中)
  const states: Record<string, TaskState> =
    demo === "complete"
      ? { brand: "done", product: "done", post: "done" }
      : { brand: "done", product: "active", post: "todo" };

  const doneCount = TASKS.filter((t) => states[t.id] === "done").length;
  const complete = doneCount === TASKS.length;
  const hidden = demo === "hidden" || dismissed;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col px-6 pt-10 pb-24">
      {hidden ? (
        /* 隐藏后:做完即消失(§GM 边界 ①)—— 页上不再占位,只留最薄回访线 */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
          <OttoAvatar size={40} mood="idle" />
          <p className="text-lg font-semibold text-foreground">You're all set up</p>
          <p className="max-w-[360px] text-sm text-muted-foreground">
            Your shop checklist is done and put away. Everything's in your workspace now.
          </p>
          <Button asChild size="sm" className="mt-1">
            <Link href="/northstar/create/canvas">Go to canvas</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* ── 头部:进度环 + Otto 一句人话 + 可关(§GM 边界 ①②) ── */}
          <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-border bg-card p-6">
            {/* 可关:右上「隐藏」(不打断,收起即可,设置里可再开) */}
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Hide checklist"
              className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-[10px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" strokeWidth={2} />
            </button>

            <div className="flex items-center gap-5">
              <CompletionRing done={doneCount} total={TASKS.length} complete={complete} />
              <div className="min-w-0 flex-1 pr-6">
                <h1 className="text-[20px] leading-[26px] font-bold tracking-[-0.017em] text-foreground">
                  {complete ? "Your shop is ready" : "Get your shop ready"}
                </h1>
                <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                  {complete
                    ? "All three done. This checklist won't show again."
                    : `${TASKS.length - doneCount} to go. Do them in any order, whenever you like.`}
                </p>
              </div>
            </div>

            {/* Otto 一句(§O3 front-door 邻近:helpful,不是 thinking;庆祝路过即归位) */}
            <div className="mt-5 flex items-start gap-3 rounded-[14px] bg-secondary/60 p-3.5">
              <OttoAvatar size={22} mood={complete ? "success" : "helpful"} />
              <p className="min-w-0 flex-1 text-[13px] leading-[1.5] text-foreground">
                {complete
                  ? `Great start, ${NS_BRAND.owner.split(" ")[0]}. I've got what I need. Ask me anything from here.`
                  : `Hi ${NS_BRAND.owner.split(" ")[0]}. Finish these three and I'll know your shop well enough to help properly.`}
              </p>
            </div>
          </div>

          {/* ── 三件事 ── */}
          <div className="mt-4 flex flex-col gap-3">
            {TASKS.map((t) => (
              <TaskCard key={t.id} task={t} state={states[t.id]} />
            ))}
          </div>

          {/* ── 完成态尾巴:一次性庆祝 + 收起入口(不做徽章墙) ── */}
          {complete ? (
            /* 庆祝克制:coral 已花在完成环 + success Otto 上;这里按钮是人的导航 = INK,
               背板中性,不再叠 coral(§O4 预算 + GM 反 confetti)。 */
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-secondary/50 p-4">
              <div className="flex items-center gap-2.5">
                <Sparkles className="size-4 text-muted-foreground" strokeWidth={2} />
                <span className="text-sm font-medium text-foreground">
                  Setup complete. Time to make something.
                </span>
              </div>
              <Button asChild size="sm">
                <Link href="/northstar/create/canvas">
                  Open canvas
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="mt-5 flex items-center justify-center gap-1.5 self-center text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              <EyeOff className="size-3.5" strokeWidth={2} />
              Hide for now
            </button>
          )}
        </>
      )}

      <MockNote path="/northstar/onboarding/checklist" />

      {/* 页内演示器(原型专用,不是产品 UI) */}
      <div className="fixed bottom-4 left-1/2 z-[10] flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card p-1 shadow-[var(--shadow-sm)]">
        <span className="px-2 font-mono text-[10px] leading-none font-medium tracking-[0.08em] text-muted-foreground/70">
          演示
        </span>
        {([
          ["progress", "进行中"],
          ["complete", "全完成"],
          ["hidden", "已隐藏"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setDismissed(false);
              setDemo(key);
            }}
            className={cn(
              "h-6 rounded-full px-2.5 font-mono text-[10px] leading-none font-medium tracking-[0.06em] transition-colors duration-[120ms]",
              demo === key && !dismissed
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <OttoDock />
    </div>
  );
}
