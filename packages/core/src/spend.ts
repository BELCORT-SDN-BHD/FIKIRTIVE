/**
 * Pure spend-snapshot helpers (OPT-6 P3a). RECORD-ONLY: the worker calls these at
 * the commit point to freeze GenJob.spentUsd / RefGenJob.spentUsd, exactly when
 * money is committed (like Generation.entitySnapshot). NO prisma, NO LLM — pure
 * functions over the price truth in gen.ts/refgen.ts so the money-critical worker
 * write is one byte-stable call. The USD snapshots never gate or influence spend.
 * EXCEPTION (2026-07-04 宪法 5 margin floor): isFlatPricedVideoModel below IS
 * consulted by the spend gate (model-config.assertSpendableModel) — only video
 * models with a flat, margin-floored price are sellable.
 */
import {
  GEN_PRICE_USD_PER_IMAGE,
  GEN_VIDEO_MODEL_OPTIONS,
  REFERENCE_VIDEO_COGS_USD,
  videoPriceUsd,
  videoDefaults,
  type GenVideoModel,
} from "./gen.js";
import { REFGEN_PRICE_USD_PER_IMAGE } from "./refgen.js";

/** Exactly the GenJob fields the price needs (a subset of the row). */
export interface GenSpendInput {
  kind: "IMAGE" | "VIDEO";
  model: string;
  count: number;
  referenceVideoGenerationId?: string | null;
  /** GenJob.videoOptions Json: { seconds, resolution, aspectRatio, fps, audio }. */
  videoOptions: { seconds?: number; resolution?: string; audio?: boolean } | null;
}

/** Frozen USD for a committed GenJob. Video: videoPriceUsd over the job's resolved
 *  options (fall back to the model's defaults exactly as the worker does at the
 *  provider call — never NaN). Image: flat per-image × count. */
export function genSpentUsd(job: GenSpendInput): number {
  if (job.kind === "VIDEO") {
    // #644 记账真相:整段参考视频的 COGS 基准搬去 gen.ts 与其它成本基准同住,并按官方
    // token 公式重算($0.85 → $0.78408)。这是**记账**,不是收费 —— 收费仍是下面
    // pricedGenCredits 里的 REFERENCE_VIDEO_CREDITS(16cr),本次一格没动。
    if (job.model === "seedance-2-fast" && job.referenceVideoGenerationId) return REFERENCE_VIDEO_COGS_USD;
    const d = videoDefaults(job.model as GenVideoModel);
    return videoPriceUsd(job.model as GenVideoModel, {
      seconds: job.videoOptions?.seconds ?? d.seconds,
      resolution: job.videoOptions?.resolution ?? d.resolution,
      audio: job.videoOptions?.audio ?? d.audio,
      count: job.count,
    });
  }
  return GEN_PRICE_USD_PER_IMAGE * job.count;
}

/** Exactly the RefGenJob fields the price needs. */
export interface RefGenSpendInput {
  model: string;
  count: number;
}

/** Frozen USD for a committed RefGenJob. Uses refgen's OWN per-image constant
 *  (REFGEN_PRICE_USD_PER_IMAGE — same value as GEN_PRICE today but independent). */
export function refgenSpentUsd(job: RefGenSpendInput): number {
  return REFGEN_PRICE_USD_PER_IMAGE * job.count;
}

// ── Credit pricing (closed-beta P2) ─────────────────────────────────────────────
// The CREDIT ledger is the spend cap (M1). Two distinct numbers:
//  - pricedGenCredits / pricedRefgenCredits = the CHARGE we debit the user, deterministic,
//    in INTERNAL credits (1 internal credit = $0.01), with margin. RESERVE and SETTLE both
//    use this exact value → reserve == settle, no variable delta.
//  - genSpentUsd / refgenSpentUsd (above) = the true fal COST, record-only. Margin = the gap.

/** Internal credit accounting unit: 1 internal credit = $0.01. balance/ledger are internal. */
export const CREDITS_PER_USD = 100;
/** Display denomination: 1 user-facing credit = 10 internal = $0.10. Charges are whole
 *  displayed credits (×10 internal) so per-action costs read as small round numbers. */
export const INTERNAL_PER_DISPLAY = 10;
const USD_PER_DISPLAY_CREDIT = 0.1;

/** Displayed credits from a USD amount: round UP to the $0.10 unit, min 1 (never
 *  under-charge, never zero). */
function displayedFromUsd(usd: number): number {
  return Math.max(1, Math.ceil(usd / USD_PER_DISPLAY_CREDIT));
}

/** Video models whose credit charge is a flat per-resolution number (BytePlus Seedance,
 *  priced by final locked costing, not the record-only COGS). All other models charge
 *  displayedFromUsd(true cost). */
export const FLAT_PRICED_VIDEO_MODELS = new Set<string>(["seedance-2-fast"]);
export function isFlatPricedVideoModel(model: string): boolean { return FLAT_PRICED_VIDEO_MODELS.has(model); }

/**
 * **Seedance 2.0 Fast 的按秒价目表**(#645 T4,Founder 裁决 2026-08-06,留档:
 * https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/645#issuecomment-5202464378)。
 *
 * 计价模型:**按秒计价,显示 credits 进位取整**。480p = 1.1cr/秒、720p = 2.2cr/秒。
 * 这里存的是「每 10 秒多少显示 credits」的**整数**分子,于是全表可以纯整数算出来 ——
 * 1.1 和 2.2 在 IEEE754 里都不是精确值,拿它们直接乘会让某些时长差一格 credit,
 * 而差一格 credit 就是 quote / reserve / settle 三处对不上。
 *
 * 这张表替掉了 #644 的「每分辨率一个数 + 10 秒特例」两行结构 —— 5s=11cr / 10s=22cr
 * 是那次裁决的数,按秒公式复算得一模一样(video-tiers.test.ts 有逐字回归钉板),
 * 所以扩容没有动任何一个已裁的数字。
 */
export const SEEDANCE_DISPLAY_CREDITS_PER_10S: Record<string, number> = { "480p": 11, "720p": 22 };

/**
 * 一档视频的显示 credits。**返回 null = 这一档不按秒计价**,调用方必须落到护栏价,
 * 有两种情形:
 *   ① 分辨率不在按秒表上(1080p / 未知);
 *   ② 秒数**不属于这个模型开出来的档位**。
 *
 * ② 的判据是**档位归属**,不是「正整数」——
 * **价格只定义在 Founder 裁过的那些格上;格外不 round、不外推,只有护栏。**
 * 三种错法都被这一条挡住:
 *   - `0.4s` 若 round 成 0 ⇒ 0 credits,而 `reserveCredits` 对 cost<=0 直接跳过
 *     (packages/db/src/credits.ts),那是一条**免费**的付费任务;
 *   - `4.4s` 若 round 成 4 ⇒ 9cr,一个从没被裁过的价;
 *   - `3s` / `16s` 是**正整数**,但同样不在已裁的十二格里,按公式外推会得到
 *     7cr / 36cr —— 同样是替 Founder 发明价格。
 * 档位归属一次覆盖三者:非整数、0、负数、NaN、∞ 都不可能命中 durations 表。
 *
 * 判据的**单一事实来源**是能力表 `GEN_VIDEO_MODEL_OPTIONS[model].durations` ——
 * 菜单上开了哪几档,就只有那几档有价。这里刻意不抄一份 [4..15] 字面量:抄一份,
 * T6 或未来任何一次改档就会让「卖什么」和「收多少」分家。
 *
 * 为什么防线必须长在钱函数自己身上:新请求那一侧有 zod `.int()` 与档位校验拦着,
 * 但 `GenJob.videoOptions` 是**无约束 JSON**,worker 结算后重算展示价的两条路
 * (apps/worker/src/jobs/gen.ts 的 GEN_RESULT 两处)直达这里,那条路上没有 zod。
 *
 * 纯整数运算:seconds 与 per10s 都是整数,+9 再整除 10 就是向上取整,不经过任何小数 ——
 * 浮点差一格 credit 的路在这里根本不存在。
 */
export function seedanceDisplayCredits(model: string, resolution: string, seconds: number): number | null {
  const per10s = SEEDANCE_DISPLAY_CREDITS_PER_10S[resolution];
  if (per10s === undefined) return null;
  const ruledDurations = GEN_VIDEO_MODEL_OPTIONS[model as GenVideoModel]?.durations;
  if (!ruledDurations?.includes(seconds)) return null;
  return Math.floor((seconds * per10s + 9) / 10);
}

/** 不按秒计价的兜底档:1080p(Fast 给不了,留作护栏)与任何未知分辨率都收 16cr。
 *  #644/#645 都没动这一格 —— 它是「宁可贵,不许贱卖」的最后一道。 */
export const VIDEO_CREDITS_BY_RESOLUTION: Record<string, number> = { "1080p": 16 };
export const REFERENCE_VIDEO_CREDITS = 16;

export function pricedGenCredits(job: GenSpendInput): number {
  if (job.kind === "VIDEO") {
    if (isFlatPricedVideoModel(job.model)) {
      if (job.referenceVideoGenerationId) return REFERENCE_VIDEO_CREDITS * INTERNAL_PER_DISPLAY;
      const d = videoDefaults(job.model as GenVideoModel);
      const r = job.videoOptions?.resolution ?? d.resolution;
      const seconds = job.videoOptions?.seconds ?? d.seconds;
      const perSecond = seedanceDisplayCredits(job.model, r, seconds); // #645 T4: 按秒计价的档
      if (perSecond !== null) return perSecond * INTERNAL_PER_DISPLAY;
      return (VIDEO_CREDITS_BY_RESOLUTION[r] ?? 16) * INTERNAL_PER_DISPLAY; // 1080p / 未知 → 护栏价
    }
    return displayedFromUsd(genSpentUsd(job)) * INTERNAL_PER_DISPLAY; // fal models: per-model USD cost (restores correct scaling)
  }
  return job.count * INTERNAL_PER_DISPLAY; // 1 displayed credit per image
}
/** DETERMINISTIC charge in INTERNAL credits for a refgen job: 1 displayed credit per image. */
export function pricedRefgenCredits(job: RefGenSpendInput): number {
  return job.count * INTERNAL_PER_DISPLAY;
}
/** Internal credits → user-facing displayed credits (view seam only — never feed this
 *  back into the ledger/balance, which are always internal). */
export function displayCredits(internal: number): number {
  return internal / INTERNAL_PER_DISPLAY;
}

/** A new org's one-time welcome grant (internal credits, 1 = $0.01).
 *
 *  20 DISPLAYED credits = 20 × INTERNAL_PER_DISPLAY internal — the #543 Founder decision
 *  (2026-07-31): enough for one complete Otto experience (a full conversation + image +
 *  critique ≈ 9.5 displayed, one 5s video = 8 displayed at the time), and it lands only
 *  AFTER the merchant verifies their email.
 *  NOTE (#644 裁决 2026-08-06):5s 视频已由 8 → 11 显示 credits,所以 20cr 不再同时够
 *  「一整场对话 + 一条视频」(9.5 + 11 ≈ 20.5)。赠额本身是 #543 的 Founder 决定,本次
 *  一格没动 —— 是否跟着调是另一次裁决。
 *
 *  Supersedes the closed-beta seed (1000 → 100 in #66 → 20 here). It is granted
 *  idempotently in the org-bootstrap path under the stable key "signup:<orgId>"; the key
 *  is deliberately UNCHANGED, because a new key would re-grant to every org that already
 *  received the old amount. */
export const SIGNUP_GRANT_CREDITS = 20 * INTERNAL_PER_DISPLAY;
