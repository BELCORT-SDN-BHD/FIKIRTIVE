/**
 * proposePack — $0 tool
 *
 * Lays out a COHERENT SET of generation proposals (a "campaign pack") in a single turn.
 * Examples: 3 product shots + 3 model shots, or a 5-slide carousel.
 *
 * Each item is built via the SAME path as a normal `propose` call (buildProposeCard +
 * executePropose), so every card is identical to a standalone proposal. The only addition
 * is a shared `packId` (and `packTitle`) stamped into each card payload so the UI can
 * group them together.
 *
 * Cost: $0 — NO GenJob, NO provider call, NO credit spend.
 * Spending still happens exclusively through the existing `generate` skill, once the
 * user approves each individual card in the pack.
 *
 * Identity comes exclusively from OttoContext (ctx), never from tool input.
 */
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import { newId, type ApprovedEntity } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";
import { proposeInput, buildProposeCard, ProposeRefusal, type ProposeInput, type CardPayload } from "./propose.helpers.js";
import { VARIANT_AXES, checkVariantSet } from "./variant-policy.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * A single item in the pack — the same fields as proposeInput, no identity.
 *
 * #775 —— 多出来的 `variantAxis` 是**变体政策**的入口:这一条走的是哪个方向。可选,
 * 不填一个字节都不变(老调用照旧)。它不进卡、不进钱、不进任何付费字段 —— 唯一的用途
 * 是让整包造完之后能回一句「这两条其实是同一个想法」的提醒。
 */
const packItemSchema = proposeInput.extend({ variantAxis: z.enum(VARIANT_AXES).optional() });

export const proposePackInput = z.object({
  packTitle: z.string().min(1).max(120),
  items: z.array(packItemSchema).min(1).max(8),
  // 创作意图/目的 —— requires 资讯门要求它非空。
  goal: z.string().optional(),
});

type ProposePackInput = z.infer<typeof proposePackInput>;

// ---------------------------------------------------------------------------
// Execute (DB side) — exported separately for unit-testing
// ---------------------------------------------------------------------------

export async function executeProposePack(
  input: ProposePackInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ packId: string; cardIds: string[]; notes?: string[] } | { error: string }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  // Collect all entityIds referenced across all items (de-duped) for a single ownership check.
  const allEntityIds = [...new Set(input.items.flatMap((item) => item.entityIds))];

  // #774 判官 r2 P1:名字与类型跟归属同一趟读出来 —— 卡上冻结的就是这一刻的身份。
  let ownedEntities: ApprovedEntity[] = [];
  if (allEntityIds.length > 0) {
    ownedEntities = await prisma.entity.findMany({
      where: { id: { in: allEntityIds }, ownerId: ctx.orgId, deletedAt: null },
      select: { id: true, type: true, name: true },
    });
  }

  // One shared packId groups all cards in the UI.
  const packId = newId();
  const cardIds: string[] = [];

  // #647 T6:整包**先全部造完再落库**。造卡是纯的($0,无 I/O),所以先造后写不多花一分
  // 成本,却买到一条硬性质:唯一那台引擎被关掉时,商家看到的是一句人话,而不是「前两张
  // 落了库、第三张报错」的半截包 —— 半截包里每一张都是点得下去的付费卡。
  const payloads: CardPayload[] = [];
  try {
    for (const item of input.items) {
      // Ownership guard: filter the owned entities to those referenced by this item.
      const itemOwnedEntities = ownedEntities.filter((e) => item.entityIds.includes(e.id));
      payloads.push(buildProposeCard(item as ProposeInput, ctx, itemOwnedEntities).cardPayload);
    }
  } catch (e) {
    // #775:认拒绝的**基类** —— 引擎被关掉、形状撑不起这段提示词,对整包来说都是同一件事:
    // 半截包里每一张都是点得下去的付费卡,所以一张都不落库,把那句话交回给商家。
    if (e instanceof ProposeRefusal) return { error: e.message };
    throw e;
  }

  for (const cardPayload of payloads) {
    // Stamp the pack grouping onto the payload (minimally extended).
    const packedPayload = {
      ...cardPayload,
      packId,
      packTitle: input.packTitle,
      ...(input.goal ? { goal: input.goal } : {}),
    };

    // Find the current max seq so each card gets a monotonically increasing sequence.
    const last = await prisma.chatMessage.findFirst({
      where: { threadId: ctx.threadId, ownerId: ctx.orgId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });

    const cardId = newId();
    await prisma.chatMessage.create({
      data: {
        id: cardId,
        threadId: ctx.threadId,
        ownerId: ctx.orgId,
        role: "AGENT",
        kind: "GEN_CARD",
        seq: (last?.seq ?? 0) + 1,
        text: "",
        payload: packedPayload,
      },
    });

    cardIds.push(cardId);
  }

  // #775 变体政策 —— 只**提醒**,绝不拦截。整包已经全部落库了,这几句话不改变任何一张卡;
  // Otto 用人话转述,要不要重来是商家的事(与 #774 U8 的素材建议同一条出口)。
  const notes = checkVariantSet(
    input.items.map((item) => ({ ...(item.variantAxis ? { axis: item.variantAxis } : {}), prompt: item.structuredPrompt })),
  );

  return { packId, cardIds, ...(notes.length > 0 ? { notes } : {}) };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const proposePackSkill = defineOttoSkill({
  name: "proposePack",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Lay out a coherent set of generation proposals (a campaign pack) in one turn. " +
    "Use this when the user wants a whole campaign laid out at once — for example, " +
    "3 product shots + 3 model shots, or a 5-slide carousel. " +
    "Each item becomes its own GEN_CARD (identical to a normal propose call) so the user " +
    "can approve and generate them individually. " +
    "Provide a packTitle describing the campaign, and an items array (1–8 entries). " +
    "Each item takes the same fields as propose: kind, structuredPrompt, entityIds, etc. " +
    // #775 变体政策 —— 几个「选项」只有真的走在不同的轴上才是选择。
    "When the items are alternative DIRECTIONS for one idea (rather than different assets), give each one a " +
    `\`variantAxis\` — the one thing it changes: ${VARIANT_AXES.join(", ")}. Two options on the same axis read ` +
    "as the same idea twice. If the result comes back with `notes`, tell the user those points in your own " +
    "plain words — they are advice, never a limit; never drop or refuse an option the user asked for. " +
    "This tool is $0 — NO generation, NO spend. Spending happens per card, via the generate skill.",
  parameters: proposePackInput,
  requires: [
    {
      field: "goal",
      question:
        "What is this campaign pack for — its goal/purpose (e.g. an ad set to drive signups, a product launch pack)?",
    },
  ],
  execute: executeProposePack,
});

export const proposePack = proposePackSkill.tool;
