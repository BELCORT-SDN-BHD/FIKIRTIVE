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
import { applyReferenceUpscaleGate } from "./reference-upscale-gate.js";
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
  //
  // FSE-210(判官 P1-1,与 `propose.ts` 同一条纪律)—— 并上这一轮服务端已核过归属的
  // `ctx.turnEntityIds`:`buildProposeCard` 内部把它并进每一项自己的 entityIds,查询集与
  // 下面 `itemOwnedEntities` 的过滤集都必须跟得上,否则归属闸会把并集救回来的那个 id
  // 误判成「查无此人」。
  const allEntityIds = [...new Set([
    ...input.items.flatMap((item) => item.entityIds),
    ...(ctx.turnEntityIds ?? []),
  ])];

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
      // Ownership guard: filter the owned entities to those referenced by this item — plus the
      // turn-resolved set `buildProposeCard` will also merge in (FSE-210 判官 P1-1), so the
      // ownedSet it builds internally always covers what it itself asks for.
      const itemEntityIds = new Set([...item.entityIds, ...(ctx.turnEntityIds ?? [])]);
      const itemOwnedEntities = ownedEntities.filter((e) => itemEntityIds.has(e.id));
      /**
       * 复审 P1-C —— **整包这一面不绑「正在做的那张图」**,直到整包卡的每一行说得出它。
       *
       * 单张那条路上,继承来的底图带着回执上卡,商家在 `Generate · N credits` 之前逐项读得到
       * 「正在改的是这一张」(`image-continuation.ts` 第 ② 条纪律)。整包这张卡没有这一格:
       * `PackCard` 的每一行只有图标、那句提示词和价钱 —— 回执确实躺在 payload 里,
       * 却一个像素都没渲染出来。于是绑上去的效果是:一个他读不到的 id 跟着**整批**
       * 付费请求上路,而 `Make all` 是一次按下去买走全部几张。
       * `plan-card-contract.ts` 早就把这条写成规矩了:卡上有一件参考而商家在付钱之前
       * 读不到它是什么,这张卡就不该拿去花钱。
       *
       * 两条路都能补上这个缺口,这里选小的那一条:给每一行补一整块回执是版面改动
       * (`design-system/governance/frontend-integration-handoff.md` §4:改布局先进变更登记、
       * 由 Founder 决定),而 FC-2 的走查现场是单张那条路。不绑 = 与这条修改之前逐字相同,
       * 没有回归,也不会有一张读不到的底图被静默买走。
       *
       * 代价说明白:「再给我三张这张图的变体」在整包这条路上仍然不继承(商家自己挂一次图
       * 就照旧能拿到)。等哪天整包卡的行说得出「正在改的是这一张」,把 `withContinuedImage`
       * 接回这里即可 —— 判据那一份是现成的,共用的就是它。
       */
      payloads.push(buildProposeCard(item as ProposeInput, ctx, itemOwnedEntities).cardPayload);
    }
  } catch (e) {
    // #775:认拒绝的**基类** —— 引擎被关掉、形状撑不起这段提示词,对整包来说都是同一件事:
    // 半截包里每一张都是点得下去的付费卡,所以一张都不落库,把那句话交回给商家。
    if (e instanceof ProposeRefusal) return { error: e.message };
    throw e;
  }

  // FSE-001 —— 付费前的参考图尺寸闸(`executePropose` 读的同一个函数,规格 §5 :176④/:176⑥)。
  // 判官第 3 轮实证:整包这一面从前整条绕过它 —— 同一份 ctx、同一张付费卡,商家点下去照旧是
  // 预扣 → 供应商 300px 闸弹回 → 退款。查在这里,与「先全部造完再落库」是同一条性质:一张
  // 撑不起,整包一张都不落库,把那句话交回给商家(半截包里每一张都是点得下去的付费卡)。
  const gatedPayloads: CardPayload[] = [];
  for (const cardPayload of payloads) {
    const gated = await applyReferenceUpscaleGate(cardPayload, ctx.orgId);
    if ("error" in gated) return gated;
    gatedPayloads.push(gated.payload);
  }

  for (const cardPayload of gatedPayloads) {
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
