"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  ArrowUpRight,
  CalendarRange,
  ChevronRight,
  Database,
  PanelsTopLeft,
  RefreshCw,
  Settings2,
  Target,
} from "lucide-react";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { canvasHref } from "@/components/canvas/canvas-href";
import { Badge } from "@/design-system/primitives/badge";
import { Button, buttonVariants } from "@/design-system/primitives/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/design-system/primitives/empty";
import { toast } from "@/design-system/primitives/toast";
import { cn } from "@/lib/utils";
import { homeHref, type MarketingHealthReadModel } from "@/lib/home-marketing-health";
import { homeAnalysisHref } from "@/lib/home-analysis-context";
import { saveHomeLayout } from "@/lib/home-layout-actions";
import { DesktopHomeRequired, useDesktopHome } from "@/design-system/patterns/founder-home/DesktopHomeBoundary";
import {
  HOME_COMPARISONS,
  HOME_GOALS,
  HOME_RANGES,
  type HomeComparison,
  type HomeComponentId,
  type HomeGoal,
  type HomeRange,
} from "@/design-system/patterns/founder-home/model";
import type { HomeSearchState } from "@/lib/home-marketing-health";
import { CustomizeHomePanel } from "./CustomizeHomePanel";
import { HomeFilterPicker } from "./HomeFilterPicker";
import { MARKETING_HOME_COPY } from "./marketing-home-copy";
import { ReadyMarketingHealth } from "./ReadyMarketingHealth";

export type HomeRecentCanvas = {
  id: string;
  name: string;
  updatedLabel: string;
};

export type HomeRecentCanvasRead =
  | { ok: true; value: HomeRecentCanvas[] }
  | { ok: false };

function ContinueCreating({ recents }: { recents: HomeRecentCanvasRead }) {
  return (
    <section aria-labelledby="continue-creating-heading" className="border-b border-border py-3">
      <div className="flex min-h-11 items-center gap-3">
        <div className="mr-1 min-w-0">
          <h2 id="continue-creating-heading" className="text-xs font-semibold">
            {MARKETING_HOME_COPY.recentsTitle}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {MARKETING_HOME_COPY.recentsDescription}
          </p>
        </div>
        {!recents.ok ? (
          <p role="status" className="text-xs text-muted-foreground">
            {MARKETING_HOME_COPY.recentsUnreadable}
          </p>
        ) : (
          recents.value.slice(0, 2).map((canvas) => (
            <Link
              key={canvas.id}
              href={canvasHref(canvas.id)}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "max-w-48")}
              title={`${canvas.name} · ${canvas.updatedLabel}`}
            >
              <PanelsTopLeft aria-hidden />
              <span className="truncate">{canvas.name}</span>
            </Link>
          ))
        )}
        <Link
          href={SHELL_ROUTES.create}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto shrink-0")}
        >
          Create something new <ChevronRight aria-hidden />
        </Link>
      </div>
    </section>
  );
}

/**
 * 一条恢复动作只有两种形状:**去别处**(一条真链接)或**再读一次这一页**(一颗真按钮)。
 * 没有第三种,也没有「看起来像动作、其实什么都不做」的那一种(裁决九)。
 */
type RecoveryContent = {
  title: string;
  description: string;
  action: string;
  icon: ReactNode;
} & ({ href: string; retry?: false } | { retry: true; href?: undefined });

function RecoveryState({
  health,
  filters,
  onRetry,
  retrying,
  retryFailed,
}: {
  health: MarketingHealthReadModel;
  filters: HomeSearchState;
  onRetry: () => void;
  retrying: boolean;
  /** 已经重试过一次、服务器仍然读不出来。首屏为 false —— 没试过就没有「仍然」。 */
  retryFailed: boolean;
}) {
  if (health.state === "partial" || health.state === "ready") return null;

  const content: RecoveryContent = health.state === "not-configured"
    ? health.action === "reconnect"
      ? {
          title: MARKETING_HOME_COPY.reconnectTitle,
          description: MARKETING_HOME_COPY.reconnectDescription,
          action: "Reconnect Meta ads",
          href: SHELL_ROUTES.connections,
          icon: <Database />,
        }
      : health.action === "connect-ad-account"
      ? {
          // 连上了,但这个 Meta 登录名下没有广告账号。同一扇门,不同的话:要他接一个
          // 投广告的账号,而不是「换 90 天」(判官 2026-09-05 P1-1)。
          title: MARKETING_HOME_COPY.noAdAccountsTitle,
          description: MARKETING_HOME_COPY.noAdAccountsDescription,
          action: "Manage connections",
          href: SHELL_ROUTES.connections,
          icon: <Database />,
        }
      : {
          title: MARKETING_HOME_COPY.notConfiguredTitle,
          description: MARKETING_HOME_COPY.notConfiguredDescription,
          action: "Manage connections",
          href: SHELL_ROUTES.connections,
          icon: <Database />,
        }
    : health.state === "insufficient"
      ? {
          title: MARKETING_HOME_COPY.insufficientTitle,
          description: MARKETING_HOME_COPY.insufficientDescription,
          action: filters.range === "90-days" ? "Manage connections" : "Use last 90 days",
          href: filters.range === "90-days"
            ? SHELL_ROUTES.connections
            : homeHref({ ...filters, range: "90-days" }),
          icon: <Database />,
        }
      : {
          title: MARKETING_HOME_COPY.unavailableTitle,
          description: MARKETING_HOME_COPY.unavailableDescription,
          action: "Retry",
          /**
           * Retry 现在是一颗**真按钮**,按下去调 `router.refresh()` —— 服务器重跑这一页的
           * RSC,`getAnalytics()` 因此真的再读一次 Meta。
           *
           * 它以前是一条指回**同一个地址**的链接,而「同一个地址也会重取」靠的是两条
           * 框架行为:Next 对 same-page 导航的特判,加上 dynamic 段路由缓存默认不留存
           * (`staleTimes.dynamic` 默认 0)。两条都不是我们自己的保证,升级 Next 就可能
           * 静默失效,商家按下去看到的还是同一份读不出来的旧结果(判官 2026-09-05 P2-1)。
           * 改成按钮之后这句保证收回自己手里,并且有围栏测试真按一下守着
           * (`lib/__tests__/home-honesty-l3.test.tsx`,FRONT-A3)。
           */
          retry: true,
          icon: <RefreshCw />,
        };

  return (
    <Empty className="min-h-[420px] border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">{content.icon}</EmptyMedia>
        <EmptyTitle>{content.title}</EmptyTitle>
        <EmptyDescription>{content.description}</EmptyDescription>
      </EmptyHeader>
      {content.retry ? (
        <>
          <Button type="button" size="sm" onClick={onRetry} disabled={retrying}>
            {retrying ? "Retrying…" : content.action}
          </Button>
          {/*
            重试失败的唯一反馈。live region 从一开始就在 DOM 里(空的),句子后填 —— 与内容
            同时插入的 live region 读屏常常读不到。首屏没有句子,所以商家看不到多余的话。
          */}
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {retryFailed ? MARKETING_HOME_COPY.retryStillUnavailable : ""}
          </p>
        </>
      ) : (
        <Link href={content.href} className={buttonVariants({ size: "sm" })}>
          {content.action}
        </Link>
      )}
    </Empty>
  );
}

function PartialMarketingHealth({
  health,
  filters,
}: {
  health: Extract<MarketingHealthReadModel, { state: "partial" }>;
  filters: HomeSearchState;
}) {
  const chartSummary = health.chart?.points.length
    ? `${health.source.label} reported ${health.chart.points.length} daily data points in this period.`
    : `${health.source.label} reported metrics without a daily trend for this period.`;

  return (
    <div>
      <section aria-labelledby="marketing-health-heading" className="border-b border-border pb-6 pt-5">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="marketing-health-heading" tabIndex={-1} className="text-lg font-semibold tracking-[-0.02em] outline-none">
                <Link
                  href={homeAnalysisHref({
                    type: "performance-change",
                    subject: "meta-ads-overview",
                    ...filters,
                    originRange: filters.range,
                    originComparison: filters.comparison,
                    returnFocus: "marketing-health-heading",
                  })}
                  className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  {MARKETING_HOME_COPY.partialTitle}
                </Link>
              </h2>
              <Badge variant="outline">{MARKETING_HOME_COPY.partialLabel}</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              {health.insight?.text ?? MARKETING_HOME_COPY.partialDescription}
            </p>
          </div>
          <Link
            href={SHELL_ROUTES.connections}
            className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <Database className="size-3.5" aria-hidden /> {health.source.label}
            {/* 「数到哪一天」只在真有那一天时说。拿不到日序列时这里过去写的是
                「Freshness unavailable」—— 一句占着 provenance 位置、却什么也没告诉商家的
                话;按裁决九「无契约的控件不出现」,没有真时间戳就不摆这一栏。 */}
            {health.freshness.status === "known" ? ` · ${health.freshness.label}` : null}
          </Link>
        </div>

        <div className="mt-7 grid grid-cols-[220px_minmax(0,1fr)] items-end gap-8">
          <div className="grid gap-5">
            {health.metrics.map((metric) => (
              <div key={metric.label}>
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <div className="mt-1.5 space-y-1">
                  {metric.values.map((value, index) => (
                    <p key={`${metric.label}-${index}`} className="text-xl font-semibold tabular-nums">
                      {value.text}
                      {value.accountName ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{value.accountName}</span>
                      ) : null}
                    </p>
                  ))}
                </div>
                {metric.delta ? <p className="mt-1 text-xs text-muted-foreground">{metric.delta.text} within this period</p> : null}
              </div>
            ))}
          </div>
          {health.chart ? (
            <div className="min-w-0">
              <svg
                viewBox="0 0 820 180"
                className="h-[180px] w-full overflow-visible"
                role="img"
                aria-labelledby="meta-trend-title meta-trend-description"
              >
                <title id="meta-trend-title">Meta ads performance trend</title>
                <desc id="meta-trend-description">{chartSummary}</desc>
                <path d={health.chart.areaPath} fill="var(--info)" fillOpacity="0.08" />
                <path d={health.chart.linePath} fill="none" stroke="var(--info)" strokeWidth="2" />
              </svg>
            </div>
          ) : (
            <p className="pb-8 text-sm text-muted-foreground">No daily trend is available for this period.</p>
          )}
        </div>
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 py-5" aria-labelledby="complete-home-heading">
        <div>
          <h2 id="complete-home-heading" className="text-sm font-semibold">Complete your marketing health view</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{MARKETING_HOME_COPY.partialDescription}</p>
        </div>
        <Link href={SHELL_ROUTES.connections} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Manage connections
        </Link>
      </section>
    </div>
  );
}

/**
 * 一块 Home 组件的渲染。`marketing-health` 是今天唯一有真实生产者的一块,而它的五态
 * (未连接/需重连/数据不足/partial/读不出来)全部来自服务器 —— 所以「这一块」在不同状态下
 * 长得不一样,但从来不是一张编出来的卡。其余 7 块没有生产者,连进不进 `components` 都轮不到
 * 这里判(`lib/home-layout.ts` 在服务端就把它们过滤掉了),所以这里没有它们的分支。
 */
/** 占满整行的那几块 —— 逐字照设计夹具的 `FULL_WIDTH_COMPONENTS`。 */
const FULL_WIDTH_HOME_COMPONENTS = new Set<HomeComponentId>(["marketing-health", "efficiency"]);

function HomeComponentBlock({
  id,
  health,
  filters,
  onRetry,
  retrying,
  retryFailed,
}: {
  id: HomeComponentId;
  health: MarketingHealthReadModel;
  filters: HomeSearchState;
  onRetry: () => void;
  retrying: boolean;
  retryFailed: boolean;
}) {
  if (id !== "marketing-health") return null;
  return (
    <>
      <RecoveryState health={health} filters={filters} onRetry={onRetry} retrying={retrying} retryFailed={retryFailed} />
      {health.state === "partial" ? <PartialMarketingHealth health={health} filters={filters} /> : null}
      {health.state === "ready" ? <ReadyMarketingHealth health={health} filters={filters} /> : null}
    </>
  );
}

export function MarketingHomeView({
  filters,
  health,
  recents,
  components,
  offeredComponents,
  recommendedComponents,
  canManageHome,
}: {
  filters: HomeSearchState;
  health: MarketingHealthReadModel;
  recents: HomeRecentCanvasRead;
  /**
   * 服务端算好的版面 —— 这一刻 Home 上有哪几块、按什么顺序(`lib/home-layout.ts` 的
   * `resolveHomeComponents`)。客户端只渲染,不再自己判断哪块该出现:那份判断在服务端
   * 只有一个产地,刷新、换浏览器、换设备读到的都是同一个答案(规格 §7.3⑤「一份版面定义单源」)。
   */
  components: readonly HomeComponentId[];
  /** Customize 面板列得出来的全部组件 —— 有真实生产者的那些。 */
  offeredComponents: readonly HomeComponentId[];
  /** 当前 business goal 的推荐版面(已按生产者过滤)—— Reset 恢复的就是它。 */
  recommendedComponents: readonly HomeComponentId[];
  /** 有没有 `workspace.manage_home` 能力。没有就连入口都不出现(FRONT-A4)。 */
  canManageHome: boolean;
}) {
  const router = useRouter();
  const isDesktop = useDesktopHome();
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState<HomeComponentId[]>([...components]);
  const [saving, startSaving] = useTransition();
  /**
   * Retry 的重取。`router.refresh()` 让服务器重跑这一页的 RSC —— `HomeEntry` 因此重新
   * `getAnalytics()`,真的再问一次 Meta。放在 transition 里,是为了让按钮在这段等待里
   * 说得出「正在重试」,而不是按下去看着没反应。
   */
  const [retrying, startRetry] = useTransition();
  /**
   * 按过一次 Retry 没有?按过、而且这一轮已经跑完,屏幕上却还是同一屏读不出来 ——
   * 那就说一句实话,而不是让商家对着逐字相同的画面猜自己按没按到(判官 2026-09-05 P2-3)。
   * 重试成功时服务器给的是 partial/ready,`RecoveryState` 整块不出现,这一句自然也不出现。
   */
  const [retryAttempted, setRetryAttempted] = useState(false);
  const retry = () => {
    setRetryAttempted(true);
    startRetry(() => router.refresh());
  };
  /**
   * 读回来了就把这颗记号清掉(判官 2026-09-05 #1216 P2-2)。
   *
   * 它从前只置真、不复位,而这一层在一程里活得比一屏久:商家按 Retry 读回来了(partial/
   * ready),接着换个 range 或 comparison 再读,这一次服务器又读不出来 —— 商家一根手指
   * 都没碰 Retry,屏幕却先说「Still unavailable」。那一句的意思是「你刚按过的那一次仍然
   * 没读出来」,不是「这一屏读不出来」;服务器给出数据的那一刻,上一次重试的故事就结束了。
   *
   * 复位写在渲染里而不是 effect 里(React 官方的「prop 变了就调整 state」那一条):effect
   * 会多渲一拍,而且 `react-hooks/set-state-in-effect` 直接判红。这里只在 partial/ready 与
   * 「读不出来」之间**真的翻面**的那一次改 state,同一屏重渲染零动作。
   */
  const healthRecovered = health.state === "partial" || health.state === "ready";
  const [lastRecovered, setLastRecovered] = useState(healthRecovered);
  if (healthRecovered !== lastRecovered) {
    setLastRecovered(healthRecovered);
    if (healthRecovered) setRetryAttempted(false);
  }

  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }, []);

  function replaceFilter(patch: Partial<HomeSearchState>) {
    router.push(homeHref({ ...filters, ...patch }), { scroll: false });
  }

  function startCustomizing() {
    setDraft([...components]);
    setCustomizing(true);
  }

  function cancelCustomizing() {
    setDraft([...components]);
    setCustomizing(false);
  }

  function toggleComponent(id: HomeComponentId, checked: boolean) {
    setDraft((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  }

  function moveComponent(id: HomeComponentId, direction: -1 | 1) {
    setDraft((current) => {
      const from = current.indexOf(id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });
  }

  function reorderComponent(fromId: HomeComponentId, toId: HomeComponentId) {
    setDraft((current) => {
      const from = current.indexOf(fromId);
      const to = current.indexOf(toId);
      if (from < 0 || to < 0 || from === to) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }

  /**
   * Save 之后**不乐观更新**:服务端 `revalidatePath("/")` 会把新的 `components` 推回来。
   * 界面上「版面已经变了」这句话,必须由那一行真的落库之后的服务端渲染来说 —— 先改本地
   * state 再等结果,就是用浏览器状态冒充持久化(规格 §1 九问 3 明禁)。写失败就说写失败,
   * 面板留在原地,商家的草稿不丢。
   */
  function saveDraft() {
    startSaving(async () => {
      const result = await saveHomeLayout([...draft]);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCustomizing(false);
      toast.success("Home saved");
      router.refresh();
    });
  }

  if (!isDesktop) return <DesktopHomeRequired />;

  return (
    <div className="flex min-h-full">
      <main id="home-main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        <div className="mx-auto w-full max-w-[1220px] px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl font-semibold tracking-[-0.035em]">Home</h1>
            {canManageHome ? (
              customizing ? (
                <span className="text-xs font-medium text-muted-foreground">Previewing unsaved changes</span>
              ) : (
                <Button type="button" variant="secondary" size="sm" onClick={startCustomizing}>
                  <Settings2 aria-hidden /> Customize home
                </Button>
              )
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1 border-b border-border pb-4">
            <HomeFilterPicker label="Business goal" icon={Target} value={filters.goal} options={HOME_GOALS} disabled={customizing} onValueChange={(value) => replaceFilter({ goal: value as HomeGoal })} />
            <HomeFilterPicker label="Date range" icon={CalendarRange} value={filters.range} options={HOME_RANGES} disabled={customizing} onValueChange={(value) => replaceFilter({ range: value as HomeRange })} />
            {/* Comparison 只在 `ready` 版面出现 —— 今天唯一读得懂它的是多来源 aggregate
                的对比栏(`ReadyMarketingHealth` 的 `dashboard.comparison`)。partial 单源
                版面里没有任何东西消费它:`HomeEntry` 只按 `range` 去读 Meta,换个对比口径
                页面上一个数字都不会变。摆着它就是摆一颗点了没反应的控件(裁决九)。
                URL 里那一段照旧解析与保留 —— 深链、Analysis 的 originComparison 回程都还
                认它,只是没有真消费者时不给一颗控件。 */}
            {health.state === "ready" ? (
              <HomeFilterPicker label="Comparison" icon={ArrowUpRight} value={filters.comparison} options={HOME_COMPARISONS} disabled={customizing} onValueChange={(value) => replaceFilter({ comparison: value as HomeComparison })} />
            ) : null}
          </div>

          {customizing ? null : <ContinueCreating recents={recents} />}

          {/* 网格与整宽规则逐字照设计夹具(FounderHomeReference 的 data-founder-home-components):
              今天只有一块、而且它是整宽的,所以看不出差别 —— 但等第二块点亮时,版式已经在位,
              不必再回来改一次布局。 */}
          {(customizing ? draft : components).length ? (
            <div
              data-founder-home-components
              className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))] gap-x-8"
            >
              {(customizing ? draft : components).map((id) => (
                <div
                  key={id}
                  data-home-component={id}
                  className={cn("min-w-0", FULL_WIDTH_HOME_COMPONENTS.has(id) && "col-span-full")}
                >
                  <HomeComponentBlock
                    id={id}
                    health={health}
                    filters={filters}
                    onRetry={retry}
                    retrying={retrying}
                    retryFailed={retryAttempted && !retrying}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty className="mt-8 min-h-80 border border-border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Settings2 /></EmptyMedia>
                <EmptyTitle>Choose what belongs on Home</EmptyTitle>
                <EmptyDescription>Add components from the library to build this workspace Home.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </main>
      {customizing ? (
        <CustomizeHomePanel
          selected={draft}
          offered={offeredComponents}
          saving={saving}
          onToggle={toggleComponent}
          onMove={moveComponent}
          onReorder={reorderComponent}
          onCancel={cancelCustomizing}
          onReset={() => setDraft([...recommendedComponents])}
          onSave={saveDraft}
        />
      ) : null}
    </div>
  );
}
