"use server";
/**
 * Fikirtive cowork card actions: the coworkGenerate spend path (the ONLY
 * cowork→startGen paid entry), card variation, thread rename/delete, the
 * per-project brief, and QUEUED-job cancel+refund. The legacy pre-Otto planner
 * actions (coworkTurn / enhancePrompt / coworkDraftStoryboard) were deleted in
 * batch-3 7-10 (2026-07-07) — Otto owns propose now.
 */
import { revalidatePath } from "next/cache";
import { prisma, Prisma, refundReservation } from "@fikirtive/db";
import { z } from "zod";
import {
  newId,
  modelFamily, deriveMode,
  coworkGenerateRequest, coworkProposalSchema,
  coworkRenameThreadRequest, coworkDeleteThreadRequest, coworkVaryCardRequest, coworkBriefRequest, MAX_GEN_PROMPT,
  composePrompt, isModelDisabled,
  buildGenRequestFromCard,
  suggestModel, generationUnavailableMessage,
} from "@fikirtive/core";
import { getEnhanceDirective } from "./cowork-knowledge";
import { resolveDisabledModels } from "./model-registry";
import { startCoworkGen } from "./gen-actions";
import { runAsUser } from "@fikirtive/db/principal";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { familyHasPromptSkill } from "@fikirtive/otto";

export async function coworkGenerate(raw: unknown): Promise<{ id: string } | { error: string }> {
  const parsed = coworkGenerateRequest.safeParse(raw);
  if (!parsed.success) return { error: "That card can't be generated." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ id: string } | { error: string }> => {
    const { ownerId } = gate;
    const { cardId, prompt, entityIds, variantSel, model: modelOverride, count: countOverride, aspectRatio: aspectOverride, resolution: resolutionOverride, durationSeconds: durationOverride, audio: audioOverride } = parsed.data;

    // Load the GEN_CARD server-side — threadId + projectId + the trusted model/params
    // come from the PERSISTED card, never from the client (anti-spoof).
    const card = await prisma.chatMessage.findFirst({
      where: { id: cardId, ownerId, kind: "GEN_CARD", deletedAt: null },
      select: { id: true, threadId: true, payload: true, genJobId: true, thread: { select: { projectId: true, deletedAt: true, ownerId: true } } },
    });
    if (!card || card.thread.deletedAt || card.thread.ownerId !== ownerId) return { error: "Card not found." };

    // RE-SPEND GUARD (server-side, money-safety #1): a card generates AT MOST ONCE. Key the
    // guard on the DURABLE record — a GenJob carrying this card's stable idempotencyKey,
    // written ATOMICALLY by startGen's genJob.create — NOT the best-effort card.genJobId
    // mark below (whose write can fail; startGen's own idempotency only dedupes while the
    // job is QUEUED/GENERATING, so once the first job is DONE/FAILED an unmarked card could
    // otherwise be re-charged by a stale tab / reload / direct RPC). If any job for this
    // card already exists (any status), return it instead of charging again. To retry, the
    // user starts a new turn (a new card) — never a silent re-charge of the same card.
    // This read is the friendly fast-path; it is NOT atomic with startGen's insert, so the
    // race-proof backstop is the DB index GenJob_cowork_idempotency_once (all-status UNIQUE on
    // cowork:<cardId> keys) — a TOCTOU re-insert is rejected there even after the first is DONE.
    const existingJob = await prisma.genJob.findFirst({
      where: { ownerId, idempotencyKey: `cowork:${cardId}` },
      select: { id: true },
    });
    if (existingJob) return { id: existingJob.id };

    // re-validate the persisted proposal subset; the model/kind/params are server-trusted
    const p = (card.payload ?? {}) as Record<string, unknown>;
    const proposal = coworkProposalSchema.safeParse({ kind: p.kind, desiredAspect: p.desiredAspect, desiredDuration: p.desiredDuration, desiredAudio: p.desiredAudio, structuredPrompt: p.structuredPrompt, entityIds: p.entityIds ?? [], variantSel: p.variantSel ?? {} });
    if (!proposal.success) return { error: "This card is no longer valid." };
    const model = typeof p.model === "string" ? p.model : null;
    if (!model) return { error: "This card is missing a model." };
    // i2v source frame: server-trusted (it was owner+project validated when the card was
    // persisted). startGen.checkCast re-validates it at spend (the backstop).
    const sourceGenerationId = typeof p.sourceGenerationId === "string" ? p.sourceGenerationId : null;

    // Build the genRequest SERVER-SIDE. kind + sourceGenerationId stay card-trusted; the
    // user MAY override model/count/video-params via the editable card (model picker + param
    // pills) — each override falls back to the card's value when absent. Overrides only WIDEN
    // what reaches startGen; startGen.safeParse + superRefine + checkCast remain the SOLE,
    // complete spend gate (model∈the card-kind's menu, every param∈the chosen model's option
    // set, count≤maxCount → an invalid/mispriced combo is rejected with {error}, no spend).
    // prompt/entityIds/variantSel still from the client; effectiveVariantSel drops it for video.
    const chosenModel = modelOverride ?? model;

    // OPT-6 P2: re-check the chosen model isn't admin-disabled at SPEND (a card built
    // before a disable, a model override, or a disabled seedream image must not spend).
    // The worker (handleGen) is the all-status backstop for an already-queued job.
    // #647 T6 修复轮 P1-3:读不到开关状态就不许花钱 —— 空集合等于替 Founder 把开关打开。
    const registry = await resolveDisabledModels();
    if ("error" in registry) return registry;
    if (isModelDisabled(chosenModel, registry.disabled)) {
      return { error: "That model is currently turned off — pick another, or ask an admin to re-enable it." };
    }

    // Deterministic $0 composer (OPT-6 P2, spec §4a) — append the resolved family×mode
    // directive to the CLIENT prompt at the spend side. conditioned = entityIds.length>0 is
    // an advisory APPROXIMATION (a bare 0-ref LOCATION mention runs t2i at the worker but keys
    // i2i here) — acceptable because the composer is advisory TEXT, never a spend decision.
    //
    // D/E prompt-mastery decision 6: a family that owns a dedicated prompt skill
    // (seedreamPrompt/seedancePrompt) is the SOLE prompt authority — do NOT stack the legacy
    // directive on top of its already-assembled prompt (the two contradicted: the assembler
    // emits comma-joined fragments while the seedream directive says "avoid comma-soup"). So we
    // skip the directive for skilled families; it stays a fallback ONLY for un-skilled models.
    // This also aligns the two spend surfaces — the Otto-chat `generate` skill already uses the
    // card prompt directly — so button + chat yield the identical model-bound prompt for the
    // families they both generate. Money-safety: changes ONLY the prompt string, never the
    // model/count/params/idempotency that determine the charge. composePrompt no-ops on undefined.
    const family = modelFamily(chosenModel);
    const mode = deriveMode({
      kind: proposal.data.kind,
      conditioned: entityIds.length > 0,
      hasSourceImage: !!sourceGenerationId,
    });
    const directive =
      family && !familyHasPromptSkill(family) ? await getEnhanceDirective(family, mode) : undefined;
    const composedPrompt = composePrompt({ prompt, directive, maxLen: MAX_GEN_PROMPT });

    // Build the request via the pure core builder (same logic, extracted for reuse by the Otto
    // generate tool). The builder re-derives proposal/model/params/sourceGenerationId from
    // card.payload — the early-return guards above (lines ~502-509) mean this will always
    // return ok:true here, but we handle ok:false for defense-in-depth.
    const built = buildGenRequestFromCard({
      cardPayload: card.payload,
      projectId: card.thread.projectId,
      threadId: card.threadId,
      cardId,
      prompt: composedPrompt,
      entityIds,
      variantSel,
      overrides: {
        model: modelOverride,
        count: countOverride,
        durationSeconds: durationOverride,
        resolution: resolutionOverride,
        aspectRatio: aspectOverride,
        audio: audioOverride,
      },
    });
    if (!built.ok) return { error: built.error };
    const req = built.req;

    const res = await startCoworkGen(req); // binds the persisted card quote before the shared startGen spend authority
    if ("error" in res) return res;

    // Persist the card→job link for the UI (reload shows the card as "Generated", disables
    // its button). This is NOT the spend guard anymore — the guard above keys on the durable
    // GenJob.idempotencyKey — so a failed mark here cannot reopen a re-spend window; worst
    // case the button isn't pre-disabled on reload, and a re-click is caught by that guard.
    // Best-effort (the spend already happened safely via startGen); log a failure.
    try {
      await prisma.chatMessage.update({ where: { id: cardId }, data: { genJobId: res.id } });
    } catch (e) {
      console.warn(`coworkGenerate: failed to mark card ${cardId} with genJobId ${res.id} (UI reload-disable only):`, e instanceof Error ? e.message : e);
    }
    return res;
  });
}

export async function coworkRenameThread(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const parsed = coworkRenameThreadRequest.safeParse(raw);
  if (!parsed.success) return { error: "Give the conversation a title (1-120 chars)." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true } | { error: string }> => {
    const { ownerId } = gate;
    const { threadId, title } = parsed.data;
    try {
      const { count } = await prisma.chatThread.updateMany({
        where: { id: threadId, ownerId, deletedAt: null },
        data: { title },
      });
      if (!count) return { error: "Conversation not found." };
    } catch { return { error: "Couldn't rename — please try again." }; } // {error} contract, like the sibling actions
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function coworkDeleteThread(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const parsed = coworkDeleteThreadRequest.safeParse(raw);
  if (!parsed.success) return { error: "Invalid request." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true } | { error: string }> => {
    const { ownerId } = gate;
    const { threadId } = parsed.data;
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
    } catch (e) {
      if (e instanceof Error && e.message === "THREAD_NOT_FOUND_DURING_DELETE") return { error: "Conversation not found." };
      if (e instanceof Error && e.message === "RESEARCH_RUNNING_DURING_DELETE") return { error: "Research is still running in this conversation. Delete it after research finishes." };
      return { error: "Couldn't delete — please try again." };
    } // {error} contract, like the sibling actions
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** Create a variation of an existing GEN_CARD — clones its payload verbatim into a new
 *  UN-generated card on the SAME thread. Zero spend: no startGen, no GenJob, no queue.
 *  The new card gets a fresh newId() so its cowork:<newCardId> idempotencyKey is
 *  independent of the original; clicking Generate on it goes through the normal single-spend
 *  guard keyed on the new card id — no cross-contamination with the original. */
export async function coworkVaryCard(raw: unknown): Promise<{ threadId: string } | { error: string }> {
  const parsed = coworkVaryCardRequest.safeParse(raw);
  if (!parsed.success) return { error: "That card can't be varied." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ threadId: string } | { error: string }> => {
    const { ownerId } = gate;
    const { cardId } = parsed.data;
    try {
      const card = await prisma.chatMessage.findFirst({
        where: { id: cardId, ownerId, kind: "GEN_CARD", deletedAt: null },
        select: { id: true, threadId: true, payload: true, thread: { select: { projectId: true, deletedAt: true, ownerId: true } } },
      });
      if (!card || card.thread.deletedAt || card.thread.ownerId !== ownerId) return { error: "Card not found." };

      // Validate the persisted payload is still a real, complete card (mirrors coworkGenerate).
      const p = (card.payload ?? {}) as Record<string, unknown>;
      const proposal = coworkProposalSchema.safeParse({ kind: p.kind, desiredAspect: p.desiredAspect, desiredDuration: p.desiredDuration, desiredAudio: p.desiredAudio, structuredPrompt: p.structuredPrompt, entityIds: p.entityIds ?? [], variantSel: p.variantSel ?? {} });
      if (!proposal.success) return { error: "This card is no longer valid." };
      if (typeof p.model !== "string") return { error: "This card is missing a model." };

      // #647 T6 修复轮 P1-1 —— 这条入口以前**整道闸都没走**。
      //
      // 「Make another」(OttoResult)与「Try again」(OttoPlanCard)都落到这里,而这里只校验
      // 旧卡的**结构**就把 payload 原样克隆成一张新 GEN_CARD。于是引擎全禁用时,商家照样拿到
      // 一张写着 credits、点下去必被花钱闸打回的卡 —— 票面③要消灭的那个病,在这条入口原样
      // 复发。钱确实花不出去,但一张确认不了的卡本身就是一个骗人的承诺。
      //
      // 判据与另外三个铸卡入口**同一条**(`suggestModel({ kind, disabled })`),措辞同一份
      // (`generationUnavailableMessage`)—— 四条路对同一件事只许说一句话。
      const registry = await resolveDisabledModels();
      if ("error" in registry) return registry; // 读不到开关状态就不许铸卡(P1-3 同一条规矩)
      if (!suggestModel({ kind: proposal.data.kind, disabled: registry.disabled })) {
        return { error: generationUnavailableMessage(proposal.data.kind) };
      }

      // Clone the payload verbatim — same model/params/prompt/refs/source. No seed is pinned,
      // so re-generating yields a genuinely different output server-side.
      const clonedPayload = card.payload as Prisma.InputJsonObject;

      const last = await prisma.chatMessage.findFirst({ where: { threadId: card.threadId, ownerId }, orderBy: { seq: "desc" }, select: { seq: true } });
      let seq = (last?.seq ?? 0);
      const rows = [
        { id: newId(), threadId: card.threadId, ownerId, role: "AGENT" as const, kind: "TEXT" as const, seq: ++seq, text: "Another take — same settings. Generate when you're ready.", payload: undefined },
        { id: newId(), threadId: card.threadId, ownerId, role: "AGENT" as const, kind: "GEN_CARD" as const, seq: ++seq, text: "", payload: clonedPayload },
      ];
      await prisma.$transaction([
        prisma.chatMessage.createMany({ data: rows }),
        prisma.chatThread.update({ where: { id: card.threadId }, data: { updatedAt: new Date() } }),
      ]);
      try {
        await prisma.actionEvent.create({ data: { id: newId(), ownerId, projectId: card.thread.projectId, type: "cowork.vary", payload: { fromCardId: cardId } } });
      } catch { /* audit best-effort */ }
      revalidatePath("/", "layout");
      return { threadId: card.threadId };
    } catch {
      return { error: "Couldn't create variations — please try again." };
    }
  });
}

/** Save (or clear) the per-project creative brief the planner sees every turn.
 *  Propose-side only — this text is injected into the planner system prompt; it
 *  does NOT touch coworkGenerate/startGen and creates no media spend. */
export async function setCoworkBrief(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const parsed = coworkBriefRequest.safeParse(raw);
  if (!parsed.success) return { error: "Invalid brief." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true } | { error: string }> => {
    const { ownerId } = gate;
    const { projectId, brief } = parsed.data;
    try {
      const { count } = await prisma.project.updateMany({
        where: { id: projectId, ownerId, deletedAt: null },
        data: { coworkBrief: brief.trim() || null },
      });
      if (!count) return { error: "Project not found." };
    } catch { return { error: "Couldn't save the brief — please try again." }; }
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

const cancelGenJobRequest = z.object({ jobId: z.string().min(1) });

/**
 * Cancel a QUEUED generation job and refund its credit reservation.
 *
 * MONEY: the ONLY money operation is refundReservation inside the transaction.
 * No reserve/settle/charge anywhere here.
 *
 * Safety contract (mirrors the reaper pattern in gen.ts):
 * - The updateMany WHERE clause is { id: jobId, ownerId, status: "QUEUED" }.
 *   A job that is already GENERATING, DONE, FAILED or CANCELLED will not match —
 *   count===0 → no refund, honest UI feedback.
 * - refundReservation is called ONLY when count>0 (i.e. our update won the race).
 * - The whole operation is one $transaction so the terminal status and the refund
 *   are written or rolled back atomically.
 * - Owner-scoped: ownerId in the WHERE so a user can only cancel their own jobs.
 *
 * CANCEL IS ITS OWN ENDING (#602 T3 · spec #599 D4). This wrote FAILED with the word "Cancelled"
 * tucked into the error text, and every reader downstream believed the status rather than the
 * text: the card went red, offered "Try again", and the batch guard treated the dead job as if it
 * were still going to deliver. The word is now CANCELLED and the readers were taught it.
 *
 * MONEY IS UNCHANGED BY THAT FLIP, deliberately and verifiably: the same single refundReservation
 * call, in the same transaction, at the same point, on the same idempotency key (`refund:<jobId>`
 * — derived from the job id, never from its status). Only the word changes.
 */
export async function cancelGenJob(raw: unknown): Promise<{ refunded: true } | { alreadyStarted: true } | { error: string }> {
  const parsed = cancelGenJobRequest.safeParse(raw);
  if (!parsed.success) return { error: "Invalid request." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ refunded: true } | { alreadyStarted: true } | { error: string }> => {
    const { ownerId } = gate;
    const { jobId } = parsed.data;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.genJob.updateMany({
          where: { id: jobId, ownerId, status: "QUEUED" },
          data: { status: "CANCELLED", error: "Cancelled by you", finishedAt: new Date() },
        });
        if (count > 0) {
          await refundReservation(tx, { orgId: ownerId, refId: jobId });
          const job = await tx.genJob.findFirst({
            where: { id: jobId, ownerId },
            select: { threadId: true },
          });
          if (job?.threadId) {
            const last = await tx.chatMessage.aggregate({
              where: { threadId: job.threadId, ownerId },
              _max: { seq: true },
            });
            await tx.chatMessage.create({
              data: {
                id: newId(),
                threadId: job.threadId,
                ownerId,
                role: "AGENT",
                kind: "TURN_ERROR",
                seq: (last._max.seq ?? 0) + 1,
                text: "Cancelled — you weren't charged.",
                // THE DURABLE MARK (#602 T3). The thread's terminal message for a job is a
                // TURN_ERROR whatever ended it — that kind carries the per-job unique index, so a
                // cancel cannot have a kind of its own without a second terminal message being
                // possible. The plan card therefore read every cancel as a failure after a reload:
                // red copy, and a "Try again" button for something the merchant chose to stop.
                // This flag is what tells the card the difference; `cancelledTurnPayload` is the one
                // reader of it.
                payload: { cancelled: true },
                genJobId: jobId,
              },
            });
            await tx.chatThread.update({
              where: { id: job.threadId },
              data: { updatedAt: new Date() },
            });
          }
        }
        return count;
      });
      if (result === 0) return { alreadyStarted: true };
      revalidatePath("/", "layout");
      return { refunded: true };
    } catch {
      return { error: "Couldn't cancel — please try again." };
    }
  });
}
