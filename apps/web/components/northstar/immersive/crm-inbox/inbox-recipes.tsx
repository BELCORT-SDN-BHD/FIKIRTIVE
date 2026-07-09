"use client";

/**
 * 生命周期配方 —— 选一个「欢迎新客」这样的配方点开关就上线,默认文案配好。Klaviyo flows
 * 的本地化原型:可读文件 + 开关,不进拖拽画布。启用配方不花钱,真花的每一步仍走审批。
 *
 * [wave-b] 预建生命周期配方库(欢迎/弃购/购后/挽回/到货/降价)
 * [wave-b] 触发数据源接入(订单/行为事件 —— Shopee/Lazada/TikTok Shop)
 * [wave-b] 发送时刻/频率优化(静默时段 + 每周上限)· A/B 测试 + 自动放量
 * [wave-b] 流程健康监控/异常报警 · 客户打分(热/温/冷)· 同行对标 Benchmark
 * [wave-b] 邮件通道 · Reviews 轻量版 · 产品推荐(购后插荐购)· 客户自助门户(最轻)
 *
 * 血管:配方/数据源/发送设置全部读写共享 store,启停即刻反映;coral 只属于 Otto。
 */

import * as React from "react";
import Link from "next/link";
import { Activity, Award, BarChart3, Coins, Database, Gauge, Mail, Sparkles, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, InboxNav, Card } from "./kit";
import { SectionTitle } from "../_kit";
import {
  RECIPES,
  DATA_SOURCES,
  LEAD_SCORE_RULES,
  INBOX_BENCHMARKS,
} from "./lifecycle-data";
import {
  useStore,
  isRecipeOn,
  toggleRecipe,
  isDataSourceConnected,
  connectDataSource,
  recipeSendSettings,
  setWeeklyCap,
  toggleAbTest,
  isEmailChannelOn,
  toggleEmailChannel,
  isReviewsOn,
  toggleReviews,
  ottoBehavior,
  setOttoBehavior,
} from "../_store";

export function InboxRecipes() {
  useStore();
  const send = recipeSendSettings();
  const behavior = ottoBehavior();
  const quiet = behavior.quietHours;

  const activeRecipes = RECIPES.filter((r) => isRecipeOn(r.id, r.defaultOn)).length;
  const connectedSources = DATA_SOURCES.filter((d) => isDataSourceConnected(d.id, d.connected)).length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Lifecycle recipes"
        subtitle="Set-and-forget flows that message the right customer at the right moment."
        actions={<InboxNav />}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Recipes on" value={String(activeRecipes)} />
        <StatCard label="Data sources" value={`${connectedSources}/${DATA_SOURCES.length}`} />
        <StatCard label="Weekly cap" value={`${send.weeklyCap}/wk`} />
      </div>

      {/* [wave-b] 配方库 */}
      <div className="mt-8 flex flex-col gap-3">
        {RECIPES.map((r) => {
          const on = isRecipeOn(r.id, r.defaultOn);
          const needsData = r.needsData && connectedSources <= 1;
          return (
            <Card key={r.id} className="overflow-hidden">
              <div className="flex items-start gap-3 px-4 py-3.5">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary">
                  <Sparkles className="size-4 text-muted-foreground" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{r.name}</p>
                    <Badge variant="outline">{r.category}</Badge>
                    {needsData && <Badge variant="warning">Needs order data</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">When: {r.trigger}</p>
                  <ol className="mt-2 flex flex-col gap-1">
                    {r.steps.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] leading-[18px] text-muted-foreground">
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground">{i + 1}</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                  {on && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                      <Activity className="size-3.5" strokeWidth={2} />
                      Healthy · Otto is watching this flow for drop-offs
                    </div>
                  )}
                </div>
                <Switch
                  checked={on}
                  disabled={needsData}
                  onCheckedChange={(v) => toggleRecipe(r.id, v)}
                  aria-label={`Turn ${r.name} on or off`}
                />
              </div>
            </Card>
          );
        })}
      </div>

      {/* [wave-b] 发送时刻 / 频率 + A/B */}
      <div className="mt-8">
        <SectionTitle>Timing &amp; testing</SectionTitle>
        <Card className="mt-3 overflow-hidden">
          <div className="flex items-center gap-4 border-t border-border px-4 py-3.5 first:border-t-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Quiet hours</p>
              <p className="mt-0.5 text-xs text-muted-foreground">No promo messages go out during these hours.</p>
            </div>
            <div className="flex items-center gap-2">
              <Input type="time" value={quiet.from} onChange={(e) => setOttoBehavior({ quietHours: { ...quiet, from: e.target.value } })} className="h-9 w-[120px]" disabled={!quiet.enabled} />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="time" value={quiet.to} onChange={(e) => setOttoBehavior({ quietHours: { ...quiet, to: e.target.value } })} className="h-9 w-[120px]" disabled={!quiet.enabled} />
              <Switch checked={quiet.enabled} onCheckedChange={(v) => setOttoBehavior({ quietHours: { ...quiet, enabled: v } })} aria-label="Quiet hours on or off" />
            </div>
          </div>
          <div className="flex items-center gap-4 border-t border-border px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Weekly message cap</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Never send the same customer more than this many messages a week.</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setWeeklyCap(send.weeklyCap - 1)}>−</Button>
              <span className="w-6 text-center text-sm font-semibold tabular-nums text-foreground">{send.weeklyCap}</span>
              <Button size="sm" variant="secondary" onClick={() => setWeeklyCap(send.weeklyCap + 1)}>+</Button>
            </div>
          </div>
          <div className="flex items-center gap-4 border-t border-border px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">A/B test &amp; auto-scale to the winner</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Send two versions to a slice; the rest gets whichever wins.</p>
            </div>
            <Switch checked={send.abTest} onCheckedChange={toggleAbTest} aria-label="A/B testing on or off" />
          </div>
        </Card>
      </div>

      {/* [wave-b] 触发数据源接入 */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" strokeWidth={2} />
          <SectionTitle>Order data sources</SectionTitle>
        </div>
        <Card className="overflow-hidden">
          {DATA_SOURCES.map((d) => {
            const connected = isDataSourceConnected(d.id, d.connected);
            return (
              <div key={d.id} className="flex items-center gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{d.name}</p>
                    {connected && <Badge variant="success">Connected</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d.note}</p>
                </div>
                {connected ? (
                  <span className="text-[11px] font-semibold text-muted-foreground">Syncing</span>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => connectDataSource(d.id)}>Connect</Button>
                )}
              </div>
            );
          })}
        </Card>
      </div>

      {/* [wave-b] 客户打分(热/温/冷)*/}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Gauge className="size-4 text-muted-foreground" strokeWidth={2} />
          <SectionTitle>Customer scoring</SectionTitle>
        </div>
        <Card className="overflow-hidden">
          {LEAD_SCORE_RULES.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
              <p className="min-w-0 flex-1 text-sm text-foreground">{r.behavior}</p>
              <span className={"text-sm font-semibold tabular-nums " + (r.points >= 0 ? "text-success-soft-foreground" : "text-error-soft-foreground")}>
                {r.points > 0 ? `+${r.points}` : r.points}
              </span>
            </div>
          ))}
          <div className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
            Score decides who's hot / warm / cold — see it on each{" "}
            <Link href={`${BASE}/crm/contacts`} className="font-semibold text-foreground hover:underline">contact</Link>.
          </div>
        </Card>
      </div>

      {/* [wave-b] 同行对标 Benchmark */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" strokeWidth={2} />
          <SectionTitle>How you compare</SectionTitle>
        </div>
        <Card className="overflow-hidden">
          {INBOX_BENCHMARKS.map((b) => (
            <div key={b.label} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
              <p className="min-w-0 flex-1 text-sm text-foreground">{b.label}</p>
              <span className="text-sm font-semibold tabular-nums text-foreground">{b.you}</span>
              <span className="text-xs text-muted-foreground">peers {b.peers}</span>
              <Badge variant={b.ahead ? "success" : "warning"}>{b.ahead ? "Ahead" : "Behind"}</Badge>
            </div>
          ))}
          <div className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">Compared with similar KL food &amp; bakery shops · anonymised</div>
        </Card>
      </div>

      {/* [wave-b] 邮件通道 · Reviews · 自助门户 —— 最轻原型 */}
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary"><Mail className="size-4 text-muted-foreground" strokeWidth={2} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Email channel</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Add email to your flows for receipts and B2B.</p>
            </div>
            <Switch checked={isEmailChannelOn()} onCheckedChange={toggleEmailChannel} aria-label="Email channel on or off" />
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary"><Star className="size-4 text-muted-foreground" strokeWidth={2} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Auto-request reviews</p>
              <p className="mt-0.5 text-xs text-muted-foreground">After delivery, ask for a review; Otto drafts your replies.</p>
            </div>
            <Switch checked={isReviewsOn()} onCheckedChange={toggleReviews} aria-label="Review requests on or off" />
          </div>
        </Card>
      </div>

      <Card className="mt-3 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary"><Award className="size-4 text-muted-foreground" strokeWidth={2} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Order lookups in chat</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Instead of a login portal, customers just ask “where's my order?” and Otto answers from the thread — the way SEA shoppers actually behave.</p>
          </div>
          <Badge variant="outline">Built in</Badge>
        </div>
      </Card>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Coins className="size-3.5" strokeWidth={2} />
        Turning a recipe on is free. Otto still asks before anything actually spends.
      </p>
    </div>
  );
}
