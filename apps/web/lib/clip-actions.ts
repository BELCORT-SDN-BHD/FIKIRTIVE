"use server";
/**
 * #922 缺口 A —— 「改这条片子 / 把这条片子接下去」的 $0 铸卡层(商家自己那一面)。
 *
 * ── 这条入口做什么、不做什么 ─────────────────────────────────────────────
 * 做:把商家在素材库/画布上点的那个动作 + 他自己打的那句话,铸成**一张与 Otto 路完全
 *    同形**的视频卡 —— 官方锚定句式在前、边界句在后、画幅钉成 adaptive、
 *    `referenceVideoGenerationId` 指着他那条片子。
 * 不做:**一分钱都不花**。这里不建 GenJob、不 reserve、不 settle、不碰幂等域。
 *    扣费仍然只发生在商家按下确认之后的既有 `coworkGenerate(cardId)` 上,幂等键仍然是
 *    那张卡自己的 `cowork:<cardId>`(once-EVER)。这条路上没有第二条钱路,也没有第二套
 *    业务实现(Founder「Shared actions」铁律)。
 *
 * ── 为什么可以直接用 buildProposeCard ────────────────────────────────────
 * 它是 `@fikirtive/otto` 导出的**纯**铸卡器(不碰 DB、不碰 SDK),选型、定价、画幅钉死、
 * 能力表的形状判定(`decideVideoAction` → 撑不起来就抛 `ProposeRefusal`,一张卡都不铸)
 * 全在它里面。分镜闸① 的子卡铸造层(`storyboard-gate1-actions.ts`)走的正是这条路 ——
 * 本文件是同一个先例的第二个消费者,不是新造的一条。
 *
 * ── 措辞的单一权威 ──────────────────────────────────────────────────────
 * 官方那两句话由 `anchoredClipLines`(@fikirtive/otto,#775 的同一个装配器)写。这里
 * 一个字都不自己拼:抄成第二份的话,哪天官方改措辞,`anchoredVideoAction`(core 的钱路
 * 判据,`genRequest` 与 `gen-from-card` 都读它)就会开始认不出我们自己产的卡。
 * 商家打的那句话原样进装配器,**绝不润色** —— 卡上冻结的那一段是批准后原样上路的那一份。
 *
 * ── 租户 ────────────────────────────────────────────────────────────────
 * 身份只来自 `requireOwner()` 的 session。客户端只送得出一个 generationId,而那一行要
 * 同时过 owner 作用域查询与 `validateOwnedGenerationExt`(Otto 路验 `referenceVideoGenerationId`
 * 用的**同一个**校验器):不是这个租户的、不是视频扩展名的,一律读不出来。
 */
import { z } from "zod";
import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { buildProposeCard, anchoredClipLines, ProposeRefusal } from "@fikirtive/otto";
import type { OttoContext } from "@fikirtive/otto";
import { runAsUser } from "@fikirtive/db/principal";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { resolveDisabledModels } from "./model-registry";
import { validateOwnedGenerationExt } from "./otto-generation-validate";
import { clipEntrySegment } from "./clip-action-entry";

/** 与 `otto-actions.ts` 的 VIDEO_EXTS 同一份口径 —— 整段参考视频认得的扩展名。 */
const CLIP_VIDEO_EXTS = ["mp4", "mov", "webm"];

const clipActionInput = z.object({
  generationId: z.string().min(1).max(64),
  // #922:这里**刻意不**照下架名单裁剪 enum。裁了就是把同一个判断写成第二份,而这条路
  // 上的判断本来就有唯一的一处:下面第 ⑤ 步的 `buildProposeCard` 走能力表,关着的动作
  // 当场抛 `ProposeRefusal`,商家拿到的正是名单里那句人话,一张卡都不落库、$0。
  // 界面那一侧同样只是**不画**那个键(`CLIP_ENTRY_ACTIONS`),不自己判。
  action: z.enum(["edit", "extend"]),
  wording: z.string().min(1).max(2000),
});

/** 铸好的卡,交给界面显示确认那一行的最小事实。 */
export type ClipActionCard = {
  cardId: string;
  threadId: string;
  /** 卡上冻结的那一段 —— 商家批准前看得见的、批准后原样上路的同一份。 */
  structuredPrompt: string;
  /** 卡面报价(credits),与 `startGen` 会预扣的是同一个数。 */
  estimatedCredits: number;
  /** 服务端派生的规格条目(含「Same shape as your reference」),界面只按顺序渲染。 */
  specChips: string[];
  /** 降级披露(例如商家先前点过 16:9)。缺席 = 没有可披露的降级。 */
  downgradeNote?: string;
};

/**
 * $0:为一条已出片的视频铸一张「改它 / 接下去」的卡。
 *
 * 成功返回卡的最小事实;失败返回一句人话。两种情形都不写任何钱路记录。
 */
export async function proposeClipActionCard(
  raw: unknown,
): Promise<ClipActionCard | { error: string }> {
  const parsed = clipActionInput.safeParse(raw);
  if (!parsed.success) return { error: "That clip can't be changed." };
  const segment = clipEntrySegment(parsed.data.wording);
  if ("error" in segment) return segment;

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);

  return runAsUser(principal, async (): Promise<ClipActionCard | { error: string }> => {
    const { ownerId } = gate;
    const { generationId, action } = parsed.data;
    try {
      // ① 这条片子确实是这个租户的。projectId 从**这一行自己**读出来,不从客户端收 ——
      //    客户端送得进来的只有一个 id。
      const clip = await prisma.generation.findFirst({
        where: { id: generationId, ownerId, deletedAt: null },
        select: { id: true, projectId: true, threadId: true },
      });
      if (!clip) return { error: "That clip isn't available." };

      // ② 再过一次 Otto 路验整段参考视频用的**同一个**校验器(owner + project + 视频
      //    扩展名)。两条路对「这条片子能不能当参考」只许有一个答案。
      const validated = await validateOwnedGenerationExt(prisma, {
        id: clip.id,
        ownerId,
        projectId: clip.projectId,
        exts: CLIP_VIDEO_EXTS,
      });
      if (!validated) return { error: "That clip isn't available." };

      // ③ 卡要落在一条会话里(ChatMessage.threadId 是必填外键,与 Otto 铸的卡同一张表)。
      //    这一步**只读**:优先落在这条片子自己出生的那条会话里 —— 商家回头能在原地看见
      //    这次改动的来龙去脉(Founder:每个东西都要有迹可循);那条会话没了或这条片子
      //    本来就不是聊出来的,就落在这个项目最近的一条活会话上。
      //
      //    判官 r1 P2-2:**一条会话都不在这里建**。上一版在这里就把新会话建好了,于是
      //    引擎被关掉(下面第 ⑤ 步抛 ProposeRefusal)时商家什么都没拿到,却在会话列表里
      //    多出一条空的 "Untitled" —— 一次被拒绝的动作留下了痕迹。现在新会话的 id 先铸出来
      //    (id 不是行),真正落库放到第 ⑥ 步、与卡在**同一个事务**里:卡铸不出来,事务
      //    根本不会开始;事务里任何一步失败,两行一起回滚。
      const existingThreadId = await findLiveClipCardThread(ownerId, clip.projectId, clip.threadId);
      if (!existingThreadId) {
        // 要新开会话就得先确认项目也是这个租户的 —— 同样只读,拒绝路径零写入。
        const project = await prisma.project.findFirst({
          where: { id: clip.projectId, ownerId, deletedAt: null },
          select: { id: true },
        });
        if (!project) return { error: "Couldn't set this up — please try again." };
      }
      const threadId = existingThreadId ?? newId();

      // ④ 官方那两句话由 #775 的同一个装配器写。商家的那句话原样做 segment。
      const structuredPrompt = anchoredClipLines({
        action: action === "extend" ? "extendClip" : "editClip",
        // 续写方向:这条入口只提供官方默认的「往后接」。往前接是另一件事,没有入口就不假装有。
        extendDirection: "forward",
        segment: segment.segment,
      }).join("\n");

      // ⑤ 铸卡 —— 与 Otto 路同一个纯铸卡器。读不到引擎开关状态就不许铸卡(与另外三个
      //    铸卡入口同一条规矩:空集合等于替 Founder 把开关打开)。
      const registry = await resolveDisabledModels();
      if ("error" in registry) return registry;

      const ctx: OttoContext = {
        orgId: ownerId,
        userId: ownerId,
        projectId: clip.projectId,
        threadId,
        // OttoContext 收数组、buildProposeCard 内部再建 Set —— 与 Otto 路同一个转换。
        disabledModels: [...registry.disabled],
        sourceGenerationId: undefined,
        // 这就是把整张卡钉在商家那条片子上的那一格 —— 与 Otto 路逐字同一个语义。
        referenceVideoGenerationId: validated,
        referenceVideoGenerationIds: [validated],
        // `turnText` 是 #775 的「第二个证人」:模型自选动作时才需要对表。这条路上动作
        // 是商家**自己按的那个键**,没有第二次转述可以对,所以不设 —— 设了反而是拿他打的
        // 那句话去推翻他按的那个键。
      };

      let built;
      try {
        built = buildProposeCard(
          {
            kind: "video",
            structuredPrompt,
            entityIds: [],
            variantSel: {},
            desiredAspect: undefined,
            desiredDuration: undefined,
            desiredAudio: undefined,
            count: 1,
            forVideo: undefined,
          },
          ctx,
          [],
        );
      } catch (e) {
        // `ProposeRefusal`(引擎被关掉 / 这一趟的形状撑不起这段提示词)带着一句给商家看的
        // 话。原样交回,一张卡都不落库。认的是**基类**,与 `executePropose` 同一条纪律 ——
        // 以后再加一种拒绝,这条入口不会漏接。别的异常照旧上抛:那是真故障,不该被翻译成
        // 一句给商家看的话。
        if (e instanceof ProposeRefusal) return { error: e.message };
        throw e;
      }

      // ⑥ 落库 —— 卡铸出来了才到这一步,而且会话与卡在同一个事务里(判官 r1 P2-2)。
      //    新会话只有在这里才第一次成为一行;事务里任何一步失败,它跟卡一起消失。
      const cardId = newId();
      await prisma.$transaction(async (tx) => {
        if (!existingThreadId) {
          // "Untitled" —— 与 `createEmptyCoworkThread` 同一份措辞(会话不是战役,#546)。
          await tx.chatThread.create({ data: { id: threadId, ownerId, projectId: clip.projectId, title: "Untitled" } });
        }
        const last = existingThreadId
          ? await tx.chatMessage.findFirst({
              where: { threadId, ownerId },
              orderBy: { seq: "desc" },
              select: { seq: true },
            })
          : null;
        await tx.chatMessage.create({
          data: {
            id: cardId,
            threadId,
            ownerId,
            role: "AGENT",
            kind: "GEN_CARD",
            seq: (last?.seq ?? 0) + 1,
            text: "",
            payload: built.cardPayload,
          },
        });
      });

      return {
        cardId,
        threadId,
        structuredPrompt: built.cardPayload.structuredPrompt,
        estimatedCredits: built.shownPriceDisplay,
        specChips: built.cardPayload.specChips,
        ...(built.cardPayload.downgradeNote ? { downgradeNote: built.cardPayload.downgradeNote } : {}),
      };
    } catch {
      return { error: "Couldn't set this up — please try again." };
    }
  });
}

/**
 * 这张卡能落进哪条**已经存在**的会话。全部 owner 作用域,**只读** —— 一行都不写。
 * 一条都找不到就回 null,由调用方决定要不要连同卡一起在事务里新开一条。
 */
async function findLiveClipCardThread(
  ownerId: string,
  projectId: string,
  bornInThreadId: string | null,
): Promise<string | null> {
  if (bornInThreadId) {
    const born = await prisma.chatThread.findFirst({
      where: { id: bornInThreadId, ownerId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (born) return born.id;
  }
  const recent = await prisma.chatThread.findFirst({
    where: { ownerId, projectId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return recent?.id ?? null;
}
