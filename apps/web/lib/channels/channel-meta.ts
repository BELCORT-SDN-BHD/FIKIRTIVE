// Client-safe channel metadata — pure data, NO adapter behaviour. The full `registry`
// (instagram.ts / facebook.ts) transitively imports server-only code (Prisma, node:crypto
// via meta-pages/token-encryption), so a client component must NOT import it. This mirror
// carries only the display + capability facts the UI needs (label, post-type gating, media
// caps, first-comment support). Keep the capability values in sync with the adapters.

import type { ChannelId, ChannelCapabilities } from "./types";

export type ChannelMeta = {
  id: ChannelId;
  label: string;
  capabilities: ChannelCapabilities;
};

export const CHANNEL_META: ChannelMeta[] = [
  {
    id: "instagram",
    label: "Instagram",
    capabilities: {
      postTypes: ["feed-image", "carousel", "reel", "story"],
      maxMediaCount: 10,
      supportsFirstComment: true,
      supportsNativeSchedule: false,
      rateLimitPer24h: 25,
    },
  },
  {
    id: "facebook",
    label: "Facebook",
    capabilities: {
      postTypes: ["feed-image", "text-link"],
      maxMediaCount: 1,
      supportsFirstComment: false,
      supportsNativeSchedule: true,
    },
  },
  {
    id: "x",
    label: "X",
    capabilities: {
      postTypes: ["text-link"],
      maxMediaCount: 0,
      supportsFirstComment: false,
      supportsNativeSchedule: false,
    },
  },
];

export function channelMeta(id: ChannelId): ChannelMeta | undefined {
  return CHANNEL_META.find((c) => c.id === id);
}

// ── Which publishing channels a merchant can actually connect today (#694) ───────────────────
// X has no OAuth route: lib/channels/x.ts's connectUrl points at an unbuilt /api/x/authorize, and
// Connections deliberately renders it as a button-less "Not available yet" row. Schedule disagreed —
// with zero connections its composer fell back to "every channel", so a brand-new merchant was
// offered X, sent to a Connections row with nothing to press, and could still save an X draft that
// can never publish. This set is the single filter every merchant-facing entry point runs: the
// Connections page, the composer's channel list, the Plan/Queue channel filter, and the account
// page's "x of y connected". When X OAuth lands, deleting one id here lights all four up at once.
//
// CHANNEL_META itself keeps X — existing X drafts, their capability blurb and their queue rows must
// still render truthfully; this is about which channels we OFFER, not which we can display.
export const UNAVAILABLE_PUBLISHING_CHANNEL_IDS: ReadonlySet<ChannelId> = new Set<ChannelId>(["x"]);

export function isConnectableChannel(id: ChannelId): boolean {
  return !UNAVAILABLE_PUBLISHING_CHANNEL_IDS.has(id);
}

export const CONNECTABLE_CHANNEL_META: ChannelMeta[] = CHANNEL_META.filter((c) => isConnectableChannel(c.id));

// ── 一行一个渠道:Connections 页 Publishing 分区的版式权威(W2-4,规格书 §4.7) ─────────────
//
// 为什么这层要存在:Connections 页原本直接 map 服务端回来的那份渠道数组,于是「有哪几行」
// 由一次网络读的结果决定,「这一行能不能连」在 JSX 里就地判断。两个后果:①读失败就整个
// Publishing 分区塌成一句话,商家连「我有哪些渠道」都看不到;②每加一个渠道,版式那边要跟着
// 改一次分区说明(旧文案把「Instagram 和 Facebook 能连、X 不能」写死在一句话里)。
//
// 这个函数把两件事分开:**有哪几行**来自 CHANNEL_META(纯数据,永远在),**每一行的状态**
// 才来自那次读。所以开关是**按渠道**的 —— 一行的连接状态坏了、缺了、被拦了,都只影响它自己
// 那一行,不会替另外两个渠道回答问题。X OAuth 落地那天,删 UNAVAILABLE_PUBLISHING_CHANNEL_IDS
// 里那一个 id,这里就自动多一行可连的,没有第二处版式要改。
//
// 泛型而不是直接吃 `ChannelState`:那个类型住在客户端组件文件里(components/otto/settings/
// sections.tsx),lib 反过来 import 组件会绕出一圈没必要的依赖。这里只需要「有个 id」。
export type PublishingChannelRow<T> = {
  id: ChannelId;
  label: string;
  /** 今天连得上吗。false ⇒ 这一行只说实话,不画任何按钮(见 isConnectableChannel)。 */
  connectable: boolean;
  /** 这一条渠道**自己**的连接状态;那次读里没有它就是 null。 */
  state: T | null;
};

export function publishingChannelRows<T extends { id: string }>(
  loaded: readonly T[],
): PublishingChannelRow<T>[] {
  return CHANNEL_META.map((meta) => ({
    id: meta.id,
    label: meta.label,
    connectable: isConnectableChannel(meta.id),
    state: loaded.find((c) => c.id === meta.id) ?? null,
  }));
}

/**
 * 一个渠道能发什么,用商家的话说一句。
 *
 * 从 `capabilities` 推,不按渠道名写 if/else(E4-16),所以加一个渠道不用改这里。
 *
 * W2-4:`maxMediaCount <= 0` 那一档原本写的是 “Text posts · media coming soon”。
 * 「coming soon」是一个没人排期的承诺 —— 这仓最贵的老病,W2-3 刚为同一件事删掉一颗
 * 永久 disabled 的按钮。能力表里没有任何东西支持那半句,所以只留前半句这个事实。
 * 它从 OttoSchedule 搬到这里,是因为这句话说的是**渠道能力**,而能力的权威就在这个文件;
 * 排程页与连接页读同一份,不会各写一句。
 */
export function channelCapabilityBlurb(cap: ChannelCapabilities): string {
  if (cap.maxMediaCount <= 0) return "Text posts only";
  if (cap.maxMediaCount === 1) return "Single feed image";
  return cap.postTypes.includes("carousel")
    ? `Feed image or carousel · up to ${cap.maxMediaCount} media`
    : `Up to ${cap.maxMediaCount} photos or a video`;
}
