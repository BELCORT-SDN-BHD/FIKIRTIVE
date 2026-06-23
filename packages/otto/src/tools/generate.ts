/**
 * generate — THE spend gate (money-machine adjacent)
 *
 * The ONE Otto tool that spends real money. Gated by needsApproval: true (human-in-the-loop).
 * Input is ONLY { cardId }. kind/model/params come EXCLUSIVELY from the persisted card
 * (anti-flip: the model cannot pass or override spend params).
 *
 * The only spend path is ctx.startGen — injected by the web caller. This tool NEVER:
 *   - calls the fal provider directly
 *   - calls reserveCredits
 *   - creates a GenJob directly
 *
 * needsApproval is a LITERAL `true` — never a numeric predicate (which fails open).
 *
 * Exactly-once guard: before spending, a GenJob with idempotencyKey=cowork:<cardId> (ANY status)
 * is checked; if found, the existing job is returned without re-charging. The DB unique index
 * GenJob_cowork_idempotency_once is the race-proof backstop.
 *
 * v1 simplification: the card's structuredPrompt is used directly — no enhance-directive
 * composer (getEnhanceDirective, composePrompt). This is a prompt-quality gap only, not a
 * spend/safety issue. The composer is app-level and not importable here.
 */
import { z } from "zod";
import { tool } from "@openai/agents";
import type { RunContext } from "@openai/agents";
import { isModelDisabled, buildGenRequestFromCard } from "@artlio/core";
import { prisma } from "@artlio/db";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Input schema — ONLY cardId. No spend params from model input (anti-flip).
// Exported for tests so they can exercise the schema directly (the built tool's
// .parameters is a JSON Schema object, not the Zod schema).
// ---------------------------------------------------------------------------

export const generateInput = z.object({
  cardId: z.string().min(1),
});

type GenerateInput = z.infer<typeof generateInput>;

// ---------------------------------------------------------------------------
// Execute function — exported separately for direct unit-testing
// ---------------------------------------------------------------------------

export async function executeGenerate(
  input: GenerateInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<
  | { genJobId: string; status: string }
  | { error: string }
> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  // Step 1: guard — startGen port MUST be injected; fail loud if absent
  if (!ctx.startGen) throw new Error("startGen port required");

  // Step 2: load the owned card (owner-scoped by ctx.orgId — cross-tenant cardId is rejected)
  const card = await prisma.chatMessage.findFirst({
    where: {
      id: input.cardId,
      ownerId: ctx.orgId,
      kind: "GEN_CARD",
      deletedAt: null,
    },
    select: {
      id: true,
      threadId: true,
      payload: true,
      thread: {
        select: {
          projectId: true,
          deletedAt: true,
          ownerId: true,
        },
      },
    },
  });
  if (!card || card.thread.deletedAt || card.thread.ownerId !== ctx.orgId) {
    return { error: "Card not found." };
  }

  // Step 3: exactly-once re-spend guard (load-bearing — Phase 0 proved SDK approval is NOT
  // exactly-once; this DB check + the GenJob_cowork_idempotency_once unique index are the
  // only things preventing re-charge of the same card).
  const existing = await prisma.genJob.findFirst({
    where: { ownerId: ctx.orgId, idempotencyKey: `cowork:${input.cardId}` },
    select: { id: true, status: true },
  });
  if (existing) return { genJobId: existing.id, status: existing.status };

  // Step 4: disabled-model check (mirror coworkGenerate — a card built before a disable must not spend)
  const p = (card.payload ?? {}) as Record<string, unknown>;
  const model = typeof p.model === "string" ? p.model : null;
  if (model && isModelDisabled(model, new Set(ctx.disabledModels))) {
    return { error: "That model is currently turned off." };
  }

  // Step 5: build the request from the persisted card — pure, no overrides (anti-flip)
  // v1: structuredPrompt used directly (no enhance-directive composer — app-level, not importable here)
  const structuredPrompt = typeof p.structuredPrompt === "string" ? p.structuredPrompt : "";
  const entityIds = Array.isArray(p.entityIds) ? (p.entityIds as string[]) : [];
  const variantSel =
    p.variantSel && typeof p.variantSel === "object" && !Array.isArray(p.variantSel)
      ? (p.variantSel as Record<string, string>)
      : {};

  const built = buildGenRequestFromCard({
    cardPayload: card.payload,
    projectId: card.thread.projectId,
    threadId: card.threadId,
    cardId: input.cardId,
    prompt: structuredPrompt,
    entityIds,
    variantSel,
    overrides: undefined,
  });
  if (!built.ok) return { error: built.error };

  // Step 6: spend via the injected port — the ONLY spend path
  const res = await ctx.startGen(built.req);
  if ("error" in res) return res;

  // Step 7: best-effort mark card→job (UI reload-disable only — NOT the spend guard)
  try {
    await prisma.chatMessage.update({
      where: { id: input.cardId },
      data: { genJobId: res.id },
    });
  } catch {
    /* best-effort — the spend already happened safely via startGen */
  }

  return { genJobId: res.id, status: "queued" };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// needsApproval is a LITERAL `true` — never a predicate, never a number.
// ---------------------------------------------------------------------------

export const generate = tool<typeof generateInput, OttoContext>({
  name: "generate",
  description:
    "Execute a generation proposal (GEN_CARD) that the user has approved. " +
    "This SPENDS the user's credits and REQUIRES the user's approval — only call it when " +
    "the user has clearly asked to go ahead with that specific card. " +
    "One card generates at most once. Pass only the card's id — model and params come from " +
    "the persisted card, not from this call.",
  parameters: generateInput,
  needsApproval: true,
  execute: async (input, runContext) => {
    if (!runContext) throw new Error("OttoContext required");
    return executeGenerate(input, runContext);
  },
});
