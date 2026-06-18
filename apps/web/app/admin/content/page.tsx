import { redirect } from "next/navigation";
import { prisma } from "@artlio/db";
import { FOUNDER_OWNER_ID, storageKey, storageKeyToSrc } from "@artlio/core";
import { requireRole } from "@/lib/auth-guard";
import { ContentAdmin, type GenRow, type BlockRow } from "@/components/admin/ContentAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Content · Artlio admin" };

// renders Generation.asset → src exactly like getRecentGenResults / getGenerationThumbs
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);

export default async function ContentPage() {
  // §③ Content & moderation read = moderator+ (per the section→role matrix).
  // requireRole re-asserts the allowlist outer wall + the matrix, and audits a denied read.
  const gate = await requireRole("content", "read");
  if ("error" in gate) redirect("/login?from=/admin/content");

  // REVIEW-ONLY: read recent produced media + the existing guardian-block moderation
  // signal. NO enforcement here — the real fal-safety gate is a separate deferred task.
  const [gens, blocks] = await Promise.all([
    prisma.generation.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, deletedAt: null },
      orderBy: { createdAt: "desc" }, take: 60,
      include: { asset: true, project: { select: { name: true } } },
    }),
    prisma.actionEvent.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, type: "gen.guardian-block" },
      orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, projectId: true, payload: true, createdAt: true },
    }),
  ]);

  const rows: GenRow[] = gens.map((g) => {
    const ext = g.asset.ext.toLowerCase();
    return {
      id: g.id,
      project: g.project?.name ?? "(unknown)",
      prompt: g.promptText,
      modelRef: g.modelRef,
      kind: VIDEO_EXTS.has(ext) ? ("video" as const) : ("image" as const),
      src: storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, ext)),
      createdAt: g.createdAt.toISOString(),
    };
  });

  const blockRows: BlockRow[] = blocks.map((b) => ({
    id: b.id, projectId: b.projectId,
    payload: JSON.stringify(b.payload ?? {}), createdAt: b.createdAt.toISOString(),
  }));

  return <ContentAdmin gens={rows} blocks={blockRows} />;
}
