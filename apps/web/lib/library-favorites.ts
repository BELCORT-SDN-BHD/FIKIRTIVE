"use server";

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { filterVisibleSubjects, resolveLibrarySubjects } from "./library-subjects";
import { isLibrarySubjectType, subjectKey } from "./library-types";
import type {
  LibraryFavoriteItem,
  LibraryFavoritePage,
  LibrarySubjectRef,
  LibrarySubjectType,
} from "./library-types";

/**
 * 收藏 —— **唯一**的业务动作层(规格 docs/specs/frontend-baseline.md §7.3② 与
 * §5 的 2026-09-03「裁决十」;验收 FRONT-A5)。
 *
 * 「人工 UI 与 Otto 走同一业务动作层」在这里是字面意思:素材详情面板的 Save 键
 * (`lib/asset-actions.ts` 的 `setFavorite`)与 Otto 的 `manageLibrary set_favorite`
 * (`lib/otto-library-port.ts`)都调进 `setLibraryFavorite`,不存在第二份收藏实现。
 *
 * 权威只有 `Favorite` 一张表。`Generation.favorite` 那一列在迁移里被**读**过一次(回灌),
 * 之后再没有任何写路径碰它;读路径也不再拿它当真相。保留那一列只为让迁移可以干净回滚
 * (见 migration 目录里的 rollback.sql),删列另开一票。
 */

const FAVORITE_SCAN_BUFFER = 20;

function parseFavoriteCursor(cursor: string): { at: Date; id: string } | null {
  const sep = cursor.lastIndexOf("|");
  if (sep <= 0) return null;
  const at = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !id) return null;
  return { at, id };
}

/**
 * 收藏 / 取消收藏一件素材。幂等:重复收藏不会长出第二行,重复取消也不报错。
 *
 * 写入前重新校验目标 —— 它必须仍然存在、仍然属于**当前会话解析出来的** org
 * (`requireOwner`,客户端传来的任何 ownerId 都不作数)。校验不过一律回 "Not found."。
 */
export async function setLibraryFavorite(
  subjectType: string,
  subjectId: string,
  favorite: boolean,
): Promise<{ favorite: boolean } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  if (!isLibrarySubjectType(subjectType) || !subjectId) return { error: "Not found." };
  const ref: LibrarySubjectRef = { subjectType, subjectId };

  const visible = await filterVisibleSubjects(ownerId, [ref]);
  if (!visible.length) return { error: "Not found." };

  if (favorite) {
    // 幂等压在 (ownerId, subjectType, subjectId) 唯一约束上,而不是「先查后建」——
    // 后者在两次快速点击下会双双查空、双双插入。
    await prisma.favorite.upsert({
      where: { ownerId_subjectType_subjectId: { ownerId, subjectType, subjectId } },
      update: {},
      create: { id: newId(), ownerId, subjectType, subjectId },
    });
  } else {
    await prisma.favorite.deleteMany({ where: { ownerId, subjectType, subjectId } });
  }
  return { favorite };
}

/**
 * 这一批素材里,哪些已经被当前 org 收藏了。网格用它给每块卡片标心。
 * 返回的是 `subjectKey()` 的集合(数组形态 —— server action 的返回值要可序列化)。
 */
export async function listFavoriteKeys(
  refs: { subjectType: string; subjectId: string }[],
): Promise<{ keys: string[] } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const wanted = refs.filter(
    (ref): ref is LibrarySubjectRef => isLibrarySubjectType(ref.subjectType) && Boolean(ref.subjectId),
  );
  if (!wanted.length) return { keys: [] };

  const rows = await prisma.favorite.findMany({
    where: {
      ownerId,
      OR: wanted.map((ref) => ({ subjectType: ref.subjectType, subjectId: ref.subjectId })),
    },
    select: { subjectType: true, subjectId: true },
  });
  return {
    keys: rows
      .filter((row): row is { subjectType: LibrarySubjectType; subjectId: string } =>
        isLibrarySubjectType(row.subjectType),
      )
      .map(subjectKey),
  };
}

/**
 * 收藏页:**一次查询、按收藏时间倒序**(裁决十点名的形状)。
 *
 * 游标 = `<收藏时间 ISO>|<收藏行 id>`,id 是并列时的 tiebreak,所以不会跳行也不会重复。
 * resolve 会丢掉媒体已经不在存储里的行,所以一页扫多一点再截断 —— 与生成历史同一手法。
 */
export async function listLibraryFavorites(
  opts?: { cursor?: string | null; take?: number },
): Promise<LibraryFavoritePage | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const take = opts?.take ?? 60;
  const scanTake = Math.min(Math.max(take + FAVORITE_SCAN_BUFFER, take + 1), 100);

  let cursorWhere = {};
  if (opts?.cursor) {
    const parsed = parseFavoriteCursor(opts.cursor);
    if (parsed) {
      cursorWhere = {
        OR: [
          { createdAt: { lt: parsed.at } },
          { createdAt: parsed.at, id: { lt: parsed.id } },
        ],
      };
    }
  }

  const rows = await prisma.favorite.findMany({
    where: { ownerId, ...cursorWhere },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: scanTake + 1,
    select: { id: true, subjectType: true, subjectId: true, createdAt: true },
  });

  const scanned = rows.slice(0, scanTake);
  const refs = scanned
    .filter((row): row is typeof row & { subjectType: LibrarySubjectType } =>
      isLibrarySubjectType(row.subjectType),
    )
    .map((row) => ({ subjectType: row.subjectType, subjectId: row.subjectId }));
  const resolved = await resolveLibrarySubjects(ownerId, refs);

  const existing: { row: (typeof scanned)[number]; item: LibraryFavoriteItem }[] = [];
  for (const row of scanned) {
    if (!isLibrarySubjectType(row.subjectType)) continue;
    const item = resolved.get(subjectKey({ subjectType: row.subjectType, subjectId: row.subjectId }));
    if (!item) continue;
    existing.push({ row, item: { ...item, favoritedAt: row.createdAt.toISOString() } });
  }

  const items = existing.slice(0, take).map((entry) => entry.item);
  const cursorRow =
    existing.length > take
      ? existing[take - 1]!.row
      : rows.length > scanTake
        ? scanned[scanned.length - 1]
        : null;
  const nextCursor = cursorRow ? `${cursorRow.createdAt.toISOString()}|${cursorRow.id}` : null;
  return { items, nextCursor, hasMore: nextCursor != null };
}
