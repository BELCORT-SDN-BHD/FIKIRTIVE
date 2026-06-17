"use server";
/**
 * Artlio cowork actions. v1 skills: draft a storyboard from an idea, and ✨
 * Enhance a prompt — each runs through the model-neutral cowork transport (mock
 * in dev, fal LLM in prod) and the per-skill runner. Drafting creates shots with
 * the SAME shot model a user's "Add shot" would, appended after any existing
 * scenes so it never clobbers work.
 */
import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@artlio/db";
import {
  coworkRequest, enhanceRequest, MAX_ENHANCE_TEXT, newId, FOUNDER_OWNER_ID,
  runSkill, draftStoryboardSkill, enhancePromptSkill,
  modelFamily, deriveMode,
  coworkTurnRequest, COWORK_MEMORY_TURNS, buildPlannerMessages, parseCoworkTurn,
  mockPlannerReply, suggestModel, GEN_MODELS, GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_OPTIONS,
  GEN_PRICE_USD_PER_IMAGE, videoPriceUsd,
  coworkGenerateRequest, coworkProposalSchema,
  coworkRenameThreadRequest, coworkDeleteThreadRequest, coworkVaryCardRequest, coworkBriefRequest, MAX_GEN_PROMPT,
  storageKey,
  type ChatMessage, type CoworkTurn, type GenVideoModel,
} from "@artlio/core";
import { getTransport, resolveVisionConfig } from "./runtime-config";
import { getEnhanceDirective } from "./cowork-knowledge";
import { startGen } from "./gen-actions";
import { storage, mimeOf } from "./storage";
import { requireSession } from "./auth-guard";

const OWNED = { ownerId: FOUNDER_OWNER_ID, deletedAt: null } as const;

/** Phase C vision: resolve one asset to a base64 data-URL for the planner.
 *  Returns null (and never throws) when the asset is missing, foreign, deleted,
 *  or exceeds the configured size limit — the caller skips gracefully.
 *  Used by CT-C2 (coworkTurn image attachment). */
async function refImageDataUrl(assetId: string): Promise<string | null> {
  const { maxBytes } = await resolveVisionConfig();
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: FOUNDER_OWNER_ID, deletedAt: null },
    select: { ownerId: true, contentHash: true, ext: true, sizeBytes: true },
  });
  if (!asset) return null; // missing / foreign / deleted → skip
  if (asset.sizeBytes != null && Number(asset.sizeBytes) > maxBytes) return null; // too big
  try {
    const bytes = await storage.get(storageKey(asset.ownerId, asset.contentHash, asset.ext));
    if (bytes.length > maxBytes) return null;
    return `data:${mimeOf(asset.ext)};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch { return null; } // read error → skip; NEVER throw the turn
}

/** Owner-global entities the planner may reference (Entity has no projectId — it's
 *  owner-scoped like getEntities). Returns the @-ref allow-list passed to the planner,
 *  plus each entity's LIVE variant ids so the action can constrain variantSel VALUES
 *  (not just keys) to real variants before persisting a card. Also returns the cached
 *  see-once visual description (Entity.descriptionJson.text) so buildPlannerMessages
 *  can embed it in the refs block on turns where no image is sent. */
async function loadAvailableRefs(): Promise<{ id: string; name: string; type: string; variantIds: string[]; description?: string }[]> {
  const entities = await prisma.entity.findMany({
    where: { ...OWNED },
    select: { id: true, name: true, type: true, descriptionJson: true, variants: { where: { deletedAt: null }, select: { id: true } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  return entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    variantIds: e.variants.map((v) => v.id),
    description: (e.descriptionJson as { text?: string } | null)?.text || undefined,
  }));
}

export async function coworkDraftStoryboard(
  raw: unknown,
): Promise<{ ok: true; scenes: number; shots: number; via: string } | { error: string }> {
  const parsed = coworkRequest.safeParse(raw);
  if (!parsed.success) return { error: "Tell cowork what to make (a short description)." };
  const gate = await requireSession(); if ("error" in gate) return gate;
  const { projectId, idea } = parsed.data;
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  const transport = await getTransport();

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
  const gate = await requireSession(); if ("error" in gate) return gate;
  const { projectId, text, model, kind, conditioned, hasSource, hasTail } = parsed.data;
  // owner-domain guard like every paid action (single-tenant today, multi-tenant-ready)
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  const transport = await getTransport();

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

/** Map a ChatMessageKind to a human-readable word for the planner quote note. */
function quotedKindLabel(kind: string): string {
  if (kind === "GEN_CARD") return "generate card";
  if (kind === "GEN_RESULT") return "result";
  return "message"; // TEXT, PLAN, DENIAL, TURN_ERROR
}

/** Build a short (≤200 char) preview of a quoted message. Never dumps full payload JSON. */
function quotedPreview(qm: { kind: string; text: string; payload: unknown }): string {
  let s: string;
  if (qm.kind === "GEN_CARD") {
    const p = qm.payload as { kind?: string } | null;
    s = p?.kind ? `${p.kind} proposal` : "proposal";
  } else if (qm.kind === "GEN_RESULT") {
    const p = qm.payload as { model?: string; urls?: string[] } | null;
    s = p?.model ? `${p.model} ×${p.urls?.length ?? 1}` : "result";
  } else {
    s = qm.text || "(no text)"; // TEXT, PLAN, DENIAL, TURN_ERROR
  }
  return s.slice(0, 200); // universal cap — payload-derived previews must never bloat the planner turn
}

/** A PROPOSE-ONLY cowork turn: runs the planner (mock $0 in dev, ≤2 LLM calls) and
 *  persists user + agent messages. It NEVER spends — it neither imports nor calls any
 *  media-generation action and writes no media job. A GEN_CARD payload carries a
 *  DISPLAY-only estimatedPriceUsd; the only spend path is the user clicking Generate
 *  later (Plan-2), which re-derives and runs the unmodified generation action. */
export async function coworkTurn(raw: unknown): Promise<{ threadId: string; brief?: string } | { error: string }> {
  const parsed = coworkTurnRequest.safeParse(raw);
  if (!parsed.success) return { error: "Say what you'd like to make." };
  const gate = await requireSession(); if ("error" in gate) return gate;
  const { projectId, text, entityIds, variantSel, sourceGenerationId, replyToMessageId } = parsed.data;
  const transport = await getTransport();

  // Mirror the sibling actions: any DB/transport hiccup returns the {error} contract
  // rather than throwing an unhandled rejection to the client. (Guard early-returns
  // below still surface their specific messages — a `return` inside try isn't caught.)
  try {
    const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
    if (!project) return { error: "Project not found." };

    // "Animate this result" — the source frame is a server-TRUSTED reference. Validate
    // it server-side (owned + in THIS project + live) before letting it force a video
    // proposal; an invalid/foreign/deleted id is silently ignored (treated as no source)
    // so a stale tab can never error the turn. This is a propose-only gate — startGen's
    // checkCast re-validates the same frame at spend time (the money backstop).
    let validSource: string | null = null;
    if (sourceGenerationId) {
      // owner + project + live AND an IMAGE asset (i2v animates an image frame) — mirrors
      // the worker's image-ext fail-close so a non-image source is rejected at turn time,
      // not just at spend. checkCast + the worker remain the money backstops.
      const g = await prisma.generation.findFirst({
        where: { id: sourceGenerationId, ...OWNED, projectId, asset: { ext: { in: ["png", "jpg", "jpeg", "webp"] } } },
        select: { id: true },
      });
      if (g) validSource = g.id;
    }

    // Resolve the thread. A NEW thread is NOT created here — its create is folded into
    // the persistence $transaction below, so a planner/DB failure can never leave an
    // empty orphan thread behind. An existing thread must be owned + live AND belong to
    // the claimed project — so a thread from project A can't be paired with project B's
    // source/refs (the source is validated against `projectId`; this keeps them consistent).
    const isNew = !parsed.data.threadId;
    const threadId = parsed.data.threadId ?? newId();
    if (!isNew) {
      const t = await prisma.chatThread.findFirst({ where: { id: threadId, ...OWNED }, select: { projectId: true } });
      if (!t || t.projectId !== projectId) return { error: "Conversation not found." };
    }

    // "Reply to message" — fetch the quoted message (existing thread only). An
    // invalid/foreign/deleted/cross-thread id is silently ignored so a stale tab never
    // errors the turn. New-thread replies are always ignored (the thread doesn't exist yet).
    let quoted: { kind: string; preview: string } | null = null;
    let validReplyId: string | null = null; // persisted ONLY when the scoped fetch succeeds (no dangling/foreign refs)
    if (!isNew && replyToMessageId) {
      const qm = await prisma.chatMessage.findFirst({
        where: { id: replyToMessageId, threadId, ownerId: FOUNDER_OWNER_ID, deletedAt: null },
        select: { kind: true, text: true, payload: true },
      });
      if (qm) {
        quoted = { kind: quotedKindLabel(qm.kind), preview: quotedPreview({ kind: qm.kind, text: qm.text, payload: qm.payload }) };
        validReplyId = replyToMessageId;
      }
    }

    // bounded, NL-only memory window (assistant/user), oldest-dropped (empty for a new thread)
    const recent = isNew ? [] : await prisma.chatMessage.findMany({
      where: { threadId, deletedAt: null, kind: { in: ["TEXT", "PLAN"] } },
      orderBy: { seq: "desc" }, take: COWORK_MEMORY_TURNS * 2, select: { role: true, text: true },
    });
    const history: ChatMessage[] = recent.reverse().map((m) => ({ role: m.role === "AGENT" ? "assistant" : "user", content: m.text }));

    const availableRefs = await loadAvailableRefs(); // owner-global entities {id,name,type}
    const modelSummary = `image: ${GEN_MODELS.join("/")}; video: ${GEN_VIDEO_MODELS.join("/")} (agent picks by capability)`;
    const refIds = availableRefs.map((r) => r.id);

    // Phase C (policy C): when vision is on, let the planner SEE the actual pixels of the
    // refs in play this turn — the @-mentioned entities (their locked base image) and the
    // i2v source frame — so it writes an image-grounded prompt. Bounded + best-effort.
    let images: { label: string; dataUrl: string }[] | undefined;
    // refs whose pixels are ACTUALLY attached this turn → their id. The see-once description
    // cache (turn.refDescriptions) persists ONLY for entities the planner truly saw, keyed
    // unambiguously by id (entity names aren't unique → ambiguous names are skipped).
    const attachedRefIdByName = new Map<string, string>();
    const ambiguousRefNames = new Set<string>();
    const vision = await resolveVisionConfig();
    if (vision.enabled) {
      // FULLY best-effort: any failure (a DB hiccup in these lookups, a storage read, etc.)
      // must only DROP this turn's images, NEVER fail the turn — the planner still runs
      // text-only. So the whole gather is wrapped (refImageDataUrl alone wasn't enough —
      // the generation/entity queries here could throw into coworkTurn's outer catch).
      try {
        const collected: { label: string; dataUrl: string }[] = [];
        // i2v source frame first (most load-bearing when animating)
        if (validSource) {
          const g = await prisma.generation.findFirst({ where: { id: validSource, ...OWNED }, select: { assetId: true } });
          if (g?.assetId) { const url = await refImageDataUrl(g.assetId); if (url) collected.push({ label: "source frame (to animate)", dataUrl: url }); }
        }
        // @-mentioned entities (allow-listed) → their locked base image
        const inPlay = entityIds.filter((id) => refIds.includes(id)).slice(0, vision.maxImages);
        if (inPlay.length) {
          const ents = await prisma.entity.findMany({ where: { id: { in: inPlay }, ...OWNED }, select: { id: true, name: true, type: true, baseAssetId: true } });
          for (const e of ents) {
            if (collected.length >= vision.maxImages) break;
            if (!e.baseAssetId) continue;
            const url = await refImageDataUrl(e.baseAssetId);
            if (url) {
              collected.push({ label: `@${e.name} (${e.type.toLowerCase()})`, dataUrl: url });
              if (attachedRefIdByName.has(e.name)) ambiguousRefNames.add(e.name); // dup name → can't map back safely
              else attachedRefIdByName.set(e.name, e.id);
            }
          }
        }
        if (collected.length) images = collected.slice(0, vision.maxImages);
      } catch (e) {
        console.warn("coworkTurn: vision image-gather failed, proceeding text-only:", e instanceof Error ? e.message : e);
        images = undefined;
      }
    }

    const messages = buildPlannerMessages({ userText: text, history, availableRefs, modelSummary, quoted: quoted ?? undefined, brief: project.coworkBrief ?? undefined, images });

    // ≤2 LLM calls total (1 + at most 1 retry). mock-$0 in dev.
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

    // prefer the user's explicit @mentions when the proposal omitted them — but run
    // the entity ids through the SAME availableRefs allow-list parseCoworkTurn applies
    // to the planner's refs (coworkTurnRequest only validates shape/length, not
    // membership), keeping variantSel keys to surviving entities.
    if (turn.proposal && entityIds.length && !turn.proposal.entityIds.length) {
      const allowed = new Set(refIds);
      const ids = entityIds.filter((id) => allowed.has(id));
      const vsel: Record<string, string> = {};
      for (const [k, v] of Object.entries(variantSel)) if (ids.includes(k)) vsel[k] = v;
      turn.proposal.entityIds = ids;
      turn.proposal.variantSel = vsel;
    }

    // Final membership gate for variant VALUES (both planner + fallback paths): a
    // variantSel value must be a LIVE variant OF its entity. parseCoworkTurn/the
    // fallback only allow-list entity ids + variantSel KEYS, never the variant id
    // itself — so a real entity paired with a ghost/deleted variant ({e1:"ghost"})
    // could otherwise reach the persisted card. The card is display-only and the
    // Guardian re-checks ref-liveness at Generate (Plan-2), but we keep the persisted
    // proposal trustworthy by dropping unknown variant ids here.
    if (turn.proposal && Object.keys(turn.proposal.variantSel).length) {
      const liveVariants = new Map(availableRefs.map((r) => [r.id, new Set(r.variantIds)]));
      const vsel: Record<string, string> = {};
      for (const [eid, vid] of Object.entries(turn.proposal.variantSel)) {
        if (liveVariants.get(eid)?.has(vid)) vsel[eid] = vid;
      }
      turn.proposal.variantSel = vsel;
    }

    // "Animate this result": a valid source frame makes this turn inherently a VIDEO (i2v).
    // FORCE a video proposal — if the planner returned an image proposal or null, coerce to
    // a video proposal whose motion prompt is the user's text. Identity comes from the frame,
    // so we drop refs/variantSel (§134 — the chosen variant is already baked into the
    // keyframe). suggestModel then sees hasSourceImage:true (keeps empty-aspect i2v models).
    if (validSource) {
      if (turn.proposal) {
        turn.proposal.kind = "video";
        turn.proposal.entityIds = [];
        turn.proposal.variantSel = {};
      } else {
        turn.proposal = { kind: "video", structuredPrompt: text.slice(0, MAX_GEN_PROMPT), entityIds: [], variantSel: {} };
      }
    }

    // build the gen-card payload (planner proposes an image keyframe first for video-with-variant per COWORK_PLANNER_SYSTEM)
    let cardPayload: Prisma.InputJsonObject | null = null;
    if (turn.proposal) {
      const sm = suggestModel({
        kind: turn.proposal.kind,
        desiredAspect: turn.proposal.desiredAspect,
        desiredDuration: turn.proposal.desiredDuration,
        desiredAudio: turn.proposal.desiredAudio,
        hasSourceImage: !!validSource, // i2v "animate" turn carries an owned source frame
        hasTail: false,
      });
      const price = turn.proposal.kind === "video"
        ? videoPriceUsd(sm.model as GenVideoModel, { seconds: sm.params.durationSeconds ?? 1, resolution: sm.params.resolution ?? "", audio: !!sm.params.audio, count: sm.params.count })
        : GEN_PRICE_USD_PER_IMAGE * sm.params.count;
      cardPayload = {
        kind: turn.proposal.kind, model: sm.model, params: sm.params, reason: sm.reason, downgraded: sm.downgraded,
        structuredPrompt: turn.proposal.structuredPrompt, entityIds: turn.proposal.entityIds, variantSel: turn.proposal.variantSel,
        estimatedPriceUsd: price, // DISPLAY-only; the card re-derives on Generate (Plan-2)
        ...(validSource ? { sourceGenerationId: validSource } : {}), // i2v source frame (server-trusted; re-validated at Generate)
      };
    }

    // Persist messages (+ create/touch the thread) in ONE $transaction. seq is read
    // before the tx (TOCTOU); for single-founder v1 concurrent turns on one thread
    // don't happen, and (threadId, seq) is a plain index — a collision would only
    // affect display order, never spend. Revisit if cowork goes multi-tenant.
    const last = isNew ? null : await prisma.chatMessage.findFirst({ where: { threadId }, orderBy: { seq: "desc" }, select: { seq: true } });
    let seq = (last?.seq ?? 0);
    const rows = [
      { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "USER" as const, kind: "TEXT" as const, seq: ++seq, text, payload: { entityIds, variantSel }, replyToMessageId: validReplyId },
      { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT" as const, kind: "PLAN" as const, seq: ++seq, text: "", payload: { planSteps: turn.planSteps } },
      { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT" as const, kind: "TEXT" as const, seq: ++seq, text: turn.reply, payload: undefined },
      ...(cardPayload ? [{ id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT" as const, kind: "GEN_CARD" as const, seq: ++seq, text: "", payload: cardPayload }] : []),
    ];

    // For a new thread the create MUST precede the messages (FK ChatMessage.threadId →
    // ChatThread, checked per-statement). For an existing thread, just bump updatedAt.
    await prisma.$transaction([
      ...(isNew ? [prisma.chatThread.create({ data: { id: threadId, ownerId: FOUNDER_OWNER_ID, projectId, title: turn.title ?? text.slice(0, 80) } })] : []),
      prisma.chatMessage.createMany({ data: rows }),
      ...(isNew ? [] : [prisma.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } })]),
    ]);
    try {
      await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, type: "cowork.turn", payload: { via: transport.name, hasCard: !!cardPayload, model: cardPayload?.model ?? null } } });
    } catch { /* audit best-effort */ }
    if (turn.briefUpdate) {
      try {
        await prisma.project.updateMany({ where: { id: projectId, ...OWNED }, data: { coworkBrief: turn.briefUpdate } });
      } catch { /* best-effort: a brief-write hiccup must never fail the turn */ }
    }
    // See-once: persist the planner's ref descriptions (emitted in the SAME JSON, $0).
    // Only sets descriptionJson where it is currently null — never overwrites an existing
    // description (see-once semantics). Owner-scoped. Best-effort: never fails the turn.
    if (turn.refDescriptions && Object.keys(turn.refDescriptions).length && attachedRefIdByName.size) {
      try {
        for (const [rawName, desc] of Object.entries(turn.refDescriptions)) {
          const name = rawName.replace(/^@/, "");
          if (ambiguousRefNames.has(name)) continue; // same-named entities → can't disambiguate, skip
          const id = attachedRefIdByName.get(name);
          if (!id) continue; // cache ONLY for entities whose pixels were actually shown this turn
          // sanitize: single line, no control chars — it gets rendered raw into the system prompt
          // on later turns, so a newline/instruction-like description must not become injectable.
          const clean = desc.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, 600);
          if (!clean) continue;
          await prisma.entity.updateMany({
            where: { id, ...OWNED, descriptionJson: { equals: Prisma.DbNull } }, // see-once: null→set only
            data: { descriptionJson: { text: clean } },
          });
        }
      } catch (e) { console.warn("coworkTurn: refDescriptions persist failed (non-fatal):", e instanceof Error ? e.message : e); }
    }
    revalidatePath("/", "layout");
    // return the agent's brief refinement so the client keeps its editor in sync (avoids a
    // stale manual save clobbering a fresher agent-written brief).
    return { threadId, ...(turn.briefUpdate ? { brief: turn.briefUpdate } : {}) };
  } catch {
    return { error: "Couldn't reach cowork — please try again." };
  }
}

export async function coworkGenerate(raw: unknown): Promise<{ id: string } | { error: string }> {
  const parsed = coworkGenerateRequest.safeParse(raw);
  if (!parsed.success) return { error: "That card can't be generated." };
  const gate = await requireSession(); if ("error" in gate) return gate;
  const { cardId, prompt, entityIds, variantSel, model: modelOverride, count: countOverride, aspectRatio: aspectOverride, resolution: resolutionOverride, durationSeconds: durationOverride, audio: audioOverride } = parsed.data;

  // Load the GEN_CARD server-side — threadId + projectId + the trusted model/params
  // come from the PERSISTED card, never from the client (anti-spoof).
  const card = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId: FOUNDER_OWNER_ID, kind: "GEN_CARD", deletedAt: null },
    select: { id: true, threadId: true, payload: true, genJobId: true, thread: { select: { projectId: true, deletedAt: true, ownerId: true } } },
  });
  if (!card || card.thread.deletedAt || card.thread.ownerId !== FOUNDER_OWNER_ID) return { error: "Card not found." };

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
    where: { ownerId: FOUNDER_OWNER_ID, idempotencyKey: `cowork:${cardId}` },
    select: { id: true },
  });
  if (existingJob) return { id: existingJob.id };

  // re-validate the persisted proposal subset; the model/kind/params are server-trusted
  const p = (card.payload ?? {}) as Record<string, unknown>;
  const proposal = coworkProposalSchema.safeParse({ kind: p.kind, desiredAspect: p.desiredAspect, desiredDuration: p.desiredDuration, desiredAudio: p.desiredAudio, structuredPrompt: p.structuredPrompt, entityIds: p.entityIds ?? [], variantSel: p.variantSel ?? {} });
  if (!proposal.success) return { error: "This card is no longer valid." };
  const model = typeof p.model === "string" ? p.model : null;
  const params = (p.params ?? {}) as { aspectRatio?: string; resolution?: string; durationSeconds?: number; audio?: boolean; count?: number };
  if (!model) return { error: "This card is missing a model." };
  // i2v source frame: server-trusted (it was owner+project validated in coworkTurn before
  // being persisted on the card). startGen.checkCast re-validates it at spend (the backstop).
  const sourceGenerationId = typeof p.sourceGenerationId === "string" ? p.sourceGenerationId : null;

  // Build the genRequest SERVER-SIDE. kind + sourceGenerationId stay card-trusted; the
  // user MAY override model/count/video-params via the editable card (model picker + param
  // pills) — each override falls back to the card's value when absent. Overrides only WIDEN
  // what reaches startGen; startGen.safeParse + superRefine + checkCast remain the SOLE,
  // complete spend gate (model∈the card-kind's menu, every param∈the chosen model's option
  // set, count≤maxCount → an invalid/mispriced combo is rejected with {error}, no spend).
  // prompt/entityIds/variantSel still from the client; effectiveVariantSel drops it for video.
  const chosenModel = modelOverride ?? model;
  // Only forward `audio` for video models that actually expose an audio toggle. startGen's
  // superRefine REJECTS audio:false for always-silent models (kling/grok/wan/hailuo); suggestModel
  // persists params.audio=false for those, so blindly forwarding it makes them un-generatable.
  const audioToggle = proposal.data.kind === "video" && (GEN_VIDEO_MODELS as readonly string[]).includes(chosenModel)
    ? GEN_VIDEO_MODEL_OPTIONS[chosenModel as GenVideoModel].audioToggle
    : false;
  const req = {
    projectId: card.thread.projectId,
    threadId: card.threadId,
    prompt,
    entityIds,
    ...(Object.keys(variantSel).length ? { variantSel } : {}),
    ...(sourceGenerationId ? { sourceGenerationId } : {}), // i2v — checkCast re-validates ownership+project
    count: proposal.data.kind === "video" ? 1 : (countOverride ?? params.count ?? 1),
    kind: proposal.data.kind, // CARD-trusted — never the client (can't flip image↔video)
    model: chosenModel,
    ...(proposal.data.kind === "video" ? {
      durationSeconds: durationOverride ?? params.durationSeconds ?? null,
      resolution: resolutionOverride ?? params.resolution ?? null,
      aspectRatio: aspectOverride ?? params.aspectRatio ?? null,
      ...(audioToggle ? { audio: audioOverride ?? params.audio ?? null } : {}),
    } : {}),
    idempotencyKey: `cowork:${cardId}`, // stable — same card always dedupes; NEVER per-retry
  };

  const res = await startGen(req); // the ONLY spend path (unmodified logic — safeParse + Guardian)
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
}

export async function coworkRenameThread(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const parsed = coworkRenameThreadRequest.safeParse(raw);
  if (!parsed.success) return { error: "Give the conversation a title (1-120 chars)." };
  const gate = await requireSession(); if ("error" in gate) return gate;
  const { threadId, title } = parsed.data;
  try {
    const { count } = await prisma.chatThread.updateMany({
      where: { id: threadId, ownerId: FOUNDER_OWNER_ID, deletedAt: null },
      data: { title },
    });
    if (!count) return { error: "Conversation not found." };
  } catch { return { error: "Couldn't rename — please try again." }; } // {error} contract, like the sibling actions
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function coworkDeleteThread(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const parsed = coworkDeleteThreadRequest.safeParse(raw);
  if (!parsed.success) return { error: "Invalid request." };
  const gate = await requireSession(); if ("error" in gate) return gate;
  const { threadId } = parsed.data;
  try {
    const { count } = await prisma.chatThread.updateMany({
      where: { id: threadId, ownerId: FOUNDER_OWNER_ID, deletedAt: null },
      data: { deletedAt: new Date() }, // soft-delete: hides from the list; messages + threadId-isolation untouched
    });
    if (!count) return { error: "Conversation not found." };
  } catch { return { error: "Couldn't delete — please try again." }; } // {error} contract, like the sibling actions
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Create a variation of an existing GEN_CARD — clones its payload verbatim into a new
 *  UN-generated card on the SAME thread. Zero spend: no startGen, no GenJob, no queue.
 *  The new card gets a fresh newId() so its cowork:<newCardId> idempotencyKey is
 *  independent of the original; clicking Generate on it goes through the normal single-spend
 *  guard keyed on the new card id — no cross-contamination with the original. */
export async function coworkVaryCard(raw: unknown): Promise<{ threadId: string } | { error: string }> {
  const parsed = coworkVaryCardRequest.safeParse(raw);
  if (!parsed.success) return { error: "That card can't be varied." };
  const gate = await requireSession(); if ("error" in gate) return gate;
  const { cardId } = parsed.data;
  try {
    const card = await prisma.chatMessage.findFirst({
      where: { id: cardId, ownerId: FOUNDER_OWNER_ID, kind: "GEN_CARD", deletedAt: null },
      select: { id: true, threadId: true, payload: true, thread: { select: { projectId: true, deletedAt: true, ownerId: true } } },
    });
    if (!card || card.thread.deletedAt || card.thread.ownerId !== FOUNDER_OWNER_ID) return { error: "Card not found." };

    // Validate the persisted payload is still a real, complete card (mirrors coworkGenerate).
    const p = (card.payload ?? {}) as Record<string, unknown>;
    const proposal = coworkProposalSchema.safeParse({ kind: p.kind, desiredAspect: p.desiredAspect, desiredDuration: p.desiredDuration, desiredAudio: p.desiredAudio, structuredPrompt: p.structuredPrompt, entityIds: p.entityIds ?? [], variantSel: p.variantSel ?? {} });
    if (!proposal.success) return { error: "This card is no longer valid." };
    if (typeof p.model !== "string") return { error: "This card is missing a model." };

    // Clone the payload verbatim — same model/params/prompt/refs/source. No seed is pinned,
    // so re-generating yields a genuinely different output server-side.
    const clonedPayload = card.payload as Prisma.InputJsonObject;

    const last = await prisma.chatMessage.findFirst({ where: { threadId: card.threadId }, orderBy: { seq: "desc" }, select: { seq: true } });
    let seq = (last?.seq ?? 0);
    const rows = [
      { id: newId(), threadId: card.threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT" as const, kind: "TEXT" as const, seq: ++seq, text: "Another take — same settings. Generate when you're ready.", payload: undefined },
      { id: newId(), threadId: card.threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT" as const, kind: "GEN_CARD" as const, seq: ++seq, text: "", payload: clonedPayload },
    ];
    await prisma.$transaction([
      prisma.chatMessage.createMany({ data: rows }),
      prisma.chatThread.update({ where: { id: card.threadId }, data: { updatedAt: new Date() } }),
    ]);
    try {
      await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: card.thread.projectId, type: "cowork.vary", payload: { fromCardId: cardId } } });
    } catch { /* audit best-effort */ }
    revalidatePath("/", "layout");
    return { threadId: card.threadId };
  } catch {
    return { error: "Couldn't create variations — please try again." };
  }
}

/** Save (or clear) the per-project creative brief the planner sees every turn.
 *  Propose-side only — this text is injected into the planner system prompt; it
 *  does NOT touch coworkGenerate/startGen and creates no media spend. */
export async function setCoworkBrief(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const parsed = coworkBriefRequest.safeParse(raw);
  if (!parsed.success) return { error: "Invalid brief." };
  const gate = await requireSession(); if ("error" in gate) return gate;
  const { projectId, brief } = parsed.data;
  try {
    const { count } = await prisma.project.updateMany({
      where: { id: projectId, ...OWNED },
      data: { coworkBrief: brief.trim() || null },
    });
    if (!count) return { error: "Project not found." };
  } catch { return { error: "Couldn't save the brief — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true };
}
