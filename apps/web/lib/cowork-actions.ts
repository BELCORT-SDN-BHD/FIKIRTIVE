"use server";
/**
 * Artlio cowork actions. v1 skills: draft a storyboard from an idea, and ✨
 * Enhance a prompt — each runs through the model-neutral cowork transport (mock
 * in dev, fal LLM in prod) and the per-skill runner. Drafting creates shots with
 * the SAME shot model a user's "Add shot" would, appended after any existing
 * scenes so it never clobbers work.
 */
import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@artlio/db";
import {
  coworkRequest, enhanceRequest, MAX_ENHANCE_TEXT, newId, FOUNDER_OWNER_ID,
  createTransport, runSkill, draftStoryboardSkill, enhancePromptSkill,
  modelFamily, deriveMode,
  coworkTurnRequest, COWORK_MEMORY_TURNS, buildPlannerMessages, parseCoworkTurn,
  mockPlannerReply, suggestModel, GEN_MODELS, GEN_VIDEO_MODELS,
  GEN_PRICE_USD_PER_IMAGE, videoPriceUsd,
  type ChatMessage, type CoworkTurn, type GenVideoModel,
} from "@artlio/core";
import { getEnhanceDirective } from "./cowork-knowledge";

const OWNED = { ownerId: FOUNDER_OWNER_ID, deletedAt: null } as const;
const transport = createTransport();

/** Owner-global entities the planner may reference (Entity has no projectId — it's
 *  owner-scoped like getEntities). Returns the @-ref allow-list passed to the planner. */
async function loadAvailableRefs(): Promise<{ id: string; name: string; type: string }[]> {
  return prisma.entity.findMany({
    where: { ...OWNED },
    select: { id: true, name: true, type: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
}

export async function coworkDraftStoryboard(
  raw: unknown,
): Promise<{ ok: true; scenes: number; shots: number; via: string } | { error: string }> {
  const parsed = coworkRequest.safeParse(raw);
  if (!parsed.success) return { error: "Tell cowork what to make (a short description)." };
  const { projectId, idea } = parsed.data;
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };

  let plan;
  try {
    plan = await runSkill(draftStoryboardSkill, idea, transport);
  } catch (e) {
    return { error: `Cowork couldn't draft that — ${e instanceof Error ? e.message.slice(0, 140) : "please try again"}.` };
  }
  if (!plan.scenes.length) return { error: "Cowork returned an empty plan — try a more specific idea." };

  // Append after existing scenes/numbers (never clobber the user's work), retried
  // on a unique collision (@@unique([projectId, number])): a concurrent "Add
  // shot"/cowork grabbing a number must NOT make this throw past the {error}
  // contract or roll back the whole draft (#5). Each attempt re-reads fresh.
  for (let attempt = 0; attempt < 4; attempt++) {
    const lastScene = await prisma.shot.findFirst({ where: { projectId, ...OWNED }, orderBy: { scene: "desc" }, select: { scene: true } });
    const lastNum = await prisma.shot.findFirst({ where: { projectId }, orderBy: { number: "desc" }, select: { number: true } });
    let scene = lastScene?.scene ?? 0;
    let number = lastNum?.number ?? 0;
    let shots = 0;
    const rows = [];
    for (const sc of plan.scenes) {
      scene += 1;
      for (const sh of sc.shots) {
        number += 1;
        shots += 1;
        rows.push({
          id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, number, scene,
          description: sh.prompt,
          promptDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: sh.prompt }] }] },
        });
      }
    }
    try {
      // shots + the audit event in ONE transaction: a failure can't leave shots
      // created while the action returns {error} (or vice versa)
      await prisma.$transaction([
        prisma.shot.createMany({ data: rows }),
        prisma.actionEvent.create({
          data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, type: "cowork.draft", payload: { scenes: plan.scenes.length, shots, via: transport.name } },
        }),
      ]);
      revalidatePath("/", "layout");
      return { ok: true, scenes: plan.scenes.length, shots, via: transport.name };
    } catch (e) {
      if (attempt < 3 && typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") continue;
      return { error: "Couldn't save the draft — please try again." };
    }
  }
  return { error: "Couldn't allocate shot numbers — please try again." };
}

/** "✨ Enhance" — rewrite the composer's rough prompt into a vivid one. Pure
 *  transform (no DB write); mock in dev ($0), fal LLM in prod. The UI re-chips
 *  any @-named entities the model kept intact. */
export async function enhancePrompt(
  raw: unknown,
): Promise<{ ok: true; text: string; via: string } | { error: string }> {
  const parsed = enhanceRequest.safeParse(raw);
  if (!parsed.success) return { error: "Write a prompt first, then ✨ Enhance." };
  const { projectId, text, model, kind, conditioned, hasSource, hasTail } = parsed.data;
  // owner-domain guard like every paid action (single-tenant today, multi-tenant-ready)
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };

  // Phase 1: server-derive (family, mode) from the gen-shape and read the tuned
  // directive. Best-effort — a knowledge-read hiccup degrades to the family-neutral
  // base prompt and NEVER blocks Enhance. Mode is server-derived (R3), never a
  // client mode string.
  const family = model ? modelFamily(model) : undefined;
  const mode = family ? deriveMode({ kind: kind ?? "image", conditioned, hasSourceImage: hasSource, hasTailImage: hasTail }) : undefined;
  let directive: string | undefined;
  try {
    if (family && mode) directive = await getEnhanceDirective(family, mode);
  } catch { /* knowledge read is best-effort — fall back to the base prompt */ }

  try {
    // clamp to the downstream generate cap so an over-long rewrite can't fail genRequest
    const out = (await runSkill(enhancePromptSkill, text, transport, { directive })).trim().slice(0, MAX_ENHANCE_TEXT);
    if (!out) return { error: "Enhance came back empty — try again." };
    try {
      // audit the paid LLM call (records usage for the future cost/credit ledger)
      await prisma.actionEvent.create({
        data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, type: "cowork.enhance", payload: { via: transport.name, chars: out.length, family: family ?? null, mode: mode ?? null, directiveApplied: !!directive } },
      });
    } catch { /* audit is best-effort — never lose a paid result on a log-write hiccup */ }
    return { ok: true, text: out, via: transport.name };
  } catch (e) {
    return { error: `Couldn't enhance that — ${e instanceof Error ? e.message.slice(0, 140) : "please try again"}.` };
  }
}

const PLANNER_MAX_TOKENS = 1200;

/** A PROPOSE-ONLY cowork turn: runs the planner (mock $0 in dev, ≤2 LLM calls) and
 *  persists user + agent messages. It NEVER spends — it neither imports nor calls any
 *  media-generation action and writes no media job. A GEN_CARD payload carries a
 *  DISPLAY-only estimatedPriceUsd; the only spend path is the user clicking Generate
 *  later (Plan-2), which re-derives and runs the unmodified generation action. */
export async function coworkTurn(raw: unknown): Promise<{ threadId: string } | { error: string }> {
  const parsed = coworkTurnRequest.safeParse(raw);
  if (!parsed.success) return { error: "Say what you'd like to make." };
  const { projectId, text, entityIds, variantSel } = parsed.data;

  // Mirror the sibling actions: any DB/transport hiccup returns the {error} contract
  // rather than throwing an unhandled rejection to the client. (Guard early-returns
  // below still surface their specific messages — a `return` inside try isn't caught.)
  try {
    const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
    if (!project) return { error: "Project not found." };

    // Resolve the thread. A NEW thread is NOT created here — its create is folded into
    // the persistence $transaction below, so a planner/DB failure can never leave an
    // empty orphan thread behind. An existing thread must be owned + live.
    const isNew = !parsed.data.threadId;
    const threadId = parsed.data.threadId ?? newId();
    if (!isNew) {
      const t = await prisma.chatThread.findFirst({ where: { id: threadId, ...OWNED }, select: { id: true } });
      if (!t) return { error: "Conversation not found." };
    }

    // bounded, NL-only memory window (assistant/user), oldest-dropped (empty for a new thread)
    const recent = isNew ? [] : await prisma.chatMessage.findMany({
      where: { threadId, deletedAt: null, kind: { in: ["TEXT", "PLAN"] } },
      orderBy: { seq: "desc" }, take: COWORK_MEMORY_TURNS * 2, select: { role: true, text: true },
    });
    const history: ChatMessage[] = recent.reverse().map((m) => ({ role: m.role === "AGENT" ? "assistant" : "user", content: m.text }));

    const availableRefs = await loadAvailableRefs(); // owner-global entities {id,name,type}
    const modelSummary = `image: ${GEN_MODELS.join("/")}; video: ${GEN_VIDEO_MODELS.join("/")} (agent picks by capability)`;
    const messages = buildPlannerMessages({ userText: text, history, availableRefs, modelSummary });

    // ≤2 LLM calls total (1 + at most 1 retry). mock-$0 in dev.
    const refIds = availableRefs.map((r) => r.id);
    let turn: CoworkTurn | null = null;
    for (let attempt = 0; attempt < 2 && !turn; attempt++) {
      try {
        const { text: out } = await transport.chat(
          "coworkPlanner",
          attempt === 0 ? messages : [...messages, { role: "user", content: "Your previous reply was not valid JSON for the schema. Reply with ONLY the JSON object." }],
          { mockReply: () => mockPlannerReply(text), responseFormat: "json_object", maxTokens: PLANNER_MAX_TOKENS },
        );
        turn = parseCoworkTurn(out, refIds);
      } catch (e) {
        // malformed JSON (expected) or a transport failure (prod) — retry once, then
        // fall through to a talk-only turn. Log for prod observability of a down planner.
        console.warn(`coworkTurn planner attempt ${attempt} failed:`, e instanceof Error ? e.message : e);
      }
    }
    if (!turn) turn = { planSteps: [], reply: "I couldn't structure that — could you rephrase?", proposal: null };

    // prefer the user's explicit @mentions when the proposal omitted them
    if (turn.proposal && entityIds.length && !turn.proposal.entityIds.length) {
      turn.proposal.entityIds = entityIds;
      turn.proposal.variantSel = variantSel;
    }

    // build the gen-card payload (planner proposes an image keyframe first for video-with-variant per COWORK_PLANNER_SYSTEM)
    let cardPayload: Prisma.InputJsonObject | null = null;
    if (turn.proposal) {
      const sm = suggestModel({
        kind: turn.proposal.kind,
        desiredAspect: turn.proposal.desiredAspect,
        desiredDuration: turn.proposal.desiredDuration,
        desiredAudio: turn.proposal.desiredAudio,
        hasSourceImage: false, // v1: no canvas source-frame yet (i2v source comes in a later slice)
        hasTail: false,
      });
      const price = turn.proposal.kind === "video"
        ? videoPriceUsd(sm.model as GenVideoModel, { seconds: sm.params.durationSeconds ?? 1, resolution: sm.params.resolution ?? "", audio: !!sm.params.audio, count: sm.params.count })
        : GEN_PRICE_USD_PER_IMAGE * sm.params.count;
      cardPayload = {
        kind: turn.proposal.kind, model: sm.model, params: sm.params, reason: sm.reason, downgraded: sm.downgraded,
        structuredPrompt: turn.proposal.structuredPrompt, entityIds: turn.proposal.entityIds, variantSel: turn.proposal.variantSel,
        estimatedPriceUsd: price, // DISPLAY-only; the card re-derives on Generate (Plan-2)
      };
    }

    // Persist messages (+ create/touch the thread) in ONE $transaction. seq is read
    // before the tx (TOCTOU); for single-founder v1 concurrent turns on one thread
    // don't happen, and (threadId, seq) is a plain index — a collision would only
    // affect display order, never spend. Revisit if cowork goes multi-tenant.
    const last = isNew ? null : await prisma.chatMessage.findFirst({ where: { threadId }, orderBy: { seq: "desc" }, select: { seq: true } });
    let seq = (last?.seq ?? 0);
    const rows = [
      { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "USER" as const, kind: "TEXT" as const, seq: ++seq, text, payload: { entityIds, variantSel } },
      { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT" as const, kind: "PLAN" as const, seq: ++seq, text: "", payload: { planSteps: turn.planSteps } },
      { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT" as const, kind: "TEXT" as const, seq: ++seq, text: turn.reply, payload: undefined },
      ...(cardPayload ? [{ id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT" as const, kind: "GEN_CARD" as const, seq: ++seq, text: "", payload: cardPayload }] : []),
    ];

    // For a new thread the create MUST precede the messages (FK ChatMessage.threadId →
    // ChatThread, checked per-statement). For an existing thread, just bump updatedAt.
    await prisma.$transaction([
      ...(isNew ? [prisma.chatThread.create({ data: { id: threadId, ownerId: FOUNDER_OWNER_ID, projectId, title: text.slice(0, 80) } })] : []),
      prisma.chatMessage.createMany({ data: rows }),
      ...(isNew ? [] : [prisma.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } })]),
    ]);
    try {
      await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, type: "cowork.turn", payload: { via: transport.name, hasCard: !!cardPayload, model: cardPayload?.model ?? null } } });
    } catch { /* audit best-effort */ }
    revalidatePath("/", "layout");
    return { threadId };
  } catch {
    return { error: "Couldn't reach cowork — please try again." };
  }
}
