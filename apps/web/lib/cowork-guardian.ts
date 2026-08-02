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
import { prisma } from "@fikirtive/db";
import { modelFamily, deriveMode, castFindings, type CastFinding } from "@fikirtive/core";
import { getCastRule } from "./cowork-knowledge";

const IMG_EXTS = ["png", "jpg", "jpeg", "webp"];

export async function checkCast(req: {
  ownerId: string;
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
          where: { id: variantId, entityId, ownerId: req.ownerId, deletedAt: null },
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
        where: { id: { in: req.entityIds }, ownerId: req.ownerId, deletedAt: null },
        // count BASE refs (variantId null) — a bare mention conditions only on those in
        // the worker, so a character with refs only under a variant must still count as
        // unanchored for the no-refs block (else it spends unconditioned).
        select: { id: true, name: true, type: true, _count: { select: { referenceImages: { where: { deletedAt: null, variantId: null } } } } },
      });
      // a variant mention's refs are validated separately above (empty-variant block), so
      // treat that entity as anchored here — don't let a zero base count wrongly flag it.
      const mapped = entities.map((e) => ({ id: e.id, name: e.name, type: e.type, liveRefCount: req.variantSel?.[e.id] ? 1 : e._count.referenceImages }));
      const family = modelFamily(req.model);
      const mode = family ? deriveMode({ kind: req.kind, conditioned: true, hasSourceImage: !!req.sourceGenerationId, hasTailImage: !!req.tailGenerationId }) : undefined;
      const castRule = family && mode ? await getCastRule(family, mode) : undefined;
      findings.push(...castFindings({ requestedEntityIds: req.entityIds, entities: mapped, castRule }));
    }

    // source/tail frame must be an owned, same-project, live image — checked exactly
    // where the worker actually consumes them (apps/worker/src/jobs/gen.ts): a
    // sourceGenerationId is consumed by BOTH kinds — the i2v start frame on a video
    // job, and the edit/base image on an IMAGE job (F09: the worker conditions the
    // gen on it and fail-closes with a refund when it can't resolve) — so pre-checking
    // it for either kind only ever ADDS a friendlier pre-spend block; a generation it
    // blocks would have been refused and refunded by the worker anyway (never-loosen
    // holds). tailGenerationId stays video-only and only alongside a source, mirroring
    // the worker. (#619 E-7 — the older comment here claimed source was video-only and
    // an image-side sourceGenerationId was inert; F09 made that false.)
    {
      const frames: Array<[string, string]> = [];
      if (req.sourceGenerationId) frames.push([req.sourceGenerationId, req.kind === "video" ? "start frame" : "base"]);
      if (req.kind === "video" && req.sourceGenerationId && req.tailGenerationId) frames.push([req.tailGenerationId, "end frame"]);
      for (const [id, label] of frames) {
        const gen = await prisma.generation.findFirst({
          where: { id, ownerId: req.ownerId, projectId: req.projectId, deletedAt: null, asset: { ext: { in: IMG_EXTS } } },
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
