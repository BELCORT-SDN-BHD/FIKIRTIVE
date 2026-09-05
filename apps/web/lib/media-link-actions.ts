"use server";

import { prisma } from "@fikirtive/db";
import { storageKey } from "@fikirtive/core";
import { signMediaToken } from "@fikirtive/token-crypto";
import { requireOwner } from "./auth-guard";
import { PUBLIC_MEDIA_TTL_MS, publicMediaPath, publicMediaTtlProblem } from "./media-public-link";

/**
 * 「Copy link」背后的那一步 —— 把一条生成结果铸成一条**别人打得开**的签名地址。
 *
 * 为什么需要它:`getGeneration` 给面板的 `url` 是 `storage.url()` 的站内路径
 * (`/files/u/<ownerId>/<hash>.png`,见 packages/storage/src/index.ts 的 `url()`)。那条路
 * 归登录墙管(`proxy.ts` 的 matcher 只放行 `/api/media/pub/*`),而且是相对路径 —— 商家把它
 * 贴到别处,对方要么撞登录墙,要么拿到一段没有域名的字符串。屏幕上写着「Copy link」,手上
 * 却是一条打不开的链子,这正是 FRONT-A12 要拦的那类「假成功」。
 *
 * 复用既有的那道门,不造第二套分享实现:签名逻辑 `signMediaToken`、验证与流字节
 * `app/api/media/pub/[token]/route.ts`、路径与 TTL `lib/media-public-link.ts` —— 与
 * seat-less 分享预览(`share-preview-view.ts`)读的是同一份。
 *
 * 三道闸,一道不过就不给链子(fail closed,与那道门同一条纪律):
 *   ① `requireOwner()` —— 租户身份只来自服务端 principal;
 *   ② 行必须在这个 owner 名下且没被软删;
 *   ③ 资产的命名空间必须还是同一个 owner(签之前再核一次,签名 bug 也跨不了租户)。
 * secret 没配(本机 / 没设过这把钥匙的环境)⇒ 明说签不出来,绝不退回那条登录墙路径冒充成功。
 *
 * `ttlMs`(Founder 2026-09-05 裁决「同意,但是加上可以自由设定时间」):商家自己挑这条链
 * 活多久,不挑就是默认那 10 分钟(share-preview 那一头照旧不传,行为一个字没变)。
 * 它**从客户端上来**,所以这里必须自己再判一次 —— 判的口径与屏幕上那一次同一个函数
 * (`publicMediaTtlProblem`,单源在 `media-public-link.ts`)。越界一律拒绝铸链,**不夹到
 * 上限**:悄悄把 90 天改成 30 天,商家会拿着一条他以为能活三个月的链子去发。
 * 时长本身签在令牌里(`signMediaToken` 的 `exp`,进 HMAC 载荷),改一个字节整条令牌就失效,
 * 所以「客户端自报时长」不构成一条可以被拉长的路 —— 上限在这一处成立就够了。
 * ttl 这一闸放在读库之前:它的答案与这个 id 存不存在无关,不构成存在性探针。
 */
export async function getPublicMediaLink(
  generationId: string,
  ttlMs: number = PUBLIC_MEDIA_TTL_MS,
): Promise<{ path: string; expiresInMs: number } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const ttlProblem = publicMediaTtlProblem(ttlMs);
  if (ttlProblem) return { error: ttlProblem };

  const secret = process.env.MEDIA_PROXY_SECRET ?? "";
  if (!secret) return { error: "Sharing links aren't configured in this environment yet." };

  const gen = await prisma.generation.findFirst({
    where: { id: generationId, ownerId, deletedAt: null },
    select: { asset: { select: { ownerId: true, contentHash: true, ext: true } } },
  });
  if (!gen) return { error: "Not found." };
  if (gen.asset.ownerId !== ownerId) return { error: "Not found." };

  const key = storageKey(gen.asset.ownerId, gen.asset.contentHash, gen.asset.ext.toLowerCase());
  const token = signMediaToken(ownerId, key, Date.now() + ttlMs, secret);
  // 回的是**真签进令牌的那个时长**,不是屏幕上挑的那个 —— 屏幕上那句话照这个数字写,
  // 两者只有一个源头,不可能出现「写着 24 小时、链子活 10 分钟」。
  return { path: publicMediaPath(token), expiresInMs: ttlMs };
}
