import "server-only";
import { founderAlert } from "@/lib/founder-alert";
import { consumeMediaProxyGate } from "@/lib/rate-limit-gates";
import type { FounderAlertOutcome } from "@fikirtive/core/founder-alert";

/**
 * SHARE-A3 / A4 / A12(docs/specs/share-preview.md 已冻结 · v1)—— 公开媒体代理的放行决定。
 *
 * 背景,一句话:这道闸原本 fail-OPEN。理由写在 `rate-limit-gates.ts` 上,当时也成立 —— 这是
 * 唯一一条本来不碰数据库的路,拒了等于让一次计数器抖动打断一次商家已经付过钱的发布。
 * B0-28 之后这条路多了第二种调用者:客户手上那条免登录预览链接。对那一半来说 fail-open 的
 * 意思是「谁手上有一条合法链接,就能在计数器不可用的整段时间里按网络速度狂拉」—— 而这条路
 * 现在是流式的、对象上限 2 GB,被刷的是出口流量账单(#1053 发现 1)。
 *
 * Founder 2026-09-12(场⑦)裁定三件一体,这个文件就是那三件:
 *   ① 拒绝  —— 计数器够不到 = 429 + `Retry-After`,不吐字节(SHARE-A3);
 *   ② 兜底  —— 刚刚成功拉过的那个客户,在一个短窗口内仍然放行,别让一次抖动
 *              把**正在看**的客户当场打断(SHARE-A4);
 *   ③ 报警  —— 「限流存储不可用」必须有人知道,而且要有逐通道**送达回执**,
 *              不是只往日志里写一行(SHARE-A12)。
 *
 * 为什么后两件不住在 `rate-limit-gates.ts`:那个文件在**免登录分享预览页**的 import 围栏内
 * (`lib/__tests__/share-preview-page.test.ts` 把那一页能碰到的每个模块与每条外部边都钉死了)。
 * 报警要 `@sentry/node` 与 Resend / Telegram 通道,那些东西没有理由出现在一个无会话页面的
 * 依赖图里。所以它们跟唯一的调用方住在一起 —— 媒体代理路由。
 */

/**
 * SHARE-A4 —— 兜底窗口。
 *
 * 它记的**不是额度**,是「这个调用方刚刚被真正的计数器放行过」这一个事实,而且只在计数器
 * 够不到的那一刻才被读。进程内存在这里是唯一可能的地方:要兜底的那件事正是「共享计数器
 * 不可用」,此时任何共享存储按定义都指望不上。
 *
 * WHY 60 秒。窗口要够长,盖住一次数据库重启或主从切换里客户正在看的这一页(图片逐条加载,
 * 一页看完是秒级);又要够短,让「握着一条合法链接的脚本」最多白拿一分钟就撞上 429。
 * 它也不续期:成功一次给一分钟,窗口过后照样拒(验收 SHARE-A4 的后半句)。
 */
export const MEDIA_PROXY_DEGRADED_GRACE_MS = 60_000;

/** 计数器够不到时告诉客户端多久之后再来。短 —— 抖动通常是秒级,让浏览器早点重试。 */
export const MEDIA_PROXY_DEGRADED_RETRY_AFTER_SECONDS = 30;

/**
 * SHARE-A12 —— 同一场故障里多久才允许再吵一次人。
 *
 * 每一个被拒的请求都报一次警,等于把一次存储故障变成一场报警风暴,而发报警邮件用的
 * `RESEND_API_KEY` 跟商家的登录邮件是同一把(见 packages/core/src/founder-alert.ts):
 * 报警自己会变成它要报的那种事故。所以每 5 分钟只派发一次;这一场故障里的第一条是完整
 * 报警(Sentry + 邮件 + Telegram),之后的走 `repeat` —— 只进 Sentry 计数,不再推送。
 */
export const MEDIA_PROXY_STORE_ALERT_INTERVAL_MS = 5 * 60_000;

/** 兜底窗口的记账上限。公开路由的调用方地址是无穷的,这张表必须有天花板。 */
const RECENT_SUCCESS_MAX_ENTRIES = 10_000;

/** callerKey → 最后一次被真正的计数器放行的时刻(epoch ms)。 */
const recentSuccessAt = new Map<string, number>();

let lastAlertAt: number | null = null;
/** 这一场故障里是否已经发过完整报警。计数器恢复正常时清空,下一场故障重新从完整报警开始。 */
let alertedThisOutage = false;

/** 过期的条目先删;还是超上限就按插入顺序丢最旧的(Map 的迭代顺序就是插入顺序)。 */
function pruneRecentSuccess(now: number): void {
  for (const [caller, at] of recentSuccessAt) {
    if (now - at > MEDIA_PROXY_DEGRADED_GRACE_MS) recentSuccessAt.delete(caller);
  }
  while (recentSuccessAt.size > RECENT_SUCCESS_MAX_ENTRIES) {
    const oldest = recentSuccessAt.keys().next();
    if (oldest.done) break;
    recentSuccessAt.delete(oldest.value);
  }
}

/** 真正的计数器放行了一次 —— 记下这个事实,并顺手确认这一场故障已经结束。 */
export function rememberMediaProxySuccess(caller: string, now: number): void {
  recentSuccessAt.set(caller, now);
  if (recentSuccessAt.size > RECENT_SUCCESS_MAX_ENTRIES) pruneRecentSuccess(now);
  alertedThisOutage = false;
}

/** SHARE-A4 —— 这个调用方在兜底窗口内吗?窗口**不续期**:读它不会把时间戳往后推。 */
export function withinMediaProxyGrace(caller: string, now: number): boolean {
  const at = recentSuccessAt.get(caller);
  return at !== undefined && now - at <= MEDIA_PROXY_DEGRADED_GRACE_MS;
}

/**
 * SHARE-A12 —— 「限流存储不可用」报警,带逐通道送达回执。
 *
 * 返回 `founderAlert` 的逐通道结果(被节流跳过时返回 `null`)。**回执要被读**:一条
 * 都没 `sent` 的时候单独写一行错误 —— 「报警发出去了」和「报警送到了」不是同一件事,
 * 而这条报警的全部意义就是让人知道客户正在集体吃 429。
 */
export async function alertMediaProxyStoreUnreachable(now: number): Promise<FounderAlertOutcome[] | null> {
  if (lastAlertAt !== null && now - lastAlertAt < MEDIA_PROXY_STORE_ALERT_INTERVAL_MS) return null;
  // 先占住节流位再 await:并发的被拒请求不许各发一条。
  lastAlertAt = now;
  const repeat = alertedThisOutage;
  alertedThisOutage = true;

  const outcomes = await founderAlert(
    {
      key: "media_proxy.rate_limit_store_unreachable",
      title: "The media proxy's rate-limit counter is unreachable — preview media is being refused",
      action:
        "Check Postgres and the rate_limit_counter table. Until it answers, share-preview images return 429 to " +
        "every client outside the short grace window.",
      context: {
        route: "/api/media/pub/[token]",
        graceSeconds: MEDIA_PROXY_DEGRADED_GRACE_MS / 1000,
        retryAfterSeconds: MEDIA_PROXY_DEGRADED_RETRY_AFTER_SECONDS,
      },
    },
    { repeat },
  );

  const receipt = outcomes.map((o) => `${o.channel}=${o.status}`).join(" ");
  if (outcomes.some((o) => o.status === "sent")) {
    console.warn(`[media-proxy] rate-limit store alert delivered — ${receipt}`);
  } else {
    console.error(`[media-proxy] rate-limit store alert NOT delivered — ${receipt}`);
  }
  return outcomes;
}

/** 放行 = 可以吐字节;拒绝 = 429,`retryAfterSeconds` 就是 `Retry-After` 的值。 */
export type MediaProxyAdmission = { admitted: true } | { admitted: false; retryAfterSeconds: number };

/**
 * 这一次请求可以拿到字节吗 —— 上面三件的唯一入口,媒体代理路由只调这一个函数。
 *
 * 顺序是有意的:报警先于兜底判断,因为**兜底放行的那一次同样是一次存储故障**。客户没事
 * 不等于存储没事,而这条报警的全部意义就是别让故障只从商家嘴里知道。
 */
export async function admitMediaProxyRequest(
  requestHeaders: Headers,
  options: { now?: number } = {},
): Promise<MediaProxyAdmission> {
  const now = options.now ?? Date.now();
  const gate = await consumeMediaProxyGate(requestHeaders, { now });

  if (gate.degraded) {
    await alertMediaProxyStoreUnreachable(now);
    if (withinMediaProxyGrace(gate.caller, now)) return { admitted: true }; // SHARE-A4
    return { admitted: false, retryAfterSeconds: MEDIA_PROXY_DEGRADED_RETRY_AFTER_SECONDS }; // SHARE-A3
  }

  if (!gate.allowed) return { admitted: false, retryAfterSeconds: gate.retryAfterSeconds };

  rememberMediaProxySuccess(gate.caller, now);
  return { admitted: true };
}

/**
 * 把这个模块的进程内状态清空。
 *
 * 两个调用方,同一个形状(与 `clearRateLimitCounters` 的理由一致):测试没法等一个 60 秒的
 * 窗口或 5 分钟的报警间隔过去,运维在演练之后需要一个「从干净状态再来一次」的手柄。
 */
export function resetMediaProxyDegradedState(): void {
  recentSuccessAt.clear();
  lastAlertAt = null;
  alertedThisOutage = false;
}
