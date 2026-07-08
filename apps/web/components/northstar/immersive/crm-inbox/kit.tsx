"use client";

/**
 * 北极星 · 沉浸式「CRM · 收件箱」组(crm-inbox)—— 只剩区专属件。
 *
 * 共享原语(Card/CardHeader/ChannelTag/CHANNELS/NsChannel/Initials/fmtStamp/fmtDate/
 * fmtMyr/useReducedMotion/useSweep/ZonePage)已上提到 ../_kit(蓝图 §3.1 kit 合并),
 * 这里 re-export 它们,页面 import 路径不变。本文件只保留两组段控子导航 + base 常量 +
 * inbox 的 3 渠道口径。
 *
 * 渠道口径统一(蓝图 §3.1 漂移点):此前 crm 的 ChannelTag 吃 3 值 NsInboxChannel、
 * 与 account 的 5 值 NsChannel 签名冲突。现 ChannelTag 单一实现吃全 5 渠道 NsChannel;
 * NsInboxChannel 收敛成 NsChannel 的 3 值子类型(inbox 只用这 3 个),页面照旧 import,
 * `as NsInboxChannel`(NsChannel 子类型)喂进 NsChannel prop 类型流畅。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto;credits 永远是 credits。
 */

import { SegNav, IMMERSIVE_BASE, type NsChannel } from "../_kit";

/* ── 共享原语 re-export(单一实现在 ../_kit;页面 import 路径不变) ──────────── */
export {
  Card,
  CardHeader,
  ChannelTag,
  CHANNELS,
  Initials,
  ZonePage,
  fmtStamp,
  fmtDate,
  fmtMyr,
  useReducedMotion,
  useSweep,
} from "../_kit";
export type { NsChannel } from "../_kit";

const BASE = IMMERSIVE_BASE;
export const CRM_INBOX_BASE = BASE;

/* ── inbox 渠道口径(区专属:NsChannel 的 3 值子类型;单一 ChannelTag 通吃) ──── */
export type NsInboxChannel = Extract<NsChannel, "whatsapp" | "instagram" | "facebook">;

export const INBOX_CHANNELS: Record<NsInboxChannel, { short: string; label: string }> = {
  whatsapp: { short: "WA", label: "WhatsApp" },
  instagram: { short: "IG", label: "Instagram" },
  facebook: { short: "FB", label: "Facebook" },
};

/* ── 两组段控子导航(区专属 §N4) ──────────────────────────────────────────── */
const CRM_VIEWS = [
  { href: `${BASE}/crm/contacts`, label: "Contacts" },
  { href: `${BASE}/crm/deals`, label: "Deals" },
  { href: `${BASE}/crm/segments`, label: "Segments" },
];

const INBOX_VIEWS = [
  { href: `${BASE}/inbox/shared`, label: "Shared inbox" },
  { href: `${BASE}/inbox/comments`, label: "Comments" },
  { href: `${BASE}/inbox/knowledge`, label: "Knowledge" },
  { href: `${BASE}/inbox/test-drive`, label: "Test drive" },
];

export function CrmNav() {
  return <SegNav views={CRM_VIEWS} />;
}
export function InboxNav() {
  return <SegNav views={INBOX_VIEWS} />;
}
