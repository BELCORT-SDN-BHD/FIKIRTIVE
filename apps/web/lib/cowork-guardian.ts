import "server-only";
/**
 * consistencyGuardian (Phase 2) — the web side: load the DB state a generation
 * would condition on, run the pure castFindings decision, and add the i2v
 * source/tail pre-checks. Returns {error,report} for a HARD finding (so startGen
 * can block BEFORE spend) or null to proceed.
 *
 * fail-OPEN: the WHOLE body is wrapped so a Guardian fault (DB hiccup, bug) can
 * NEVER block a legit render — it returns null and the existing gate stands. It
 * only ever ADDS blocks; it can't loosen the existing money-safety.
 */
import { prisma } from "@artlio/db";
import { FOUNDER_OWNER_ID, modelFamily, deriveMode, castFindings, type CastFinding } from "@artlio/core";
import { getCastRule } from "./cowork-knowledge";

const IMG_EXTS = ["png", "jpg", "jpeg", "webp"];

export async function checkCast(req: {
  projectId: string;
  entityIds: string[];
  variantSel?: Record<string, string>;
  sourceGenerationId?: string | null;
  tailGenerationId?: string | null;
  model: string;
  kind: "image" | "video";
}): Promise<{ error: string; report: { findings: CastFinding[] } } | null> {
  try {
    const findings: CastFinding[] = [];

    // variant @mentions (Phase C): each selected variant must be live + owned + have
    // >=1 live reference image, else conditioning would spend on nothing (the worker
    // also fail-closes — this is the friendlier pre-spend block). Fail-CLOSED on a
    // bad variant; a DB fault still falls through to the outer fail-OPEN catch.
    if (req.variantSel) {
      for (const [entityId, variantId] of Object.entries(req.variantSel)) {
        const variant = await prisma.entityVariant.findFirst({
          where: { id: variantId, entityId, ownerId: FOUNDER_OWNER_ID, deletedAt: null },
          select: { name: true, _count: { select: { referenceImages: { where: { deletedAt: null } } } } },
        });
        if (!variant) {
          findings.push({ kind: "empty-variant", entityId, message: "An @mentioned variant was deleted — pick another or use the base." });
        } else if (variant._count.referenceImages === 0) {
          findings.push({ kind: "empty-variant", entityId, message: `The "${variant.name}" variant has no image yet — generate it first, or use the base.` });
        }
      }
    }

    // entity cast checks: CHARACTER-with-no-refs (the big money-saver), a
    // deleted/cross-project @mention, and multi-character on a "block" family
    if (req.entityIds.length) {
      const entities = await prisma.entity.findMany({
        where: { id: { in: req.entityIds }, ownerId: FOUNDER_OWNER_ID, deletedAt: null },
        select: { id: true, name: true, type: true, _count: { select: { referenceImages: { where: { deletedAt: null } } } } },
      });
      const mapped = entities.map((e) => ({ id: e.id, name: e.name, type: e.type, liveRefCount: e._count.referenceImages }));
      const family = modelFamily(req.model);
      const mode = family ? deriveMode({ kind: req.kind, conditioned: true, hasSourceImage: !!req.sourceGenerationId, hasTailImage: !!req.tailGenerationId }) : undefined;
      const castRule = family && mode ? await getCastRule(family, mode) : undefined;
      findings.push(...castFindings({ requestedEntityIds: req.entityIds, entities: mapped, castRule }));
    }

    // i2v start/end frame must be an owned, same-project, live image — but check
    // ONLY where the worker actually consumes them: source is video-only, and tail
    // only alongside a source (apps/worker/src/jobs/gen.ts). Checking an inert ID
    // the render path would ignore (e.g. a stray sourceGenerationId on an image
    // request) would WRONGLY block a working generation — a never-loosen violation
    // — so we mirror the worker's semantics exactly.
    if (req.kind === "video") {
      const frames: Array<[string, string]> = [];
      if (req.sourceGenerationId) frames.push([req.sourceGenerationId, "start frame"]);
      if (req.sourceGenerationId && req.tailGenerationId) frames.push([req.tailGenerationId, "end frame"]);
      for (const [id, label] of frames) {
        const gen = await prisma.generation.findFirst({
          where: { id, ownerId: FOUNDER_OWNER_ID, projectId: req.projectId, deletedAt: null, asset: { ext: { in: IMG_EXTS } } },
          select: { id: true },
        });
        if (!gen) findings.push({ kind: "missing-source", message: `The ${label} image isn't an owned image in this project — pick another.` });
      }
    }

    if (findings.length) return { error: findings[0]!.message, report: { findings } };
    return null;
  } catch {
    return null; // fail-OPEN — a Guardian fault must NEVER block a legit render
  }
}
