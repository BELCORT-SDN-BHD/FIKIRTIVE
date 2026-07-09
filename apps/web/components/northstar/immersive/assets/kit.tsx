"use client";

/**
 * 北极星 · 沉浸式「资产区」组(assets)—— 只剩区专属件。
 *
 * 共享原语(Card/CardHeader/SectionTitle/ZonePage/fmt* /useSweep …)在 ../_kit,
 * 三态 / 网格原语(SweepIn/GenBar/Skeleton/SegChips/SearchField/OttoMark/ZoneTabs/
 * ErrorPanel)在 ../../assets/_zone(全城资产区单一实现,禁 fork)。本文件只保留
 * 资产区七页的段控子导航 + base 常量。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto;credits 永远是 credits。
 */

import { SegNav, IMMERSIVE_BASE } from "../_kit";

/* ── 共享原语 re-export(单一实现在 ../_kit;页面 import 路径统一) ───────────── */
export {
  Card,
  CardHeader,
  SectionTitle,
  ZonePage,
  fmtStamp,
  fmtDate,
  fmtMyr,
  useReducedMotion,
  useSweep,
  useQueryParam,
} from "../_kit";
export { PageHeader, StatCard, EmptyState } from "../_kit";

export const ASSETS_BASE = IMMERSIVE_BASE;

/* ── 资产区七页段控子导航(§N4;跨页不跳出壳) ─────────────────────────────── */
const ASSETS_VIEWS = [
  { href: `${IMMERSIVE_BASE}/assets/my-stuff`, label: "My stuff" },
  { href: `${IMMERSIVE_BASE}/assets/library`, label: "Library" },
  { href: `${IMMERSIVE_BASE}/assets/templates`, label: "Templates" },
  { href: `${IMMERSIVE_BASE}/assets/discover`, label: "Discover" },
  { href: `${IMMERSIVE_BASE}/assets/brand-memory`, label: "Memory" },
  { href: `${IMMERSIVE_BASE}/assets/brand-kit`, label: "Kit" },
  { href: `${IMMERSIVE_BASE}/assets/cast`, label: "Cast" },
];

export function AssetsNav() {
  return <SegNav views={ASSETS_VIEWS} />;
}
