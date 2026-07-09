/* @nsPage district="广告区" page="competitors" status="draft"
   sources="GOOSEWORKS-MAP §二 B1 同行广告透视;Wave-C 总单 C-E" approvedAt="" pr="" */
"use client";

/**
 * 同行广告透视页(画廊) — 搜同城同类 → 广告卡瀑布(真图)→ 按 hook 聚类 → 「借这个角度」进创作。
 *
 * 依据:GOOSEWORKS-MAP §二 B1(Competitor Ad X-ray)+ Wave-C 总单 C-E。数据形态 = Meta Ad
 * Library 官方公开广告透明工具(合法公开数据);正文与沉浸式共享 CompetitorAngles,画廊仅套页头。
 * 诚实红线:不给同行编造花费/触达;赢家信号 = 跑了多久;聚类 = 我们对开场白的判读(照实标注)。
 */

import { ProvenancePill } from "@/components/northstar/analytics/zone-kit";
import { MockNote, PageHeader } from "@/components/northstar/_shared";
import { AdsTabs } from "@/components/northstar/ads/ads-tabs";
import { CompetitorAngles } from "@/components/northstar/ads/competitor-angles";

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[880px] px-6 pt-6 pb-24">
      <PageHeader title="What peers are running" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <AdsTabs />
        <ProvenancePill text="via Meta Ad Library · public" />
      </div>

      <div className="mt-4">
        <CompetitorAngles base="/northstar" />
      </div>

      <MockNote path="/northstar/ads/competitors" />
    </div>
  );
}
