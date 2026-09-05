import "server-only";

import { prisma } from "@fikirtive/db";
import { entityCapabilities, entityOrigin, storageKey, storageKeyToSrc } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
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

  const rows = await prisma.entity.findMany({
    where: { ownerId, deletedAt: null },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: {
      id: true,
      type: true,
      name: true,
      catalogKey: true,
      referenceImages: {
        where: { deletedAt: null, variantId: null },
        orderBy: { position: "asc" },
        select: { asset: { select: { ownerId: true, contentHash: true, ext: true } } },
      },
    },
  });

  const elements = await Promise.all(rows.map(async (row) => {
    const kind = libraryElementKind(row.type, row.catalogKey);
    if (!kind) return null;
    const first = row.referenceImages[0]?.asset;
    // 字节真的还在才给封面 —— 与生成历史同一条纪律:不给一个必然坏掉的 <img src>。
    let coverUrl: string | null = null;
    if (first) {
      const key = storageKey(first.ownerId, first.contentHash, first.ext.toLowerCase());
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
      mediaCount: row.referenceImages.length,
    } satisfies LibraryElement;
  }));

  return elements.filter((element): element is LibraryElement => element != null);
}
