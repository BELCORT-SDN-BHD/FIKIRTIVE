"use server";

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { filterVisibleSubjects, resolveLibrarySubjects } from "./library-subjects";
import { isLibrarySubjectType, subjectKey } from "./library-types";
import type {
  LibraryCollectionDetail,
  LibraryCollectionItemView,
  LibraryCollectionSummary,
  LibrarySubjectRef,
  LibrarySubjectType,
} from "./library-types";

/**
 * 合集 —— 一层结构、只存链接(设计 `design-system/patterns/library/README.md` §3.4;
 * 规格 §7.3②;验收 FRONT-A6)。
 *
 * 三条不可动摇的规矩,全部由这一个文件负责:
 *  ① 只保存**对象链接**。加进合集不复制文件,同一个素材可以属于多个合集。
 *  ② 移除成员、删除合集,都**不删原对象** —— 成员对象仍然在 Library 的 canonical 视图里。
 *  ③ 每一次写入都重新校验目标仍然存在、仍然属于当前会话解析出来的 org。
 *
 * 删除合集用软删(`deletedAt`):成员行留在原地跟着一起隐身,不需要一次删几千行,
 * 也让「删错了」这件事在数据层还有救。CollectionItem 的外键是 Cascade,所以将来真要硬删
 * 一个合集,它自己的成员行会跟着走 —— 而生成结果一行都不会动。
 */

const COLLECTION_NAME_MAX = 80;
const COLLECTION_ITEM_SCAN_BUFFER = 20;

function cleanName(name: string): string {
  return name.trim().slice(0, COLLECTION_NAME_MAX);
}

function toRefs(input: { subjectType: string; subjectId: string }[]): LibrarySubjectRef[] {
  return input.filter(
    (ref): ref is LibrarySubjectRef => isLibrarySubjectType(ref.subjectType) && Boolean(ref.subjectId),
  );
}

/** 这个 org 的合集列表:名字、真实成员数、最后更新时间、封面(最新加入的那件素材)。 */
export async function listCollections(): Promise<
  { collections: LibraryCollectionSummary[] } | { error: string }
> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const collections = await prisma.collection.findMany({
    where: { ownerId, deletedAt: null },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true, name: true, updatedAt: true },
  });
  if (!collections.length) return { collections: [] };

  const ids = collections.map((collection) => collection.id);

  // 成员数 = **存的链接数**,不是「这一页画得出来的块数」。合集真的收了那么多条,
  // 某一件素材今天预览不出来不改变这个事实(设计里 count 是合集的属性,不是网格的属性)。
  const counts = await prisma.collectionItem.groupBy({
    by: ["collectionId"],
    where: { ownerId, collectionId: { in: ids } },
    _count: { _all: true },
  });
  const countByCollection = new Map(counts.map((row) => [row.collectionId, row._count._all]));

  // 封面 = 每个合集最新加入的那一件。`distinct` 在 orderBy 之后取每组第一行。
  const covers = await prisma.collectionItem.findMany({
    where: { ownerId, collectionId: { in: ids } },
    orderBy: [{ collectionId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    distinct: ["collectionId"],
    select: { collectionId: true, subjectType: true, subjectId: true },
  });
  const resolved = await resolveLibrarySubjects(
    ownerId,
    toRefs(covers.map((row) => ({ subjectType: row.subjectType, subjectId: row.subjectId }))),
  );
  const coverByCollection = new Map(
    covers.flatMap((row) => {
      if (!isLibrarySubjectType(row.subjectType)) return [];
      const item = resolved.get(subjectKey({ subjectType: row.subjectType, subjectId: row.subjectId }));
      return item ? [[row.collectionId, item.url] as const] : [];
    }),
  );

  return {
    collections: collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      itemCount: countByCollection.get(collection.id) ?? 0,
      updatedAt: collection.updatedAt.toISOString(),
      coverUrl: coverByCollection.get(collection.id) ?? null,
    })),
  };
}

export async function createCollection(
  name: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const clean = cleanName(name ?? "");
  if (!clean) return { error: "Name this collection first." };

  const id = newId();
  await prisma.collection.create({ data: { id, ownerId, name: clean } });
  return { id, name: clean };
}

export async function renameCollection(
  collectionId: string,
  name: string,
): Promise<{ name: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const clean = cleanName(name ?? "");
  if (!clean) return { error: "Name this collection first." };

  const result = await prisma.collection.updateMany({
    where: { id: collectionId, ownerId, deletedAt: null },
    data: { name: clean },
  });
  return result.count === 1 ? { name: clean } : { error: "Not found." };
}

/**
 * 删除合集。软删 —— 成员链接跟着隐身,**成员对象一件都没动**(验收 FRONT-A6 明写:
 * 删完之后它们仍然能从 Library 打开)。
 */
export async function deleteCollection(
  collectionId: string,
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const result = await prisma.collection.updateMany({
    where: { id: collectionId, ownerId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return result.count === 1 ? { ok: true } : { error: "Not found." };
}

/**
 * 把一批素材加进一个合集。
 *
 * 幂等:同一个合集里同一件素材只有一行,重复加入被 `(collectionId, subjectType, subjectId)`
 * 唯一约束挡下(`skipDuplicates`),不是靠「先查后建」。
 * 返回真正新加了几条 —— 界面据此说实话("2 added, 1 already there"),而不是一律弹成功。
 */
export async function addToCollection(
  collectionId: string,
  refs: { subjectType: string; subjectId: string }[],
): Promise<{ added: number; skipped: number } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!collection) return { error: "Not found." };

  const wanted = toRefs(refs ?? []);
  if (!wanted.length) return { error: "Not found." };

  // 目标必须仍然存在、仍然属于这个 org —— 客户端传来的 id 只是定位参数。
  const visible = await filterVisibleSubjects(ownerId, wanted);
  if (!visible.length) return { error: "Not found." };

  const created = await prisma.collectionItem.createMany({
    data: visible.map((ref) => ({
      id: newId(),
      ownerId,
      collectionId,
      subjectType: ref.subjectType,
      subjectId: ref.subjectId,
    })),
    skipDuplicates: true,
  });
  if (created.count > 0) {
    await prisma.collection.updateMany({
      where: { id: collectionId, ownerId, deletedAt: null },
      data: { updatedAt: new Date() },
    });
  }
  return { added: created.count, skipped: wanted.length - created.count };
}

/** 从合集里移除一件素材。移除的是**链接**;素材本身留在 Library(FRONT-A6)。 */
export async function removeFromCollection(
  collectionId: string,
  subjectType: string,
  subjectId: string,
): Promise<{ removed: number } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  if (!isLibrarySubjectType(subjectType) || !subjectId) return { error: "Not found." };

  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!collection) return { error: "Not found." };

  const result = await prisma.collectionItem.deleteMany({
    where: { ownerId, collectionId, subjectType, subjectId },
  });
  if (result.count > 0) {
    await prisma.collection.updateMany({
      where: { id: collectionId, ownerId, deletedAt: null },
      data: { updatedAt: new Date() },
    });
  }
  return { removed: result.count };
}

/** 合集详情:卡片信息 ＋ 这一页成员(按加入时间倒序,与列表页同一套游标手法)。 */
export async function getCollection(
  collectionId: string,
  opts?: { cursor?: string | null; take?: number },
): Promise<{ collection: LibraryCollectionDetail; nextCursor: string | null } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId, deletedAt: null },
    select: { id: true, name: true, updatedAt: true },
  });
  if (!collection) return { error: "Not found." };

  const take = opts?.take ?? 60;
  const scanTake = Math.min(Math.max(take + COLLECTION_ITEM_SCAN_BUFFER, take + 1), 100);

  let cursorWhere = {};
  if (opts?.cursor) {
    const sep = opts.cursor.lastIndexOf("|");
    const at = new Date(opts.cursor.slice(0, sep));
    const id = opts.cursor.slice(sep + 1);
    if (sep > 0 && !Number.isNaN(at.getTime()) && id) {
      cursorWhere = { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] };
    }
  }

  const rows = await prisma.collectionItem.findMany({
    where: { ownerId, collectionId, ...cursorWhere },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: scanTake + 1,
    select: { id: true, subjectType: true, subjectId: true, createdAt: true },
  });
  const scanned = rows.slice(0, scanTake);
  const resolved = await resolveLibrarySubjects(
    ownerId,
    toRefs(scanned.map((row) => ({ subjectType: row.subjectType, subjectId: row.subjectId }))),
  );

  const existing: { row: (typeof scanned)[number]; item: LibraryCollectionItemView }[] = [];
  for (const row of scanned) {
    if (!isLibrarySubjectType(row.subjectType)) continue;
    const item = resolved.get(subjectKey({ subjectType: row.subjectType, subjectId: row.subjectId }));
    if (!item) continue;
    existing.push({ row, item: { ...item, addedAt: row.createdAt.toISOString() } });
  }

  const items = existing.slice(0, take).map((entry) => entry.item);
  const cursorRow =
    existing.length > take
      ? existing[take - 1]!.row
      : rows.length > scanTake
        ? scanned[scanned.length - 1]
        : null;

  const total = await prisma.collectionItem.count({ where: { ownerId, collectionId } });

  return {
    collection: {
      id: collection.id,
      name: collection.name,
      itemCount: total,
      updatedAt: collection.updatedAt.toISOString(),
      coverUrl: items[0]?.url ?? null,
      items,
    },
    nextCursor: cursorRow ? `${cursorRow.createdAt.toISOString()}|${cursorRow.id}` : null,
  };
}

/** 这一批素材各自属于哪些合集(详情面板 / 网格标记用)。返回 `subjectKey -> collectionId[]`。 */
export async function listCollectionMemberships(
  refs: { subjectType: string; subjectId: string }[],
): Promise<{ memberships: Record<string, string[]> } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const wanted = toRefs(refs ?? []);
  if (!wanted.length) return { memberships: {} };

  const rows = await prisma.collectionItem.findMany({
    where: {
      ownerId,
      collection: { deletedAt: null },
      OR: wanted.map((ref) => ({ subjectType: ref.subjectType, subjectId: ref.subjectId })),
    },
    select: { collectionId: true, subjectType: true, subjectId: true },
  });

  const memberships: Record<string, string[]> = {};
  for (const row of rows) {
    if (!isLibrarySubjectType(row.subjectType)) continue;
    const key = subjectKey({
      subjectType: row.subjectType as LibrarySubjectType,
      subjectId: row.subjectId,
    });
    (memberships[key] ??= []).push(row.collectionId);
  }
  return { memberships };
}
