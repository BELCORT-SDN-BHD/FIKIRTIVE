/**
 * generate — THE spend gate (money-machine adjacent)
 *
 * The ONE Otto tool that spends real money. Gated by needsApproval: true (human-in-the-loop).
 * Input is ONLY { cardId }. kind/model/params come EXCLUSIVELY from the persisted card
 * (anti-flip: the model cannot pass or override spend params).
 *
 * The only spend path is ctx.startGen — injected by the web caller. This tool NEVER:
 *   - calls the generation provider directly
 *   - calls reserveCredits
 *   - creates a GenJob directly
 *
 * needsApproval is a LITERAL `true` — never a numeric predicate (which fails open).
 *
 * Exactly-once guard: before spending, a GenJob with idempotencyKey=cowork:<cardId> (ANY status)
 * is checked; if found, the existing job is returned without re-charging. The DB unique index
 * GenJob_cowork_idempotency_once is the race-proof backstop.
 *
 * Prompt authority (D/E decision 6): the card's structuredPrompt is used directly — no legacy
 * enhance-directive composer. The models this path generates (seedream/seedance) each own a
 * dedicated prompt skill and are the SOLE prompt authority, so the family×mode directive is
 * intentionally NOT applied on EITHER spend surface — the button path (coworkGenerate) also
 * skips it for skilled families (familyHasPromptSkill) — and both yield the identical
 * model-bound prompt. (The app-level directive read isn't importable here anyway.) This only
 * ever affects the prompt string, never spend/safety.
 */
import { z } from "zod";
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import { isModelDisabled, buildGenRequestFromCard, cardQuoteVersion, QUOTE_VERSION_STALE } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
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
  if (card.threadId !== ctx.threadId) return { error: "Card not found." };
  if (card.thread.projectId !== ctx.projectId) return { error: "Card not found." };

  // Step 3: exactly-once re-spend guard (load-bearing — Phase 0 proved SDK approval is NOT
  // exactly-once; this DB check + the GenJob_cowork_idempotency_once unique index are the
  // only things preventing re-charge of the same card).
  const existing = await prisma.genJob.findFirst({
    where: { ownerId: ctx.orgId, idempotencyKey: `cowork:${input.cardId}` },
    select: { id: true, status: true },
  });
  if (existing) return { genJobId: existing.id, status: existing.status };

  // Step 3b: FSE-012 (creation-engine.md §5 :170) —— 「批的是哪一版报价」。
  //
  // `ottoApprove` 门口那道闸只证明了**按下按钮那一刻**卡还是商家看的那一版;这一步之前
  // 商家还可以在别处改一格,而这条路会把整份请求按**当前**这张卡重新拼一遍(下面 Step 5),
  // 价钱因此自洽在新的那一版上,两道价格对签谁也拦不住 —— 批 A 收 B 就是这么发生的
  // (判官第 3 轮 P2-b)。所以把批准那一刻的版本随 ctx 带进来,在这里与**这一次读出来的、
  // 马上要拿去拼装请求的那张卡**逐串比对。
  //
  // 排在再花钱守卫之后:已经成交的那张卡第二次点击是幂等取回,不是一次新的报价。
  // 拒在 `ctx.startGen` 之前 ⇒ 零建任务、零预扣、账本零新增行。缺席 ⇒ 放行(老客户端 /
  // 非确认卡入口),与这条闸出现之前逐字相同。
  if (
    ctx.approvedQuoteVersion
    && ctx.approvedQuoteVersion.cardId === input.cardId
    && cardQuoteVersion(card.payload) !== ctx.approvedQuoteVersion.version
  ) {
    return { error: QUOTE_VERSION_STALE };
  }

  // Step 4: disabled-model check (mirror coworkGenerate — a card built before a disable must not spend)
  const p = (card.payload ?? {}) as Record<string, unknown>;
  const model = typeof p.model === "string" ? p.model : null;
  if (model && isModelDisabled(model, new Set(ctx.disabledModels))) {
    return { error: "That model is currently turned off." };
  }

  // Step 5: build the request from the persisted card — pure, no overrides (anti-flip).
  // structuredPrompt used directly: the families reachable here (seedream/seedance) are the
  // sole prompt authority (decision 6) — no directive on either surface. See file header.
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
// Skill definition via factory — derives needsApproval from cost:"spend".
// needsApproval is a LITERAL `true` — never a predicate, never a number.
// ---------------------------------------------------------------------------

export const generateSkill = defineOttoSkill({
  name: "generate",
  cost: "spend",
  effect: "write",
  reach: "internal",
  // The exactly-once guard itself lives in executeGenerate + the DB unique index
  // (GenJob_cowork_idempotency_once). This declaration satisfies the factory's
  // "spend must declare an idempotency key" rule and documents the key shape.
  idempotencyKey: (i) => `cowork:${i.cardId}`,
  description:
    "Execute a generation proposal (GEN_CARD) that the user has approved. " +
    "This SPENDS the user's credits and REQUIRES the user's approval — only call it when " +
    "the user has clearly asked to go ahead with that specific card. " +
    "One card generates at most once. Pass only the card's id — model and params come from " +
    "the persisted card, not from this call.",
  parameters: generateInput,
  execute: executeGenerate,
});
