/**
 * ottoTurn — Otto agent server action (Task 1.8a)
 * ottoApprove — approve a parked generate → resume → spend (Task 1.8b)
 *
 * NON-MONEY half (ottoTurn): runs the Otto agent loop for a user message, persists
 * conversation state to ChatThread.ottoState, charges the turn's LLM cost via
 * withLlmBudget, and handles completed / interrupted (needs_approval) / maxTurns-exceeded
 * gracefully. The generate tool is gated by needsApproval:true — it PARKS and returns
 * "needs_approval". The actual spend (approve/resume) is ottoApprove (Task 1.8b).
 *
 * MONEY half (ottoApprove): rehydrates the paused RunState, verifies + approves the
 * matching generate interruption (cardId binding), and resumes the run — which executes
 * generate.execute → ctx.startGen → real spend. Resume is metered via withLlmBudget.
 *
 * MONEY-SAFETY INVARIANTS (ottoApprove):
 *   - Spend goes ONLY through the resumed generate tool → ctx.startGen (never directly).
 *   - cardId binding: approves only the generate interruption whose arguments.cardId
 *     matches the approved cardId. Mismatch → reject, no approve, no spend.
 *   - Double-approve safe: if no pending interruption but a GenJob cowork:<cardId> already
 *     exists, returns it benignly (no second approve, no second spend).
 *   - Resume turn LLM cost is metered via withLlmBudget (reserve → settle).
 *   - Tenant-scoped: thread loaded owner-scoped; cross-tenant threadId/cardId rejected.
 *
 * Owner-scoped validation mirrors coworkTurn. Does NOT modify coworkTurn/coworkGenerate.
 */
import "server-only";
import { revalidatePath } from "next/cache";
import { prisma, finalizedReservations, otherHoldsSince } from "@fikirtive/db";
import type { Prisma } from "@fikirtive/db";
import {
  newId,
  coworkTurnRequest,
  GOAL_PRESETS,
  isGoalKey,
  tavilySearch,
  braveSearch,
  searchWithFallback,
  extractProductDraft,
  merchantGenFailureMessage,
  // Codex QA-CRE-FE9-013:挂上来的引用取不到时,商家读到的那一句 —— 措辞的单一权威是
  // `gen-failure.ts` 里的那张表,这里只按名字取,绝不在别处再写一份句子。
  referenceUnavailableMessage,
  // CRE-STG-P2-004:批准失败时商家与日志共用的那个短号,算法只有这一份。
  diagnosticRef,
  // 「行在、文件在不在」那一问。取不到的引用要在 reserve 之前拦住,而不是等 worker 退款。
  storageKey,
  type ReferenceUnavailableReason,
  type SegmentRuleGroup,
} from "@fikirtive/core";
import {
  otto,
  ottoInteractiveRuntime,
  ottoApprovalResumeRuntime,
  runOttoTurn,
  finalizeOttoTurn,
  withLlmBudget,
  llmHoldInternal,
  ottoBudgetArgsFor,
  ReservationNotClaimed,
  ClaimFailed,
  run,
  MaxTurnsExceededError,
  ottoSimpleModeBlock,
  buildUserTurn,
  sanitizeHistory,
  // ENGINE-A6(规格 §7.2④):成对感知的历史裁剪与摘要回注块。
  trimHistoryToBudget,
  rollingSummaryBlock,
  tryRestoreRunState,
  tryRestoreRunStateWithContext,
  approvalRefOf,
  // 媒体参考回执的唯一构造处 —— 两步接力铸第二张卡时用的是同一份口径。
  mediaReferenceReceipt,
  UNTITLED_CANVAS_NAME,
  // Founder 2026-09-05「加进确认卡」—— 三格控件(张数／形状／精修)的改档口径。
  // 判词是纯函数,住在引擎包;这里只负责归属、可改与否、以及把新卡落库。
  applyCardOptions,
} from "@fikirtive/otto";
import type { OttoContext, OttoMediaReference, AgentInputItem, ApprovalInterruption, OttoTurnTraceFacts, OttoRollingSummaryPort, CardPayload, CardOptionEdit } from "@fikirtive/otto";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { runAsUser } from "@fikirtive/db/principal";
import { isImpersonating } from "@/lib/better-auth/compat";
// #810 P2-2: the ONE translation of a failed turn into what the merchant reads — shared with
// the streaming route so an out-of-credits refusal is never reported as a product fault here
// and as the real two numbers there.
import { ottoDegradeText, ottoFailureMessage } from "@/lib/otto-error-copy";
import { newThreadTitle } from "@/lib/otto-canned-starters";
import { coerceThreadSurface, DEFAULT_THREAD_SURFACE } from "@/lib/otto-thread-surface";
// #524 r2 — the READ-ONLY look at the merchant's spend cap that keeps an approval from being
// burned by a refusal knowable one line earlier. Never an authority; reserveCredits still decides.
import { spendCapRefusal, approvedToolCostInternal, approvedGenerateCostInternal } from "@/lib/spend-cap-preflight";
import { consumeOttoTurnGate, OTTO_TURN_RATE_LIMIT_MESSAGE } from "@/lib/rate-limit-gates";
import { resolveDisabledModels } from "./model-registry";
import { startCoworkGen } from "./gen-actions";
import { runVariantBatch, runBulkGrid } from "./factory-actions";
import { gatherReferenceImages } from "./otto-ref-images";
import { getBrandContextText } from "./memory-actions";
import { fetchAndExtract, fetchRawHtml } from "./fetch-extract";
import { draftScheduledPost } from "./schedule-service";
import {
  approveScheduledPost,
  cancelScheduledPost,
  updateScheduledPost,
  listScheduledPosts,
  listOwnerTargets,
  suggestPostTimes,
  sharePostPreview,
  revokeSharePreview,
} from "./schedule-actions";
import { asApprovalCardPayload, approvalCardResolutionText, type ApprovalCardPayload, type ApprovalCardResolution, type ApprovalCardSummary } from "./approval-card-view";
import { computeApprovalContentHash, refgenApprovalHashFromArgs, factoryBatchApprovalHashFromArgs, APPROVAL_CARD_TTL_MS } from "./approval-content-hash";
import { readPageCached } from "./web-page-cache";
import { fetchOwnerInsights } from "./meta-insights";
import { toOttoInsightAccounts, toOttoAdRows } from "./otto-money-view";
import { fetchOwnerAdPerformance } from "./meta-performance";
import { fetchOwnerAdObjects } from "./meta-objects";
import { fetchOwnerPages } from "./meta-pages";
import { proposeMetaActionForOwner } from "./meta-propose";
import { proposeAdBuildForOwner } from "./meta-build-propose";
import { declineMetaCard } from "./meta-card-decline";
import type { MetaCardKind } from "./meta-card-decline-view";
import { validateOwnedGenerationExt, type OwnedGenerationRef } from "./otto-generation-validate";
import { storage } from "./storage";
import { makeOttoCanvasPort } from "./otto-canvas-port";
import { makeOttoMediaPort, makeOttoRenderPort, makeOttoMediaImportPort } from "./otto-media-port";
import { makeOttoProjectsPort } from "./otto-projects-port";
import { makeOttoRefgenPort } from "./otto-refgen-port";
import { makeOttoEntitiesPort } from "./otto-entities-port";
import { makeOttoLibraryPort } from "./otto-library-port";
import { makeOttoBrandMemoryPort } from "./otto-brand-memory-port";
import { makeOttoWorkflowsPort } from "./otto-workflows-port";
import {
  buildSegment as buildCrmSegment,
  getSegment as getCrmSegment,
  listSegments as listCrmSegments,
  previewSegment as previewCrmSegment,
} from "./segment-actions";
import {
  approveCampaignEntry,
  proposeCampaign,
  proposeCampaignEntry,
  removeCampaignEntry,
  setCampaignGrouping,
  updateCampaignEntry,
} from "./campaign-actions";
import { getCampaign, listCampaigns } from "./campaign-view-data";
import { listTrendSnapshots, saveTrendSnapshot } from "./trend-actions";
import {
  addContactPhoneFromOtto,
  createContact,
  importContacts,
  removeContactPhoneFromOtto,
  setContactConsent,
  setContactDndFromOtto,
  updateContact,
  updateContactPhoneFromOtto,
} from "./crm-actions";
import { getContact, listContacts, searchContacts } from "./crm-view-data";
// #742: the contact-list boundary — the page's counts cross into chat with the rows.
import { contactForOtto, contactPageForOtto } from "./otto-contact-view";
import { listChannelScopes } from "./customer-inbox-gateway";
import { makeOttoSpendingPort } from "./otto-spending-port";

// mapOttoUsage re-exported from @fikirtive/otto so existing callers that import
// it from this module continue to work (the canonical source is @fikirtive/otto).
export { mapOttoUsage } from "@fikirtive/otto";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
const VIDEO_EXTS = ["mp4", "mov", "webm"];

function makeOttoSegmentsPort() {
  const context = {
    list: async () => {
      const result = await listCrmSegments();
      if (!("ok" in result)) return result;
      return { ok: true as const, evaluatedAt: result.evaluatedAt, segments: result.segments };
    },
    get: async (segmentId: string) => {
      const result = await getCrmSegment(segmentId);
      if (!("ok" in result)) return result;
      return { ok: true as const, evaluatedAt: result.evaluatedAt, segment: result.segment };
    },
    preview: async (rules: SegmentRuleGroup) => {
      const result = await previewCrmSegment(rules);
      if (!("ok" in result)) return result;
      return {
        ok: true as const,
        evaluatedAt: result.evaluatedAt,
        phrase: result.phrase,
        matchedCount: result.matchedCount,
        contactableCount: result.contactableCount,
        knownOptOutCount: result.knownOptOutCount,
        excludedByConsentCount: result.excludedByConsentCount,
        unresolvedLegacyOptOutCount: result.unresolvedLegacyOptOutCount,
        reportedOptOutCount: result.reportedOptOutCount,
        // #758 — Otto reads the same disclosure the page prints, including what the merchant's
        // own optional exclusion removed. A number the human surface shows and Otto does not is
        // the two-surfaces-one-truth defect this port exists to prevent.
        excludedByReportedOptOutCount: result.excludedByReportedOptOutCount,
        contacts: result.contacts,
        // #819 — the preview cuts the sample at ten. The cut crosses the boundary with the
        // rows, so "these ten are everyone" is contradicted by the payload itself.
        returned: result.returned,
        hasMore: result.hasMore,
      };
    },
    build: async ({ operation, segmentId, name, rules }: {
      operation: "create" | "update";
      segmentId?: string;
      name: string;
      rules: SegmentRuleGroup;
    }) => {
      if (operation === "update") {
        if (!segmentId) return { error: "Update needs the exact segment id." };
        return buildCrmSegment({ operation, segmentId, name, rules });
      }

      // The model never mints a Segment id. Reuse the action layer's owner-bound signed draft,
      // then enter the exact same validated create/replay path as the human page.
      const draft = await listCrmSegments();
      if (!("ok" in draft)) return draft;
      return buildCrmSegment({
        operation,
        segmentId: draft.nextSegmentId,
        segmentProof: draft.nextSegmentProof,
        name,
        rules,
      });
    },
  };
  return context;
}

function makeOttoCampaignsPort(): NonNullable<OttoContext["campaigns"]> {
  return {
    list: async () => {
      const result = await listCampaigns();
      if (!("ok" in result)) return result;
      return { ok: true as const, campaigns: result.campaigns };
    },
    get: async (campaignId) => {
      const result = await getCampaign(campaignId);
      if (!("ok" in result)) return result;
      return { ok: true as const, campaign: result.campaign };
    },
    listTrends: async (input) => {
      const result = await listTrendSnapshots(input);
      if (!("ok" in result)) return result;
      return { ok: true as const, snapshots: result.snapshots };
    },
    create: async (input) => {
      // The model never mints a Campaign id. The authenticated list action issues an owner-bound
      // signed draft, then creation enters the same retry-safe action as the human workbench.
      const draft = await listCampaigns();
      if (!("ok" in draft)) return draft;
      return proposeCampaign({
        campaignId: draft.nextCampaignId,
        campaignProof: draft.nextCampaignProof,
        title: input.name,
        goal: input.goal,
        status: input.status,
        period: input.period,
        theme: input.theme ?? input.name,
        items: [],
        ideas: [],
      });
    },
    proposeEntry: async ({ campaignId, entry }) => {
      // Entry ids are also server-issued and owner-bound. A lost response can replay the same id.
      const draft = await getCampaign(campaignId);
      if (!("ok" in draft)) return draft;
      return proposeCampaignEntry({
        campaignId,
        entryId: draft.nextEntryId,
        entryProof: draft.nextEntryProof,
        entry,
      });
    },
    updateEntry: (input) => updateCampaignEntry(input),
    removeEntry: (input) => removeCampaignEntry(input),
    approveEntry: (input) => approveCampaignEntry(input),
    group: (input) => setCampaignGrouping(input),
    saveTrend: async ({ campaignId, evidence }) => {
      const draft = await listTrendSnapshots();
      if (!("ok" in draft)) return draft;
      return saveTrendSnapshot({
        snapshotId: draft.nextSnapshotId,
        snapshotProof: draft.nextSnapshotProof,
        campaignId,
        evidence,
      });
    },
  };
}

function makeOttoContactsPort(): NonNullable<OttoContext["contacts"]> {
  return {
    // #742: a page crosses as a page. contactPageForOtto carries the owner-scoped total and
    // the truncation flag over with the rows, so an answer can never quote 50 as the headcount.
    list: async (input) => contactPageForOtto(await listContacts(input)),
    get: async (contactId) => {
      const result = await getContact(contactId);
      if (!("ok" in result)) return result;
      return {
        ok: true as const,
        contact: {
          ...contactForOtto(result.contact),
          consentEvents: result.contact.consentEvents.map((event) => ({
            ...event,
            occurredAt: event.occurredAt?.toISOString() ?? null,
            receivedAt: event.receivedAt.toISOString(),
          })),
        },
      };
    },
    search: async (input) => contactPageForOtto(await searchContacts(input)),
    create: (input) => createContact({ ...input, source: "otto" }),
    update: (input) => updateContact(input),
    importCsv: (input) => importContacts(input),
    recordConsent: (input) => setContactConsent(input),
    setDnd: (input) => setContactDndFromOtto(input),
    // #803 — Otto stores a number through the same writer as the contact page, at the same
    // merchant-entered grade. There is no Otto-only path and no way to claim verification.
    addPhone: (input) => addContactPhoneFromOtto(input),
    updatePhone: (input) => updateContactPhoneFromOtto(input),
    removePhone: (input) => removeContactPhoneFromOtto(input),
  };
}

// #495/#500 read parity: the SAME owner-scoped customer-inbox gateway read the human
// template picker uses (the broadcast composer reads the same owner-scoped rows through
// its own broadcast gateway). The port never accepts owner identity.
function makeOttoChannelScopesPort(): NonNullable<OttoContext["channelScopes"]> {
  return {
    list: async () => {
      const result = await listChannelScopes();
      if (!result.ok) return { error: result.error };
      return { ok: true as const, scopes: result.resource };
    },
  };
}

// #555 read parity: the spending port lives in lib/otto-spending-port.ts so a test can run the
// REAL projection over the same ledger rows the two page reads use (#683 judge r1 P2②).

function orderedUniqueIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 解析这一轮挂上来的一组引用 —— 每一个都必须有答案:**要么解出来,要么记成不可用**。
 *
 * Codex QA-CRE-FE9-013:上一版这里是 `if (resolved) valid.push(...)` —— 解不出来的那个
 * id 就地蒸发,调用方拿到的只是一个短一点的数组,分不清「商家没挂」与「挂了但被丢了」。
 * 现在两条路都留痕:`refs` 是能用的,`unavailable` 是不能用的**及其原因**。
 */
async function resolveGenerationRefs(input: {
  ownerId: string;
  ids: string[];
  exts: string[];
  /** 这一格要的是哪一种媒体 —— 只用来把「拿错了类型」与「找不到」分开说(见下)。 */
  slot: "image" | "video";
}): Promise<{ refs: OwnedGenerationRef[]; unavailable: UnavailableTurnReference[] }> {
  const refs: OwnedGenerationRef[] = [];
  const unavailable: UnavailableTurnReference[] = [];
  for (const id of input.ids) {
    const resolved = await validateOwnedGenerationExt(prisma, {
      id,
      ownerId: input.ownerId,
      exts: input.exts,
    });
    if (!resolved) {
      // Codex staging CRE-STG-P0-001 —— **拿错了类型不是「找不到」。**
      //
      // 商家从「My Videos」里挑了一支片子当图片参考:行在、是他自己的、没删,只是扩展名
      // 属于另一族。上一版把这一档也说成「isn't available any more」—— 那句话他一看
      // Library 就知道是假的,而且指着一个从未发生过的删除,他永远修不好。
      //
      // 再查一次的范围仍然是**同一个 owner**(`generationReferenceScope` 那一份判据),
      // 所以这里多说出来的只有「它是另一种媒体」,一个字都没有泄露别家账号里有什么。
      const otherExts = input.slot === "image" ? VIDEO_EXTS : IMAGE_EXTS;
      const wrongKind = await validateOwnedGenerationExt(prisma, {
        id,
        ownerId: input.ownerId,
        exts: otherExts,
      });
      unavailable.push({
        id,
        reason: wrongKind ? (input.slot === "image" ? "videoAsImage" : "imageAsVideo") : "notFound",
      });
      continue;
    }
    // 行在、文件不在:这一条走到引擎那里也是 fail-closed 退款,所以在**发送之前**就说。
    // `storage.exists` 只把「对象不存在」读成 false;鉴权/网络故障它照旧抛出去,由调用方的
    // try/catch 翻成「等一下再试」—— 不知道文件在不在的时候,绝不当作它在。
    const present = await storage.exists(
      storageKey(resolved.asset.ownerId, resolved.asset.contentHash, resolved.asset.ext),
    );
    if (!present) {
      unavailable.push({ id, reason: "fileMissing" });
      continue;
    }
    if (!refs.some((r) => r.id === resolved.id)) refs.push(resolved);
  }
  return { refs, unavailable };
}

/** 这一轮挂上来、但服务端取不到的那一件引用。`reason` 决定商家读到哪一句(单一措辞源)。 */
export type UnavailableTurnReference = { id: string; reason: ReferenceUnavailableReason };

export type OttoTurnReferences = {
  sourceGenerationIds: string[];
  referenceVideoGenerationIds: string[];
  /** 回执:每一件真会随这一轮上路的媒体参考,配上商家读得懂的名字与来源画布。 */
  mediaReferences: OttoMediaReference[];
  /** 空数组 = 商家挂的每一件都取得到。非空 = **这一轮不许发出去**(见调用方)。 */
  unavailable: UnavailableTurnReference[];
};

/**
 * 这一轮的引用,解析一次,解给所有人用。
 *
 * 判据只有一条(`generationReferenceScope`):同一 owner、活着、扩展名对得上。画布不再
 * 是过滤条件 —— 它只是回执上那句「来自哪一块画布」。
 */
export async function validateOttoTurnReferences(input: {
  ownerId: string;
  projectId: string;
  sourceGenerationId?: string | null;
  sourceGenerationIds?: string[] | null;
  referenceVideoGenerationId?: string | null;
  referenceVideoGenerationIds?: string[] | null;
}): Promise<OttoTurnReferences> {
  const sourceIds = orderedUniqueIds([...(input.sourceGenerationIds ?? []), input.sourceGenerationId]);
  const videoIds = orderedUniqueIds([...(input.referenceVideoGenerationIds ?? []), input.referenceVideoGenerationId]);
  const [source, video] = await Promise.all([
    resolveGenerationRefs({ ownerId: input.ownerId, ids: sourceIds, exts: IMAGE_EXTS, slot: "image" }),
    resolveGenerationRefs({ ownerId: input.ownerId, ids: videoIds, exts: VIDEO_EXTS, slot: "video" }),
  ]);
  const projectNames = await referenceProjectNames(
    input.ownerId,
    [...source.refs, ...video.refs].map((r) => r.projectId),
  );
  // 回执的构造口径只有一份(`mediaReferenceReceipt`,@fikirtive/otto)—— 两步接力在
  // Step 1 出图之后自己铸第二张卡时用的是同一份,所以商家在两张卡上读到的是同一种说法。
  const receipt = (ref: OwnedGenerationRef, kind: "image" | "video"): OttoMediaReference =>
    mediaReferenceReceipt({
      generationId: ref.id,
      kind,
      prompt: ref.prompt,
      sourceProjectId: ref.projectId,
      sourceProjectName: projectNames.get(ref.projectId) ?? null,
      sameCanvas: ref.projectId === input.projectId,
      asset: ref.asset,
    });
  return {
    sourceGenerationIds: source.refs.map((r) => r.id),
    referenceVideoGenerationIds: video.refs.map((r) => r.id),
    mediaReferences: [
      ...source.refs.map((r) => receipt(r, "image")),
      ...video.refs.map((r) => receipt(r, "video")),
    ],
    unavailable: [...source.unavailable, ...video.unavailable],
  };
}

/** 画布的名字,一次读齐。读不到就退回「Untitled canvas」—— 回执可以少一个好名字,不能少一行。 */
async function referenceProjectNames(ownerId: string, projectIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Map();
  try {
    const rows = await prisma.project.findMany({
      where: { id: { in: ids }, ownerId },
      select: { id: true, name: true },
    });
    return new Map(rows.map((p) => [p.id, p.name?.trim() || UNTITLED_CANVAS_NAME]));
  } catch {
    return new Map();
  }
}

/**
 * 商家读到的那一句 —— 只从 `@fikirtive/core` 的那一张表取(第二份映射就是第二种说法)。
 * 一轮里有多件取不到时只说第一件:接下来那一件在他移掉第一件之后照样会被拦。
 */
export function unavailableReferenceMessage(unavailable: UnavailableTurnReference[]): string {
  return referenceUnavailableMessage(unavailable[0]?.reason ?? "notFound");
}

/**
 * Safe one-line error summary for server logs. Logs name/message/statusCode only —
 * NOT the raw error, whose AI SDK provider fields (e.g. requestBodyValues) can carry
 * the full prompt, user text, and context into logs.
 */
function errSummary(e: unknown): string {
  if (!e || typeof e !== "object") return String(e);
  const x = e as { name?: unknown; message?: unknown; statusCode?: unknown };
  return [x.name, x.message, x.statusCode != null ? `status=${x.statusCode}` : null]
    .filter(Boolean)
    .join(" | ") || String(e);
}

// ---------------------------------------------------------------------------
// loadAvailableRefsForAgent — owner-scoped entity loader for the agent context
// ---------------------------------------------------------------------------

/** Returns the slim { id, name, type, variants } shape the agent context needs.
 *  Best-effort: returns [] on any error so context injection never fails the turn. */
async function loadAvailableRefsForAgent(
  ownerId: string,
): Promise<{ id: string; name: string; type: string; variants: { id: string; name: string }[] }[]> {
  try {
    const entities = await prisma.entity.findMany({
      // Only surface entities Otto can actually USE as a visual reference: one with no
      // reference image can't meaningfully be @-mentioned (nothing to condition on). This
      // also keeps ref-less test/junk entities out of Otto's @-suggestions (audit STUFF-7).
      where: { ownerId, deletedAt: null, referenceImages: { some: { deletedAt: null } } },
      select: {
        id: true,
        name: true,
        type: true,
        // #781 — the element's saved styling variants (same identity, different look). Same rule
        // as the elements themselves: only ones that HAVE an image are listed. A variant with no
        // image conditions nothing, and the generation worker fails closed on it, so naming an
        // empty one to Otto would only invite a pick that can't be honoured. This is what makes
        // "use the red dress one" answerable — and what gives deleteReferenceVariant a real id
        // instead of a guessed one.
        variants: {
          where: { deletedAt: null, referenceImages: { some: { deletedAt: null } } },
          select: { id: true, name: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    return entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      variants: e.variants.map((v) => ({ id: v.id, name: v.name })),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// buildContextSystemMessage — compose the injected system message from OttoContext
// ---------------------------------------------------------------------------

export function buildContextSystemMessage(ctx: OttoContext, rollingSummary?: string | null): AgentInputItem | null {
  const parts: string[] = [];
  // ENGINE-A6 (规格 docs/specs/otto-engine.md §7.2④ 第三刀) —— 被裁掉的旧轮回注在**这条新鲜的
  // system 消息**上,而且排在最前:它是这段对话里**最老**的内容,读在品牌记忆与项目 brief 之前,
  // 不与它们争「谁说了算」(那两条的先后次序与含义原样不动)。`sanitizeHistory` 每轮都会把历史里
  // 的旧 system 消息丢掉,所以这一条是折叠掉的上下文唯一能落脚的地方。
  const folded = rollingSummaryBlock(rollingSummary);
  if (folded) parts.push(folded);
  if (ctx.brandContext) parts.push(`What you know about the user's brand:\n${ctx.brandContext}`);
  // #791-1: the merchant's brief for THIS project, right after the shop-wide brand memory.
  // Order is the meaning: brand memory is who the shop is, the brief is what THIS project
  // must do — so the narrower instruction is read last and wins on a conflict.
  if (ctx.projectBrief) {
    parts.push(
      `The brief for this project, written by the user — follow it every turn unless they change it:\n${ctx.projectBrief}`,
    );
  }
  if (ctx.availableRefs?.length) {
    parts.push(
      `Reusable items you can @-reference (use the id with tools): ${ctx.availableRefs
        .map((r) => {
          // #781 — an element's saved looks, named beside it. Without this line the styling
          // variants exist but are invisible to Otto: it cannot pick one for a generation
          // (variantSel) and cannot name one to delete, so the merchant's "use the red dress
          // one" has no answer.
          const looks = r.variants?.length
            ? ` looks: ${r.variants.map((v) => `${v.name} (variantId=${v.id})`).join("; ")}`
            : "";
          return `@${r.name} [${r.type}, id=${r.id}]${looks}`;
        })
        .join(", ")}`,
    );
    if (ctx.availableRefs.some((r) => r.variants?.length)) {
      parts.push(
        "A look is the SAME element restyled (a different outfit or setting). When the user asks for " +
          "one by name, put its variantId in variantSel on the proposal ({ elementId: variantId }); " +
          "otherwise the element's base look is used.",
      );
    }
  }
  if (ctx.simpleMode) parts.push(ottoSimpleModeBlock);
  if (ctx.activeJob) {
    const s = ctx.activeJob.status;
    // #765 — when this failure has a merchant-facing explanation, Otto is given it VERBATIM so
    // a follow-up ("what happened?") is answered with the same sentence the durable turn message
    // and the board's card already showed them. Two surfaces telling one merchant two different
    // stories about one refusal is the thing this is here to prevent — hence "use this sentence
    // as written" rather than an invitation to paraphrase.
    //
    // Whitelisted in core, never a passthrough of GenJob.error: that column also carries ops
    // strings, and Otto is the last place an internal error should be handed a megaphone.
    const failureExplanation = merchantGenFailureMessage(ctx.activeJob.error);
    const human =
      s === "DONE" ? "the last generation finished"
      : s === "FAILED" ? `the last generation FAILED — the user was automatically refunded, so they were NOT charged for it${
          failureExplanation
            ? `. They have already been shown WHY, in these exact words — if they ask about it, repeat this sentence as written and do not reword it: "${failureExplanation}"`
            : ""
        }`
      // Otto must not describe a cancel as a failure either (#602 T3): it is the user's own
      // decision, and speaking about it apologetically invites an offer to retry.
      : s === "CANCELLED" ? "the user CANCELLED the last generation themselves — it was refunded, so they were NOT charged for it, and nothing went wrong"
      : s === "GENERATING" ? "a generation is being made right now"
      : s === "QUEUED" ? "a generation is queued and about to start"
      : `the last generation status is ${s}`;
    parts.push(`Current generation status for this conversation: ${human}. Speak about generation progress ONLY based on this.`);
  }
  if ((ctx.images?.length ?? 0) > 1) {
    parts.push(`The user attached ${ctx.images!.length} IMAGE REFERENCES this turn. You can inspect them as input images; compare and use all relevant visual details from the attached references.`);
  }
  const referenceVideoCount = ctx.referenceVideoGenerationIds?.length ?? (ctx.referenceVideoGenerationId ? 1 : 0);
  if (referenceVideoCount > 0) {
    // Per-turn signal: unlike an attached image (which Otto SEES as an input_image part),
    // a reference video is invisible to the model — so tell it one is attached this turn.
    parts.push(
      referenceVideoCount === 1
        ? `The user attached a REFERENCE VIDEO this turn — you cannot see it; reason from their words. Propose kind:"video" so the clip guides the generation's motion, pacing, and style.`
        : `The user attached ${referenceVideoCount} REFERENCE VIDEOS this turn — you cannot see the clips; reason from their words. Propose kind:"video" so the primary clip can guide the generation's motion, pacing, and style, and acknowledge when multiple clips may be conflicting references.`,
    );
  }
  return parts.length ? ({ role: "system", content: parts.join("\n\n") } as AgentInputItem) : null;
}

// ---------------------------------------------------------------------------
// buildOttoContext — exported for 1.8b reuse
// ---------------------------------------------------------------------------

/** W-B3-F-P factory batch port. Kept as its own factory because ottoApprove can only learn the
 *  attemptId AFTER it has inspected the restored interruptions, so it rebuilds this ONE port on the
 *  already-built context (#566) instead of building a second context. The attemptId still never
 *  comes from model args — only from a hash-verified, CAS-consumed APPROVAL_CARD.id. */
function makeFactoryBatchPort(factoryAttemptId?: string): NonNullable<OttoContext["runFactoryBatch"]> {
  return {
    variant: (input) => factoryAttemptId
      ? runVariantBatch({ ...input, attemptId: factoryAttemptId })
      : Promise.resolve({ error: "That batch approval attempt is missing — ask Otto to propose it again." }),
    bulk: (input) => factoryAttemptId
      ? runBulkGrid({ ...input, attemptId: factoryAttemptId })
      : Promise.resolve({ error: "That batch approval attempt is missing — ask Otto to propose it again." }),
  };
}

export async function buildOttoContext({
  ownerId,
  projectId,
  threadId,
  sourceGenerationId,
  sourceGenerationIds,
  referenceVideoGenerationId,
  referenceVideoGenerationIds,
  mediaReferences,
  turnText,
  simpleMode,
  approvalConsent,
  factoryAttemptId,
}: {
  ownerId: string;
  projectId: string;
  threadId: string;
  sourceGenerationId?: string | null;
  sourceGenerationIds?: string[] | null;
  referenceVideoGenerationId?: string | null;
  referenceVideoGenerationIds?: string[] | null;
  /** Codex QA-CRE-FE9-013:解析器一次产出的引用回执(名字 + 来源画布),原样进 ctx。
   *  缺席 = 这条入口没有回执可交(例如 worker 侧的批准续跑),卡面照旧只列 @元素。 */
  mediaReferences?: OttoMediaReference[];
  /** #775 判官 r3 P1-2:商家这一轮自己打的那句话,服务端原样带进 ctx。只用于铸视频卡前
   *  与模型自选的动作对一次表(见 OttoContext.turnText)。绝不来自模型入参。 */
  turnText?: string;
  simpleMode?: boolean;
  /** AR2 处方1: set ONLY by ottoApprove's universal branch — the hash-time updatedAt snapshot. */
  approvalConsent?: { scheduledPostId: string; expectedUpdatedAt: string };
  /** Server-only factory attempt token: the hash-verified, CAS-consumed APPROVAL_CARD.id. */
  factoryAttemptId?: string;
}): Promise<OttoContext> {
  // #647 T6 修复轮 P1-3:读不到后台开关状态 ⇒ 这一轮不许开跑。Otto 一开跑就会铸卡,
  // 而「不知道哪台引擎被关了」的时候铸出来的每一张卡都可能是确认不了的承诺。抛出去 ——
  // 三个调用方(stream route / ottoTurn / ottoApprove)都有 try/catch,会把它翻译成
  // 一句「等一下再试」,零卡落库。
  const registry = await resolveDisabledModels();
  if ("error" in registry) throw new Error(registry.error);
  const disabledModels = Array.from(registry.disabled);
  const imageRefIds = orderedUniqueIds([...(sourceGenerationIds ?? []), sourceGenerationId]);
  const videoRefIds = orderedUniqueIds([...(referenceVideoGenerationIds ?? []), referenceVideoGenerationId]);

  // Web-search transport (S1). Tavily is primary; Brave is the fallback when both keys
  // are present. With no key configured, `search` is left unwired — researchWeb's query
  // path then returns its graceful "not configured" message (fail-closed, never crashes).
  const k1 = process.env.TAVILY_API_KEY;
  const k2 = process.env.BRAVE_SEARCH_API_KEY;
  const primary = k1 ? tavilySearch(k1) : k2 ? braveSearch(k2) : undefined;
  const fb = k1 && k2 ? braveSearch(k2) : undefined;
  // Wrap the bare WebSearchResult[] the adapter returns in { results } to match the port shape.
  const search = primary
    ? async (query: string) => ({ results: await searchWithFallback(primary, fb)(query) })
    : undefined;

  const [brandContext, projectBriefRow, availableRefs, activeJob, images] = await Promise.all([
    getBrandContextText(ownerId, null).catch(() => ""),
    // #791-1: the per-project brief the merchant wrote (QuickBrief / Otto's updateBrief).
    // Owner-scoped like every other project read here — projectId alone never selects a row.
    // Best-effort: a failed read drops the brief for this turn, it never fails the turn.
    prisma.project
      .findFirst({
        where: { id: projectId, ownerId, deletedAt: null },
        select: { coworkBrief: true },
      })
      .catch(() => null),
    loadAvailableRefsForAgent(ownerId),
    prisma.genJob.findFirst({
      where: { threadId, ownerId },
      orderBy: { createdAt: "desc" },
      select: { status: true, kind: true, error: true },
    }).catch(() => null),
    // Codex QA-CRE-FE9-013:视觉这一路也曾按 projectId 过滤 —— 那正是「Otto 说它没看到
    // 杯子」的直接原因。判据现在与校验器同一份(owner 作用域),两处不可能再给出不同答案。
    gatherReferenceImages(ownerId, imageRefIds),
  ]);
  const context: OttoContext & {
    segments: ReturnType<typeof makeOttoSegmentsPort>;
    campaigns: ReturnType<typeof makeOttoCampaignsPort>;
    contacts: ReturnType<typeof makeOttoContactsPort>;
  } = {
    orgId: ownerId,
    // userId is the owner/tenant scope (= orgId), not a distinct verified per-user id — no per-user
    // token is threaded here. See OttoContext.userId doc. Do not treat as an individual-member id.
    userId: ownerId,
    projectId,
    threadId,
    disabledModels,
    // Image refs still go to Otto vision below, but when a reference video is attached
    // the current paid generation path stays single-primary video-reference only.
    sourceGenerationId: videoRefIds.length > 0 ? null : imageRefIds[0] ?? null,
    sourceGenerationIds: imageRefIds,
    referenceVideoGenerationId: videoRefIds[0] ?? null,
    referenceVideoGenerationIds: videoRefIds,
    // 引用回执 —— 铸卡时冻进卡里,商家在按下 `Generate · N credits` 之前逐项读得到。
    ...(mediaReferences?.length ? { mediaReferences } : {}),
    // #775 判官 r3 P1-2:商家这一轮的原话。铸视频卡前拿它跟模型自选的动作对一次表 ——
    // 这是「模型选错档」唯一可能被逮住的时刻,而且那一刻还没花一分钱。
    ...(turnText ? { turnText } : {}),
    images,
    startGen: startCoworkGen,
    // W-B3-F-P: factory batch port — routes to the SAME owner-scoped server actions. The model
    // never receives an attemptId; only ottoApprove can inject the verified + consumed card id.
    runFactoryBatch: makeFactoryBatchPort(factoryAttemptId),
    brandContext,
    projectBrief: projectBriefRow?.coworkBrief?.trim() || undefined,
    availableRefs,
    simpleMode: simpleMode ?? false,
    activeJob,
    // C7: exact authenticated read/draft capability. Revision publish changes only the definition
    // pointer; activation, authorization, run, dispatch, send, provider, and spend methods are absent.
    workflows: makeOttoWorkflowsPort(),
    // B0-61/C3: list/get/preview/build all enter the authenticated Segment action layer.
    // The port never accepts ownerId and never compiles free-form language into rules.
    segments: makeOttoSegmentsPort(),
    // B0-51..58/C2a: zero-cost Campaign planning only. Reads/writes re-enter the authenticated
    // action layer; no UTM, generation, credits, schedule approval, send, publish, or provider port.
    campaigns: makeOttoCampaignsPort(),
    // B0-59/60/C1: owner-scoped Contact reads/writes re-enter the same authenticated actions.
    // #803: phone entry/correction/removal is open to Otto, at the merchant-entered grade only —
    // a channel-verified number is refused, and no argument can store one as verified. Consent
    // and DND mutations still route through the closed runtime writers.
    contacts: makeOttoContactsPort(),
    // #495/#500: connected channel-account list re-enters the same gateway read as the human pickers.
    channelScopes: makeOttoChannelScopesPort(),
    // #555: balance + credit history re-enter the same owner-scoped read the Billing page renders.
    // Read-only: no credit write, no top-up, no identity from the model.
    spending: makeOttoSpendingPort(),
    metaAds: { list: () => fetchOwnerAdObjects(ownerId) },
    metaPages: { list: () => fetchOwnerPages(ownerId) },
    // #692 r3: money crosses into chat through the boundary in lib/otto-money-view.ts — as
    // finished text carrying its currency (or naming the account when Meta reported none), with
    // no numeric amount left to add across accounts. Three rounds of instructing the model
    // failed; the shape is what holds. Connection states pass through untouched.
    metaInsights: {
      get: async (datePreset: string) => {
        const res = await fetchOwnerInsights(ownerId, datePreset);
        return "accounts" in res ? { accounts: toOttoInsightAccounts(res.accounts) } : res;
      },
    },
    metaPerformance: {
      getAds: async (p: string) => {
        const res = await fetchOwnerAdPerformance(ownerId, p);
        return "ads" in res ? { ...res, ads: toOttoAdRows(res.ads) } : res;
      },
    },
    metaPropose: (input) => proposeMetaActionForOwner(ownerId, threadId, input),
    metaBuild: { propose: (input) => proposeAdBuildForOwner(ownerId, threadId, input) },
    brandBrain: { context: () => getBrandContextText(ownerId, null).catch(() => "") },
    research: {
      fetchUrl: fetchAndExtract,
      search,
      readPage: (url: string, page?: number) => readPageCached(url, page),
      // MONEY-A10:这一轮的搜索槽。**每次装配一个新的**,所以它天然是 per-turn 的 —— 上限
      // 判 `granted`(账本预留时发的格数)、计费按 `succeeded`,协议全文见 OttoSearchSlots。
      // 它同时是钱腿存在与否的开关(runtime.ts ottoBudgetArgsFor):少了它,researchWeb 的
      // query 腿会拒绝搜索。`granted: 0` 是 fail closed 的初值 —— 预留还没跑/跑失败,
      // 一格也不许搜。
      searchSlots: { granted: 0, taken: 0, succeeded: 0 },
    },
    // Single write authority: Otto's schedulePosts skill drafts through the SAME server function
    // the human createScheduledPost action uses (shared validation + owner-scoped media check).
    // debt-70~74 (B4): the remaining ports are the SAME owner-scoped server actions the human
    // buttons/views use — identity re-derives from the verified session inside each action
    // (requireOwner), which is the session this run executes under; approve/cancel/update also
    // re-check impersonation there. Skills never touch Prisma (single-action-layer rule).
    approvalConsent,
    schedule: {
      draft: (input) => draftScheduledPost({ ownerId, projectId, source: "otto", input }),
      // AR2 处方1: the CAS inside approveScheduledPost pins the THREADED hash-time snapshot,
      // not its own fresh read — a material edit after hash-check hard-fails the approve.
      approve: ({ scheduledPostId, expectedUpdatedAt }) => approveScheduledPost(scheduledPostId, { expectedUpdatedAt }),
      cancel: ({ scheduledPostId }) => cancelScheduledPost(scheduledPostId),
      update: ({ scheduledPostId, patch }) => updateScheduledPost(scheduledPostId, patch),
      list: async ({ from, to }) => {
        const rows = await listScheduledPosts({ from, to });
        return rows.map((r) => ({
          id: r.id,
          channel: r.channel,
          caption: r.caption,
          status: r.status,
          scheduledAt: r.scheduledAt.toISOString(),
          scheduledTz: r.scheduledTz,
          approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
          mediaCount: r.media.length,
          lastError: r.lastError,
        }));
      },
      listTargets: () => listOwnerTargets(),
      // B0-103 read parity: reads the static global seed table (no owner scope), $0, never writes.
      suggestTimes: ({ channel, limit }) => suggestPostTimes({ channel, limit }),
      // B0-28: mints a seat-less read-only share link for one OWNED post (owner-verified server-side;
      // TTL server-fixed; one authority row per mint). Revoke kills every active link for a post.
      sharePreview: ({ scheduledPostId }) => sharePostPreview({ scheduledPostId }),
      sharePreviewRevoke: ({ scheduledPostId }) => revokeSharePreview({ scheduledPostId }),
    },
    productIngest: {
      // Layer 1 only: fetch (SSRF-hardened) + deterministic extract, plus the page text so
      // Otto itself fills any gaps (that is the skill path's Layer 2 — no separate LLM call).
      fromUrl: async (url: string) => {
        try {
          const { html, url: sourceUrl } = await fetchRawHtml(url);
          const draft = extractProductDraft(html, sourceUrl);
          const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
          return { draft, text };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Couldn't read that URL." };
        }
      },
    },
    // Canvas port (W-B3-A, $0) — single action layer (宪法 7 / Seam 9): Otto's manageCanvas
    // skill drives the SAME owner-gated $0 server actions the human canvas UI uses
    // (canvas-actions + the display-only chat→canvas bridge), with Otto-side pre-validation
    // (generationId must be real + in-project; edit/remove are project-bound) — see
    // makeOttoCanvasPort. None of these touch startGen / reserveCredits / the provider.
    canvas: makeOttoCanvasPort(ownerId, projectId),
    // Media ports (W-B3-B, $0) — single action layer: Otto's manageMedia / renderVideo /
    // importMedia skills drive the SAME owner-gated $0 server actions the human media UI uses
    // (getEditorMedia/loadMoreMedia/attach/detach/delete/discard/cancelGenJob; startRender/
    // getRenderJobs/startCaption/getCaptionJob/getTranscript; finalizeCandidateUploads via a
    // server-side SSRF-guarded fetch), each pre-bound to this owner+project. None touch startGen.
    media: makeOttoMediaPort(ownerId, projectId),
    render: makeOttoRenderPort(ownerId, projectId),
    mediaImport: makeOttoMediaImportPort(ownerId, projectId),
    // Projects / entities / library / brand-memory ports (W-B3-D, $0) — single action layer
    // (宪法 7 / Seam 9): Otto's manage* skills drive the SAME owner-gated server actions the human
    // UI uses (actions.ts / library-actions / asset-actions / brand-record-actions / memory-actions).
    // Each action re-derives the owner from the verified session (requireOwner) and is fail-closed on
    // a missing/cross-owner id; none touch startGen / reserveCredits / the provider.
    projects: makeOttoProjectsPort(ownerId),
    entities: makeOttoEntitiesPort(),
    library: makeOttoLibraryPort(),
    brandMemory: makeOttoBrandMemoryPort(),
    // Reference-generation port (W-B3-G-P, debt-68/69). generate forwards to the SOLE refgen spend
    // authority (startRefGen — own requireOwner + refGenRequest gate + server-priced reserve); the
    // generateReferences skill is cost:"spend" ⇒ needsApproval literal true. deleteVariant is $0 with
    // an Otto-only fail-closed active-job gate (refuses while a paid job runs). None duplicate spend.
    refgen: makeOttoRefgenPort(ownerId),
  };
  return context;
}

// ---------------------------------------------------------------------------
// finalizeOttoRun — shared post-run persistence
// (extractText lives in @fikirtive/otto run-output.ts — the single source, 7-14b.)
//
// finalizeOttoRun is the EXACT post-run persistence ottoTurn performs after a
// (non-streaming) run completes, lifted verbatim so the streaming route handler
// (app/api/otto/stream/route.ts) can reuse it WITHOUT duplicating ~100 lines of
// money-adjacent CAS logic. Behavior is identical:
//   - interruption branch: CAS-write paused ottoState (existing) / plain update
//     (new) → stale on count 0 → persist partial assistant text → needs_approval
//   - completed branch: CAS-write ottoState (existing) / $transaction (new) →
//     stale on count 0 → persist assistant reply → done
// The CAS guard `updateMany({ where:{ id, ownerId, ottoState: priorOttoState }})`
// (count 0 ⇒ stale) is preserved. Does NOT call revalidatePath (caller-owned).
// ---------------------------------------------------------------------------

export type FinalizeOttoRunResult =
  | { status: "needs_approval"; pendingCardIds: string[]; fallbackReply: string | null }
  | { status: "done"; reply: string }
  | { status: "stale" };

// ---------------------------------------------------------------------------
// #498 never-silent fallbacks — a paused run must always leave something visible.
// The verbal-approval path ("全部生成") parks the gated generate call(s) with, in
// practice, ZERO narration text from the model, so without a synthesized reply the
// turn ends in dead air: no message, no error, no visible state change (the SDK's
// "Accessed finalOutput before agent run is completed." warn is the only trace).
// These strings are chat copy ONLY — the approval/spend machinery is untouched.
// P2 honesty rules: the receipt follows the merchant's own message language
// (Han-majority → Chinese; Malay-indicative-token majority → Malay; else English),
// and its promise follows what confirming actually does — only generate cards may
// say work starts right away.
// ---------------------------------------------------------------------------

export type FallbackLang = "en" | "zh" | "ms";

/** Malay-indicative tokens for the coarse ms/en vote below. Function words, polite
 *  markers, and the make/confirm verbs merchants actually type at Otto. Malay and
 *  Indonesian share most of these — both intentionally land on "ms". The list is a
 *  heuristic, not a lexicon: unlisted Malay words simply don't vote. */
const MS_TOKENS = new Set([
  "sila", "tolong", "boleh", "buat", "buatkan", "jana", "janakan", "hasilkan",
  "teruskan", "semua", "kesemua", "semuanya", "saya", "anda", "awak", "kami", "kita",
  "ini", "itu", "yang", "dan", "dengan", "untuk", "dalam", "pada", "tak", "tidak",
  "jangan", "sudah", "dah", "belum", "lagi", "sekarang", "nanti", "gambar", "okey",
  "baiklah", "sahkan", "setuju", "mula", "mulakan", "terus", "cuba", "nak", "hendak",
  "mahu", "satu", "dua", "tiga",
]);

/** Malay-looking word form: -kan / -lah / -nya suffix on a 5+ letter word. Prefix
 *  tests (me-/ber-/ter-) are deliberately NOT used — too many English false
 *  positives (member, mention, terrible). Rare English -lah/-nya endings can still
 *  slip through; accepted as heuristic noise. */
const MS_WORD_FORM = /^[a-z]{2,}(kan|lah|nya)$/;

/** English-indicative tokens for the same vote. Shared en/ms words (e.g. "video")
 *  sit on the English side so plain-English asks never flip to ms on one loanword. */
const EN_TOKENS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "it", "is", "are",
  "was", "be", "i", "you", "we", "they", "my", "me", "this", "that", "these",
  "those", "please", "pls", "make", "all", "them", "then", "now", "go", "ahead",
  "yes", "yeah", "ok", "okay", "sure", "start", "generate", "create", "do", "does",
  "can", "could", "will", "would", "just", "everything", "every", "each", "both",
  "image", "images", "picture", "pictures", "video", "videos", "proceed", "confirm",
  "with", "for", "from", "one", "two", "three",
]);

/** Decide ONE message's language, honestly admitting when it can't.
 *  Detection boundaries:
 *   - Han-majority (vs latin letters) → zh, checked FIRST — a mixed CJK+Malay/English
 *    message follows whichever side has more counted characters; kana/hangul are not
 *    counted (not launch markets).
 *   - Otherwise a coarse token vote: Malay-indicative tokens (MS_TOKENS + -kan/-lah/
 *    -nya word forms) vs English-indicative tokens (EN_TOKENS). Strictly more Malay
 *    votes → ms; strictly more English votes → en. Malay vs Indonesian is NOT
 *    distinguished (shared function words).
 *   - #498 round-5: a mixed-language TIE ("ok teruskan"), no recognized tokens, and
 *    empty input return null — indecisive — instead of silently defaulting to en.
 *    The caller falls back to the thread's most recent decisive merchant message
 *    (resolveFallbackLang below); only a thread with no decisive history lands on
 *    "en" (the UI language). */
export function decideFallbackLang(userText: string | null | undefined): FallbackLang | null {
  if (!userText) return null;
  let cjk = 0;
  let latin = 0;
  for (const ch of userText) {
    if (/\p{Script=Han}/u.test(ch)) cjk += 1;
    else if (/[A-Za-z]/.test(ch)) latin += 1;
  }
  if (cjk > latin) return "zh";
  let ms = 0;
  let en = 0;
  for (const token of userText.toLowerCase().split(/[^a-z]+/)) {
    if (!token) continue;
    if (MS_TOKENS.has(token) || MS_WORD_FORM.test(token)) ms += 1;
    else if (EN_TOKENS.has(token)) en += 1;
  }
  if (ms > en) return "ms";
  if (en > ms) return "en";
  return null;
}

/** Single-message projection with the UI-language default (no thread history in
 *  reach — pure). Production receipt paths use resolveFallbackLang instead. */
export function fallbackLangOf(userText: string | null | undefined): FallbackLang {
  return decideFallbackLang(userText) ?? "en";
}

/** How many recent merchant messages the tie fallback may consult. */
const FALLBACK_LANG_HISTORY_WINDOW = 10;

/** #498 round-5: resolve the receipt language for a thread. The merchant's message
 *  this turn decides when it can; an indecisive one (mixed-language tie, no
 *  recognized tokens, or a click with no message — ottoApprove) falls back through
 *  the thread's recent merchant messages, newest first, to the first decisive one:
 *  that IS the most recent message's adjudicated language, because a message that
 *  was itself indecisive was adjudicated from ITS predecessors the same way. Only
 *  a thread with no decisive history returns "en". Copy only — no spend logic. */
async function resolveFallbackLang(
  ownerId: string,
  threadId: string,
  userText?: string | null,
): Promise<FallbackLang> {
  const direct = decideFallbackLang(userText);
  if (direct) return direct;
  const history = await prisma.chatMessage.findMany({
    where: { threadId, ownerId, role: "USER", kind: "TEXT", deletedAt: null },
    orderBy: { seq: "desc" },
    take: FALLBACK_LANG_HISTORY_WINDOW,
    select: { text: true },
  });
  for (const m of history) {
    const lang = decideFallbackLang(m.text);
    if (lang) return lang;
  }
  return "en";
}

/** Reply persisted when a run pauses on approvable card(s) with no model narration.
 *  `allGenerate` keeps the promise honest: only generate cards start work on confirm,
 *  so any non-generate approval in the batch drops the "I'll start right away" line. */
export function approvalPointerText({ cardCount, allGenerate, lang }: {
  cardCount: number;
  allGenerate: boolean;
  lang: FallbackLang;
}): string {
  if (lang === "zh") {
    if (allGenerate) {
      return cardCount === 1
        ? "为了守住你的积分，光靠一句话不会开始生成——请在上方卡片确认，我会马上开始。"
        : "为了守住你的积分，光靠一句话不会开始生成——请逐张确认上方卡片，我会马上开始。";
    }
    return cardCount === 1
      ? "光靠一句话不会执行任何操作——请查看并确认审批卡片，我才会继续。"
      : "光靠一句话不会执行任何操作——请逐张查看并确认审批卡片，我才会继续。";
  }
  if (lang === "ms") {
    if (allGenerate) {
      return cardCount === 1
        ? "Untuk menjaga kredit anda, tiada apa-apa dijana dengan kata-kata sahaja — sahkan pada kad di atas dan saya akan mula serta-merta."
        : "Untuk menjaga kredit anda, tiada apa-apa dijana dengan kata-kata sahaja — sahkan setiap kad di atas dan saya akan mula serta-merta.";
    }
    return cardCount === 1
      ? "Tiada apa-apa berlaku dengan kata-kata sahaja — semak dan sahkan kad kelulusan itu, kemudian saya akan teruskan."
      : "Tiada apa-apa berlaku dengan kata-kata sahaja — semak dan sahkan setiap kad kelulusan, kemudian saya akan teruskan.";
  }
  if (allGenerate) {
    return cardCount === 1
      ? "To keep your credits safe, nothing is made from words alone — confirm on the card above and I'll start right away."
      : "To keep your credits safe, nothing is made from words alone — confirm each card above and I'll start right away.";
  }
  return cardCount === 1
    ? "Nothing happens from words alone — review and confirm the approval card, and I'll take it from there."
    : "Nothing happens from words alone — review and confirm each approval card, and I'll take it from there.";
}

/** Reply persisted when a run pauses with NOTHING approvable (malformed/unknown
 *  interruption) and no model narration — an honest dead-end instead of silence. */
export function interruptedFallbackText(lang: FallbackLang): string {
  if (lang === "zh") return "这一步我没能完成——请再试一次。";
  if (lang === "ms") return "Saya tidak dapat menyelesaikan langkah ini — sila cuba lagi.";
  return "I couldn't finish that — please try again.";
}

// ---------------------------------------------------------------------------
// Universal approval cards (B4 debt-70, spec §五 5.1·附 touchpoints ①/②) — the durable
// APPROVAL_CARD a non-generate approval-gated skill parks as. generate keeps its own
// GEN_CARD/OttoPlanCard spend path untouched; these helpers only serve the other gated skills.
// ---------------------------------------------------------------------------

/** R1 + AR1 处方2: enrich the card with WHAT is being consented to (owner-scoped read of the
 *  MATERIAL fields) and hash-bind it. Returns null when the post can't be read — the resulting
 *  hashless card is unapprovable (fail-closed). */
async function readApprovalConsent(
  ownerId: string,
  toolName: string,
  ref: string,
  args?: Record<string, unknown>,
): Promise<{ summary: ApprovalCardSummary | null; contentHash: string; updatedAt: string } | null> {
  // generateReferences (debt-68, spend): the consent object is the EXACT parked tool-call args, not a
  // mutable DB row — nothing to re-read for drift, no TOCTOU snapshot to thread. Bind the args with a
  // content hash (anti-flip: a same-entity prompt/count/mode swap ⇒ a different hash ⇒ hard refuse at
  // approve). No entity read is needed to be approvable — startRefGen owner-gates the entity at execute
  // time; the generic approval-card view renders this card (named action, no rich summary).
  if (toolName === "generateReferences") {
    const contentHash = refgenApprovalHashFromArgs(args);
    if (!contentHash) return null; // no bindable consent ⇒ fail-closed (hashless, unapprovable card)
    return {
      summary: null,
      contentHash,
      updatedAt: "", // no mutable row ⇒ no TOCTOU snapshot (only approveScheduledPost threads one)
    };
  }
  // runFactoryBatch (W-B3-F-P, spend): same consent shape as generateReferences — the consent object
  // is the EXACT parked tool-call args (mode/batchId/name/base/variants/cells; immutable in the
  // RunState, no mutable row, no TOCTOU snapshot). ANY post-mint flip of the batch content ⇒ a
  // different hash ⇒ hard refuse at approve. The generic approval-card view renders this card.
  if (toolName === "runFactoryBatch") {
    const contentHash = factoryBatchApprovalHashFromArgs(args);
    if (!contentHash) return null; // no bindable consent ⇒ fail-closed (hashless, unapprovable card)
    return {
      summary: null,
      contentHash,
      updatedAt: "", // no mutable row ⇒ no TOCTOU snapshot (only approveScheduledPost threads one)
    };
  }
  if (toolName !== "approveScheduledPost") return null;
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: ref, ownerId, deletedAt: null },
      select: {
        channel: true, caption: true, scheduledAt: true, scheduledTz: true,
        firstComment: true, metaTargetId: true, updatedAt: true,
        media: { select: { generationId: true }, orderBy: { position: "asc" } },
      },
    });
    if (!post) return null;
    const scheduledAtIso = post.scheduledAt.toISOString();
    return {
      summary: {
        channel: post.channel,
        caption: post.caption,
        scheduledAt: scheduledAtIso,
        scheduledTz: post.scheduledTz,
        mediaCount: post.media.length,
      },
      contentHash: computeApprovalContentHash({
        channel: post.channel,
        scheduledAt: scheduledAtIso,
        caption: post.caption,
        firstComment: post.firstComment ?? null,
        metaTargetId: post.metaTargetId ?? null,
        mediaGenerationIds: post.media.map((m) => m.generationId),
      }),
      // The TOCTOU-weld snapshot (AR2 处方1): captured in the SAME read the hash is computed from.
      updatedAt: post.updatedAt.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Persist one APPROVAL_CARD per parked non-generate approval. Deduped per (toolName, ref,
 * status=pending): a rehydrated run can re-park the SAME pending tool call (the user sent another
 * message while an approval waited), and that must not mint a second card for one consent.
 * generateReferences additionally pins contentHash in the dedup (P2 ref collision): its ref
 * (entityId) is NOT unique across two same-entity parks with different prompts — without the hash,
 * the second distinct ask would silently reuse the first ask's card and become unapprovable. The
 * re-park-same-call dedup still holds (same args ⇒ same hash ⇒ same card).
 * runFactoryBatch pins the hash for the same reason: its ref (batchId) can repeat across two parks
 * with different cells (the orchestration layer only fails-closed on changed content at execute).
 */
async function persistPendingApprovalCards(args: {
  ownerId: string;
  threadId: string;
  approvals: ApprovalInterruption[];
  seqStart: number;
}): Promise<{ cardIds: string[]; seq: number }> {
  let seq = args.seqStart;
  const cardIds: string[] = [];
  for (const a of args.approvals) {
    // P2 ref collision: refgen's consent object is the parked args themselves, so the pending-card
    // identity must include their hash (null for unbindable args — those dedupe by ref alone and
    // mint a hashless, unapprovable card).
    const consentHash =
      a.toolName === "generateReferences" ? refgenApprovalHashFromArgs(a.args)
      : a.toolName === "runFactoryBatch" ? factoryBatchApprovalHashFromArgs(a.args)
      : null;
    const existing = await prisma.chatMessage.findFirst({
      where: {
        threadId: args.threadId,
        ownerId: args.ownerId,
        kind: "APPROVAL_CARD",
        AND: [
          { payload: { path: ["toolName"], equals: a.toolName } },
          { payload: { path: ["ref"], equals: a.ref } },
          { payload: { path: ["status"], equals: "pending" } },
          ...(consentHash !== null ? [{ payload: { path: ["contentHash"], equals: consentHash } }] : []),
        ],
      },
      select: { id: true },
    });
    if (existing) {
      cardIds.push(existing.id);
      continue;
    }
    const consent = await readApprovalConsent(args.ownerId, a.toolName, a.ref, a.args);
    const payload: ApprovalCardPayload = {
      toolName: a.toolName,
      ref: a.ref,
      status: "pending",
      // #524 r5: try #1. Bumped only by a try that burned its reservation (see ApprovalCardPayload).
      attempt: 1,
      summary: consent?.summary ?? null,
      // Fail-closed: a card without a hash can never be approved (post unreadable at mint).
      contentHash: consent?.contentHash ?? null,
      expiresAt: new Date(Date.now() + APPROVAL_CARD_TTL_MS).toISOString(),
    };
    const id = newId();
    await prisma.chatMessage.create({
      data: {
        id,
        threadId: args.threadId,
        ownerId: args.ownerId,
        role: "AGENT",
        kind: "APPROVAL_CARD",
        seq: ++seq,
        text: "",
        payload: payload as unknown as Prisma.InputJsonObject,
      },
    });
    cardIds.push(id);
  }
  return { cardIds, seq };
}

/** ATOMIC card consumption (AR1 处方2): a conditional pending→terminal update — the WHERE pins
 *  payload.status="pending", so of two concurrent resolvers exactly ONE wins (count 1) and the
 *  loser sees count 0 (double-click / replay = idempotent refusal). The card is the consumable. */
async function casApprovalCard(
  db: Pick<Prisma.TransactionClient, "chatMessage">,
  cardId: string,
  ownerId: string,
  payload: ApprovalCardPayload,
  status: "approved" | "rejected" | "expired",
): Promise<boolean> {
  const { count } = await db.chatMessage.updateMany({
    where: {
      id: cardId,
      ownerId,
      kind: "APPROVAL_CARD",
      AND: [{ payload: { path: ["status"], equals: "pending" } }],
    },
    data: { payload: { ...payload, status } as unknown as Prisma.InputJsonObject },
  });
  return count > 0;
}

async function consumeApprovalCard(
  cardId: string,
  ownerId: string,
  payload: ApprovalCardPayload,
  status: "approved" | "rejected" | "expired",
): Promise<boolean> {
  try {
    return await casApprovalCard(prisma, cardId, ownerId, payload, status);
  } catch (err) {
    console.warn(`[approval-card] consume failed (cardId=${cardId}).`, err);
    return false;
  }
}

/**
 * Which parked interruption an APPROVAL_CARD refers to — the ONE definition, used by both
 * `ottoApprove` (to bind the consent it is about to spend) and `ottoReject` (to mark the same
 * call declined). The two carried a word-for-word copy of this, per-tool hash branches and all;
 * a card that approves against one rule and rejects against another is a money bug waiting for
 * the copies to drift apart, and only a comment stood between them.
 *
 * The match is (toolName, ref) AND — for the two tools whose `ref` is NOT unique — the card's
 * own content hash. `generateReferences` refs an entityId that two same-entity parks share, and
 * `runFactoryBatch` refs a batchId that may repeat across parks with different content, so each
 * card must match exactly ITS OWN parked call and never a sibling's still-pending ask.
 * `generate` is excluded: it is bound by cardId on its own path above, not by this one.
 *
 * Generic in the interruption element type so both call sites keep the exact type the run state
 * handed them (`state.approve`/`state.reject` take it back unchanged).
 */
function findParkedApprovalInterruption<T>(
  interruptions: readonly T[],
  cardPayload: ApprovalCardPayload,
): T | undefined {
  return interruptions.find((item) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const it = item as any;
    const toolName: string | undefined = it.name ?? it.rawItem?.name;
    if (!toolName || toolName === "generate" || toolName !== cardPayload.toolName) return false;
    try {
      const args = JSON.parse(it.arguments ?? it.rawItem?.arguments ?? "{}") as Record<string, unknown>;
      if (approvalRefOf(toolName, args) !== cardPayload.ref) return false;
      if (toolName === "generateReferences") {
        return refgenApprovalHashFromArgs(args) === cardPayload.contentHash;
      }
      if (toolName === "runFactoryBatch") {
        return factoryBatchApprovalHashFromArgs(args) === cardPayload.contentHash;
      }
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Claim the approval card as the LAST step before the model runs (#524 r3, judge P1-A).
 *
 * ORDER IS THE FIX. r2 consumed the card and then let `reserveCredits` decide, with a read-only
 * preflight in between; under READ COMMITTED that preflight could read a cap the merchant lowered
 * a moment later, so the card was eaten and the reserve then refused — consent gone, model never
 * run. No preflight can close that window, because the two decisions live in two transactions.
 *
 * So the consumption moved INSIDE the metered call, into `withLlmBudget`'s `afterReserve` claim
 * window: the authoritative hold is taken FIRST, and only once the ledger has agreed does the
 * consent get spent. Every reserve refusal — spend cap, balance, anything — now lands while the
 * card is still `pending`, and the model has not run. Losing the CAS refunds the hold in full.
 *
 * This needs NO approved→pending reverse channel: the card is never flipped on a path that can
 * still fail into "nothing ran", so AR1 处方2's one-way consent survives intact. The CAS itself is
 * byte-identical, so of two concurrent resolvers exactly one still wins.
 *
 * Errors are NOT swallowed (judge r2 P2): a write that failed is not "someone else won", and the
 * caller must never turn it into a cheerful `resolution: "approved"`. It propagates, withLlmBudget
 * refunds the hold, and the merchant is told the approve failed.
 *
 * WHY THE CLAIM IS STAMPED (2026-08-18). The leaked-approve reaper's recovery keys on a dated
 * record that consent was spent. It normally has one — this resume's RESERVE row — but a refId
 * family that reserves NOTHING leaves it with nothing to sweep, and `ChatMessage` has no
 * `updatedAt` to fall back on. So the instant goes into the payload here, in the SAME conditional
 * write that spends the consent, where it cannot drift away from it and cannot depend on how
 * conversation happens to be priced. See ApprovalCardPayload.approvedAt.
 */
async function claimApprovalCard(
  cardId: string,
  ownerId: string,
  payload: ApprovalCardPayload,
): Promise<boolean> {
  return casApprovalCard(prisma, cardId, ownerId, { ...payload, approvedAt: new Date().toISOString() }, "approved");
}


/** True for a Postgres unique-constraint violation surfaced by Prisma. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * The refId this try will reserve under — chosen from the LEDGER, not from a marker (#524 r6,
 * judge r5 P1-A'①).
 *
 * `reserve:<refId>` is globally unique and a REFUND does not delete the RESERVE row, so an attempt
 * that reserved and was then refunded is spent forever: reserving under it again can only hit
 * P2002. r5 handled that by writing the next attempt onto the card after each burned try — but
 * that write was best-effort and happened AFTER the refund committed, so a crash in between, a
 * failed write, or a card minted before the field existed all left a card whose own "Try again"
 * the ledger would refuse forever. A promise the product cannot keep is worse than no button.
 *
 * So the attempt is DERIVED instead: ask the ledger which of this card's attempts it has already
 * finished with, and take the first one it has not. That answer cannot be stale, cannot be lost to
 * a crash, and needs nothing to have been written correctly beforehand — the ledger is the thing
 * that would refuse, so the ledger is the thing that is asked.
 *
 * An attempt that is HELD but not yet finalized is deliberately not skipped: it is a click still in
 * flight, and reusing its refId is exactly how a duplicate click loses on the unique key and is
 * answered benignly instead of running a second time.
 *
 * The card's own `attempt` is the starting point (a fast path past attempts already known to be
 * burned) and the fallback if the ledger cannot be read — failing to a refId that may collide is
 * strictly better than failing to one that could double-charge.
 */
const APPROVE_ATTEMPT_PROBE = 8;

async function chooseApproveAttempt(
  ownerId: string,
  refIdFor: (attempt: number) => string,
  fromAttempt: number,
): Promise<number> {
  const candidates = Array.from({ length: APPROVE_ATTEMPT_PROBE }, (_, i) => fromAttempt + i);
  try {
    const spent = await finalizedReservations(ownerId, candidates.map(refIdFor));
    const free = candidates.find((n) => !spent.has(refIdFor(n)));
    // Every probed attempt already finished: keep walking forward rather than reusing a spent one.
    return free ?? fromAttempt + APPROVE_ATTEMPT_PROBE;
  } catch (err) {
    console.warn(`[approval-card] attempt lookup failed (ownerId=${ownerId}).`, err);
    return fromAttempt;
  }
}

/**
 * Record on the card that this try burned its attempt, so the next click skips it without asking
 * the ledger (#524 r5; demoted to a fast path in r6).
 *
 * Correctness no longer depends on it — `chooseApproveAttempt` derives the real answer from the
 * ledger — which is why the write can stay best-effort AND why it no longer pins the attempt in
 * its WHERE. Pinning `payload.attempt` was itself a bug: a card minted before the field existed
 * has no `attempt` key at all, so the JSON path matched nothing and the bump silently did not
 * happen. Pinning `status: "pending"` is what actually matters — it is what keeps this from ever
 * touching a card someone else has resolved. Two failures racing write the same value.
 */
async function retireApprovalAttempt(
  cardId: string,
  ownerId: string,
  payload: ApprovalCardPayload,
  usedAttempt: number,
): Promise<void> {
  try {
    await prisma.chatMessage.updateMany({
      where: {
        id: cardId,
        ownerId,
        kind: "APPROVAL_CARD",
        AND: [{ payload: { path: ["status"], equals: "pending" } }],
      },
      data: {
        payload: { ...payload, status: "pending", attempt: usedAttempt + 1 } as unknown as Prisma.InputJsonObject,
      },
    });
  } catch (err) {
    console.warn(`[approval-card] attempt retire failed (cardId=${cardId}).`, err);
  }
}

/**
 * Move a card the run consumed but never delivered to the terminal `failed` state (#524 r5,
 * judge r4 P1-A'②).
 *
 * The hole this closes: the CAS won (consent spent), the resume then threw, and the card sat there
 * reading "Approved", which was simply untrue. Nothing was published and the merchant had no way
 * to see it.
 *
 * `approved → failed` is FORWARD-only: the card never becomes consumable again, so AR1 处方2's
 * one-way consent is untouched and no reverse channel is introduced. The merchant re-initiates by
 * asking Otto, which mints a fresh card — the same route a rejected or expired card takes.
 * The CAS pins `status="approved"` so it can only ever rewrite the card THIS run consumed.
 *
 * #524 r6 (judge r5 P1-A'②): `chargeVerdict` rides along because `failed` alone says nothing about
 * money. A refunded LLM hold proves only that THIS turn was free; the approved tool runs BEFORE the
 * model call that threw, so it may already have created and paid for a generation. Only a caller
 * that PROVED the whole action was free passes `"zero"` — everything else, including "we could not
 * check", is `"unknown"` and gets the sentence that promises less.
 */
async function markApprovalFailed(
  cardId: string,
  ownerId: string,
  payload: ApprovalCardPayload,
  chargeVerdict: "zero" | "unknown",
): Promise<void> {
  try {
    await prisma.chatMessage.updateMany({
      where: {
        id: cardId,
        ownerId,
        kind: "APPROVAL_CARD",
        AND: [{ payload: { path: ["status"], equals: "approved" } }],
      },
      data: { payload: { ...payload, status: "failed", chargeVerdict } as unknown as Prisma.InputJsonObject },
    });
  } catch (err) {
    console.warn(`[approval-card] failure mark failed (cardId=${cardId}).`, err);
  }
}

/**
 * What the merchant is told when an approve RAN but lost the thread CAS (judge r2 P1, 2026-08-18).
 *
 * Both sentences fix a gap that predates the reaper question. A concurrent turn moving the thread
 * makes `ottoApprove` return `status: "stale"` and write NOTHING, so the merchant who pressed
 * Approve saw their conversation carry on as if they never had — while their approved work had in
 * fact run, and on the completed branch had been paid for and delivered. Saying so is the product
 * fix; it is also what makes "every terminal outcome leaves evidence in the thread" true by
 * CONSTRUCTION rather than by luck, which is the premise the leaked-card sweep rests on
 * (apps/worker/src/jobs/llm-reservation-reaper.ts pass 3).
 *
 * Neither sentence claims more than is known. The work committed — that is what winning the tool
 * call and losing a state CAS means — so both say it plainly; what was lost is Otto's own reply
 * and the paused state, and both say that too instead of implying the work itself failed.
 */
export const APPROVE_STALE_COMPLETED_NOTE =
  "Your approval went through and Otto finished the work. Another message arrived at the same moment, so Otto's reply couldn't be added here — anything it made is saved.";

export const APPROVE_STALE_INTERRUPTED_NOTE =
  "Your approval went through and Otto has more to ask before it can carry on. Another message arrived at the same moment, so that follow-up couldn't be saved here — ask Otto to pick it up again.";

/** Append an AGENT message to the thread (best-effort), so a failure the merchant needs to know
 *  about is visible in the conversation and not only on the card.
 *
 *  IT NEVER THROWS, and three callers now depend on that: each of them is already on a terminal
 *  path (a lost CAS, or the outer catch) where the honest answer is decided and a second failure
 *  must not replace it. A `create` that fails here costs the merchant a sentence; letting it
 *  propagate out of the outer catch would cost them the REAL error and hand them "database down"
 *  in place of what actually went wrong. The double-failure sliver — the note is lost AND the
 *  thread therefore carries no evidence, so a leaked card could later be swept — is accepted
 *  deliberately: it needs the database to be failing at exactly that instant, and its cost is a
 *  card retired to `failed` with `chargeVerdict: "unknown"`, which is the sentence that promises
 *  least, never a charge. */
async function persistAgentNote(threadId: string, ownerId: string, text: string): Promise<void> {
  try {
    const last = await prisma.chatMessage.findFirst({
      where: { threadId, ownerId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    await prisma.chatMessage.create({
      data: { id: newId(), threadId, ownerId, role: "AGENT", kind: "TEXT", seq: (last?.seq ?? 0) + 1, text },
    });
  } catch (err) {
    console.warn(`[approval-card] note persist failed (threadId=${threadId}).`, err);
  }
}

/**
 * Persist a completed/interrupted Otto run, with the SAME CAS + seq semantics as
 * ottoTurn. `seqAfterUser` is the seq value AFTER the USER message was written;
 * the assistant message is created at `seqAfterUser + 1`.
 */
export async function finalizeOttoRun({
  ownerId,
  threadId,
  isNew,
  priorOttoState,
  result,
  seqAfterUser,
  userText,
}: {
  ownerId: string;
  threadId: string;
  isNew: boolean;
  priorOttoState: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  seqAfterUser: number;
  /** The merchant's message this turn — picks the #498 fallback receipt's language
   *  (decideFallbackLang: Han-majority → zh, Malay-token majority → ms). Copy only;
   *  indecisive or absent → the thread's recent merchant messages decide
   *  (resolveFallbackLang), English only without decisive history. */
  userText?: string | null;
}): Promise<FinalizeOttoRunResult> {
  const finalization = finalizeOttoTurn(result, ottoInteractiveRuntime);
  const newOttoState = finalization.newOttoState;
  // Tools persist card messages MID-run at max(seq)+1 (proposePack writes one per
  // item), so the pre-run seqAfterUser snapshot can be stale. Writing the reply at
  // seqAfterUser+1 would collide with the first card — a reload (ordered by seq)
  // then interleaves the TEXT into the pack and splits the PackCard grouping.
  const lastMsg = await prisma.chatMessage.findFirst({
    where: { threadId, ownerId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  let seq = Math.max(seqAfterUser, lastMsg?.seq ?? 0);

  // Handle interruption (an approval-gated tool parked for approval)
  if (finalization.interrupted) {
    // Closed set from the registry (collectApprovalInterruptions): generate keeps its existing
    // contract — pendingCardIds carries its pre-persisted GEN_CARD ids. Other gated tools
    // (approveScheduledPost) get a durable APPROVAL_CARD persisted below (B4 debt-70 5.1·附①).
    // CONTRACT (#498 round-7): pendingCardIds is the COMPLETE current pending set of this
    // thread's RunState, never a per-round increment — the single fact source both sides cite
    // is the ChainedApproval.pendingCardIds comment in apps/web/components/otto/approval-chain.ts.
    const approvals = finalization.approvals;
    const pendingCardIds: string[] = approvals.filter((a) => a.toolName === "generate").map((a) => a.ref);
    const nonGenerateApprovals = approvals.filter((a) => a.toolName !== "generate");

    // CAS: only write paused ottoState if no concurrent turn moved it (existing thread only)
    if (!isNew) {
      const { count: casCount } = await prisma.chatThread.updateMany({
        where: { id: threadId, ownerId, ottoState: priorOttoState },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });
      if (casCount === 0) return { status: "stale" };
    } else {
      await prisma.chatThread.update({
        where: { id: threadId },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });
    }

    // CAS won (or new thread) — persist any assistant text produced before the interruption.
    // #498: when the model parked the gated call(s) with NO narration (the verbal-approval
    // path), synthesize an honest reply so the turn is never silent: point at the card's
    // confirmation step when something is approvable, or land an honest dead-end line when
    // nothing is. The synthesized text is returned as `fallbackReply` so the live stream
    // can surface it too (model-authored text already streamed as deltas; the fallback is
    // only set when no model text exists, so nothing renders twice).
    const assistantText = finalization.text;
    let fallbackReply: string | null = null;
    if (!assistantText) {
      // #498 round-5: an indecisive message this turn (mixed-language tie) follows
      // the thread's most recent decisive merchant message; en only without history.
      const lang = await resolveFallbackLang(ownerId, threadId, userText);
      fallbackReply = approvals.length > 0
        ? approvalPointerText({
            cardCount: approvals.length,
            allGenerate: approvals.every((a) => a.toolName === "generate"),
            lang,
          })
        : interruptedFallbackText(lang);
    }
    const visibleText = assistantText || fallbackReply;
    if (visibleText) {
      await prisma.chatMessage.create({
        data: {
          id: newId(),
          threadId,
          ownerId,
          role: "AGENT",
          kind: "TEXT",
          seq: ++seq,
          text: visibleText,
        },
      });
    }

    // Durable approval cards for the non-generate gated tools (after the explanatory text).
    if (nonGenerateApprovals.length > 0) {
      const persisted = await persistPendingApprovalCards({
        ownerId,
        threadId,
        approvals: nonGenerateApprovals,
        seqStart: seq,
      });
      seq = persisted.seq;
      pendingCardIds.push(...persisted.cardIds);
    }

    return { status: "needs_approval", pendingCardIds, fallbackReply };
  }

  // Completed — persist Otto's final reply + ottoState
  const replyText = finalization.text;

  if (!isNew) {
    // CAS: only write if no concurrent turn moved the state on
    const { count: casCount } = await prisma.chatThread.updateMany({
      where: { id: threadId, ownerId, ottoState: priorOttoState },
      data: { ottoState: newOttoState, updatedAt: new Date() },
    });
    if (casCount === 0) return { status: "stale" };
    await prisma.chatMessage.create({
      data: {
        id: newId(),
        threadId,
        ownerId,
        role: "AGENT",
        kind: "TEXT",
        seq: ++seq,
        text: replyText,
      },
    });
  } else {
    await prisma.$transaction([
      prisma.chatThread.update({
        where: { id: threadId },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      }),
      prisma.chatMessage.create({
        data: {
          id: newId(),
          threadId,
          ownerId,
          role: "AGENT",
          kind: "TEXT",
          seq: ++seq,
          text: replyText,
        },
      }),
    ]);
  }

  return { status: "done", reply: replyText };
}

// ---------------------------------------------------------------------------
// ENGINE-A2 — 每轮调试档案的落盘实现(规格 docs/specs/otto-engine.md §7.2②)
// ---------------------------------------------------------------------------

/**
 * The ONE writer behind all three doors (stream route / ottoTurn / ottoApprove).
 *
 * 无明文围栏是**类型层**的:入参 `OttoTurnTraceFacts` 上没有任何自由文本字段(动作名已在
 * 引擎侧折过注册表白名单,文件名来自文件柜清单),所以这个函数拿不到 prompt、消息正文或
 * 工具参数,也就无从写进去。落库时**逐字段挑选**而不是把 facts 摊开写,是同一条围栏的
 * 收尾;但真正拦住「悄悄多写一列明文」的是引擎侧的类型与封闭集走查
 * (packages/otto/src/runtime-turn-trace.test.ts),不是这里的挑选写法 —— 下面那条
 * 列集测试钉住的是**当前入库列集**,不是「加字段必须来这里改」这句更强的话。
 *
 * `settledInternal` 在这里读,不在引擎里读:它是账本的事实,引擎包不直连 prisma(与
 * `ctx` 上其他 port 同一条规矩)。读法与流式路由的 `settledTurnCost` 同源 —— 必须先有
 * 终结行(SETTLE 或 REFUND),一个只有 RESERVE 的 refId 是持有不是花费,写进「花了多少」
 * 那一列就是一句假话,所以那种情况写 null。
 *
 * 诊断性质,永不影响商家的这一轮:所有异常在 `runOttoTurn` 的 `emitTurnTrace` 里被吞掉,
 * 这里只负责把话说完整。`upsert` 而不是 `create` 是为了让重跑同一个 refId(比如手工补档)
 * 安全,而不是为了掩盖冲突 —— refId 全仓每轮唯一。
 */
export async function recordOttoTurnTrace(facts: OttoTurnTraceFacts): Promise<void> {
  const settledInternal = await settledTurnInternal(facts.orgId, facts.refId);
  const row = {
    orgId: facts.orgId,
    threadId: facts.threadId,
    surface: facts.surface,
    modelId: facts.modelId,
    steps: facts.steps,
    toolCalls: facts.toolCalls.map((c) => ({ name: c.name, calls: c.calls, ok: c.ok, failed: c.failed })),
    skillFiles: [...facts.skillFiles],
    truncated: facts.truncated,
    settledInternal,
  };
  await prisma.ottoTurnTrace.upsert({
    where: { refId: facts.refId },
    create: { refId: facts.refId, ...row },
    update: row,
  });
}

/**
 * ENGINE-A6(规格 docs/specs/otto-engine.md §7.2④)—— 折叠好的滚动摘要落盘。
 *
 * 与 `recordOttoTurnTrace` 同一条规矩:引擎包不直连 prisma,所以「写哪一行」由入口给。
 * 两个入口(`ottoTurn` 与流式路由)共用这一个写入口,于是租户约束只有一处需要守 ——
 * `updateMany` 带 `ownerId`,租户不对就是零行更新,不是写到别人的对话上去。
 *
 * 迁移为零:`ChatThread.rollingSummary` 这一列 2026 年就在 schema 里等着了
 * (`packages/db/prisma/schema.prisma:1032`,注释自陈 reserved),本段只是终于开始写它。
 */
export async function saveRollingSummary(threadId: string, ownerId: string, summary: string): Promise<void> {
  await prisma.chatThread.updateMany({
    // 判官落修 A6-P2-2:`deletedAt: null` 与两个入口**读**线程时用的 OWNED 口径逐字一致。
    // 少了它,一条商家已经删掉的对话仍会被改写摘要 —— 读不回来的行,写它没有任何意义。
    where: { id: threadId, ownerId, deletedAt: null },
    data: { rollingSummary: summary },
  });
}

/** ENGINE-A6 —— 一个入口把「这一轮要不要折叠」算出来的全部结果:裁过的历史 + 交给引擎的端口。
 *  裁剪的决定在入口(输入装配是它的活),折叠与计费在引擎(runtime.ts),两半各住一处。 */
function planHistoryBudget(
  history: AgentInputItem[],
  priorSummary: string | null,
  threadId: string,
  ownerId: string,
): { kept: AgentInputItem[]; rollingSummary?: OttoRollingSummaryPort } {
  const { kept, dropped } = trimHistoryToBudget(history);
  // 端口在**这一轮裁掉了东西、或线程上已经有摘要**时都要传:折叠仍只在有裁掉的轮时发生(引擎侧
  // `dropped.length > 0` 那道判据没动),但⑥段的装配器要靠它看见被折走的那部分对话 —— 否则
  // 装载集会在裁剪之后中途缩水(见 packages/otto/src/runtime.ts 的 instructionsForTurn)。
  if (dropped.length === 0 && !priorSummary) return { kept };
  return {
    kept,
    rollingSummary: {
      dropped,
      priorSummary,
      save: (summary: string) => saveRollingSummary(threadId, ownerId, summary),
    },
  };
}

/** 这一轮结算掉的 internal credits,或 null(账本还没有终结行 / 读失败 / 免费轮)。
 *  与 apps/web/app/api/otto/stream/route.ts 的 settledTurnCost 同一条口径,但有两处差别:
 *  (1) 单位 —— 那一处给商家看显示面值,这一处进档案存 internal;
 *  (2) 整笔退款那一轮(reserve+refund 净变 0)这里存 0 而不是 null(stream route 的
 *      `chargedInternal <= 0 → null` 是给商家的显示口径)。档案要能区分「退过、净收 0」
 *      与「还没结、根本没有终结行」,所以 0 与 null 在这里是两件事。 */
async function settledTurnInternal(orgId: string, refId: string): Promise<number | null> {
  try {
    const rows = await prisma.creditLedger.findMany({
      where: { orgId, refId },
      select: { kind: true, balanceDelta: true },
    });
    if (!rows.some((row) => row.kind === "SETTLE" || row.kind === "REFUND")) return null;
    const charged = -rows.reduce((sum, row) => sum + row.balanceDelta, 0);
    return Number.isFinite(charged) ? charged : null;
  } catch (e) {
    console.error("[otto:trace] could not read the settled amount:", { refId, error: errSummary(e) });
    return null;
  }
}

/**
 * ENGINE-A4 —— 「这一轮没收钱」的**统一判据**,两门(`ottoTurn` / `ottoApprove`)共用。
 *
 * 从前截断那一支只凭 `onRefundedFailure` 点亮的那面旗就对商家说「没收钱」,而同一个 catch
 * 的第 5 支写着相反的规定。那面旗证明的只是 meter **走过**退款那一步,不证明账本真的把钱
 * 放开了:`refundReservation` 会返回 `already-settled` / `already-refunded` / `no-reservation`
 * (`RefundOutcome`,packages/db/src/credits.ts),而钩子是 `void` 的 —— 那个返回值到不了入口。
 * 判据从此只有一条:**钱话要有账本证据,拿不到证据就不说**。
 *
 * 证据两件,都直接问账本(只读:不移动任何钱、不写任何行):
 *  1. 这笔预扣名下真有一行 `refund:<refId>` —— 退款**真的发生**,而不是被一笔 SETTLE 抢先
 *     (退款的幂等键就是这个字符串,所以「行在」等于「钱回去了」);
 *  2. `otherHoldsSince` === `"none"` —— 这次动作没有第二条腿收过钱(恢复轮先跑完被批准的
 *     那件工具、再在下一次模型调用里死掉,那笔生成已经付过钱了 —— #524 r6)。
 * 读不出来就当没有证据(fail closed):宁可少说一句,也不对着账单说假话。
 */
async function chargedNothingProven(ownerId: string, refundedRefId: string | null): Promise<boolean> {
  if (!refundedRefId) return false; // 退款那一步根本没走到 —— 无从谈起
  try {
    const refund = await prisma.creditLedger.findFirst({
      where: { orgId: ownerId, idempotencyKey: `refund:${refundedRefId}` },
      select: { id: true },
    });
    if (!refund) return false;
  } catch (e) {
    console.error("[otto:money] could not verify the refund landed:", { refId: refundedRefId, error: errSummary(e) });
    return false;
  }
  const holds = await otherHoldsSince(ownerId, refundedRefId).catch(() => "unknown" as const);
  return holds === "none";
}

// ---------------------------------------------------------------------------
// ottoTurn — the main server action
// ---------------------------------------------------------------------------

export async function ottoTurn(raw: unknown): Promise<
  | { threadId: string; status: "done"; reply: string }
  | { threadId: string; status: "needs_approval"; pendingCardIds: string[] }
  | { threadId: string; status: "degraded" }
  | { threadId: string; status: "stale" }
  | { error: string }
> {
  const parsed = coworkTurnRequest.safeParse(raw);
  if (!parsed.success) return { error: "Say what you'd like to make." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<
    | { threadId: string; status: "done"; reply: string }
    | { threadId: string; status: "needs_approval"; pendingCardIds: string[] }
    | { threadId: string; status: "degraded" }
    | { threadId: string; status: "stale" }
    | { error: string }
  > => {
    if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
    const { ownerId } = gate;
    // The same conversation gate the streaming route takes, on the same per-tenant bucket, so the
    // two doors into one conversation share one hourly budget instead of each handing out its own.
    // Placed before anything is validated, persisted or run: a refusal costs nothing. It bounds
    // runaway VOLUME; what a turn may spend is bounded by the reserve. See
    // OTTO_TURN_PER_TENANT_PER_HOUR.
    if (!(await consumeOttoTurnGate(ownerId))) return { error: OTTO_TURN_RATE_LIMIT_MESSAGE };

    const { projectId, text, entityIds, variantSel, sourceGenerationId, sourceGenerationIds, referenceVideoGenerationId, referenceVideoGenerationIds, replyToMessageId } = parsed.data;

    // ENGINE-A4(规格 docs/specs/otto-engine.md §7.2⑤ 第③刀):由 withLlmBudget 在**整笔退款**
    // 时记下这一轮的 refId —— 「钱话要有账本证据」的入口(判据见 `chargedNothingProven`)。
    // 记 refId 而不是一面布尔旗:旗只说「钩子响过」,refId 才是回账本对证的那把钥匙。
    // 走查修复三(#3310):声明提到**外层 try 之前**,因为供应商侧失败是从 `runOttoTurn` 里
    // 抛出去、被文末那个 catch 接住的,而那句诚实话要在那里说 —— 在里面声明等于那句话
    // 在唯一需要它的地方读不到(而 `refId` 本身住在里面)。
    let refundedRefId: string | null = null;

    try {
      const OWNED = { ownerId, deletedAt: null } as const;

      // Validate the project is owned + live
      const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
      if (!project) return { error: "Project not found." };

      const refs = await validateOttoTurnReferences({
        ownerId,
        projectId,
        sourceGenerationId,
        sourceGenerationIds,
        referenceVideoGenerationId,
        referenceVideoGenerationIds,
      });
      // Codex QA-CRE-FE9-013 —— **静默丢弃到此为止**。商家挂上来的引用只要有一件取不到,
      // 这一轮就整轮不发:不建对话、不落 USER 消息、不进 Otto、不铸卡、不预扣。他读到的是
      // 一句人话(措辞的单一权威在 `gen-failure.ts`),草稿留在输入框里,移掉那一件再试。
      // 上一版在这里把它滤成空数组继续跑,于是 Otto 按「没有产品参考」的前提铸卡、商家批准
      // 并为一张不含他指定产品的素材付了钱。
      if (refs.unavailable.length > 0) return { error: unavailableReferenceMessage(refs.unavailable) };

      // Resolve thread: new vs existing-owned-and-in-project
      const isNew = !parsed.data.threadId;
      const threadId = parsed.data.threadId ?? newId();
      let priorOttoState: string | null = null;
      // ENGINE-A6 —— 这条对话此前折叠掉的旧轮。每一轮都要回注,不只是发生裁剪的那一轮。
      let priorRollingSummary: string | null = null;

      if (!isNew) {
        const t = await prisma.chatThread.findFirst({
          where: { id: threadId, ...OWNED },
          select: { projectId: true, ottoState: true, rollingSummary: true },
        });
        if (!t || t.projectId !== projectId) return { error: "Conversation not found." };
        priorOttoState = t.ottoState;
        priorRollingSummary = t.rollingSummary;
      }

      // Validate replyToMessageId (scoped, else null)
      let validReplyId: string | null = null;
      if (!isNew && replyToMessageId) {
        const qm = await prisma.chatMessage.findFirst({
          where: { id: replyToMessageId, threadId, ownerId, deletedAt: null },
          select: { id: true },
        });
        if (qm) validReplyId = qm.id;
      }

      // Compute next seq
      const last = isNew
        ? null
        : await prisma.chatMessage.findFirst({
            where: { threadId, ownerId },
            orderBy: { seq: "desc" },
            select: { seq: true },
          });
      let seq = last?.seq ?? 0;

      // Persist USER message first (create thread row first if new — FK ordering)
      // #979:标题只能来自商家**自己**打的字。产品自己写好的起手 chip(Brand memory 那
      // 四句)被点一下也是一条消息,但它是我们的文案 —— 拿它当标题,画布随后沿用,
      // 商家的画布就在侧栏里叫「Let me describe my brand to you — …」(beta 录像 01:28)。
      //
      // FRONT-A14(判官 P2-2):这一扇门开出来的**一定是画布对话**,所以 `surface` 写死。
      // 不读 `parsed.data.surface`:那一格是 #879 step 1 的**页面位置**(自测值就是
      // "campaign"),与「这条对话从哪个门开」是两件事,只是重名。拿它当线程来源,#879
      // step 2 一落地、客户端开始如实上报 "campaign",这里就会把它 coerce 成 canvas ——
      // 一个靠巧合才正确的值。侧栏面板永远先走 `createEmptyCoworkThread` 建线程再发第一句,
      // 所以它一次都不会走到这里。
      //
      // 注释写在 `create(` **上面**而不是里面:#979 那道命名守卫按「`chatThread.create(`
      // 起 10 行内必须看得见 title」扫全仓,长注释塞进 data 里会把 title 挤出那扇窗。
      if (isNew) {
        await prisma.chatThread.create({
          data: { id: threadId, ownerId, projectId, title: newThreadTitle(text), surface: DEFAULT_THREAD_SURFACE },
        });
      }
      const userMessageId = newId();
      await prisma.chatMessage.create({
        data: {
          id: userMessageId,
          threadId,
          ownerId,
          role: "USER",
          kind: "TEXT",
          seq: ++seq,
          text,
          payload: { entityIds, variantSel, sourceGenerationIds: refs.sourceGenerationIds, referenceVideoGenerationIds: refs.referenceVideoGenerationIds },
          replyToMessageId: validReplyId,
        },
      });

      // Build context
      const ctx = await buildOttoContext({
        ownerId,
        projectId,
        threadId,
        sourceGenerationIds: refs.sourceGenerationIds,
        referenceVideoGenerationIds: refs.referenceVideoGenerationIds,
        mediaReferences: refs.mediaReferences,
        turnText: text,
        simpleMode: parsed.data.simple,
      });

      // Goal-intent seeding: on a new thread with a goalKey, append the preset's opening
      // to brandContext so buildContextSystemMessage injects it as a system message.
      if (isNew && parsed.data.goalKey && isGoalKey(parsed.data.goalKey)) {
        ctx.brandContext = [ctx.brandContext, `Goal for this conversation: ${GOAL_PRESETS[parsed.data.goalKey].opening}`]
          .filter(Boolean)
          .join("\n\n");
      }

      // Build run input: rehydrate prior state (multi-turn) or start fresh;
      // prepend a system message with brand context + available refs when present.
      const sys = buildContextSystemMessage(ctx, priorRollingSummary);
      const userTurn = buildUserTurn(text, ctx.images);
      let runInput: AgentInputItem[];
      // ENGINE-A6(规格 §7.2④):裁掉的旧轮交给引擎折进 rollingSummary —— 沿用本轮 refId,
      // 不新开钱路。没裁掉任何东西的一轮这里是 undefined,与本改动之前逐字节相同。
      let rollingSummaryPort: OttoRollingSummaryPort | undefined;
      const priorState = priorOttoState ? await tryRestoreRunState(otto, priorOttoState) : null;
      if (priorState) {
        const budget = planHistoryBudget(sanitizeHistory(priorState.history), priorRollingSummary, threadId, ownerId);
        rollingSummaryPort = budget.rollingSummary;
        runInput = [...(sys ? [sys] : []), ...budget.kept, userTurn];
      } else {
        // No prior state OR an unrestorable one (F24): start fresh — the turn still runs and its
        // normal state write self-heals ottoState to the current schema.
        // 判官 P2-1(⑥段):恢复不回来的这一轮**照样要带端口**。历史没了,但线程上那份摘要还在,
        // 而它就是这一轮真正带着的旧上下文 —— 上面那条 system 消息里回注的正是它。不传的话,
        // 只在摘要里点过名的那几份柜文会在恢复失败的这一轮悄悄掉出装载集(与④段之后中途缩水
        // 同一个病灶,只是触发处不同)。空历史 ⇒ `dropped` 为空 ⇒ 引擎侧 `dropped.length > 0`
        // 那道判据仍然不成立:零模型调用、零落盘,钱路一个字没动。
        rollingSummaryPort = planHistoryBudget([], priorRollingSummary, threadId, ownerId).rollingSummary;
        runInput = [...(sys ? [sys] : []), userTurn];
      }

      // Run agent, metered. Key the reservation off the UNIQUE user-message id, not threadId:seq —
      // seq is read-max-then-insert with only a non-unique index, so two concurrent turns can land
      // the same seq → the same `otto-turn:threadId:seq` refId → the second reserveCredits collides
      // on the reserve:<refId> unique index and no-ops, running a turn WITHOUT holding credits (F27).
      const refId = `otto-turn:${userMessageId}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let agentResult: any;

      try {
        agentResult = await runOttoTurn(
          {
            orgId: ownerId,
            refId,
            input: runInput,
            // ENGINE-A2 — 这一门的落盘实现。surface/threadId 由入口给(它们来自已认证的
            // 会话,不来自模型);其余结构事实由引擎累计。
            trace: { surface: "action", threadId, sink: recordOttoTurnTrace },
            // ENGINE-A6 —— 本轮裁掉的旧轮(有才传)。
            rollingSummary: rollingSummaryPort,
          },
          ctx,
          ottoInteractiveRuntime,
          {
            // ENGINE-A4:唯一的改动是挂上这个**只读**钩子(meter.ts 不变量 #7 —— 它改不了任何
            // 金额),把「整笔退了」告诉入口,好让下面的降级句说实话。先转调、再置旗:今天
            // `ottoBudgetArgsFor` 不产出 `onRefundedFailure`,但对象展开会**静默盖掉**将来引擎
            // 侧自己挂的钩子,所以不覆盖,只在它后面接一句(与流式门逐字同形)。
            meter: (budgetArgs, fn) =>
              withLlmBudget(
                {
                  ...budgetArgs,
                  onRefundedFailure: () => {
                    budgetArgs.onRefundedFailure?.();
                    refundedRefId = refId;
                  },
                },
                fn,
              ),
            runAgent: run,
            maxTurnsExceededError: MaxTurnsExceededError,
          },
        );
      } catch (e) {
        if (e instanceof MaxTurnsExceededError) {
          // Graceful degrade — withLlmBudget already settled actual usage (or refunded if no usage)
          // ENGINE-A4(§7.2⑤ 第③刀):整笔退了的那一轮,商家读到的必须是「没收钱」,而不是一句
          // 道歉之后账单上冒出一笔他拿不到东西的钱。两句合成**一条**持久化消息(与流式门同一
          // 句字面量),刷新之后还在,不需要第二条只在内存里活一瞬的提示。
          // 走查修复三:那份字面量现在真的只有一处(`otto-error-copy.ts`),三门共读。
          // 尾巴组十一:这句话现在要账本证据才说 —— 与另一门同一个判据。
          const degradeText = ottoDegradeText(await chargedNothingProven(ownerId, refundedRefId));
          await prisma.chatMessage.create({
            data: {
              id: newId(),
              threadId,
              ownerId,
              role: "AGENT",
              kind: "TEXT",
              seq: ++seq,
              text: degradeText,
            },
          });
          revalidatePath("/", "layout");
          return { threadId, status: "degraded" };
        }
        // InsufficientCredits and other errors bubble to {error} contract
        throw e;
      }

      // agentResult is a RunResult from withLlmBudget; typed as any to avoid overload ambiguity
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = agentResult as any;

      // Persist the run (interruption / completed / stale) with CAS — shared with the
      // streaming route handler via finalizeOttoRun (identical behavior).
      const finalized = await finalizeOttoRun({ ownerId, threadId, isNew, priorOttoState, result, seqAfterUser: seq, userText: text });
      revalidatePath("/", "layout");
      if (finalized.status === "stale") return { threadId, status: "stale" };
      if (finalized.status === "needs_approval") {
        return { threadId, status: "needs_approval", pendingCardIds: finalized.pendingCardIds };
      }
      return { threadId, status: "done", reply: finalized.reply };
    } catch (e) {
      // Log the real cause server-side: the generic client message hides it, and a swallowed
      // error here once masked an Anthropic 529 for hours. The client message stays generic.
      console.error("[ottoTurn] failed:", errSummary(e));
      // 走查修复三(#3310):供应商侧的那一档在这里也换诚实句 —— 与流式门同一份分类器、
      // 同一份文案。「没收钱」只在账本能证明退款真的落地时才说(`chargedNothingProven`)。
      return {
        error: ottoFailureMessage(e, "Couldn't reach Otto — please try again.", {
          chargedNothing: await chargedNothingProven(ownerId, refundedRefId),
        }),
      };
    }
  });
}

// ---------------------------------------------------------------------------
// ottoUpdateGenCardOptions —— 商家在确认卡上改那三格(张数／形状／精修),$0
// (Founder 2026-09-05 裁决「加进确认卡」;规格 docs/specs/otto-engine.md,ENGINE-A3)
// ---------------------------------------------------------------------------

/**
 * ⑦段把画布上那个直出 composer 退役之后,张数／形状／精修在商家那一侧无处可选 ——
 * 唯一的花钱入口是这张卡,而这张卡从前只能整张接受或整张丢掉。这个动作就是
 * 「商家批准前可改」那一句裁决。
 *
 * **零花费**:它只重写一张还没有任务行的 GEN_CARD 的 payload。没有 reserve、没有
 * GenJob、没有 provider 调用 —— 花钱仍然只发生在商家按下 `Generate · N credits` 那一刻。
 *
 * 报价与预扣同源,靠的是**不新增第二处派生**:新价由引擎包那个纯函数用
 * `pricedGenCredits`(startGen 预扣时用的同一个函数)算出来写进卡,而 `startCoworkGen`
 * 只从**持久化的卡**读 `expectedCredits` 再现算一次比对 —— 对不上就在 create/reserve
 * 之前拒。所以卡面那个数与真正离开余额的那个数不可能是两个数。
 *
 * 三道门,顺序即理由:
 *  ① 身份只来自 `requireOwner`,卡按 owner + threadId 作用域读 —— 跨租户的 cardId 读不到;
 *  ② 已经成交的卡不许再改。三条判据各拦各的:卡上有 `canvasAction`(画布节点级那张回执)、
 *     卡上有 `genJobId`(这张卡已经挂着一行任务)、以及已经有任务行(`cowork:<cardId>`)——
 *     那张卡已经被商家批准并花过钱,改它就是改一份已经成交的授权;
 *  ③ 改不动的(视频卡、老卡、这一档收不下的形状、今天没有价的精修)一律**如实拒绝**,
 *     卡一个字节不动 —— 绝不静默换一档。
 */
export async function ottoUpdateGenCardOptions(raw: unknown): Promise<
  { ok: true; payload: CardPayload } | { error: string }
> {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).threadId !== "string" ||
    typeof (raw as Record<string, unknown>).cardId !== "string" ||
    ((raw as Record<string, unknown>).threadId as string).length < 1 ||
    ((raw as Record<string, unknown>).threadId as string).length > 64 ||
    ((raw as Record<string, unknown>).cardId as string).length < 1 ||
    ((raw as Record<string, unknown>).cardId as string).length > 64
  ) {
    return { error: "Invalid request." };
  }
  const r = raw as Record<string, unknown>;
  const threadId = r.threadId as string;
  const cardId = r.cardId as string;
  // 只收这三格,而且只收**说得清楚**的值:一个「说了不算数」的入参会让卡与请求分家。
  const edit: CardOptionEdit = {
    ...(typeof r.count === "number" && Number.isFinite(r.count) ? { count: r.count } : {}),
    ...(typeof r.aspectRatio === "string" && r.aspectRatio.length > 0 && r.aspectRatio.length <= 16
      ? { aspectRatio: r.aspectRatio }
      : {}),
    ...(typeof r.fineDetail === "boolean" ? { fineDetail: r.fineDetail } : {}),
  };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; payload: CardPayload } | { error: string }> => {
    if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
    const { ownerId } = gate;

    const card = await prisma.chatMessage.findFirst({
      where: { id: cardId, threadId, ownerId, kind: "GEN_CARD", deletedAt: null },
      select: {
        id: true,
        payload: true,
        genJobId: true,
        thread: { select: { ownerId: true, deletedAt: true } },
      },
    });
    if (!card || card.thread.deletedAt || card.thread.ownerId !== ownerId) return { error: "Card not found." };

    const persisted = card.payload;
    if (
      !persisted ||
      typeof persisted !== "object" ||
      Array.isArray(persisted) ||
      typeof (persisted as Record<string, unknown>).model !== "string" ||
      typeof (persisted as Record<string, unknown>).params !== "object"
    ) {
      return { error: "I can't read this plan any more — ask me to put it together again and I'll make a fresh one." };
    }

    // #1239 判官 P2-1 —— **已经成交的那张卡改不动**,判据不止一条。
    //
    // 下面那道「已经在跑」的闸只认 `cowork:<cardId>` 这一个幂等键,而画布节点级那张卡
    // (`canvas-thread-log.ts` 铸的回执)用的是 `canvas:<actionId>`,又长得跟 Otto 那张确认卡
    // 一模一样 —— 它是一次**已经批过、已经扣过**的动作的收据,却能从这条 $0 的改档路上被
    // 改写。界面那一侧改不到它(有 genJobId ⇒ `deriveCardState` 不是 idle,三格不渲染),但
    // Server Action 是可以直接调的:少了这一道,商家的历史里那张收据说的就不再是当时真正
    // 花掉的那一件事(付费闸 `gen-actions.ts` 那一句同一条口径)。
    //
    // 两条判据各拦各的:`canvasAction` 认画布回执,`genJobId` 认「这张卡上已经挂了一行任务」
    // (Otto 路批准后由交付路写回)。拒在任何写之前 ⇒ payload 一个字节不动、账本零新增行。
    if (typeof (persisted as Record<string, unknown>).canvasAction === "string") {
      return { error: "That was already generated from the canvas — start a new action instead." };
    }
    if (typeof card.genJobId === "string" && card.genJobId.length > 0) {
      return { error: "This one's already under way — ask me for a fresh plan if you'd like it different." };
    }

    const applied = applyCardOptions(persisted as unknown as CardPayload, edit);
    if (!applied.ok) return { error: applied.error };

    // 已经花过钱的卡不许再改。判据是**账本那一份**(GenJob 的 `cowork:<cardId>`,由 startGen
    // 原子写下),不是卡上那个 best-effort 的标记 —— 与 `coworkGenerate` 的再花钱守卫同一个
    // 判据、同一把钥匙。
    //
    // 钱安全(#1230 判官 P2-3):查与写现在进**同一个事务**,而且写的那一句是**条件更新**
    // (`updateMany` 的 `where` 带上租户、线程、卡种与未删除),对不上就是零行受影响、如实说
    // 读不到,不假报成功。
    //
    // 但**竞态窗口并没有因此消除**(尾巴组十一判官 P1-1 纠正上一轮的不实措辞):Prisma 的
    // 交互式事务不传 `isolationLevel` 就是 PostgreSQL 默认的 READ COMMITTED,事务内这条
    // SELECT 对**尚不存在**的 GenJob 行不取任何谓词锁;而 interactive transaction 每条语句
    // 都要回一次 Node,窗口的物理长度也没变短。所以并发的 `startCoworkGen` 若在两条语句之间
    // 插入 `cowork:<cardId>`,这里仍然看不见,updateMany 仍会落地(幻读)。真正原子的写法是
    // 把「未在跑」这个条件搬进那条 UPDATE 的谓词里(`NOT EXISTS (SELECT 1 FROM "GenJob" …)`),
    // 事务内先查后写做不到这一点。**已知未做**,触发条件:下一次动这条路时改成带「未在跑」
    // 谓词的条件更新(它绕过 Prisma 租户守卫,要另配一条真库并发测试)。
    const verdict = await prisma.$transaction(async (tx) => {
      const existingJob = await tx.genJob.findFirst({
        where: { ownerId, idempotencyKey: `cowork:${cardId}` },
        select: { id: true },
      });
      if (existingJob) return "running" as const;
      const { count } = await tx.chatMessage.updateMany({
        where: { id: cardId, threadId, ownerId, kind: "GEN_CARD", deletedAt: null },
        data: { payload: applied.payload as unknown as object },
      });
      return count === 0 ? ("gone" as const) : ("updated" as const);
    });
    if (verdict === "running") {
      return { error: "This one's already under way — ask me for a fresh plan if you'd like it different." };
    }
    if (verdict === "gone") return { error: "Card not found." };
    return { ok: true, payload: applied.payload };
  });
}

// ---------------------------------------------------------------------------
// ottoApprove — approve a parked generate interruption and resume the run
// (Task 1.8b — MONEY half)
// ---------------------------------------------------------------------------

export async function ottoApprove(raw: unknown): Promise<
  | { ok: true; status: "done"; reply: string; genJobId?: string }
  | { ok: true; status: "needs_approval"; pendingCardIds: string[]; fallbackReply: string | null; narrationMessageId: string | null }
  | { ok: true; status: "degraded" }
  | { ok: true; status: "stale" }
  | { ok: true; genJobId: string; status: string } // double-approve: existing job
  | { ok: true; alreadyResolved: true; resolution: ApprovalCardResolution } // consumed/expired card: idempotent refusal
  // Codex staging CRE-STG-P2-004 —— `ref` 只在真正未知的那一支出现(见文末 catch)。
  | { error: string; ref?: string | null }
> {
  // Inline validation (no zod dep in apps/web) — mirror brief schema
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).threadId !== "string" ||
    typeof (raw as Record<string, unknown>).cardId !== "string" ||
    ((raw as Record<string, unknown>).threadId as string).length < 1 ||
    ((raw as Record<string, unknown>).threadId as string).length > 64 ||
    ((raw as Record<string, unknown>).cardId as string).length < 1 ||
    ((raw as Record<string, unknown>).cardId as string).length > 64
  ) {
    return { error: "Invalid approval request." };
  }
  const { threadId, cardId } = raw as { threadId: string; cardId: string };

  // Tenant scope: identity from requireOwner only, never from input
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<
    | { ok: true; status: "done"; reply: string; genJobId?: string }
    | { ok: true; status: "needs_approval"; pendingCardIds: string[]; fallbackReply: string | null; narrationMessageId: string | null }
    | { ok: true; status: "degraded" }
    | { ok: true; status: "stale" }
    | { ok: true; genJobId: string; status: string } // double-approve: existing job
    | { ok: true; alreadyResolved: true; resolution: ApprovalCardResolution } // consumed/expired card: idempotent refusal
    // Codex staging CRE-STG-P2-004 —— `ref` 只在真正未知的那一支出现(见文末 catch)。
    | { error: string; ref?: string | null }
  > => {
    if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
    const { ownerId } = gate;

    // Set by withLlmBudget when a thrown run was refunded in FULL — the starting point (never the
    // whole proof) for "nothing was charged" being a true sentence in front of the merchant (#524 r5).
    // 尾巴组十一:记的是这一次尝试的 refId,不是一面布尔旗 —— 那句话现在要回账本对证
    // (`chargedNothingProven`),而对证要的正是这把钥匙。
    // 走查修复三(#3310):声明提到**外层 try 之前** —— 供应商侧失败是被文末那个 catch 接住的,
    // 而那句诚实话要在那里说。
    let refundedRefId: string | null = null;
    // Set the moment the CAS actually consumed the consent — the only way the catch below can
    // tell "the consent is spent and the run died" from "the consent is still intact" (#524 r5).
    // 同上提到外层:文末的 catch 要靠它判断「这一门到底有没有为别的东西收过钱」。
    let claimedPayload: ApprovalCardPayload | null = null;

    try {
      // Load thread owner-scoped (cross-tenant rejected)
      const thread = await prisma.chatThread.findFirst({
        where: { id: threadId, ownerId, deletedAt: null },
        select: { id: true, projectId: true, ottoState: true },
      });
      if (!thread) return { error: "Conversation not found." };
      if (!thread.ottoState) return { error: "Nothing to approve." };
      const priorOttoState = thread.ottoState;

      // Build the LIVE context BEFORE rehydrating (#566). The serialized RunState carries only JSON,
      // so restoring it rebuilds a context with every injected port erased — and run() ignores
      // options.context for a resumed state, so the ports cannot be re-attached afterwards. The
      // context therefore has to exist first and ride INTO the restore. Card-derived fields
      // (approvalConsent / the factory attemptId) can only be computed after the interruptions are
      // known, so they are late-bound onto this SAME object below — the state holds it by reference.
      const ctx = await buildOttoContext({
        ownerId,
        projectId: thread.projectId,
        threadId,
        sourceGenerationId: null,
      });

      // Rehydrate the paused RunState with that live context. On an unrestorable state (schema bump /
      // corruption, F24) we can't resume the interruption this approval refers to — surface a clean
      // error instead of throwing (which would 500 every approve on a stale thread).
      const state = await tryRestoreRunStateWithContext(ottoApprovalResumeRuntime.agent, priorOttoState, ctx);
      if (!state) return { error: "This conversation's approval state couldn't be restored — please ask Otto to propose it again." };

      // #524 r3: set only on the branch that holds a one-shot consent. It is invoked inside the
      // metered call, after the hold and before the model — see claimApprovalCard.
      let claimCard: (() => Promise<boolean>) | null = null;
      // The card as this try read it. Needed to rewrite the payload when an attempt is retired.
      let cardPayloadForRetry: ApprovalCardPayload | null = null;
      // The FULL cost of the approval as one action — this resume's LLM hold PLUS the
      // deterministic charge of the tool being approved. Handed to the meter so the spend cap is
      // judged against the whole thing inside the reserve's transaction (#524 r5, judge r4 P1-B).
      // #524 r6 (judge r5 P1-A①): EVERY branch names the whole approved action, not just the
      // branch that holds a card. A plain generate is two reserves too — this resume's LLM hold
      // and the card's own deterministic charge — and leaving it null was the 70/40/60 hole.
      let approvedActionCostInternal: number | null = null;

      // The refId of the resume turn. Hoisted above the approval branch (#524 r2) because the
      // spend-cap preflight has to name the SAME turn the reserve will later hold against, and it
      // must run before the card is consumed.
      //
      // #524 r5 (judge r4 P1-A'①): it carries the try's ATTEMPT. `reserve:<refId>` is globally
      // unique, and a refund does NOT remove the RESERVE row — so a fixed per-card refId made
      // every retry after a burned attempt collide (P2002) forever, while the card said "Try
      // again". One refId per attempt.
      // #524 r6 (judge r5 P1-A'①): which attempt is free is DERIVED from the ledger
      // (chooseApproveAttempt), not read off a best-effort marker — so a crash between the refund
      // and the marker's write, a failed write, an old card without the field, and the
      // plain-generate branch (which has no card to mark at all) all still retry for real.
      let approveAttempt = 1;
      const refIdFor = (attempt: number) => `otto-approve:${threadId}:${cardId}:a${attempt}`;
      let refId = refIdFor(approveAttempt);

      // Find the matching generate interruption (cardId binding)
      const interruptions = state.getInterruptions();
      const matchingInterruption = interruptions.find((item) => {
        // item.name uses the getter (toolName ?? rawItem.name)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const it = item as any;
        const toolName: string | undefined = it.name;
        if (toolName !== "generate") return false;
        try {
          const args = JSON.parse(it.arguments ?? "{}") as { cardId?: string };
          return args.cardId === cardId;
        } catch {
          return false;
        }
      });

      // Universal branch (B4 debt-70, spec §五 5.1·附②): when the id isn't a parked generate card,
      // it may be an APPROVAL_CARD message id (a non-generate gated skill, e.g. approveScheduledPost).
      // The card payload carries the (toolName, ref) binding, the content hash binds the consent
      // object, and CAS consumption makes the card single-use (AR1 处方2).
      // AR2 处方1: the hash-time updatedAt snapshot rides the resume context so the server action
      // CAS-pins exactly the content the hash verified (TOCTOU weld).
      let approvalConsent: { scheduledPostId: string; expectedUpdatedAt: string } | undefined;
      let factoryAttemptId: string | undefined;

      if (!matchingInterruption) {
        const cardMsg = await prisma.chatMessage.findFirst({
          where: { id: cardId, threadId, ownerId, kind: "APPROVAL_CARD", deletedAt: null },
          select: { id: true, payload: true },
        });
        const cardPayload = cardMsg ? asApprovalCardPayload(cardMsg.payload) : null;
        if (cardMsg && cardPayload) {
          // Double-approve idempotency (M2 spirit): a consumed card refuses benignly — no re-approve,
          // no second execution.
          if (cardPayload.status !== "pending") {
            return { ok: true, alreadyResolved: true, resolution: cardPayload.status };
          }
          // #524 r5/r6: bind this resume's reservation to an attempt the LEDGER will still accept,
          // before the hold is computed and long before anything is charged. The card's own
          // attempt is where the search starts; the ledger decides where it lands.
          approveAttempt = await chooseApproveAttempt(ownerId, refIdFor, cardPayload.attempt ?? 1);
          refId = refIdFor(approveAttempt);
          cardPayloadForRetry = cardPayload;
          // TTL (AR1 处方2): an expired ASK is no longer confirmable — consume to "expired" and say so.
          if (!cardPayload.expiresAt || Date.now() > new Date(cardPayload.expiresAt).getTime()) {
            await consumeApprovalCard(cardMsg.id, ownerId, cardPayload, "expired");
            return { ok: true, alreadyResolved: true, resolution: "expired" };
          }
          // (toolName, ref) binding FIRST — locate the parked interruption this card refers to. We need
          // its exact args to bind the consent for tools whose consent object IS the parked call
          // (generateReferences), and it lets a stale/already-approved card short-circuit before any read.
          // The matcher (with its per-tool hash pinning) is shared with ottoReject — see
          // findParkedApprovalInterruption.
          const targetItem = findParkedApprovalInterruption(interruptions, cardPayload);
          if (!targetItem) {
            // Parked ask gone (superseded/consumed). Truth first: if the post IS approved, consume the
            // card and answer benignly instead of failing the user for a stale ask.
            if (cardPayload.toolName === "approveScheduledPost") {
              const post = await prisma.scheduledPost.findFirst({
                where: { id: cardPayload.ref, ownerId, deletedAt: null },
                select: { approvedAt: true },
              });
              if (post?.approvedAt) {
                // NODE-279① regression fix: hash BEFORE consume on this short-circuit too — the
                // pre-reorder code verified the content hash before ANY resolution path could run.
                // approvedAt=true must not launder a drifted card: if the post's material fields
                // changed since mint (or the card is hashless), hard-refuse WITHOUT consuming,
                // exactly like the main path below.
                const current = await readApprovalConsent(ownerId, cardPayload.toolName, cardPayload.ref);
                if (!cardPayload.contentHash || !current || current.contentHash !== cardPayload.contentHash) {
                  return { error: "This post changed since Otto asked — review it and ask Otto to request approval again." };
                }
                await consumeApprovalCard(cardMsg.id, ownerId, cardPayload, "approved");
                return { ok: true, alreadyResolved: true, resolution: "approved" };
              }
            }
            return { error: "That card isn't awaiting approval." };
          }
          // The matched interruption's exact args — the consent object for tools that bind the parked
          // call itself (generateReferences hashes these; approveScheduledPost ignores them and re-reads
          // its DB row instead).
          const targetArgs: Record<string, unknown> = (() => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const it = targetItem as any;
              return JSON.parse(it.arguments ?? it.rawItem?.arguments ?? "{}") as Record<string, unknown>;
            } catch {
              return {};
            }
          })();
          // Content-hash binding (AR1 处方2, spec 5.1·附②): recompute the consent hash — for
          // approveScheduledPost by re-reading the post's material fields (drift check), for
          // generateReferences from the matched interruption's args (anti-flip). ANY drift/mismatch (or
          // an unreadable/hashless card) = hard refuse WITHOUT consuming — the user asks Otto afresh.
          const current = await readApprovalConsent(ownerId, cardPayload.toolName, cardPayload.ref, targetArgs);
          if (!cardPayload.contentHash || !current || current.contentHash !== cardPayload.contentHash) {
            return {
              error:
                cardPayload.toolName === "generateReferences"
                  ? "That reference request changed since Otto asked — ask Otto to request it again."
                  : cardPayload.toolName === "runFactoryBatch"
                    ? "That batch request changed since Otto asked — ask Otto to request it again."
                    : "This post changed since Otto asked — review it and ask Otto to request approval again.",
            };
          }
          // AR2 处方1 (approveScheduledPost only): snapshot updatedAt from the SAME read the hash was
          // verified against, so the resumed approve threads it to the server action's CAS (TOCTOU weld).
          // generateReferences has no mutable row ⇒ no snapshot to thread (approvalConsent stays undefined).
          if (cardPayload.toolName === "approveScheduledPost") {
            approvalConsent = { scheduledPostId: cardPayload.ref, expectedUpdatedAt: current.updatedAt };
          }
          // #524 r3 — the card is NOT consumed here any more. Consumption is the claim inside
          // withLlmBudget's afterReserve window below, i.e. AFTER the authoritative hold: that is
          // what makes "the model did not run ⇒ the card is still pending" true by construction
          // instead of by a preflight racing the ledger (judge r2 P1-A). `claimCard` is set for
          // this branch only; the plain-generate branch has no consent to spend.
          claimCard = async () => {
            const won = await claimApprovalCard(cardMsg.id, ownerId, cardPayload);
            // #524 r5: remember it. If the run then dies, the consent is already spent and the
            // card must say so out loud rather than sit there reading "approved" (judge P1-A'②).
            if (won) claimedPayload = cardPayload;
            return won;
          };

          // BOTH legs of this approval, as one number: the resume turn's hold AND the
          // deterministic charge of the tool the merchant actually approved. Counting only the
          // hold is how a cap of 5 credits let a 4-credit hold through and then refused the
          // 6-credit reference generation it was approving. Under-counting merely falls through to
          // the real gates; over-counting would refuse work the ledger would have allowed, so
          // unknown tool costs count as 0 rather than being guessed.
          const holdInternal = llmHoldInternal(
            // ctx 一并传进去:这一轮的真实预扣**包含** MONEY-A10 的搜索腿(resume 一样能搜),
            // 预检少算它就会放行一笔真实 reserve 会被 cap 拒掉的动作。
            ottoBudgetArgsFor(ottoApprovalResumeRuntime, { orgId: ownerId, refId, input: state }, ctx),
          );
          const approvedCostInternal = holdInternal + approvedToolCostInternal(cardPayload.toolName, targetArgs);
          // #524 r5 (judge r4 P1-B) — the number that DECIDES. It rides into the meter and is
          // asserted against the cap inside the reserve's own transaction, so the whole action is
          // judged once, before any of it is held, against the cap as it reads AT THAT MOMENT.
          // The line below is the courtesy version of the same verdict: same total, same words,
          // one read earlier, so the merchant hears it before anything moves. It carries no
          // correctness (different transaction) and the one above re-decides regardless.
          approvedActionCostInternal = approvedCostInternal;
          const earlyCapRefusal = await spendCapRefusal(prisma, ownerId, approvedCostInternal);
          if (earlyCapRefusal) return { error: earlyCapRefusal };

          if (cardPayload.toolName === "runFactoryBatch") factoryAttemptId = cardMsg.id;
          // Approve — mutates the rehydrated state; resume executes the tool → the SAME owner-scoped
          // server action the human button uses (via ctx.schedule.approve).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          state.approve(targetItem as any);
        } else {
          // No matching pending interruption — check if already generated (double-approve path)
          const existingJob = await prisma.genJob.findFirst({
            where: { ownerId, idempotencyKey: `cowork:${cardId}` },
            select: { id: true, status: true },
          });
          if (existingJob) {
            // Already approved/generating — return benignly, no second spend
            return { ok: true, genJobId: existingJob.id, status: existingJob.status };
          }
          return { error: "That card isn't awaiting approval." };
        }
      } else {
        // ── The plain-generate branch: also TWO reserves, not one (#524 r6, judge r5 P1-A①) ──
        //
        // r5 called this branch "exactly one leg" and sent no action total, so the cap judged the
        // resume's LLM hold on its own and then judged the generation on its own. The judge's
        // reproduction needs no concurrency at all: a 40-credit hold and a 60-credit 480p/5s video
        // both clear a cap of 70, and one action the merchant capped at 70 spends 100.
        //
        // The card is the same GEN_CARD the `generate` skill will read, so the second leg is priced
        // from that row through the very functions that will charge it (approvedGenerateCostInternal).
        // An unreadable/unpriceable card counts 0 — it cannot generate either.
        //
        // A card that ALREADY has its job (a re-approve the SDK let through) is about to charge
        // nothing: `executeGenerate` returns the existing job on the `cowork:<cardId>` key. Counting
        // its price anyway would refuse a free action, so the existing job is checked first — the
        // same read, and the same key, the double-approve path above uses.
        //
        // This branch has no APPROVAL_CARD to carry an attempt, so before r6 its refId was always
        // `…:a1` — a resume that reserved and refunded made every later click collide on the unique
        // key forever, with no marker anywhere to move it on. The ledger answers that too.
        approveAttempt = await chooseApproveAttempt(ownerId, refIdFor, 1);
        refId = refIdFor(approveAttempt);

        const genCard = await prisma.chatMessage.findFirst({
          where: { id: cardId, threadId, ownerId, kind: "GEN_CARD", deletedAt: null },
          select: { payload: true },
        });
        const alreadyGenerated = await prisma.genJob.findFirst({
          where: { ownerId, idempotencyKey: `cowork:${cardId}` },
          select: { id: true },
        });
        const generateLegInternal =
          genCard && !alreadyGenerated
            ? approvedGenerateCostInternal({
                cardPayload: genCard.payload,
                projectId: thread.projectId,
                threadId,
                cardId,
              })
            : 0;
        const holdInternal = llmHoldInternal(
          // 同上:预检与真实预扣必须看同一套腿(MONEY-A10 搜索腿)。
          ottoBudgetArgsFor(ottoApprovalResumeRuntime, { orgId: ownerId, refId, input: state }, ctx),
        );
        // The number that DECIDES — asserted against the cap inside the reserve's own transaction.
        approvedActionCostInternal = holdInternal + generateLegInternal;
        // …and the courtesy version of the same verdict, one read earlier, so the merchant hears it
        // before anything moves. It carries no correctness; the one above re-decides regardless.
        const earlyGenCapRefusal = await spendCapRefusal(prisma, ownerId, approvedActionCostInternal);
        if (earlyGenCapRefusal) return { error: earlyGenCapRefusal };

        // Approve — mutates the rehydrated state in place; resume will execute the tool
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.approve(matchingInterruption as any);
      }

      // Late-bind the card-derived fields onto the context the restored state already holds (#566).
      // They could not be passed to buildOttoContext above because they are only knowable once the
      // interruptions have been matched and the card hash-verified + CAS-consumed. Assigning them
      // here reaches the skills because the RunState holds this exact object by reference:
      //  - approvalConsent: the hash-time snapshot (AR2 处方1) approveScheduledPost threads to the
      //    server action's CAS; absent ⇒ that skill fails closed, exactly as before.
      //  - runFactoryBatch: rebuilt so its closure carries the consumed APPROVAL_CARD.id. Still never
      //    from model args; a non-factory approve keeps the attemptId-less (refusing) port.
      ctx.approvalConsent = approvalConsent;
      if (factoryAttemptId) ctx.runFactoryBatch = makeFactoryBatchPort(factoryAttemptId);

      // Resume the run, metered (LLM cost of this resume turn); refId is bound above.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let agentResult: any;

      try {
        agentResult = await runOttoTurn(
          {
            orgId: ownerId,
            refId,
            input: state,
            // ENGINE-A2 — 恢复轮同样落一行档案。它的 refId 带 attempt 序号
            // (`otto-approve:<threadId>:<cardId>:a<n>`),所以重试是**新的一行**,
            // 不会覆盖上一次尝试的档案。
            trace: { surface: "approve-resume", threadId, sink: recordOttoTurnTrace },
          },
          ctx,
          ottoApprovalResumeRuntime,
          {
            // #524 r3 — reserve, THEN claim the consent, THEN run. The claim rides in
            // withLlmBudget's afterReserve window, so a cap/balance refusal always lands with the
            // card still pending, and a lost claim refunds the hold and never calls the model.
            //
            // #524 r6 (judge r5 P1-A①): ONE wrapper for every branch. r5 wrapped only the branch
            // that had a consent to claim, so the plain-generate branch reached the meter bare and
            // its action total was never judged — the 70/40/60 hole. `afterReserve` is what varies
            // (only a card can be claimed); the cap verdict is not.
            meter: (budgetArgs, fn) =>
              withLlmBudget(
                {
                  ...budgetArgs,
                  ...(claimCard ? { afterReserve: claimCard } : {}),
                  // #524 r5 (judge r4 P1-B): the cap is judged against EVERY leg of this approval,
                  // in the reserve's transaction, before the hold and before any card is consumed.
                  // Over the ceiling ⇒ SpendCapBlocked, nothing held, nothing consumed, and the
                  // merchant is told which limit stopped them.
                  capCostInternal: approvedActionCostInternal ?? undefined,
                  // #524 r5: only this tells us "the run died AND this turn paid nothing", the
                  // starting point for whether a consumed card may stop saying "approved".
                  // 先转调、再置旗(与另外两门同形):对象展开会静默盖掉将来引擎侧自己挂的钩子。
                  onRefundedFailure: () => {
                    budgetArgs.onRefundedFailure?.();
                    refundedRefId = refId;
                  },
                },
                fn,
              ),
            runAgent: run,
            maxTurnsExceededError: MaxTurnsExceededError,
          },
        );
      } catch (e) {
        // ── #524 r5 — every way out of the metered resume, each with an honest terminal state ──
        //
        // Ordered by what each says about the CONSENT and the REFID, because those two facts are
        // what the merchant's next click depends on:
        //   1. lost the claim to another resolver → benign; report the state we can READ
        //   2. the claim itself threw             → consent intact, this refId is spent (P1-A'①)
        //   3. the reserve lost its unique key    → nothing moved; answer from the card
        //   4. ran, but ran out of turns          → the model DID run; graceful degrade, unchanged
        //   5. consent spent and the run died     → the card must stop saying "approved" (P1-A'②)
        //
        // 4 sits before 5 on purpose: "it couldn't run" would be false about a run that used up
        // its turns, and the merchant already gets the degrade sentence in the thread.
        // Anything else falls through to the outer catch unchanged.

        // 1. Another resolver claimed this card first. The hold was refunded in full inside
        //    withLlmBudget and the model never ran, so this is the benign double-click answer. The
        //    resolution is READ, never assumed (judge r2 P2): a card that still reads `pending`
        //    means we cannot prove anything was resolved, and saying "approved" would be a lie.
        if (e instanceof ReservationNotClaimed) {
          const fresh = await prisma.chatMessage.findFirst({
            where: { id: cardId, threadId, ownerId, kind: "APPROVAL_CARD", deletedAt: null },
            select: { payload: true },
          });
          const freshPayload = fresh ? asApprovalCardPayload(fresh.payload) : null;
          if (!freshPayload || freshPayload.status === "pending") {
            // Unprovable AND this try's refId is spent — retire the attempt or "Try again" is a
            // promise the ledger will refuse with P2002.
            if (cardPayloadForRetry) await retireApprovalAttempt(cardId, ownerId, cardPayloadForRetry, approveAttempt);
            return { error: "Couldn't confirm this approval — nothing ran and nothing was charged. Try again." };
          }
          return { ok: true, alreadyResolved: true, resolution: freshPayload.status };
        }

        // 2. The claim itself failed (the card write threw) AFTER the hold was taken. The consent
        //    survived — nobody consumed it — but this attempt's reservation is spent, so the next
        //    click needs a fresh one. Never reported as "approved" (judge r2 P2).
        if (e instanceof ClaimFailed) {
          if (cardPayloadForRetry) await retireApprovalAttempt(cardId, ownerId, cardPayloadForRetry, approveAttempt);
          return { error: "Couldn't confirm this approval — nothing ran and nothing was charged. Try again." };
        }

        // 3. A second click inside the SAME attempt: its reserve lost on `reserve:<refId>`, which
        //    is exactly the ledger keeping money exactly-once. It moved nothing — the transaction
        //    rolled back — so answer from the card's own state instead of inventing a fault.
        if (!claimedPayload && isUniqueViolation(e)) {
          const fresh = await prisma.chatMessage.findFirst({
            where: { id: cardId, threadId, ownerId, kind: "APPROVAL_CARD", deletedAt: null },
            select: { payload: true },
          });
          const freshPayload = fresh ? asApprovalCardPayload(fresh.payload) : null;
          if (freshPayload && freshPayload.status !== "pending") {
            return { ok: true, alreadyResolved: true, resolution: freshPayload.status };
          }
          return { error: "This approval is already being confirmed — give it a moment." };
        }
        // 4. The model ran and ran out of turns. Unchanged behaviour, and deliberately ahead of 5:
        //    the run DID happen, so the card reading "approved" is true and the merchant already
        //    hears what went wrong in the thread.
        if (e instanceof MaxTurnsExceededError) {
          // ENGINE-A4(§7.2⑤ 第③刀):这一门早就有那面旗(挂在同一个 `onRefundedFailure` 上),
          // 只是这条分支从前不读它 —— 恢复轮的零交付截断现在也整笔退,商家却读不到「没收钱」。
          // 与另外两门同一句字面量。
          // 走查修复三:那份字面量现在真的只有一处(`otto-error-copy.ts`)。
          // 尾巴组十一(#1218 判官 P2-3):从前这里只凭那面旗就说「没收钱」,与下面第 5 支
          // 「PROVEN, not assumed」的规定正好相反 —— 恢复轮是**先跑完被批准的那件工具**再撞上
          // 步数上限的,那笔生成可能已经付过钱了。现在两门同一个判据:要账本证据才说。
          const degradeText = ottoDegradeText(await chargedNothingProven(ownerId, refundedRefId));
          // Persist the degrade message so the user actually sees it (parity with ottoTurn),
          // plus the partial RunState if the SDK attached one.
          const seq = await prisma.chatMessage.findFirst({
            where: { threadId, ownerId },
            orderBy: { seq: "desc" },
            select: { seq: true },
          });
          await prisma.chatMessage.create({
            data: {
              id: newId(),
              threadId,
              ownerId,
              role: "AGENT",
              kind: "TEXT",
              seq: (seq?.seq ?? 0) + 1,
              text: degradeText,
            },
          });
          const errState = (e as { state?: { toString(): string } }).state;
          if (errState) {
            await prisma.chatThread.update({
              where: { id: threadId },
              data: { ottoState: errState.toString(), updatedAt: new Date() },
            });
          }
          revalidatePath("/", "layout");
          return { ok: true, status: "degraded" };
        }

        // 5. The CAS won, so the consent is gone — and then the run died. A card reading "approved"
        //    over a thing that was never delivered is a lie the merchant cannot see through, so it
        //    moves to `failed` and the thread says so. Deliberately NOT reached when the turn was
        //    settled against real usage — the card is then honestly "approved and charged".
        //
        //    #524 r6 (judge r5 P1-A'②): what it says about MONEY is a separate question, and r5 got
        //    it wrong by answering it from `chargedNothing` alone. That flag proves only that THIS
        //    turn's hold was refunded; a resume runs the approved tool FIRST and can then fail in
        //    the next model call, having already created and paid for a generation. So the zero is
        //    PROVEN, not assumed: the ledger is asked whether anything else was held for this org
        //    from the moment this hold was taken (otherHoldsSince). No — the whole action really was
        //    free. Anything else, including a read that failed, gets the sentence that promises
        //    less. One helper writes both sentences (approvalCardResolutionText), so the card, this
        //    response and the thread note cannot drift into three different claims.
        if (claimedPayload && refundedRefId !== null) {
          // Pinned before the ledger read: `claimedPayload` is assigned inside the claim closure,
          // so TypeScript drops the guard's narrowing across the intervening await.
          const spentCard: ApprovalCardPayload = claimedPayload;
          const holds = await otherHoldsSince(ownerId, refId).catch(() => "unknown" as const);
          const chargeVerdict = holds === "none" ? "zero" : "unknown";
          await markApprovalFailed(cardId, ownerId, spentCard, chargeVerdict);
          const sentence = approvalCardResolutionText({ ...spentCard, status: "failed", chargeVerdict })!;
          await persistAgentNote(threadId, ownerId, sentence);
          revalidatePath("/", "layout");
          return { error: sentence };
        }
        throw e;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = agentResult as any;

      // Shared extractText (@fikirtive/otto run-output.ts) — this was a local copy until 7-14b.
      const finalization = finalizeOttoTurn(result, ottoApprovalResumeRuntime);
      const newOttoState = finalization.newOttoState;

      // (Universal card already consumed pending→approved BEFORE the resume — AR1 处方2 CAS.)

      // Handle another interruption (chained approval needed)
      if (finalization.interrupted) {
        // Same closed-set collection as finalizeOttoRun: generate ids ride pendingCardIds; other
        // gated tools get durable APPROVAL_CARDs persisted after the CAS below.
        // CONTRACT (#498 round-7): pendingCardIds is the COMPLETE current pending set of this
        // thread's RunState (stable ids — a re-parked old dedupes to its existing card), never a
        // per-round increment; a status:"done" return below implies the set is empty. The single
        // fact source both sides cite is the ChainedApproval.pendingCardIds comment in
        // apps/web/components/otto/approval-chain.ts.
        const chainedApprovals = finalization.approvals;
        const pendingCardIds: string[] = chainedApprovals.filter((a) => a.toolName === "generate").map((a) => a.ref);
        const chainedNonGenerate = chainedApprovals.filter((a) => a.toolName !== "generate");

        // CAS: only write paused ottoState if no concurrent turn moved it
        const { count: casInterrupt } = await prisma.chatThread.updateMany({
          where: { id: threadId, ownerId, ottoState: priorOttoState },
          data: { ottoState: newOttoState, updatedAt: new Date() },
        });
        if (casInterrupt === 0) {
          // The tool the merchant approved already RAN — losing this CAS only means a concurrent
          // turn moved the thread before the paused state could be written. Saying so is the
          // product fix (they used to see nothing at all here); it is also what keeps every
          // terminal exit of this action leaving evidence in the thread.
          await persistAgentNote(threadId, ownerId, APPROVE_STALE_INTERRUPTED_NOTE);
          revalidatePath("/", "layout");
          return { ok: true, status: "stale" };
        }

        // CAS won — persist any assistant text produced before the interruption.
        // #498 P1a: the RESUMED run can park again with ZERO narration — the exact
        // main-path silence, one click deeper. Synthesize the same honest receipt:
        // the language follows the merchant's recent messages (an approve is a click,
        // not a message; #498 round-5: an indecisive latest message falls back through
        // the thread history), and the promise follows what confirming actually does.
        const assistantText = finalization.text;
        let fallbackReply: string | null = null;
        if (!assistantText) {
          const lang = await resolveFallbackLang(ownerId, threadId, null);
          fallbackReply = chainedApprovals.length > 0
            ? approvalPointerText({
                cardCount: chainedApprovals.length,
                allGenerate: chainedApprovals.every((a) => a.toolName === "generate"),
                lang,
              })
            : interruptedFallbackText(lang);
        }
        // #498 round-5 P2c: when the model DID narrate, the text used to land in the
        // DB only — the approve response carried fallbackReply: null and the client
        // showed nothing until a reload. Return the persisted narration's durable id
        // so the post-approve poll can inject that exact TEXT message live (the
        // approve path streams nothing, so injecting it can never double-render).
        const visibleText = assistantText || fallbackReply;
        let narrationMessageId: string | null = null;
        if (visibleText) {
          const seq = await prisma.chatMessage.findFirst({
            where: { threadId, ownerId },
            orderBy: { seq: "desc" },
            select: { seq: true },
          });
          const visibleTextId = newId();
          await prisma.chatMessage.create({
            data: {
              id: visibleTextId,
              threadId,
              ownerId,
              role: "AGENT",
              kind: "TEXT",
              seq: (seq?.seq ?? 0) + 1,
              text: visibleText,
            },
          });
          // fallbackReply keeps its round-4 display channel (the card's own receipt
          // line); only model narration rides the id for live chat injection.
          if (assistantText) narrationMessageId = visibleTextId;
        }

        // Durable approval cards for chained non-generate gated asks (B4 debt-70 5.1·附①).
        if (chainedNonGenerate.length > 0) {
          const seqRow = await prisma.chatMessage.findFirst({
            where: { threadId, ownerId },
            orderBy: { seq: "desc" },
            select: { seq: true },
          });
          const persisted = await persistPendingApprovalCards({
            ownerId,
            threadId,
            approvals: chainedNonGenerate,
            seqStart: seqRow?.seq ?? 0,
          });
          pendingCardIds.push(...persisted.cardIds);
        }

        revalidatePath("/", "layout");
        return { ok: true, status: "needs_approval", pendingCardIds, fallbackReply, narrationMessageId };
      }

      // Completed — persist Otto's reply + updated ottoState (CAS guard)
      const replyText = finalization.text;

      // Look up the GenJob created by the resumed generate (best-effort, for UI)
      const genJob = await prisma.genJob.findFirst({
        where: { ownerId, idempotencyKey: `cowork:${cardId}` },
        select: { id: true, status: true },
      });

      const seq = await prisma.chatMessage.findFirst({
        where: { threadId, ownerId },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });

      const { count: casCompleted } = await prisma.chatThread.updateMany({
        where: { id: threadId, ownerId, ottoState: priorOttoState },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });
      if (casCompleted === 0) {
        // The worst of the three silent exits: the run SUCCEEDED — the approved tool ran, the
        // generation was created and charged — and the merchant was told nothing whatsoever
        // because a concurrent turn had moved the thread. They keep the work and lose the
        // sentence explaining it. This note is that sentence, and it is also the thread evidence
        // that stops the leaked-card sweep from ever reading this success as a stranded approve.
        await persistAgentNote(threadId, ownerId, APPROVE_STALE_COMPLETED_NOTE);
        revalidatePath("/", "layout");
        return { ok: true, status: "stale" };
      }
      await prisma.chatMessage.create({
        data: {
          id: newId(),
          threadId,
          ownerId,
          role: "AGENT",
          kind: "TEXT",
          seq: (seq?.seq ?? 0) + 1,
          text: replyText,
        },
      });

      revalidatePath("/", "layout");
      return {
        ok: true,
        status: "done",
        reply: replyText,
        ...(genJob ? { genJobId: genJob.id } : {}),
      };
    } catch (e) {
      console.error("[ottoApprove] failed:", errSummary(e));
      // ONE sentence, said in both places: the merchant reads it wherever they are looking, and
      // the thread and the response cannot drift into two different accounts of the same failure.
      // (Same shape as the spent-consent path above, which pairs markApprovalFailed with a note.)
      // `persistAgentNote` cannot throw — see its doc — so a database that is down here costs the
      // note and nothing else; the real error still reaches the merchant, which is the whole point
      // of not letting a second failure speak over the first.
      // 走查修复三(#3310):供应商侧的那一档换诚实句(与另外两门同一份分类器与文案)。
      // 「没收钱」在这一门要更严:钩子只证明**这一轮的预扣**退了,而恢复轮可能先跑完被批准
      // 的那件工具、付过它的钱(#524 r6)。所以两道:账本证据(`chargedNothingProven`,与另一门
      // 同一个判据)＋**没有任何一张卡被消费** —— 卡被消费的那一支由上面第 5 支自己的句子
      // 负责,根本走不到这里。
      // 把手照旧走 `ref` 字段(`diagnosticRef`),不在句子里再造第二串。
      const sentence = ottoFailureMessage(e, "Couldn't approve — please try again.", {
        chargedNothing: claimedPayload === null && (await chargedNothingProven(ownerId, refundedRefId)),
      });
      await persistAgentNote(threadId, ownerId, sentence);
      // Codex staging CRE-STG-P2-004 —— 商家手上要有一个能念给客服听的把手,而它必须与
      // 上面那行 `console.error` 是同一串。短号由卡的身份算出来(`diagnosticRef`,单一算法),
      // 不是新造的 id —— 一次失败的批准恰恰是「什么都没存下来」的那一刻。句子本身一格没动。
      return { error: sentence, ref: diagnosticRef(cardId) };
    }
  });
}

// ---------------------------------------------------------------------------
// ottoReject — decline a parked non-generate approval (universal card chain, B4 debt-70)
// ---------------------------------------------------------------------------

/** Deterministic decline confirmation — inserted verbatim, NO LLM involved (AR1 处方1). */
const DECLINE_CONFIRMATION_TEXT =
  "Declined — nothing was published. The post stays unapproved in your schedule.";

/**
 * Reject path (spec §五 5.1·附 test ③; AR1 处方1 structural guarantee): declining is a STATIC
 * confirmation — no LLM resume happens at all, so the gated tool structurally cannot execute:
 * ZERO EXTERNAL writes, zero LLM cost. The INTERNAL writes are exactly (honest accounting, AR2
 * 处方2): ① the card's terminal state (CAS pending→rejected — the park is terminated at the
 * consumable, so ottoApprove can never approve it), ② best-effort RunState hygiene (deterministic
 * SDK state mutation, no run) so a later turn rehydrates a rejected tool call instead of a
 * dangling park, ③ the deterministic "declined" conversation message, ④ the
 * ActionEvent(approval.declined) audit row.
 * generate cards are NOT handled here: their decline UX stays the existing plan-card flow.
 */
export async function ottoReject(raw: unknown): Promise<
  | { ok: true; status: "done"; reply: string }
  | { ok: true; alreadyResolved: true; resolution: ApprovalCardResolution }
  | { error: string }
> {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).threadId !== "string" ||
    typeof (raw as Record<string, unknown>).cardId !== "string" ||
    ((raw as Record<string, unknown>).threadId as string).length < 1 ||
    ((raw as Record<string, unknown>).threadId as string).length > 64 ||
    ((raw as Record<string, unknown>).cardId as string).length < 1 ||
    ((raw as Record<string, unknown>).cardId as string).length > 64
  ) {
    return { error: "Invalid request." };
  }
  const { threadId, cardId } = raw as { threadId: string; cardId: string };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<
    | { ok: true; status: "done"; reply: string }
    | { ok: true; alreadyResolved: true; resolution: ApprovalCardResolution }
    | { error: string }
  > => {
    if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
    const { ownerId } = gate;

    try {
      const thread = await prisma.chatThread.findFirst({
        where: { id: threadId, ownerId, deletedAt: null },
        select: { id: true, projectId: true, ottoState: true },
      });
      if (!thread) return { error: "Conversation not found." };

      const cardMsg = await prisma.chatMessage.findFirst({
        where: { id: cardId, threadId, ownerId, kind: "APPROVAL_CARD", deletedAt: null },
        select: { id: true, payload: true },
      });

      // FRONT-A12: not an APPROVAL_CARD? It may be one of Otto's two Meta cards (ACTION_CARD /
      // BUILD_CARD), whose Deny now lands here too — one decline entry point, one audit trail.
      // Their consent is a frozen `Approval` binding rather than an SDK park, so the write itself
      // lives in meta-card-decline; everything below this branch is the APPROVAL_CARD (park) path.
      if (!cardMsg) {
        const metaCardMsg = await prisma.chatMessage.findFirst({
          where: { id: cardId, threadId, ownerId, kind: { in: ["ACTION_CARD", "BUILD_CARD"] }, deletedAt: null },
          select: { kind: true },
        });
        if (metaCardMsg) {
          const declined = await declineMetaCard({
            ownerId,
            threadId,
            cardId,
            kind: metaCardMsg.kind as MetaCardKind,
          });
          if ("error" in declined) return declined;
          if ("alreadyResolved" in declined) {
            // "declined" is this chain's word for the universal card's "rejected" — one vocabulary
            // reaches the client, so a caller never has to know which chain answered.
            const resolution: ApprovalCardResolution =
              declined.resolution === "declined" ? "rejected" : declined.resolution;
            return { ok: true, alreadyResolved: true, resolution };
          }
          revalidatePath("/", "layout");
          return declined;
        }
      }

      const cardPayload = cardMsg ? asApprovalCardPayload(cardMsg.payload) : null;
      if (!cardMsg || !cardPayload) return { error: "That card isn't awaiting approval." };
      if (cardPayload.status !== "pending") {
        return { ok: true, alreadyResolved: true, resolution: cardPayload.status };
      }

      // TTL: an expired ask resolves to "expired", not "rejected" (honest terminal state).
      if (!cardPayload.expiresAt || Date.now() > new Date(cardPayload.expiresAt).getTime()) {
        await consumeApprovalCard(cardMsg.id, ownerId, cardPayload, "expired");
        return { ok: true, alreadyResolved: true, resolution: "expired" };
      }

      // Truth first: if the post got approved elsewhere, record that instead of a false "rejected".
      if (cardPayload.toolName === "approveScheduledPost") {
        const post = await prisma.scheduledPost.findFirst({
          where: { id: cardPayload.ref, ownerId, deletedAt: null },
          select: { approvedAt: true },
        });
        if (post?.approvedAt) {
          await consumeApprovalCard(cardMsg.id, ownerId, cardPayload, "approved");
          return { ok: true, alreadyResolved: true, resolution: "approved" };
        }
      }

      // ATOMIC consumption (CAS pending→rejected) — the park terminates HERE: a consumed card can
      // never be approved (ottoApprove requires pending), regardless of what the run state holds.
      const consumed = await consumeApprovalCard(cardMsg.id, ownerId, cardPayload, "rejected");
      if (!consumed) {
        const fresh = await prisma.chatMessage.findFirst({
          where: { id: cardId, threadId, ownerId, kind: "APPROVAL_CARD", deletedAt: null },
          select: { payload: true },
        });
        const freshPayload = fresh ? asApprovalCardPayload(fresh.payload) : null;
        const resolution = freshPayload && freshPayload.status !== "pending" ? freshPayload.status : "rejected";
        return { ok: true, alreadyResolved: true, resolution };
      }

      // Best-effort state hygiene (deterministic, NO run/LLM): mark the parked tool call rejected on
      // the persisted RunState so the next turn rehydrates a rejected call, not a dangling park. A
      // stale CAS (concurrent turn moved the state) is fine — the consumed card already dead-ends it.
      if (thread.ottoState) {
        try {
          const state = await tryRestoreRunState(otto, thread.ottoState);
          if (state) {
            // The SAME matcher ottoApprove binds consent with — one definition, so a card cannot
            // be approved against one rule and rejected against another.
            const targetItem = findParkedApprovalInterruption(state.getInterruptions(), cardPayload);
            if (targetItem) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              state.reject(targetItem as any, { message: "The user declined this request." });
              await prisma.chatThread.updateMany({
                where: { id: threadId, ownerId, ottoState: thread.ottoState },
                data: { ottoState: state.toString() as string, updatedAt: new Date() },
              });
            }
          }
        } catch (err) {
          console.warn(`[ottoReject] state hygiene skipped (threadId=${threadId}).`, err);
        }
      }

      // Deterministic confirmation message (no LLM) + audit trail.
      const seqRow = await prisma.chatMessage.findFirst({
        where: { threadId, ownerId },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      await prisma.chatMessage.create({
        data: {
          id: newId(),
          threadId,
          ownerId,
          role: "AGENT",
          kind: "TEXT",
          seq: (seqRow?.seq ?? 0) + 1,
          text: DECLINE_CONFIRMATION_TEXT,
        },
      });
      await prisma.actionEvent
        .create({
          data: {
            id: newId(),
            ownerId,
            projectId: thread.projectId,
            type: "approval.declined",
            payload: { cardId, toolName: cardPayload.toolName, ref: cardPayload.ref },
          },
        })
        .catch(() => {});

      revalidatePath("/", "layout");
      return { ok: true, status: "done", reply: DECLINE_CONFIRMATION_TEXT };
    } catch (e) {
      console.error("[ottoReject] failed:", errSummary(e));
      return { error: "Couldn't decline that — please try again." };
    }
  });
}

// ---------------------------------------------------------------------------
// createEmptyCoworkThread — create an empty thread shell (NO first turn, NO spend)
// so the streaming front door can stream the first message into a thread that
// already exists (the stream route's existing-thread branch then handles it:
// priorOttoState null, seq 0). Owner-scoped + project-validated, mirroring ottoTurn.
// (Task 6: founder-flagged streaming front door.)
// ---------------------------------------------------------------------------
export async function createEmptyCoworkThread(raw: unknown): Promise<{ id: string } | { error: string }> {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).projectId !== "string" ||
    typeof (raw as Record<string, unknown>).title !== "string"
  ) {
    return { error: "Invalid request." };
  }
  const { projectId, title } = raw as { projectId: string; title: string };
  // FRONT-A14:第三扇门也要登记来源。声明来自调用方(前门 / 侧栏面板),但只有过闸的两个
  // 字面量能落库 —— 认不出来的按画布读(`lib/otto-thread-surface.ts`)。
  const surface = coerceThreadSurface((raw as Record<string, unknown>).surface);

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ id: string } | { error: string }> => {
    const { ownerId } = gate;

    try {
      const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
      if (!project) return { error: "Project not found." };

      const id = newId();
      await prisma.chatThread.create({
        // "Untitled" (not "New campaign" — #546): a conversation is never a campaign, and
        // OttoApp's auto-title effect already treats "Untitled" threads as unnamed.
        //
        // #979:**第三扇**建对话的门,而且是前门真正走的那一扇 —— 流式前门先建一条空对话,
        // 再把第一条消息交给 OttoChatStream。只在另外两扇上装守卫等于没装:点目标格子
        // 送进来的 `title` 就是我们自己写的标签(「Sell a product」),画布随后沿用它。
        // 空标题照旧退回 "Untitled" —— `newThreadTitle` 自己就管这一档。
        data: { id, ownerId, projectId, title: newThreadTitle(title), surface },
      });
      return { id };
    } catch (e) {
      console.error("[createEmptyCoworkThread] failed:", errSummary(e));
      return { error: "Couldn't start a new conversation — please try again." };
    }
  });
}

// ---------------------------------------------------------------------------
// deleteCoworkThread — permanently delete a conversation record (owner-scoped)
// ---------------------------------------------------------------------------

export async function deleteCoworkThread(threadId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true } | { error: string }> => {
    const { ownerId } = gate;

    try {
      const thread = await prisma.chatThread.findFirst({
        where: { id: threadId, ownerId, deletedAt: null },
        select: { id: true },
      });
      if (!thread) return { error: "Conversation not found." };
      await prisma.$transaction(async (tx) => {
        const threadLockKey = `thread:${threadId}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${threadLockKey}, 0::bigint))`;
        const liveThread = await tx.chatThread.findFirst({
          where: { id: threadId, ownerId, deletedAt: null },
          select: { id: true },
        });
        if (!liveThread) throw new Error("THREAD_NOT_FOUND_DURING_DELETE");
        const activeResearch = await tx.researchJob.findFirst({
          where: { ownerId, threadId, status: { in: ["QUEUED", "RUNNING"] } },
          select: { id: true },
        });
        if (activeResearch) throw new Error("RESEARCH_RUNNING_DURING_DELETE");
        await tx.researchJob.deleteMany({ where: { ownerId, threadId } });
        await tx.canvasNode.updateMany({ where: { ownerId, threadId }, data: { threadId: null } });
        await tx.generation.updateMany({ where: { ownerId, threadId }, data: { threadId: null } });
        await tx.genJob.updateMany({ where: { ownerId, threadId }, data: { threadId: null } });
        await tx.chatMessage.deleteMany({ where: { ownerId, threadId } });
        await tx.chatThread.deleteMany({ where: { id: threadId, ownerId } });
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message === "THREAD_NOT_FOUND_DURING_DELETE") return { error: "Conversation not found." };
      if (e instanceof Error && e.message === "RESEARCH_RUNNING_DURING_DELETE") return { error: "Research is still running in this conversation. Delete it after research finishes." };
      console.error("[deleteCoworkThread] failed:", errSummary(e));
      return { error: "Couldn't delete the conversation — please try again." };
    }
  });
}

// ---------------------------------------------------------------------------
// setCoworkThreadPinned — pin/unpin a conversation in the sidebar
// ---------------------------------------------------------------------------

export async function setCoworkThreadPinned(threadId: string, pinned: boolean): Promise<{ ok: true; pinnedAt: string | null } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; pinnedAt: string | null } | { error: string }> => {

    try {
      const thread = await prisma.chatThread.findFirst({
        where: { id: threadId, ownerId, deletedAt: null },
        select: { id: true },
      });
      if (!thread) return { error: "Conversation not found." };
      const pinnedAt = pinned ? new Date() : null;
      const { count } = await prisma.chatThread.updateMany({
        where: { id: thread.id, ownerId },
        data: { pinnedAt },
      });
      if (!count) return { error: "Conversation not found." };
      return { ok: true, pinnedAt: pinnedAt ? pinnedAt.toISOString() : null };
    } catch (e) {
      console.error("[setCoworkThreadPinned] failed:", errSummary(e));
      return { error: "Couldn't update the conversation — please try again." };
    }
  });
}
