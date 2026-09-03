import "server-only";

import { prisma } from "@fikirtive/db";
import { storageKey, storageKeyToSrc } from "@fikirtive/core";
import { storage } from "./storage";
import { subjectKey, type LibrarySubjectItem, type LibrarySubjectRef } from "./library-types";

/**
 * 类型化 ID 的**服务端**那一半:租户校验与 resolve(规格 §7.3②;FRONT-A5 / A6 / A7)。
 * 类型定义与两个纯函数住在 `library-types.ts`(客户端也要用),这里只放要读库的东西。
 */

const LIBRARY_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);

/**
 * 把一批 ref 过一遍租户与存活校验,返回**当前这个 org 真的看得见**的那些。
 *
 * 这是写入前的那道门:加收藏、加进合集之前都要过它。看不见的一律当作不存在 ——
 * 不区分「不属于你」和「已经删了」,因为这两者的区别本身就是跨租户的信息。
 */
export async function filterVisibleSubjects(
  ownerId: string,
  refs: readonly LibrarySubjectRef[],
): Promise<LibrarySubjectRef[]> {
  const generationIds = refs.filter((r) => r.subjectType === "generation").map((r) => r.subjectId);
  if (!generationIds.length) return [];
  const rows = await prisma.generation.findMany({
    where: { id: { in: generationIds }, ownerId, deletedAt: null },
    select: { id: true },
  });
  const live = new Set(rows.map((row) => row.id));
  return refs.filter((r) => r.subjectType === "generation" && live.has(r.subjectId));
}

/**
 * 把一批 ref resolve 成可显示的素材。
 *
 * 与生成历史读模型同一口径:媒体文件已经不在存储里的行会被丢掉(`storage.exists`),
 * 因为网格上画不出一块不存在的图。**链接本身不会被这次读取删掉** —— 收藏行 / 合集成员行
 * 还在,只是这一次不显示;这与「删链接不删原对象」是同一条规矩的两面。
 */
export async function resolveLibrarySubjects(
  ownerId: string,
  refs: readonly LibrarySubjectRef[],
): Promise<Map<string, LibrarySubjectItem>> {
  const out = new Map<string, LibrarySubjectItem>();
  const generationIds = refs.filter((r) => r.subjectType === "generation").map((r) => r.subjectId);
  if (!generationIds.length) return out;

  const rows = await prisma.generation.findMany({
    where: { id: { in: generationIds }, ownerId, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      assetId: true,
      promptText: true,
      source: true,
      createdAt: true,
      asset: { select: { ownerId: true, contentHash: true, ext: true } },
    },
  });

  const resolved = await Promise.all(
    rows.map(async (row) => {
      const ext = row.asset.ext.toLowerCase();
      const key = storageKey(row.asset.ownerId, row.asset.contentHash, ext);
      if (!(await storage.exists(key))) return null;
      return {
        subjectType: "generation",
        subjectId: row.id,
        id: row.id,
        projectId: row.projectId,
        assetId: row.assetId,
        url: storageKeyToSrc(key),
        kind: LIBRARY_VIDEO_EXTS.has(ext) ? "video" : "image",
        prompt: row.promptText ?? "",
        source: row.source === "UPLOAD" ? "upload" : "generated",
        createdAt: row.createdAt.toISOString(),
      } satisfies LibrarySubjectItem;
    }),
  );

  for (const item of resolved) {
    if (item) out.set(subjectKey(item), item);
  }
  return out;
}
