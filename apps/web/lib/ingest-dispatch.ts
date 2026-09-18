import "server-only";
import * as Sentry from "@sentry/node";
import { INGEST_QUEUE } from "@fikirtive/core";
import { getBoss } from "./queue";

/**
 * 上传落行之后把 ingest 派出去 —— **全站唯一**的那一处(家规 §7.3 单一真相)。
 *
 * ingest 这一条活干两件事,两件都不是可有可无的装饰:
 *  ① **哈希复核**(T4b / D19 第 3 条)。直传路径上 `sha256` 只是浏览器的声明,worker 重新
 *     流式算一遍,对不上就删对象、软删行。
 *  ② **元数据探测**(ffprobe 写 `Asset.width/height/durationS`)。素材理解的扫描器只捞
 *     元数据齐的行(`METADATA_READY_FOR_UNDERSTANDING`,apps/worker/src/jobs/understand.ts),
 *     所以**没派这条活 = 那件素材不会被理解,也就不会按 MONEY-A9 扣那 0.1 credit、更不会
 *     出回执**。这不是免费,是延后:兜底的 `redispatchLostIngest` 会在 15 分钟–24 小时之间
 *     把它补投出去(`apps/worker/src/jobs/ingest.ts`),窗口一开照样建行、照样扣。
 *
 * R3-F25(Founder 2026-09-18 裁决「这个设计完全不合理,可以移除」):画布拖放上传
 * (`lib/actions.ts` 的 `uploadReference`)从 2026-06-12 起就没派过这条活 —— 那是一次抄漏,
 * 不是设计(考据见 PR 说明)。修法不是在第二处再写一遍这段循环,而是把这段循环提到这里,
 * 让两条上传入口调**同一个**函数。谁将来再加一条上传入口,也只有这一个函数可调。
 *
 * ── 失败了怎么办(C1b ③ 的结论,原样搬过来,一个字没改)────────────────────────
 * 调用方**照样回 `ok`**:行确实已经提交、文件确实已经在商家的素材库里,告诉他们「失败了」
 * 是另一个谎,而且是那种会让人再传一遍的谎。缺的从来不是商家那一半,是我们这一半 ——
 * 所以失败在这里**报警**(Sentry),并且**一个失败不拖垮整批**:每个 id 各试各的。
 *
 * RESIDUAL,写明而不是糊过去:从这一刻到那个补投窗之间,资产带着客户端声明的哈希是可见的。
 * 真正收口要 `Asset.verifiedAt` + 未验证不可见,那是一次 schema 改动,仍然延后。
 *
 * `getBoss()` 放在循环**里面**是刻意的,而且不花钱。它是一个带缓存的懒单例(lib/queue.ts):
 * 顺路时第一次之后每一轮拿到的都是同一个已解析的句柄;队列真的挂了时,它的失败格进入冷却,
 * 于是第 2..N 轮**立刻**被拒,而不是各自再付一次连接超时 —— 十个一批是快速失败,不是慢十次。
 * 把这行提到循环外面,会让整批重新挤到一个 `await` 后面,也就把「一次失败甩下整批」那条
 * 缺陷请了回来。
 */
export async function dispatchIngest(assetIds: string[]): Promise<void> {
  const undispatched: string[] = [];
  for (const id of assetIds) {
    try {
      const boss = await getBoss();
      await boss.send(INGEST_QUEUE, { assetId: id });
    } catch (e) {
      undispatched.push(id);
      console.error("[upload] UNVERIFIED — ingest dispatch failed for", id, ":", e instanceof Error ? e.message : e);
    }
  }
  if (undispatched.length > 0) reportUndispatchedIngest(undispatched);
}

/**
 * C1b ③ —— 一次派不出去的 ingest,报到有人看得见的地方。
 *
 * 载荷只带资产 id,**别的一个字都不带** —— 没有租户、没有文件名、没有哈希。一件未验证的
 * 上传是某个人的私人文件;运维要动手需要的是「有几行、是哪几行」,而这两件事一个 id 就答得完。
 * (与死信探针 `lib/dlq-watch.ts` 同一条纪律:说清楚什么卡住了,绝不说那是谁的。)
 */
function reportUndispatchedIngest(assetIds: string[]): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureMessage(`ingest dispatch failed for ${assetIds.length} upload(s) — hashes unverified until the sweep`, {
    level: "error",
    tags: { probe: "ingest-dispatch" },
    extra: { assetIds: assetIds.join(" "), count: assetIds.length },
  });
}
