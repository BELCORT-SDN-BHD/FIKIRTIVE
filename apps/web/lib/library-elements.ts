import "server-only";

import { prisma } from "@fikirtive/db";
import { entityCapabilities, entityOrigin, storageKey, storageKeyToSrc } from "@fikirtive/core";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { runAsUser } from "@fikirtive/db/principal";
import { storage } from "./storage";
import { libraryElementKind, type LibraryElement } from "./library-elements-model";

/**
 * Library 的 **Elements** 视图要的那一点点东西(前端基线规格 §7.1 段②)。
 *
 * 权威对象仍然是 `Entity` —— 这里不建第二份身份,只是一个更窄的读:已批准的 Library 设计
 * 在 Elements 里按 `Products / Characters / Official avatars / Clothes / Locations` 分栏
 * (patterns/library/README.md §3.5),而现成的 `lib/data.ts:getEntities` 有两处对不上:
 *   · 它不返回 `catalogKey` —— 而「Official avatars」与「Characters」之间**唯一**的区别
 *     就是这一列(演员库播种在 `lib/actor-library-seed.ts`;商家自建的元素永远是 null);
 *   · 它顺带把 variants、每个 variant 的参考图、以及一次 GenJob 扫描全拖进来,那是元素
 *     编辑面要的,不是一格卡片要的。
 * 所以这里只取卡片上真的画得出来的四样:身份、名字、封面、关联媒体数。
 *
 * 租户:`ownerId` 只来自服务端 `requireOwner()`,调用方不传、也传不进来。
 * 这个读只在服务端渲染时跑一次(Elements 没有分页与筛选),所以它不是 server action。
 */
export async function getLibraryElements(): Promise<LibraryElement[] | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<LibraryElement[] | { error: string }> => {
    const rows = await prisma.entity.findMany({
      where: { ownerId, deletedAt: null },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: {
        id: true,
        type: true,
        name: true,
        catalogKey: true,
        baseAssetId: true,
        referenceImages: {
          where: { deletedAt: null, variantId: null },
          orderBy: { position: "asc" },
          select: { assetId: true, asset: { select: { ownerId: true, contentHash: true, ext: true } } },
        },
      },
    });

    const elements = await Promise.all(rows.map(async (row): Promise<LibraryElement | null> => {
      const kind = libraryElementKind(row.type, row.catalogKey);
      if (!kind) return null;
      const keyOf = (ref: (typeof row.referenceImages)[number]) =>
        storageKey(ref.asset.ownerId, ref.asset.contentHash, ref.asset.ext.toLowerCase());
      // 封面 = 身份上钉的那一张,**只认这一张**(`Entity.baseAssetId`;规格 §5,
      // Founder 2026-09-15 裁决;验收 PRODID-A4)。
      //
      // 从前这里还有一句 `?? row.referenceImages[0]`「没钉过就沿用第一张」,而 Brand 那条读路
      // (`packages/core/src/brand-records.ts:withProductIdentity`)在没钉过时是**当作没有主图**的
      // —— 同一件产品于是有两张脸:Library 一张图,Brand 一个空位。裁决把这件事挪到了写路:
      // 挂上第一张参考图的同一个事务里就钉成封面(`@fikirtive/db:reconcileEntityCover`),存量
      // 数据由迁移 20260915120000_entity_cover_autopin 一次补齐。读路从此不再各自猜一遍。
      //
      // 拿的是这一张本身,所以「钉的那张字节没了」仍然是没有封面,不静默换成另一张 —— 与 Brand
      // 逐字同一口径。
      const cover = row.referenceImages.find((ref) => ref.assetId === row.baseAssetId);
      // **整个列表只探这一张**:字节真的还在才给封面 —— 与生成历史同一条纪律,不给一个必然
      // 坏掉的 <img src>。一格一张图地探会让这一页的 HEAD 数从「每个元素一次」涨成「每张
      // 参考图一次」(无上限的 `Promise.all`),而 `storage.exists` 对非 404 是**往上抛**的:
      // 一次瞬时故障就能把整张 /library 掀翻。弹层里那一排缩略图因此**不探**,与已批准的
      // `ElementVariantsDialog` 逐字同一口径 —— 它画的 `entity.refs` 同样只是
      // `lib/dto.ts:refOf` 拼出来的 url,一次都没有探过。
      let coverUrl: string | null = null;
      if (cover) {
        const key = keyOf(cover);
        if (await storage.exists(key)) coverUrl = storageKeyToSrc(key);
      }
      return {
        id: row.id,
        kind,
        name: row.name,
        // 只读判据算在域层、只算这一次(`packages/core/src/entity-policy.ts`),和
        // `lib/dto.ts:toEntityDTO` 走的是同一个函数 —— Library 不另起一套「是不是官方」。
        origin: entityOrigin(row),
        capabilities: entityCapabilities(row),
        coverUrl,
        baseAssetId: row.baseAssetId,
        images: row.referenceImages.map((ref) => ({ assetId: ref.assetId, url: storageKeyToSrc(keyOf(ref)) })),
        mediaCount: row.referenceImages.length,
      } satisfies LibraryElement;
    }));

    return elements.filter((element): element is LibraryElement => element != null);
  });
}
