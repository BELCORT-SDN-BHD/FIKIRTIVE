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
import {
  modelFamily,
  deriveMode,
  castFindings,
  generationReferenceScope,
  REFERENCE_IMAGE_EXTS,
  type CastFinding,
} from "@fikirtive/core";
import { getCastRule } from "./cowork-knowledge";

export async function checkCast(req: {
  ownerId: string;
  projectId: string;
  entityIds: string[];
  variantSel?: Record<string, string>;
  sourceGenerationId?: string | null;
  tailGenerationId?: string | null;
  /**
   * creation §5 :162⑤ —— 这一单**额外挂上路的原件**。视频侧是
   * `GenJob.videoOptions.referenceGenerationIds`(PR #1273 的正路:演员参考照 + 商品图各作
   * 一张 `role:"reference_image"`),图片侧是 `GenJob.imageOptions.referenceGenerationIds`
   * (CRE-STG-P1-003:第一张之外的挂图)——两种 kind 同一条判据,调用方按 kind 传那一格。
   *
   * 从前这道守卫只查首帧/末帧那两张,于是「商品图已被删除 / 已不属于这家店」这一趟走到
   * worker 才 fail closed:钱已经预扣、事后退回。判据与首帧那两张同一份 `generationReferenceScope`
   * (同 owner、活着、图片扩展名 —— 画布是出处,不是权限边界),所以这里只是把同一条既有
   * 规矩铺到同一批部件的其余几张上,一格都没松。
   */
  referenceGenerationIds?: string[] | null;
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

    // The source/tail frames must be an owned, live image — checked
    // exactly where the worker actually consumes them (apps/worker/src/jobs/gen.ts):
    //   - VIDEO: source is the i2v start frame; tail only alongside a source.
    //   - IMAGE: source is the edit base image — unshifted to inputImageUrls[0] and sent
    //     to the engine (F09; the worker fail-closes with a refund when it can't be
    //     resolved). #619 corrected the stale claim that source was video-only and that
    //     an image's sourceGenerationId was an inert field: DetailPanel edit, canvas edit
    //     and (since #619) an Otto image card with an attached reference all consume it.
    // Mirroring the worker exactly keeps this never-loosen: it only ADDS a friendlier
    // pre-spend block for a request the worker would have refunded anyway.
    if (req.sourceGenerationId) {
      const frames: Array<[string, string]> = [
        [req.sourceGenerationId, req.kind === "video" ? "start frame" : "reference image"],
      ];
      if (req.kind === "video" && req.tailGenerationId) frames.push([req.tailGenerationId, "end frame"]);
      // Codex QA-CRE-FE9-013:这里从前多写了一格 `projectId`,于是一张从别的画布引用过来
      // 的合法参考会在**付费之前**被这道守卫判成「不是这个项目里的图」。判据现在与校验器、
      // Otto 视觉、worker 共读同一份 `generationReferenceScope`(同一 owner、活着、图片扩展
      // 名)—— 画布是出处,不是权限边界。租户这一格一点没松。
      for (const [id, label] of frames) {
        const gen = await prisma.generation.findFirst({
          where: { id, ...generationReferenceScope(req.ownerId, REFERENCE_IMAGE_EXTS) },
          select: { id: true },
        });
        if (!gen) findings.push({ kind: "missing-source", message: `The ${label} image isn't one of your images any more — pick another.` });
      }
    }

    // creation §5 :162⑤ —— 挂上路的那几张原件,与首帧/末帧同一条判据、同一趟 owner scope。
    // 取不到原件(删了 / 不是这家店的 / 不是图片扩展名)⇒ 在 create+reserve 之前拒,零卡零账本行。
    // worker 侧仍旧 fail closed(纵深防御);这里只是把同一句话挪到花钱之前说。
    for (const id of req.referenceGenerationIds ?? []) {
      const gen = await prisma.generation.findFirst({
        where: { id, ...generationReferenceScope(req.ownerId, REFERENCE_IMAGE_EXTS) },
        select: { id: true },
      });
      if (!gen) findings.push({ kind: "missing-source", message: "One of the reference images isn't one of your images any more — pick another." });
    }

    if (findings.length) return { error: findings[0]!.message, report: { findings } };
    return null;
  } catch {
    return null; // fail-OPEN — a Guardian fault must NEVER block a legit render
  }
}
