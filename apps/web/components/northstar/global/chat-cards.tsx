"use client";

/**
 * 北极星原型 · 全局横切区 — Otto 聊天卡种(GEN / PACK / RESEARCH / STORYBOARD / META / CAMPAIGN)
 * + 审批卡(ApprovalFlow:waiting → approving → success / cancelled)
 *
 * design-rules v3:§L3 聊天卡宽 480 / §8b 落地 / §O2 mood=状态 / §V5 花钱文案
 * (按钮即收据:「Approve · 120 credits」;完成:「You approved this. It used N credits.」)。
 * coral 预算(§O4):卡头 kind 章是中性 mono 章;coral 只出现在 Otto 动作
 * (审批卡的 brand 按钮 = 按下即开工)与工作中的 narration。
 */

import * as React from "react";
import {
  Calendar,
  Check,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { GenBar, useLanding, useSweep } from "./_fx";
import {
  NS_ASSETS,
  NS_CAMPAIGN,
  NS_CAMPAIGN_ENTRIES,
  NS_PRODUCTS,
  type NsChatCardKind,
} from "./_data";

/* ── 卡壳:kind 章(micro-mono)+ 标题 + 正文 + 页脚 ─────────────────────── */
function CardShell({
  kind,
  title,
  right,
  children,
  footer,
  land,
}: {
  kind: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  land?: boolean;
}) {
  const landing = useLanding();
  return (
    <div
      style={land ? landing : undefined}
      className="w-full max-w-[480px] overflow-hidden rounded-[18px] border border-border bg-card shadow-[var(--shadow-xs)]"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="inline-flex h-5 items-center rounded-full bg-secondary px-2 font-mono text-[11px] leading-none font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {kind}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</span>
        {right}
      </div>
      <div className="p-4">{children}</div>
      {footer && <div className="flex items-center gap-3 border-t border-border px-4 py-3">{footer}</div>}
    </div>
  );
}

function CreditsMeta({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
      {children}
    </span>
  );
}

/* ── GEN:4 图网格 ──────────────────────────────────────────────────────── */
export function GenCard({ land }: { land?: boolean }) {
  const shots = [NS_PRODUCTS[5], NS_PRODUCTS[0], NS_PRODUCTS[1], NS_PRODUCTS[4]];
  return (
    <CardShell kind="gen" title="4 images · gift box hero shots" right={<CreditsMeta>12 credits</CreditsMeta>} land={land}>
      <div className="grid grid-cols-2 gap-2">
        {shots.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p.id}
            src={p.image}
            alt={`Variant ${i + 1} · ${p.name}`}
            className="aspect-square w-full rounded-[10px] border border-border object-cover"
          />
        ))}
      </div>
      <p className="mt-3 text-xs font-medium text-muted-foreground">Saved to Library · tap a variant to open it</p>
    </CardShell>
  );
}

/* ── PACK:平台 × 尺寸变体清单(已确认态,收据在页脚) ─────────────────── */
const PACK_ROWS = [
  { id: "pk-1", label: "Instagram · 1:1 · image", credits: 12 },
  { id: "pk-2", label: "Instagram · 9:16 · video", credits: 40 },
  { id: "pk-3", label: "Facebook · 1.91:1 · image", credits: 12 },
  { id: "pk-4", label: "TikTok · 9:16 · video", credits: 40 },
  { id: "pk-5", label: "Instagram story · 9:16 · image", credits: 12 },
  { id: "pk-6", label: "X · 16:9 · image", credits: 12 },
];

export function PackCard({ land }: { land?: boolean }) {
  const total = PACK_ROWS.reduce((s, r) => s + r.credits, 0);
  return (
    <CardShell
      kind="pack"
      title="Content pack · 6 variants"
      right={<CreditsMeta>{total} credits</CreditsMeta>}
      land={land}
      footer={
        <p className="text-[13px] leading-[18px] font-medium text-success-soft-foreground">
          <Check className="mr-1 inline size-3.5 align-[-2px]" strokeWidth={2.5} />
          You approved this. It used {total} credits.
        </p>
      }
    >
      <ul>
        {PACK_ROWS.map((r, i) => (
          <li
            key={r.id}
            className={cn("flex items-center gap-3 py-2", i > 0 && "border-t border-border")}
          >
            <ImageIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.label}</span>
            <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{r.credits} cr</span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

/* ── RESEARCH:发现 + 来源 ─────────────────────────────────────────────── */
const RESEARCH_FINDINGS = [
  "Bakery gift box posts peak 5 to 7 days before Merdeka. Pre-order CTAs beat generic wishes 3 to 1.",
  "Short behind-the-counter videos outperform product stills for KL food brands this season.",
  "Local flavour names (pandan, gula melaka) in the first line lift saves noticeably.",
];

export function ResearchCard({ land }: { land?: boolean }) {
  return (
    <CardShell
      kind="research"
      title="Merdeka trends for KL bakeries"
      land={land}
      footer={
        <>
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">Saved to trends archive</p>
          <Button variant="ghost" size="sm">
            Open trends
            <ExternalLink strokeWidth={2} />
          </Button>
        </>
      }
    >
      <ul className="space-y-2.5">
        {RESEARCH_FINDINGS.map((f, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-5 text-foreground">
            <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-foreground/60" />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["thestar.com.my", "instagram explore", "tiktok creative center"].map((s) => (
          <span
            key={s}
            className="inline-flex h-6 items-center rounded-full border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground"
          >
            {s}
          </span>
        ))}
      </div>
    </CardShell>
  );
}

/* ── STORYBOARD:4 镜带 + 免费步/付费步说明 ────────────────────────────── */
export function StoryboardCard({ land }: { land?: boolean }) {
  const sb = NS_ASSETS[3];
  return (
    <CardShell
      kind="storyboard"
      title="Croissant reel · 4 scenes"
      land={land}
      footer={
        <>
          <p className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
            Steps 1 to 3 are free · rendering costs 40 credits
          </p>
          <Button variant="secondary" size="sm">
            Open storyboard
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-4 gap-2">
        {["Dark kitchen", "Folding dough", "Oven glow", "Golden tray"].map((scene, i) => (
          <figure key={scene} className="min-w-0">
            <div className="relative overflow-hidden rounded-[10px] border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sb.thumb} alt={`Scene ${i + 1}: ${scene}`} className="aspect-video w-full object-cover" />
              <span className="absolute top-1 left-1 inline-flex size-5 items-center justify-center rounded-full bg-background/90 font-mono text-[11px] font-medium text-foreground">
                {i + 1}
              </span>
            </div>
            <figcaption className="mt-1 truncate text-xs font-medium text-muted-foreground">{scene}</figcaption>
          </figure>
        ))}
      </div>
    </CardShell>
  );
}

/* ── META:广告草稿(build = $0,PAUSED) ──────────────────────────────── */
export function MetaAdCard({ land }: { land?: boolean }) {
  return (
    <CardShell
      kind="meta"
      title="Meta ad draft"
      right={<Badge variant="warning">Paused draft</Badge>}
      land={land}
      footer={
        <p className="text-xs font-medium text-muted-foreground">
          Built as a draft. Nothing runs and nothing is charged until you turn it on in Ads.
        </p>
      }
    >
      <dl className="space-y-2.5 text-sm">
        {[
          ["Campaign", "Merdeka gift box pre-orders"],
          ["Audience", "KL and Selangor · 24 to 45 · bakery and dessert interests"],
          ["Placement", "Instagram feed and reels"],
          ["Budget", "RM 25 per day · 7 days"],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-3">
            <dt className="w-24 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 flex-1 font-medium text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
    </CardShell>
  );
}

/* ── CAMPAIGN:提案卡(主题/目标/跨度/节奏 + 内容日历) ────────────────── */
const STATUS_BADGE: Record<string, { variant: "default" | "success" | "info"; label: string }> = {
  proposed: { variant: "default", label: "Proposed" },
  approved: { variant: "success", label: "Approved" },
  scheduled: { variant: "info", label: "Scheduled" },
  published: { variant: "success", label: "Published" },
};

export function CampaignCard({ land }: { land?: boolean }) {
  const shown = NS_CAMPAIGN_ENTRIES.slice(0, 4);
  const totalEst = NS_CAMPAIGN_ENTRIES.reduce((s, e) => s + e.estCredits, 0);
  return (
    <CardShell
      kind="campaign"
      title={NS_CAMPAIGN.name}
      land={land}
      footer={
        <>
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground tabular-nums">
            {NS_CAMPAIGN_ENTRIES.length} posts · about {totalEst} credits if you generate them all
          </p>
          <Button variant="ghost" size="sm">
            Open in calendar
            <Calendar strokeWidth={2} />
          </Button>
        </>
      }
    >
      <p className="text-sm text-foreground">{NS_CAMPAIGN.goal}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[NS_CAMPAIGN.period, `${NS_CAMPAIGN.budgetCredits} credit budget`, "IG · FB · TikTok"].map((m) => (
          <span
            key={m}
            className="inline-flex h-6 items-center rounded-full border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground tabular-nums"
          >
            {m}
          </span>
        ))}
      </div>
      <ul className="mt-4">
        {shown.map((e, i) => (
          <li key={e.id} className={cn("flex items-center gap-3 py-2", i > 0 && "border-t border-border")}>
            {e.format === "video" ? (
              <Film className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            ) : e.format === "carousel" ? (
              <Megaphone className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            ) : (
              <ImageIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            )}
            <span className="w-14 shrink-0 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground tabular-nums">
              {e.date.slice(5)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{e.hook}</span>
            <Badge variant={STATUS_BADGE[e.status].variant}>{STATUS_BADGE[e.status].label}</Badge>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs font-medium text-muted-foreground">
        Showing 4 of {NS_CAMPAIGN_ENTRIES.length} planned posts.
      </p>
    </CardShell>
  );
}

/* ── 审批卡:waiting → approving → success / cancelled(§FB6 影响清单必列) ── */
export type ApprovalState = "waiting" | "approving" | "done" | "cancelled";

export interface ApprovalFlowProps {
  title: string;
  detail?: string;
  impacts: string[];
  credits?: number;
  /** generation = 按下即开工的 Otto 动作(brand);schedule = 人的确认(INK) */
  kind?: "generation" | "schedule";
  /** approving 阶段的步数(演示计数器 n/N) */
  workSteps?: number;
  onSettled?: (state: "done" | "cancelled") => void;
  land?: boolean;
  className?: string;
}

export function ApprovalFlow({
  title,
  detail,
  impacts,
  credits,
  kind = "generation",
  workSteps = 3,
  onSettled,
  land,
  className,
}: ApprovalFlowProps) {
  const [state, setState] = React.useState<ApprovalState>("waiting");
  const [step, setStep] = React.useState(1);
  const [sweepStyle, fireSweep] = useSweep();
  const landing = useLanding();
  const onSettledRef = React.useRef(onSettled);
  React.useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  React.useEffect(() => {
    if (state !== "approving") return;
    const t = window.setInterval(() => {
      setStep((s) => {
        if (s >= workSteps) {
          window.clearInterval(t);
          setState("done");
          fireSweep();
          onSettledRef.current?.("done");
          return s;
        }
        return s + 1;
      });
    }, 1100);
    return () => window.clearInterval(t);
  }, [state, workSteps, fireSweep]);

  const mood = state === "waiting" ? "waiting" : state === "approving" ? "approving" : state === "done" ? "success" : "idle";

  return (
    <div
      style={{ ...(land ? landing : undefined), ...sweepStyle }}
      className={cn(
        "w-full max-w-[480px] overflow-hidden rounded-[18px] border border-border bg-card shadow-[var(--shadow-xs)]",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <OttoAvatar size={22} mood={mood} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {state === "waiting" ? "Approval needed" : state === "approving" ? "On it" : state === "done" ? "Done" : "Cancelled"}
        </span>
        {credits !== undefined && <CreditsMeta>{credits} credits</CreditsMeta>}
      </div>

      <div className="p-4">
        {state === "cancelled" ? (
          <p className="text-sm text-muted-foreground">
            Cancelled. Nothing was {kind === "generation" ? "generated and you weren't charged" : "scheduled"}.
          </p>
        ) : state === "done" ? (
          <p className="text-sm font-medium text-success-soft-foreground">
            <Check className="mr-1 inline size-4 align-[-2.5px]" strokeWidth={2.5} />
            {kind === "generation" && credits !== undefined
              ? `You approved this. It used ${credits} credits.`
              : "You approved this. It is on the schedule."}
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold text-foreground">
              {title}
              {kind === "generation" && credits !== undefined ? ` for ${credits} credits?` : "?"}
            </p>
            {detail && <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{detail}</p>}
            <div className="mt-3 rounded-[14px] bg-secondary/70 p-3">
              <p className="text-xs font-semibold text-foreground">What happens</p>
              <ul className="mt-1.5 space-y-1">
                {impacts.map((im, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-[18px] text-muted-foreground">
                    <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground" />
                    {im}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>

      {state === "waiting" && (
        <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setState("cancelled");
              onSettledRef.current?.("cancelled");
            }}
          >
            Cancel
          </Button>
          <Button
            variant={kind === "generation" ? "brand" : "default"}
            size="sm"
            onClick={() => setState("approving")}
          >
            {kind === "generation" && credits !== undefined ? `Approve · ${credits} credits` : "Approve schedule"}
          </Button>
        </div>
      )}

      {state === "approving" && (
        <div role="status" className="flex items-center gap-2 border-t border-border px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-muted-foreground">
            {kind === "generation" ? "Generating…" : "Scheduling…"}
          </span>
          <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
            {Math.min(step, workSteps)}/{workSteps}
          </span>
          <GenBar />
        </div>
      )}
    </div>
  );
}

/* ── 卡种索引(聊天页按 message.card 渲染) ────────────────────────────── */
export function ChatCard({ kind, land }: { kind: NsChatCardKind; land?: boolean }) {
  switch (kind) {
    case "gen":
      return <GenCard land={land} />;
    case "pack":
      return <PackCard land={land} />;
    case "research":
      return <ResearchCard land={land} />;
    case "storyboard":
      return <StoryboardCard land={land} />;
    case "meta":
      return <MetaAdCard land={land} />;
    case "campaign":
      return <CampaignCard land={land} />;
  }
}
