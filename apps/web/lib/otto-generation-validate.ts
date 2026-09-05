/**
 * validateOwnedGenerationExt — shared OWNER-scoped Generation lookup for turn references.
 *
 * Used by both the "sourceGenerationId" (image-ext, i2v source frame / edit base) and
 * "referenceVideoGenerationId" (video-ext, whole-clip reference) validators in
 * ottoTurn (lib/otto-actions.ts) and the streaming route (app/api/otto/stream/route.ts),
 * and by the $0 clip-card entry (lib/clip-actions.ts).
 *
 * ── 2026-09-04,Codex QA-CRE-FE9-013 —— 这里少了一格,不是多了一格 ──────────────
 *
 * 这个函数从前还要求 `projectId` 相等。而「Choose from Library」读的是**全店**历史
 * (Founder 2026-08-30:Library 是 owner 级的,`@` 与 Library 可跨 Canvas 引用),
 * 于是画布 A 生成的那张产品图在画布 B 被选中时,这一行悄悄把它过滤成 null ——
 * 没有报错、没有回执,USER 消息落库时 `sourceGenerationIds` 是空数组。
 *
 * 现在判据只有一条,住在 `@fikirtive/core` 的 `generationReferenceScope`:
 * **同一 owner、活着、扩展名对得上**。画布是出处,不是权限边界,所以 `projectId`
 * 从过滤条件变成**返回值**(引用回执要说「来自哪一块画布」)。
 *
 * 租户边界一格没松:`ownerId` 仍然只能来自 `requireOwner()` 的 session。
 *
 * Pure pass-through to prisma.generation.findFirst — no side effects, easy to unit test.
 */
import type { PrismaClient } from "@fikirtive/db";
import { generationReferenceScope } from "@fikirtive/core";

/** 一件通过校验的参考素材。`projectId` 是**出处**(哪一块画布做出来的),供回执显示。 */
export type OwnedGenerationRef = {
  id: string;
  projectId: string;
  /** 商家读得懂的名字 —— 这件素材当初的提示词(Library 卡片上显示的同一串)。 */
  prompt: string;
  /** 存储对象的坐标,给「文件还在不在」那一问用。 */
  asset: { ownerId: string; contentHash: string; ext: string };
};

export async function validateOwnedGenerationExt(
  // Narrowed to the one delegate method used, so unit tests can pass a findFirst-only mock.
  prisma: { generation: Pick<PrismaClient["generation"], "findFirst"> },
  { id, ownerId, exts }: { id: string; ownerId: string; exts: string[] },
): Promise<OwnedGenerationRef | null> {
  const g = await prisma.generation.findFirst({
    where: { id, ...generationReferenceScope(ownerId, exts) },
    select: {
      id: true,
      projectId: true,
      promptText: true,
      asset: { select: { ownerId: true, contentHash: true, ext: true } },
    },
  });
  if (!g) return null;
  return {
    id: g.id,
    projectId: g.projectId,
    prompt: g.promptText ?? "",
    asset: g.asset,
  };
}
