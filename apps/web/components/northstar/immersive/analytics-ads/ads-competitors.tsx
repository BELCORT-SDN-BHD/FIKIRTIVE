"use client";

/**
 * 同行广告透视页(§L List;880;C-E 新功能)—— 沉浸式原生。
 *
 * GOOSEWORKS-MAP §二 B1「Competitor Ad X-ray」:搜同城同类 → 广告卡瀑布(真图)→ 按 hook
 * 聚类 → 「借这个角度」一键进创作。数据形态 = Meta Ad Library 官方公开广告透明工具(合法公开
 * 数据,DSA 强制;不碰个人数据,不公开花费/触达 —— 正文照实标注)。正文 = 与画廊页共享的
 * CompetitorAngles;此文件只给 §D PinnedHeader 外壳 + AdsNav 段控 + 出处印章 + Otto 帮我。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto(白空间判读那一条);图片只从 NS_IMAGES。
 */

import { ProvenancePill } from "@/components/northstar/analytics/zone-kit";
import { CompetitorAngles } from "@/components/northstar/ads/competitor-angles";
import { IMMERSIVE_BASE } from "../_kit";
import { AdsNav, PinnedHeader, ZoneBody } from "./kit";

export default function AdsCompetitors() {
  return (
    <>
      <PinnedHeader
        title="What peers are running"
        nav={<AdsNav />}
        provenance={<ProvenancePill text="via Meta Ad Library · public" />}
      />
      <ZoneBody>
        <CompetitorAngles base={IMMERSIVE_BASE} />
      </ZoneBody>
    </>
  );
}
