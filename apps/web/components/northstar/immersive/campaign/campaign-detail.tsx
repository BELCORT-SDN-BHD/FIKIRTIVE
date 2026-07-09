"use client";

/**
 * Campaign 详情容器页(D1 的物理载体)—— 7 tabs:总览 · 日历 · 内容 · 投放 · 对话 · 结果 · 资料。
 *
 * 为这件事发生的一切**自动**长在它身上:切片(assetsForCampaign)、帖子(postsForCampaign)、
 * 对话(D2 单流按 campaignId 过滤 = streamFor)、广告、研究(trendsForCampaign)、效果回流。
 * 详情页 = 收纳本身。管理面安静,dock 外零 coral;唯一 Otto avatar 在「对话」tab(那本就是它的流)。
 *
 * Wave B(campaign 侧):#1 资产伞 · #2 预算/花费 · #3 ROI · #4 目标条 · #8 首触归因 · #9 内容审批 ·
 * #13 UTM · #14 参与标记 · #15 Lead Ads · #16/#17 Advantage+ · #18 Lookalike · #19 A/B · #20 疲劳 ·
 * #21 学习期 · #22 CAPI · #27 上期反哺。每处代码标 [wave-b]。
 *
 * 铁律:纯 client、零后台 import;图片只从 NS_IMAGES;credits 永远是 credits,对客金额用 RM。
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  FolderKanban,
  Megaphone,
  MessageSquareText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { PageHeader, StatCard, EmptyState } from "@/components/northstar/_shared";
import {
  campaignSummaryById,
  trendSnapshotById,
  type NsCampaignSummary,
  type NsAsset,
} from "@/components/northstar/_mock";
import {
  assetsForCampaign,
  postsForCampaign,
  trendsForCampaign,
} from "../_selectors";
import {
  useStore,
  streamFor,
  appendToStream,
  sendCampaignMessage,
  pushApproval,
  submitAd,
  type NsStreamMsg,
} from "../_store";
import { useQueryParam } from "../_kit";
import {
  CAMP_BASE as BASE,
  CampaignStatusBadge,
  StatusTrack,
  GoalBar,
  PlatformPill,
  fmtCredits,
  fmtDay,
  roiLine,
} from "./kit";

/* ── 光标聚焦 tablist(7 tab) ───────────────────────────────────────────────── */
type TabKey = "overview" | "calendar" | "content" | "ads" | "chat" | "results" | "research";
const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "calendar", label: "Calendar" },
  { key: "content", label: "Content" },
  { key: "ads", label: "Ads" },
  { key: "chat", label: "Conversations" },
  { key: "results", label: "Results" },
  { key: "research", label: "Research" },
];

/* ── 该 campaign 的广告(区级原型数据:世界圣经无 NS_ADS,广告配置属 Campaign 区扩展) ── */
interface CampAd {
  id: string;
  title: string;
  platform: string;
  status: "ACTIVE" | "PAUSED" | "ENDED";
  spendMyr: number;
  phase: "learning" | "stable";
  fatigued: boolean;
}
const ADS: Record<string, CampAd[]> = {
  "camp-merdeka-01": [
    { id: "ad-m1", title: "Merdeka gift box · conversions", platform: "Meta", status: "ACTIVE", spendMyr: 62, phase: "learning", fatigued: false },
    { id: "ad-m2", title: "Packing day reel · reach", platform: "Meta", status: "ACTIVE", spendMyr: 28, phase: "stable", fatigued: true },
  ],
  "camp-raya-01": [
    { id: "ad-r1", title: "Raya gifting · conversions", platform: "Meta", status: "ENDED", spendMyr: 540, phase: "stable", fatigued: false },
  ],
  "camp-croffle-01": [],
};

/* ═══════════════════════════ tabs ═══════════════════════════ */

function OverviewTab({ c }: { c: NsCampaignSummary }) {
  const posts = postsForCampaign(c.id);
  const assets = assetsForCampaign(c.id);
  const pct = c.goalProgress.target > 0 ? Math.round((c.goalProgress.current / c.goalProgress.target) * 100) : 0;
  const roi = c.result ? roiLine(c.spentCredits, 21216) : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={c.goalProgress.label}
          value={`${c.goalProgress.current}/${c.goalProgress.target}`}
          delta={{ dir: "flat", text: `${pct}% of goal` }}
        />
        {/* 预算/花费两列(#2) [wave-b] Campaign 预算/花费追踪 */}
        <StatCard label="Spent" value={String(c.spentCredits)} delta={{ dir: "flat", text: `of ${c.budgetCredits} credits` }} />
        <StatCard label="Posts" value={String(posts.length)} />
        <StatCard label="Content" value={String(assets.length)} />
      </div>

      {/* 目标条(#4) */}
      <div className="rounded-[18px] border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">{c.goal}</p>
        <GoalBar label={c.goalProgress.label} current={c.goalProgress.current} target={c.goalProgress.target} className="mt-3" />
      </div>

      {/* ROI 一行(#3) [wave-b] Campaign ROI 一行结论 */}
      {roi && (
        <div className={cn("rounded-[18px] border border-border bg-card p-5", roi.positive ? "" : "")}>
          <p className="text-xs font-medium text-muted-foreground">Return on this campaign</p>
          <p className={cn("mt-1 text-sm font-semibold", roi.positive ? "text-success-soft-foreground" : "text-error-soft-foreground")}>
            {roi.text}
          </p>
        </div>
      )}

      {/* 一句话生命周期时间线(phases) */}
      <div className="rounded-[18px] border border-border bg-card p-5">
        <p className="mb-3 text-sm font-semibold text-foreground">Where this campaign is</p>
        <ol className="space-y-2.5">
          {c.phases.map((p) => (
            <li key={p.key} className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                  p.done ? "border-transparent bg-secondary text-foreground" : "border-border text-muted-foreground",
                )}
              >
                {p.done ? <Check className="size-3" strokeWidth={2.5} /> : ""}
              </span>
              <span className={cn("text-sm", p.done ? "text-foreground" : "text-muted-foreground")}>{p.label}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* 下一步动作(读面永不是死胡同) */}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link href={`${BASE}/campaign/proposal-card`}>Open proposal</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href={`${BASE}/campaign/calendar`}>Open calendar</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href={`${BASE}/schedule/plan`}>Go to schedule</Link>
        </Button>
      </div>
    </div>
  );
}

function CalendarTab({ c }: { c: NsCampaignSummary }) {
  const posts = postsForCampaign(c.id);
  if (posts.length === 0) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="No posts scheduled yet"
        body="Approve the proposal and confirm the pack — finished posts land here and in your schedule."
        action={
          <Button asChild size="sm">
            <Link href={`${BASE}/campaign/proposal-card`}>Open proposal</Link>
          </Button>
        }
      />
    );
  }
  const sorted = [...posts].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-card">
      {sorted.map((p, i) => (
        <div key={p.id} className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-border")}>
          <span className="w-14 shrink-0 font-mono text-xs font-medium text-muted-foreground tabular-nums">
            {fmtDay(p.scheduledAt.slice(0, 10))}
          </span>
          <PlatformPill platform={p.platform} />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.caption}</span>
          {p.status === "published" && <Badge variant="outline">Published</Badge>}
          {p.status === "scheduled" && <Badge variant="info">Scheduled</Badge>}
          {p.status === "draft" && <Badge>Draft</Badge>}
          {p.status === "failed" && <Badge variant="destructive">Failed</Badge>}
        </div>
      ))}
      <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        Same posts show on your{" "}
        <Link href={`${BASE}/schedule/plan`} className="font-semibold text-foreground hover:underline">
          schedule
        </Link>
        , grouped under this campaign.
      </div>
    </div>
  );
}

/** 内容伞(#1)+ 审批(#9)。 [wave-b] Campaign 资产伞 · Campaign 内容审批 */
function ContentTab({ c }: { c: NsCampaignSummary }) {
  useStore();
  const assets = assetsForCampaign(c.id);
  const [submitted, setSubmitted] = React.useState<Set<string>>(new Set());
  if (assets.length === 0) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="No content yet"
        body="Generated images, videos and storyboards for this campaign land here automatically."
      />
    );
  }
  function submitForApproval(a: NsAsset) {
    if (submitted.has(a.id)) return;
    setSubmitted((prev) => new Set(prev).add(a.id));
    pushApproval({
      title: `Approve content · ${a.title}`,
      detail: `${c.name} · ${a.kind}`,
      impacts: ["Approving marks it ready to schedule", "Nothing publishes until you schedule it"],
      kind: "schedule",
    });
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {assets.map((a) => (
        <div key={a.id} className="flex flex-col overflow-hidden rounded-[14px] border border-border bg-card">
          <div className="relative aspect-square w-full overflow-hidden bg-secondary">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.thumb} alt={a.title} className="size-full object-cover" />
            {a.status === "generating" && <div className="absolute inset-0 bg-background/40" aria-hidden />}
          </div>
          <div className="flex flex-1 flex-col gap-2 p-3">
            <p className="truncate text-xs font-semibold text-foreground">{a.title}</p>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="uppercase">{a.kind}</span>
              {a.status === "failed" && <Badge variant="destructive">Failed</Badge>}
              {a.status === "generating" && <Badge variant="info">Generating</Badge>}
            </div>
            <div className="mt-auto">
              {a.status === "ready" &&
                (submitted.has(a.id) ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <Check className="size-3" strokeWidth={2.5} /> Sent for approval
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => submitForApproval(a)}
                    className="text-[11px] font-semibold text-foreground hover:underline"
                  >
                    Send for approval
                  </button>
                ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 投放(#15–#22 广告侧全量,轻原型)。 */
function AdsTab({ c }: { c: NsCampaignSummary }) {
  useStore();
  const ads = ADS[c.id] ?? [];
  const [advBudget, setAdvBudget] = React.useState(true); // #16
  const [advAudience, setAdvAudience] = React.useState(true); // #17
  const [built, setBuilt] = React.useState(false);

  function buildDraft() {
    setBuilt(true);
    // Submit for approval = $0 建 PAUSED 草稿(非钱路确认)。 [wave-b] 广告草稿过审批闸
    submitAd({ label: `${c.name} boost`, platform: "meta" });
  }

  return (
    <div className="space-y-4">
      {/* 现有广告卡:学习期(#21)+ 疲劳提醒(#20) */}
      {ads.length > 0 ? (
        <div className="overflow-hidden rounded-[18px] border border-border bg-card">
          {ads.map((ad, i) => (
            <div key={ad.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", i > 0 && "border-t border-border")}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{ad.title}</span>
                <span className="text-xs text-muted-foreground">
                  {ad.platform} · RM{ad.spendMyr.toLocaleString("en-MY")} spent
                </span>
              </span>
              {/* #21 学习期状态标签 [wave-b] 广告学习期状态 */}
              <Badge variant={ad.phase === "learning" ? "info" : "outline"}>
                {ad.phase === "learning" ? "Learning" : "Stable"}
              </Badge>
              {ad.status === "ACTIVE" && <Badge variant="success">Active</Badge>}
              {ad.status === "PAUSED" && <Badge>Paused</Badge>}
              {ad.status === "ENDED" && <Badge variant="outline">Ended</Badge>}
              {/* #20 创意疲劳提醒 [wave-b] 创意疲劳提醒 */}
              {ad.fatigued && (
                <span className="w-full text-xs font-medium text-warning-soft-foreground">
                  This ad is tiring out — time to refresh the creative.{" "}
                  <Link href={`${BASE}/create/canvas`} className="font-semibold underline">
                    Make a new one
                  </Link>
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-[18px] border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No ads for this campaign yet. Build a draft below — nothing goes live without your approval.
        </p>
      )}

      {/* 建广告草稿:Advantage+ 开关(#16/#17)+ Lookalike(#18)+ A/B(#19) */}
      <div className="rounded-[18px] border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">Boost this campaign</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Otto builds a paused draft. You approve before anything spends.</p>

        <div className="mt-4 space-y-3">
          {/* #16 Advantage+ 预算自动 [wave-b] Advantage+ 预算自动分配 */}
          <label className="flex items-center gap-3">
            <Switch checked={advBudget} onCheckedChange={setAdvBudget} />
            <span className="text-sm text-foreground">
              Let Meta spread the budget automatically <span className="text-muted-foreground">(recommended)</span>
            </span>
          </label>
          {/* #17 Advantage+ 受众自动 [wave-b] Advantage+ 受众自动扩量 */}
          <label className="flex items-center gap-3">
            <Switch checked={advAudience} onCheckedChange={setAdvAudience} />
            <span className="text-sm text-foreground">
              Let Meta widen the audience automatically <span className="text-muted-foreground">(recommended)</span>
            </span>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {/* #18 Lookalike [wave-b] Lookalike 相似受众一键 */}
          <Button asChild variant="secondary" size="sm">
            <Link href={`${BASE}/crm/contacts`}>Build a lookalike from my customers</Link>
          </Button>
          {/* #19 A/B [wave-b] 广告 A/B 测试 */}
          <span className="inline-flex items-center gap-2 rounded-[10px] border border-border px-3 text-xs font-medium text-muted-foreground">
            <input type="checkbox" className="size-3.5 accent-[var(--primary)]" /> Add a control version (A/B)
          </span>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          {built ? (
            <p className="text-sm font-medium text-foreground">
              Draft built and paused. It&apos;s in{" "}
              <Link href={`${BASE}/ads/builder`} className="font-semibold underline">
                the ad builder
              </Link>{" "}
              waiting for your approval — RM0 until you approve.
            </p>
          ) : (
            <Button size="sm" onClick={buildDraft}>
              Build ad draft · RM0
            </Button>
          )}
        </div>
      </div>

      {/* #15 Lead Ads → CRM · #22 Conversions API(太深奥:轻状态展示) */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* [wave-b] Meta Lead Ads 实时回传 CRM */}
        <div className="rounded-[18px] border border-border bg-card p-4">
          <p className="text-xs font-semibold text-foreground">Lead form → contacts</p>
          <p className="mt-1 text-xs text-muted-foreground">
            When someone fills a lead form on this ad, they land in your contacts automatically, tagged to this campaign.
          </p>
          <Link href={`${BASE}/crm/contacts`} className="mt-2 inline-block text-xs font-semibold text-foreground hover:underline">
            View contacts
          </Link>
        </div>
        {/* [wave-b] Conversions API 接入向导 */}
        <div className="rounded-[18px] border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-foreground">Conversions signal</p>
            <Badge variant="warning">Not connected</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Tell Meta who actually ordered so ads get smarter. Otto walks you through it — no developer docs.
          </p>
          <Link href={`${BASE}/account/connections`} className="mt-2 inline-block text-xs font-semibold text-foreground hover:underline">
            Set up
          </Link>
        </div>
      </div>
    </div>
  );
}

/** 对话(D2 单流按 campaign 过滤 = 同一条流的一种看法)。 */
function ChatTab({ c }: { c: NsCampaignSummary }) {
  useStore();
  const [draft, setDraft] = React.useState("");
  const [thinking, setThinking] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const timerRef = React.useRef<number | null>(null);
  const stream = streamFor({ campaignId: c.id });

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [stream, thinking]);
  React.useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  function send() {
    const text = draft.trim();
    if (!text || thinking) return;
    sendCampaignMessage(c.id, c.name, text);
    setDraft("");
    setThinking(true);
    timerRef.current = window.setTimeout(() => {
      setThinking(false);
      appendToStream({
        role: "otto",
        text: `On ${c.name} — got it. It's all on this one thread; nothing to file away.`,
        context: { zone: "Campaign", label: c.name, campaignId: c.id },
      });
    }, 1300);
  }

  return (
    <div className="flex flex-col rounded-[18px] border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <MessageSquareText className="size-4 text-muted-foreground" strokeWidth={2} />
        <p className="text-sm font-semibold text-foreground">Everything Otto did for {c.name}</p>
        <Link href={`${BASE}/otto`} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">
          Open full thread
        </Link>
      </div>
      <div ref={scrollRef} role="log" className="max-h-[460px] min-h-[240px] space-y-4 overflow-y-auto px-4 py-4">
        {stream.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing on this campaign yet. Ask Otto to plan or draft below.
          </p>
        ) : (
          stream.map((m) => <ChatBubble key={m.id} m={m} />)
        )}
        {thinking && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <OttoAvatar size={18} mood="thinking" />
            <span>Thinking…</span>
          </div>
        )}
      </div>
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-[14px] border border-input bg-background p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={`Message Otto about ${c.name}`}
            className="max-h-28 min-h-[36px] w-full resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Button size="icon" aria-label="Send" className="size-8 shrink-0 rounded-full" onClick={send} disabled={!draft.trim()}>
            <ArrowUp strokeWidth={2.5} />
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          Same thread as the dock and{" "}
          <Link href={`${BASE}/otto`} className="font-semibold text-foreground hover:underline">
            /otto
          </Link>{" "}
          — filtered to this campaign. Never a second conversation.
        </p>
      </div>
    </div>
  );
}

function ChatBubble({ m }: { m: NsStreamMsg }) {
  if (m.role === "owner") {
    return (
      <div className="flex flex-col items-end gap-1">
        <p className="max-w-[80%] rounded-[16px] rounded-br-[5px] bg-primary px-3.5 py-2 text-[13px] leading-5 text-primary-foreground">
          {m.text}
        </p>
        <span className="text-[10px] text-muted-foreground">{m.at}</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      <OttoAvatar size={22} mood={m.error ? "error" : "idle"} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-col items-start gap-1">
        <p className="max-w-[80%] text-[13px] leading-5 text-foreground">{m.text}</p>
        <span className="text-[10px] text-muted-foreground">{m.at}</span>
      </div>
    </div>
  );
}

/** 结果(DONE:完整效果 + learnings 喂下一次;进行中:实时 pacing)。 [wave-b] 上期反哺下期(#27) */
function ResultsTab({ c }: { c: NsCampaignSummary }) {
  if (c.result) {
    return (
      <div className="space-y-4">
        <div className="rounded-[18px] border border-border bg-card p-5">
          <p className="text-lg font-semibold text-foreground">{c.result.headline}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {c.result.kpis.map((k) => (
              <StatCard
                key={k.label}
                label={k.label}
                value={k.value}
                delta={k.delta ? { dir: "flat", text: k.delta } : undefined}
              />
            ))}
          </div>
        </div>
        <div className="rounded-[18px] border border-border bg-card p-5">
          <p className="mb-2 text-sm font-semibold text-foreground">What we learned</p>
          <ul className="space-y-2">
            {c.result.learnings.map((l) => (
              <li key={l} className="flex gap-2 text-sm text-muted-foreground">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
          {/* #27 上期反哺:learnings → 下一次提案 */}
          <div className="mt-4 border-t border-border pt-4">
            <Button asChild size="sm">
              <Link href={`${BASE}/campaign/workbench`}>Use these learnings in a new campaign</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }
  const pct = c.goalProgress.target > 0 ? Math.round((c.goalProgress.current / c.goalProgress.target) * 100) : 0;
  return (
    <div className="rounded-[18px] border border-border bg-card p-5">
      <p className="text-sm font-semibold text-foreground">Results come in as this campaign runs</p>
      <p className="mt-1 text-sm text-muted-foreground">
        So far you&apos;re at {c.goalProgress.current} of {c.goalProgress.target} ({pct}%). Otto will write the full readout
        when it wraps — and feed the learnings into your next one.
      </p>
      <GoalBar label={c.goalProgress.label} current={c.goalProgress.current} target={c.goalProgress.target} className="mt-4" />
    </div>
  );
}

/** 资料(D3:引用的 research + UTM + 首触归因)。 */
function ResearchTab({ c }: { c: NsCampaignSummary }) {
  const trends = trendsForCampaign(c.id);
  const [copied, setCopied] = React.useState(false);
  const utmBase = `utm_source={platform}&utm_medium=social&utm_campaign=${c.id.replace("camp-", "").replace(/-\d+$/, "")}`;

  function copyUtm() {
    void navigator.clipboard?.writeText(utmBase).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="space-y-4">
      {/* 引用的 trends(燃料;指向 NS_TRENDS) */}
      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">Research this campaign is built on</p>
        {trends.length === 0 ? (
          <p className="rounded-[18px] border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No research linked. Pull some in the{" "}
            <Link href={`${BASE}/campaign/trends`} className="font-semibold text-foreground hover:underline">
              trends library
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-3">
            {(c.trendIds.map((id) => trendSnapshotById(id)).filter(Boolean) as ReturnType<typeof trendSnapshotById>[])
              .concat(trends.filter((t) => !c.trendIds.includes(t.id)))
              .filter((t, i, arr) => t && arr.findIndex((x) => x?.id === t.id) === i)
              .map(
                (t) =>
                  t && (
                    <div key={t.id} className="rounded-[18px] border border-border bg-card p-4">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">{t.title}</p>
                        <Badge variant="outline">{t.via}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{t.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {t.sources.map((s) => (
                          <span
                            key={s.title}
                            className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                          >
                            {s.domain}
                          </span>
                        ))}
                        <span className="font-mono text-[10px] text-muted-foreground">· {t.capturedAt}</span>
                      </div>
                    </div>
                  ),
              )}
            <Link href={`${BASE}/campaign/trends`} className="inline-block text-xs font-semibold text-foreground hover:underline">
              Open trends library
            </Link>
          </div>
        )}
      </div>

      {/* #13 UTM 自动生成 + 追踪链接 [wave-b] UTM 自动生成 + 追踪链接生成器 */}
      <div className="rounded-[18px] border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">Tracking tags (UTM base)</span>
          <button
            type="button"
            onClick={copyUtm}
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check className="size-3.5" strokeWidth={2.5} /> : <Copy className="size-3.5" strokeWidth={2} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-2 font-mono text-xs leading-5 break-all text-muted-foreground">{utmBase}</p>
        <p className="mt-2 text-xs text-muted-foreground">Every link in this campaign carries these tags.</p>
      </div>

      {/* #8 首触归因:被这档带进来的联系人 [wave-b] Campaign 首触归因 */}
      <div className="rounded-[18px] border border-border bg-card p-5">
        <p className="text-xs font-medium text-muted-foreground">Contacts this campaign brought in</p>
        <p className="mt-1 text-sm text-foreground">
          New contacts sourced from this campaign show &quot;First seen: {c.name}&quot; on their profile.
        </p>
        {/* #14 参与/回应标记:回过消息的人被标「Engaged」 [wave-b] Campaign 参与/回应标记 */}
        <p className="mt-2 text-xs text-muted-foreground">
          Contacts who replied to this campaign are tagged &quot;Engaged: {c.name}&quot; in your CRM.
        </p>
        <Link href={`${BASE}/crm/contacts`} className="mt-2 inline-block text-xs font-semibold text-foreground hover:underline">
          See who came from here
        </Link>
      </div>
    </div>
  );
}

/* ═══════════════════════════ container ═══════════════════════════ */

export function CampaignDetail() {
  useStore();
  const id = useQueryParam("id") ?? "camp-merdeka-01";
  const c = campaignSummaryById(id);
  const [tab, setTab] = React.useState<TabKey>("overview");
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  if (!c) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[1000px] flex-col px-6 pt-6 pb-16">
        <EmptyState
          icon={Megaphone}
          title="Campaign not found"
          body="This campaign may have been removed."
          action={
            <Button asChild size="sm">
              <Link href={`${BASE}/campaign/list`}>All campaigns</Link>
            </Button>
          }
          className="mt-10"
        />
      </div>
    );
  }

  function onTabKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const cur = TABS.findIndex((t) => t.key === tab);
    const next = (cur + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS[next]!.key);
    refs.current[next]?.focus();
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1000px] flex-col px-6 pt-6 pb-16">
      <Link
        href={`${BASE}/campaign/list`}
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="size-4" strokeWidth={2} />
        All campaigns
      </Link>

      <PageHeader
        className="mt-4"
        title={c.name}
        subtitle={c.goal}
        meta={[c.period]}
        actions={<CampaignStatusBadge status={c.status} />}
      />
      <div className="mt-3">
        <StatusTrack status={c.status} />
      </div>

      {/* 7 tabs */}
      <div
        role="tablist"
        aria-label="Campaign sections"
        onKeyDown={onTabKey}
        className="mt-6 flex flex-wrap gap-1 rounded-[12px] bg-muted p-1"
      >
        {TABS.map((t, i) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={cn(
                "h-8 rounded-[8px] px-3 text-[13px] font-medium transition-colors",
                active ? "bg-card font-semibold text-foreground shadow-[var(--shadow-sm)]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="mt-5">
        {tab === "overview" && <OverviewTab c={c} />}
        {tab === "calendar" && <CalendarTab c={c} />}
        {tab === "content" && <ContentTab c={c} />}
        {tab === "ads" && <AdsTab c={c} />}
        {tab === "chat" && <ChatTab c={c} />}
        {tab === "results" && <ResultsTab c={c} />}
        {tab === "research" && <ResearchTab c={c} />}
      </div>
    </div>
  );
}
