"use client";

/**
 * 北极星 · 沉浸式「账户 · 自动化 · 团队」组(account-ops)—— 只剩区专属件。
 *
 * 共享原语(Card/CardHeader/SectionTitle/ChannelTag/CHANNELS/NsChannel/fmtStamp/
 * useReducedMotion/useSweep/SettingRow)已上提到 ../_kit(蓝图 §3.1 kit 合并),
 * 这里 re-export 它们,页面 import 路径不变。本文件只保留三组段控子导航 + base 常量。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto;credits 永远是 credits。
 */

import { SegNav, IMMERSIVE_BASE } from "../_kit";

/* ── 共享原语 re-export(单一实现在 ../_kit;页面 import 路径不变) ──────────── */
export {
  Card,
  CardHeader,
  SectionTitle,
  ChannelTag,
  CHANNELS,
  SettingRow,
  Initials,
  fmtStamp,
  useReducedMotion,
  useSweep,
} from "../_kit";
export type { NsChannel } from "../_kit";

const BASE = IMMERSIVE_BASE;
export const ACCOUNT_OPS_BASE = BASE;

/* ── 三组段控子导航(区专属:各页各占一路由,视觉保持 segmented §N4) ──────── */
const ACCOUNT_VIEWS = [
  { href: `${BASE}/account/settings`, label: "Settings" },
  { href: `${BASE}/account/credits`, label: "Credits" },
  { href: `${BASE}/account/connections`, label: "Connections" },
  { href: `${BASE}/account/channel-wallet`, label: "Channel fees" },
];

const AUTOMATION_VIEWS = [
  { href: `${BASE}/automation/recipes`, label: "Recipes" },
  { href: `${BASE}/automation/rules`, label: "Rules" },
  { href: `${BASE}/automation/routines`, label: "Routines" },
];

const TEAM_VIEWS = [
  { href: `${BASE}/team/members`, label: "Members" },
  { href: `${BASE}/team/approvals`, label: "Approvals" },
  { href: `${BASE}/team/agency`, label: "Agency" },
];

export function AccountNav() {
  return <SegNav views={ACCOUNT_VIEWS} />;
}
export function AutomationNav() {
  return <SegNav views={AUTOMATION_VIEWS} />;
}
export function TeamNav() {
  return <SegNav views={TEAM_VIEWS} />;
}
