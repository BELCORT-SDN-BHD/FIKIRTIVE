/**
 * Pure builder: card payload → genRequest input.
 *
 * Extracted from `coworkGenerate` (apps/web/lib/cowork-actions.ts lines 545–565).
 * This file MUST remain pure — no @fikirtive/db, no apps/* imports, no Prisma.
 * The logic is behavior-identical to the original: same field order, same
 * spread/conditional patterns, same fallback chain.
 */
import { coworkProposalSchema } from "./cowork.js";
import { GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_OPTIONS, type GenVideoModel } from "./gen.js";
import { parseApprovedEntities } from "./reference-budget.js";

/** The assembled genRequest object that `buildGenRequestFromCard` returns on success.
 *  Exported for use in OttoContext.startGen (packages/otto cannot import apps/*). */
export type GenRequestInput = Record<string, unknown>;

export function buildGenRequestFromCard(args: {
  cardPayload: unknown;
  projectId: string;
  threadId: string;
  cardId: string;
  prompt: string;
  entityIds: string[];
  variantSel: Record<string, string>;
  overrides?: {
    model?: string;
    count?: number;
    durationSeconds?: number | null;
    resolution?: string | null;
    aspectRatio?: string | null;
    audio?: boolean | null;
  };
}): { ok: true; req: Record<string, unknown> } | { ok: false; error: string } {
  const { cardPayload, projectId, threadId, cardId, prompt, entityIds, variantSel, overrides } = args;

  // Step 1: re-validate the persisted proposal subset (mirrors coworkGenerate line 501–502).
  const p = (cardPayload ?? {}) as Record<string, unknown>;
  const proposal = coworkProposalSchema.safeParse({
    kind: p.kind,
    desiredAspect: p.desiredAspect,
    desiredDuration: p.desiredDuration,
    desiredAudio: p.desiredAudio,
    structuredPrompt: p.structuredPrompt,
    entityIds: p.entityIds ?? [],
    variantSel: p.variantSel ?? {},
  });
  if (!proposal.success) return { ok: false, error: "This card is no longer valid." };

  // Step 2: model must be a non-empty string (mirrors coworkGenerate line 503–505).
  const model = typeof p.model === "string" ? p.model : null;
  if (!model) return { ok: false, error: "This card is missing a model." };

  // Step 3: extract params and sourceGenerationId (mirrors coworkGenerate lines 504, 508).
  const params = (p.params ?? {}) as {
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    audio?: boolean;
    count?: number;
  };
  const sourceGenerationId = typeof p.sourceGenerationId === "string" ? p.sourceGenerationId : null;
  const referenceVideoGenerationId = typeof p.referenceVideoGenerationId === "string" ? p.referenceVideoGenerationId : null;

  // Step 3.5 (#774 判官 r2 P1): the approved element identities — CARD-trusted, like `kind`.
  // 引擎认人那几句机器指令里的名字只能来自这里,而这里只能来自**卡**:卡是商家批准前
  // 看过、批准后不可变的那一份。所以它不从 `args` 收(调用方给的 `entityIds` 可以变,
  // 名字不可以),而且只保留 `entityIds` 里真的还在的那些 —— 卡上有、这一趟没 @ 的元素
  // 不许把名字带进付费提示词。
  //
  // #774 判官 r3 P0 —— 卡上没有这一份时的降级方向,写死在这里:
  // #774 之前铸的老卡、跨部署铸的卡,payload 里根本没有 `approvedEntities`(或整段读不懂)
  // ⇒ 空表 ⇒ 下面那个展开把这个字段整个留在请求之外。执行侧(`startGen`)看到字段缺席
  // **不会**替它现读活名称补上 —— 它就此成为「这一趟没有获批的名字」,worker 照旧编号、
  // 只是不写名字(`Define the product in <Image_1> as <Subject_1>.`)。
  // 降级是「少一个名字」;「执行时读一个没人批准过的名字」不是降级,是「批 A 做 B」。
  const entityIdSet = new Set(entityIds);
  const approvedEntities = parseApprovedEntities(p.approvedEntities).filter((e) => entityIdSet.has(e.id));

  // Step 4: chosen model (mirrors coworkGenerate line 517).
  const chosenModel = overrides?.model ?? model;

  // Step 5: audioToggle (mirrors coworkGenerate lines 545–547).
  const audioToggle =
    proposal.data.kind === "video" && (GEN_VIDEO_MODELS as readonly string[]).includes(chosenModel)
      ? GEN_VIDEO_MODEL_OPTIONS[chosenModel as GenVideoModel].audioToggle
      : false;

  // Step 6: count (mirrors coworkGenerate line 555).
  const count = proposal.data.kind === "video" ? 1 : (overrides?.count ?? params.count ?? 1);

  // Step 7: assemble the request object — field order and spread patterns identical to
  // coworkGenerate lines 548–565 (the critical byte-identical requirement).
  const ov = overrides;
  const req = {
    projectId,
    threadId,
    prompt,
    entityIds,
    ...(approvedEntities.length ? { approvedEntities } : {}),
    ...(Object.keys(variantSel).length ? { variantSel } : {}),
    ...(sourceGenerationId ? { sourceGenerationId } : {}),
    ...(referenceVideoGenerationId ? { referenceVideoGenerationId } : {}),
    count,
    kind: proposal.data.kind, // CARD-trusted — anti-flip
    model: chosenModel,
    ...(proposal.data.kind === "video"
      ? {
          durationSeconds: ov?.durationSeconds ?? params.durationSeconds ?? null,
          resolution: ov?.resolution ?? params.resolution ?? null,
          aspectRatio: ov?.aspectRatio ?? params.aspectRatio ?? null,
          ...(audioToggle ? { audio: ov?.audio ?? params.audio ?? null } : {}),
        }
      // #643 T2：图片卡上冻结的形状必须原样进付费请求。这条分支原本什么都不带，所以
      // 卡面即使写了形状，引擎也收不到它 —— 「说的」和「做的」在这一行分家。
      // 卡上没形状时仍然不带（服务端按底图继承 / 默认解释，不在这里编一个值）。
      : (ov?.aspectRatio ?? params.aspectRatio)
        ? { aspectRatio: ov?.aspectRatio ?? params.aspectRatio }
        : {}),
    idempotencyKey: `cowork:${cardId}`,
  };

  return { ok: true, req };
}
