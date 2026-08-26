import { Bell, Building2, Globe2, KeyRound, Link2, Radio, ShieldCheck, SlidersHorizontal, UserRound, UsersRound, WalletCards } from "lucide-react";

/**
 * Settings 的分节权威表 + beta 收窄名单。
 *
 * 为什么这张表住在自己的文件里,而不是留在 `R22SettingsShell.tsx`:壳是 `"use client"`,
 * 而收窄那道闸在服务端(`R22SettingsEntry`)—— 服务端组件从一个 client 模块里取**值**,
 * 拿到的是 client reference,不是数组。所以表下沉到这个没有 `"use client"` 的模块,两边
 * 各自 import 同一份,谁都不用手抄第二张名单。
 */
export type R22SettingsSection = "preferences" | "profile" | "notifications" | "security" | "connected" | "workspace" | "members" | "roles" | "connections" | "billing" | "domains";

export const SETTINGS_GROUPS: Array<{ label: string; items: Array<{ id: R22SettingsSection; label: string; icon: typeof Bell }> }> = [
  { label: "Personal", items: [{ id: "preferences", label: "Preferences", icon: SlidersHorizontal }, { id: "profile", label: "Profile", icon: UserRound }, { id: "notifications", label: "Notifications", icon: Bell }, { id: "security", label: "Security and access", icon: ShieldCheck }, { id: "connected", label: "Connected accounts", icon: Link2 }] },
  { label: "Workspace", items: [{ id: "workspace", label: "General", icon: Building2 }, { id: "members", label: "Members", icon: UsersRound }, { id: "roles", label: "Roles and permissions", icon: KeyRound }] },
  { label: "Publishing", items: [{ id: "connections", label: "Connections", icon: Radio }, { id: "billing", label: "Billing and credits", icon: WalletCards }] },
  { label: "Administration", items: [{ id: "domains", label: "Domains", icon: Globe2 }] },
];

/**
 * beta V1 的 Settings 收窄(Founder 裁决 2026-08-27,卫生大扫除台账 P2-14 / P2-22)。
 *
 * 裁决:beta 期 Settings 只留 **Profile / Preferences / Billing and credits** 三节。理由在
 * 台账 P2-22:beta 只有一个人、一个工作区、不发布 —— Members / Roles / Domains /
 * Connections / Connected accounts / Security / Notifications / General 这八节没有对象,
 * 而它们每一颗动作都以「这在预览里没真的动」收尾,商家点一圈只收获八次道歉。
 *
 * **只藏不删**,照 `R22DashboardShell` 的 `BETA_HIDDEN_NAV_KEYS` 先例:上面那张
 * `SETTINGS_GROUPS` 权威表一格没动,壳里 `switch (section)` 八节的实现一行没删,
 * `R22SettingsSection` 类型也照旧十一节。收窄只发生在两处壳层动作 ——
 *   ① 侧栏按这张名单过滤(空掉的分组整组不画);
 *   ② `R22SettingsEntry` 把落到被藏节的深链温和回落到 Profile,并说出来。
 *
 * **显式开关**:`?sections=all`(`R22SettingsEntry` 读)把十一节原样放回来 —— 后端线与
 * beta 之后要验这八节时不用改代码。
 */
export const BETA_SETTINGS_SECTIONS = ["profile", "preferences", "billing"] as const satisfies readonly R22SettingsSection[];

/** beta V1 期间不在 Settings 侧栏、深链也回落掉的八节。回来的时候把它们并回上面那一行。 */
export const BETA_HIDDEN_SETTINGS_SECTIONS = SETTINGS_GROUPS
  .flatMap((group) => group.items.map((item) => item.id))
  .filter((id) => !(BETA_SETTINGS_SECTIONS as readonly R22SettingsSection[]).includes(id));

export const isBetaSettingsSection = (section: R22SettingsSection) => (BETA_SETTINGS_SECTIONS as readonly R22SettingsSection[]).includes(section);

/** 侧栏里商家读到的那一格名字。回落提示要说出他刚才按的是哪扇门,不能自己另起一套叫法。 */
export const R22_SETTINGS_SECTION_LABELS = Object.fromEntries(
  SETTINGS_GROUPS.flatMap((group) => group.items.map((item) => [item.id, item.label] as const)),
) as Record<R22SettingsSection, string>;
