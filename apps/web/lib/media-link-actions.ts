"use server";

import { prisma } from "@fikirtive/db";
import { storageKey } from "@fikirtive/core";
import { signMediaToken } from "@fikirtive/token-crypto";
import { requireOwner } from "./auth-guard";
import { PUBLIC_MEDIA_TTL_MS, PUBLIC_MEDIA_TTL_MINUTES, publicMediaPath } from "./media-public-link";

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
 */
export async function getPublicMediaLink(
  generationId: string,
): Promise<{ path: string; expiresInMinutes: number } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const secret = process.env.MEDIA_PROXY_SECRET ?? "";
  if (!secret) return { error: "Sharing links aren't configured in this environment yet." };

  const gen = await prisma.generation.findFirst({
    where: { id: generationId, ownerId, deletedAt: null },
    select: { asset: { select: { ownerId: true, contentHash: true, ext: true } } },
  });
  if (!gen) return { error: "Not found." };
  if (gen.asset.ownerId !== ownerId) return { error: "Not found." };

  const key = storageKey(gen.asset.ownerId, gen.asset.contentHash, gen.asset.ext.toLowerCase());
  const token = signMediaToken(ownerId, key, Date.now() + PUBLIC_MEDIA_TTL_MS, secret);
  return { path: publicMediaPath(token), expiresInMinutes: PUBLIC_MEDIA_TTL_MINUTES };
}
