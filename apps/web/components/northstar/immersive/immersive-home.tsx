"use client";

/**
 * 北极星 · 沉浸式首页(the real front door)—— Wave C「生意状态 → 今日决策队列 → 工作面」重排
 *
 * 老板开门第一眼要答的是两句话:「这周赚了吗」+「现在该干嘛」。ENDGAME D1/D2 的三容器
 * (Campaign / Studio / Otto)仍是骨架,但首屏顺序按 Wave C 判决重排:
 *   招呼条(唯一 coral statement,落到生意结果不是触达)
 *   → 生意状态:营收头卡(真成交,不是花掉的 credit)+ 触达 + FIKIRTIVE credits(明标、降级)
 *   → 今日决策队列「Needs you」:回一句就变钱的最高 ROI 动作按在险金额排,深链现场(蓝=人手)
 *   → 工作面:进行中的 campaign(running 只数 ACTIVE)+ Studio recents + Up next。
 * 每张卡都是通向真实流程的 `<Link>`,读面永不是死胡同。一切状态经 _store / _selectors / _mock,
 * 零本地副本;图片只从 NS_IMAGES(经 NS_ASSETS / NS_CAMPAIGNS.hero)。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Clock, PartyPopper, Play, Reply, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import {
  NS_ASSETS,
  NS_BRAND,
  NS_CAMPAIGN,
  NS_CAMPAIGNS,
  NS_CONTACTS,
  NS_ANALYTICS,
  type NsCampaignStatus,
  type NsCampaignSummary,
} from "@/components/northstar/_mock";
import {
  avgOrderValue,
  dormantHighValue,
  needsOwnerConversations,
  ordersThisWeek,
} from "./_selectors";
import { useImmersive } from "./_context";
import {
  balance,
  hasMilestone,
  markMilestone,
  pendingApprovals,
  recentEvents,
  upNext,
  useStore,
} from "./_store";

const BASE = "/northstar-immersive";

/** 从 ISO 排期时间取一个店主看得懂的短标签(确定性,不用 Date.now)。 */
function whenLabel(iso: string): string {
  const [date, time] = iso.split("T");
  const hhmm = time?.slice(0, 5) ?? "";
  return `${date.slice(5)} · ${hhmm}`;
}

/** waitingFor 短码("22m"/"1h"/"3d")→ 人话("waiting 22 min")。确定性,纯字符串。 */
function humanWait(w?: string): string {
  if (!w) return "waiting on you";
  const n = w.slice(0, -1);
  const u = w.slice(-1);
  const unit = u === "m" ? "min" : u === "h" ? "hr" : u === "d" ? "days" : "";
  return unit ? `waiting ${n} ${unit}` : "waiting on you";
}

const CONTACT_BY_ID = new Map(NS_CONTACTS.map((c) => [c.id, c]));

/** 一行今日决策(回一句就变钱)。
 *  stakeMyr = 前瞻在险值(回这一句近期真能进账多少)—— 唯一进「in play」头部合计的数;
 *  rankMyr  = 仅排序用的优先级权重(大客户回流用生涯额置顶,不进合计、不做展示)。 */
interface TriageRow {
  key: string;
  name: string;
  reason: string;
  wait: string;
  stakeMyr: number;
  rankMyr: number;
  href: string;
  action: "reply" | "winback";
}

/** campaign 状态 → badge(D1「事」容器三态,coral 严守只属 Otto,这里全走中性/语义色)。 */
const STATUS_BADGE: Record<NsCampaignStatus, { label: string; variant: "success" | "warning" | "outline" }> = {
  ACTIVE: { label: "Active", variant: "success" },
  DRAFT: { label: "Draft", variant: "warning" },
  DONE: { label: "Done", variant: "outline" },
};

/** D1 排序:进行中的先看到 → 待起的 → 已完结的。 */
const STATUS_ORDER: Record<NsCampaignStatus, number> = { ACTIVE: 0, DRAFT: 1, DONE: 2 };

/** 「进行中的事」一张 campaign 卡:hero 真图 + 状态 + 目标进度;整卡 → Campaign 容器。 */
function CampaignCard({ c }: { c: NsCampaignSummary }) {
  const badge = STATUS_BADGE[c.status];
  const pct = Math.min(100, Math.round((c.goalProgress.current / c.goalProgress.target) * 100));
  return (
    <Link
      href={`${BASE}/campaign/detail?id=${c.id}`}
      className="group flex flex-col overflow-hidden rounded-[14px] border border-border bg-card transition-colors duration-[120ms] hover:bg-accent"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img>(北极星约定) */}
        <img src={c.hero} alt={c.name} className="size-full object-cover" />
        <span className="absolute top-2 left-2">
          <Badge variant={badge.variant} className="bg-card/90 backdrop-blur">
            {badge.label}
          </Badge>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-sm font-semibold text-foreground">{c.name}</p>
        <p className="line-clamp-2 text-xs leading-[1.45] text-muted-foreground">{c.goal}</p>
        <div className="mt-auto pt-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-muted-foreground">{c.goalProgress.label}</span>
            <span className="font-mono text-[11px] text-foreground tabular-nums">
              {c.goalProgress.current}/{c.goalProgress.target}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${c.status === "DONE" ? "bg-success-soft-foreground/70" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

export function ImmersiveHome() {
  const immersive = useImmersive();
  useStore(); // 订阅共享 store:排期 / 审批 / 事件变化即时反映到本屏

  // GM 里程碑(GM-05):店主本会话第一次批准 campaign 帖 → 一次性庆祝 toast(克制,跨页只放一次)。
  const campaignLaunched = recentEvents(50).some((e) => e.type === "campaign_entry_approved");
  React.useEffect(() => {
    if (campaignLaunched && !hasMilestone("first-campaign")) {
      markMilestone("first-campaign");
      toast("Your first campaign is live", {
        icon: <PartyPopper className="size-4 text-brand" strokeWidth={2} />,
        description: "Otto will keep the posts moving. You can watch it in the campaign calendar.",
      });
    }
  }, [campaignLaunched]);

  // 「进行中的事」= D1 唯一「事」容器,三状态,进行中优先。
  const campaigns = React.useMemo(
    () => [...NS_CAMPAIGNS].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [],
  );
  // running 只数真正在跑的(ACTIVE);DRAFT(提案还没批)单独标,别把没上线的算进「进行中」。
  const runningCount = campaigns.filter((c) => c.status === "ACTIVE").length;
  const draftCount = campaigns.filter((c) => c.status === "DRAFT").length;

  // Studio recents(D1 自由创作台):不挂 campaign 的随手创作,最新在前,真图网格。
  const studioRecents = React.useMemo(
    () =>
      NS_ASSETS.filter((a) => a.status === "ready" && !a.campaignId)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 8),
    [],
  );

  // ── 生意状态:本周真成交(诚实读收件箱里被确认的订单,不是花掉的 credit) ──
  const orders = ordersThisWeek();
  // Reach 卡与分析区同源(NS_ANALYTICS.kpis[0]),避免同屏「招呼条 18% vs 卡片 9%」一店两数。
  const reachKpi = NS_ANALYTICS.kpis[0];

  // ── 今日决策队列「Needs you」:等店主回 + 大客户静默 ──
  //   头部「in play」合计与每行 stake 只用【前瞻在险值】:回这一句近期真能进账多少。
  //   已经赚过的生涯总额(totalOrdersMyr)绝不冒充待回款——它只用来给大客户回流【排序】置顶
  //   (排序 ≠ 合计),并作已标注的历史上下文出现在理由行,不注水「in play」。
  const triage = React.useMemo<TriageRow[]>(() => {
    const byContact = new Map<string, TriageRow>();
    // ① 等店主回 / 超时的对话 → 回复行(现场在收件箱,深链到那条等回的对话)。
    //   前瞻在险值:活跃客 = 预计下一单(predictedNextMyr);静默客该字段归零 → 退化到均单价
    //   = 复购潜力(与 crm-data.predictedNext / crm-segments 同模型,同一客户全城不再两数)。
    for (const cv of needsOwnerConversations()) {
      const c = CONTACT_BY_ID.get(cv.contactId);
      const reengagingWhale = !!c && c.lifecycle === "dormant" && c.totalOrdersMyr >= 1000;
      // 前瞻在险值(唯一进合计的数):刻意保守,只认「下一单」,绝不外推到整段生涯。
      const forwardStake = c?.predictedNextMyr || avgOrderValue(cv.contactId) || 0;
      byContact.set(cv.contactId, {
        key: cv.id,
        name: c?.name ?? "A customer",
        // 大客户亲自回到线上 = 整段关系在重启;把生涯往来 + 单数作为已标注的历史锚点
        //   (清楚是 lifetime,不是即将进账),既解释「为何排第一」又不冒充待回款。
        reason:
          reengagingWhale && c
            ? `Biggest account back online · RM${c.totalOrdersMyr.toLocaleString("en-MY")} lifetime · ${c.orderCount ?? 0} orders`
            : cv.subject,
        wait: humanWait(cv.waitingFor),
        stakeMyr: forwardStake,
        // 排序权重:大客户回流用生涯额置顶(reviewer 许可);其余按前瞻额。只排序,不进合计、不展示。
        rankMyr: reengagingWhale && c ? c.totalOrdersMyr : forwardStake,
        href: `${BASE}/inbox/conversation?id=${cv.id}`,
        action: "reply",
      });
    }
    // ② 静默的大客户但没有在途对话 → 唤回行(现场在 CRM 档案,冷启动一条 nudge)。
    //   stake = 预计下一单(前瞻;不是生涯总额 —— 那笔钱已经赚过了,拿来当"即将进账"会注水)。
    //   已经作为回复行浮现的(客户已亲自回到线上)不再重复成冷唤回:reply 覆盖 winback。
    for (const c of dormantHighValue(1000)) {
      if (byContact.has(c.id)) continue;
      const forwardStake = c.predictedNextMyr || avgOrderValue(c.id) || 0;
      byContact.set(c.id, {
        key: `winback-${c.id}`,
        name: c.name,
        reason: c.note ?? "Big account gone quiet",
        wait: "gone quiet, worth a nudge",
        stakeMyr: forwardStake,
        rankMyr: forwardStake,
        href: `${BASE}/crm/contact-profile?id=${c.id}`,
        action: "winback",
      });
    }
    // 活跃回复(有人正等,时间敏感)排在冷唤回(投机)之上;同组内按优先级权重 rankMyr 降序
    //   (大客户回流因生涯额置顶,但它的展示 stake / 头部合计仍只是前瞻额)。取前 5 条。
    return [...byContact.values()]
      .sort((a, b) => (a.action !== b.action ? (a.action === "reply" ? -1 : 1) : b.rankMyr - a.rankMyr))
      .slice(0, 5);
  }, []);
  // 头部「in play」= 前瞻在险额之和(每行 stakeMyr 都是前瞻额,生涯总额不在其中)。
  const triageTotal = triage.reduce((s, r) => s + r.stakeMyr, 0);

  // Up next 读 store 的排期(scheduled + draft),不再直接读 _mock 静态数组。
  const queued = upNext();
  const nextPosts = queued.slice(0, 4);
  const approvals = pendingApprovals();

  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 pt-6 pb-24">
      <PageHeader
        title={`Morning, ${NS_BRAND.owner.split(" ")[0]}`}
        subtitle={`${NS_BRAND.name} · ${NS_BRAND.city}`}
        actions={
          <Button asChild size="sm">
            <Link href={`${BASE}/create/canvas`}>
              Create
              <ArrowRight />
            </Link>
          </Button>
        }
      />

      {/* Otto 招呼条:本屏唯一 coral statement;洞察锚在真实存在的信号 —— 那条 Sunday croissant
          reel 的本周触达(_mock 的 NS_ANALYTICS.insight + Otto 单流 os-53:12.4K reach、本周最佳)。
          mock 里没有帖级「订单 DM」归因数据,故不编一个查不到的业务结果;宁可诚实报可核对的触达。 */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-brand-soft bg-brand-soft/50 px-4 py-3.5">
        <OttoAvatar size={32} mood="helpful" />
        <span className="min-w-0 flex-1 basis-64 text-sm leading-[1.45] text-brand-soft-foreground">
          Your Sunday croissant reel was your top post this week — 12.4K reach. Want two more in the same style?
        </span>
        <Button
          variant="brand"
          size="sm"
          className="ns-pressable"
          onClick={() => immersive?.openOtto("Line up two more reels in the style of my top Sunday croissant reel — it hit 12.4K reach this week")}
        >
          <Sparkles />
          Ask Otto
        </Button>
      </div>

      {/* ── 生意状态:营收头卡 → 触达 → FIKIRTIVE credits(明标、降为次要) ── */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href={`${BASE}/inbox/shared`} className="rounded-[14px] focus-visible:outline-2 focus-visible:outline-ring">
          <StatCard
            label="Orders this week"
            value={`RM${orders.revenueMyr.toLocaleString("en-MY")}`}
            delta={{
              dir: "flat",
              text: orders.orderCount === 1 ? "1 confirmed in the inbox" : `${orders.orderCount} confirmed in the inbox`,
            }}
          />
        </Link>
        <Link href={`${BASE}/analytics/overview`} className="rounded-[14px] focus-visible:outline-2 focus-visible:outline-ring">
          <StatCard label="People reached · 28 days" value={reachKpi.value} delta={reachKpi.delta} />
        </Link>
        <Link href={`${BASE}/account/credits`} className="rounded-[14px] focus-visible:outline-2 focus-visible:outline-ring">
          <StatCard label="FIKIRTIVE credits" value={balance().toLocaleString("en-MY")} delta={{ dir: "flat", text: "Tap to top up" }} />
        </Link>
      </div>

      {/* ── 今日决策队列「Needs you」:回一句就变钱,按在险金额排,深链现场(蓝=人手声部) ── */}
      {triage.length > 0 && (
        <>
          <div className="mt-8 flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-foreground">Needs you</h2>
            <span className="text-xs text-muted-foreground">reply and it turns into money</span>
            <span className="ml-auto font-mono text-[11px] text-foreground tabular-nums">
              RM{triageTotal.toLocaleString("en-MY")} in play
            </span>
          </div>
          <div className="mt-3 overflow-hidden rounded-[14px] border border-border bg-card">
            {triage.map((r, i) => (
              <Link
                key={r.key}
                href={r.href}
                className={`flex items-center gap-3 px-4 py-3 transition-colors duration-[120ms] hover:bg-accent ${i > 0 ? "border-t border-border" : ""}`}
              >
                <span className="w-16 shrink-0 font-mono text-[13px] font-semibold text-foreground tabular-nums">
                  RM{r.stakeMyr.toLocaleString("en-MY")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{r.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock className="size-3 shrink-0" strokeWidth={2} />
                    <span className="truncate">
                      {r.reason} · {r.wait}
                    </span>
                  </span>
                </span>
                <span className="ns-human-soft inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold">
                  {r.action === "winback" ? (
                    <RotateCcw className="size-3" strokeWidth={2} />
                  ) : (
                    <Reply className="size-3" strokeWidth={2} />
                  )}
                  {r.action === "winback" ? "Win back" : "Reply"}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ── 进行中的事(D1:Campaign = 唯一「事」容器;为它发生的一切自动长在它身上) ── */}
      <div className="mt-8 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">In progress</h2>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {runningCount} running{draftCount > 0 ? ` · ${draftCount} draft` : ""}
        </span>
        <Link href={`${BASE}/campaign/list`} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">
          All campaigns
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {campaigns.map((c) => (
          <CampaignCard key={c.id} c={c} />
        ))}
      </div>

      {/* ── Studio recents(D1:自由创作台;随手做的东西,零整理压力) ── */}
      <div className="mt-8 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">Studio recents</h2>
        <Link href={`${BASE}/create/canvas`} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">
          Open studio
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {studioRecents.map((a) => (
          <Link
            key={a.id}
            href={`${BASE}/create/asset-viewer?asset=${a.id}`}
            className="group overflow-hidden rounded-[14px] border border-border bg-card transition-colors duration-[120ms] hover:bg-accent"
          >
            <div className="relative aspect-square w-full overflow-hidden bg-secondary">
              {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img>(北极星约定) */}
              <img src={a.thumb} alt={a.title} className="size-full object-cover" />
              {a.kind === "video" && (
                <span className="absolute right-1.5 bottom-1.5 flex size-5 items-center justify-center rounded-full bg-card/85">
                  <Play className="size-3 text-foreground" strokeWidth={2} fill="currentColor" />
                </span>
              )}
              {a.byOtto && (
                <span className="absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-card/90">
                  <OttoAvatar size={14} mood="idle" />
                </span>
              )}
            </div>
            <div className="p-2.5">
              <p className="truncate text-xs font-medium text-foreground">{a.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground capitalize">{a.kind}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Up next(排期即将发出的;每行 → composer 深链) ── */}
      <div className="mt-8 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">Up next</h2>
        {approvals.length > 0 ? (
          <Badge variant="warning">{approvals.length} awaiting approval</Badge>
        ) : (
          <Badge variant="success">{NS_CAMPAIGN.name} · all approved</Badge>
        )}
        <Link href={`${BASE}/schedule/queue`} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">
          Open queue
        </Link>
      </div>
      <div className="mt-3 overflow-hidden rounded-[14px] border border-border bg-card">
        {nextPosts.length === 0 ? (
          <Link
            href={`${BASE}/schedule/composer`}
            className="flex items-center gap-3 px-4 py-4 text-[13px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent"
          >
            Nothing queued yet — schedule your first post
            <ArrowRight className="ml-auto size-4 shrink-0" strokeWidth={2} />
          </Link>
        ) : (
          nextPosts.map((p, i) => (
            <Link
              key={p.id}
              href={`${BASE}/schedule/composer?post=${p.id}`}
              className={`flex items-center gap-3 px-4 py-3 transition-colors duration-[120ms] hover:bg-accent ${i > 0 ? "border-t border-border" : ""}`}
            >
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{whenLabel(p.scheduledAt)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{p.caption}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground capitalize">{p.platform}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
