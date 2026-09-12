import { z } from "zod";
import { newId, MAX_GEN_ENTITIES } from "@fikirtive/core";

/** 一条分镜最多几个镜头（对齐遗留 CoworkPlan 每场 8 shot 的上限，防跑飞）。 */
export const MAX_STORYBOARD_SHOTS = 8;

/** 一个镜头：首帧 prompt（Seedream）+ 视频 prompt（Seedance），都由 D/E 的 skill 预先拼好（英文）。
 *  entityIds = 该镜头的 @引用实体 id（可选）——纯数据管道,F4 铸子卡时才透传到模型,此前无人消费。 */
export const storyboardShot = z.object({
  title: z.string().trim().max(120).optional(),
  /** FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 首帧合成对所有镜头都已退场,
   *  这一格永久可选、无人再读。字段留着只服务尚未清完的老写路径(与 web 侧
   *  `apps/web/lib/storyboard-actions.ts` 的同一条纪律),Otto 不必再写它。 */
  firstFramePrompt: z.string().trim().min(1).max(2000).optional(),
  videoPrompt: z.string().trim().min(1).max(2000),
  // 形状对齐花钱侧 coworkProposalSchema 的 entityIds(gen.ts)——F4 铸子卡时零转换透传。
  entityIds: z.array(z.string().min(1).max(64)).max(MAX_GEN_ENTITIES).optional(),
  // 该镜头视频时长(Otto 可按用户要求建议)——入库仅存数字,校验交给下游模型吸附(G 闸②)。
  // videoCardId/videoGenerationId 是服务端写字段,不进输入 schema(同 firstFrameCardId 规则)。
  durationSeconds: z.number().int().min(1).max(60).optional(),
});

/** Otto 调 proposeStoryboard 的输入。goal 是刨根问底资讯门（同 propose）。 */
export const storyboardCardInput = z.object({
  storyboardTitle: z.string().trim().min(1).max(120),
  goal: z.string().optional(),
  shots: z.array(storyboardShot).min(1).max(MAX_STORYBOARD_SHOTS),
  /** #782 接续模式:这条片子的镜头是不是**一镜接一镜**的同一段动作/同一个空间。
   *  true ⇒ 每个镜头的起点 = 上一个镜头**真实停住的那一帧**(引擎免费附送的末帧),
   *  而不是另外画一张首帧图。默认 false = 各镜头彼此独立(可并行、各画各的首帧)。 */
  continuity: z.boolean().optional(),
});
export type StoryboardCardInput = z.infer<typeof storyboardCardInput>;

// FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 「这一份输入里,哪几镜必须带首帧
// 文字却没带」判据闸(`shotsMissingFirstFramePrompt`)随闸①整段报废一并删除:首帧那一步
// 对所有镜头都已退场,没有「必须带首帧文字」这一档,没有替代覆盖(报废,不是迁移)。

/** 持久化进 STORYBOARD_CARD 的 payload —— 有序（每镜头带 index），首帧图 id 由 F4 写回。
 *  shotId = 服务端铸造的稳定镜头 id（index 每次编辑都重编，付费重出/异步写回按 shotId 定位）。
 *  entityIds = 该镜头的 @引用实体 id（可选，透传；F4 铸子卡时才送到模型）。 */
export type StoryboardCardPayload = {
  storyboardTitle: string;
  goal?: string;
  /** #782 接续模式(整条分镜一个开关,缺省 = false = 老行为)。
   *  开着时:只有第一个镜头需要生成首帧图;其后每个镜头的首帧由上一个镜头出片时
   *  引擎免费附送的**末帧**填上(闸③),所以镜头之间是真的接得上,而不是靠提示词暗示。 */
  continuity?: boolean;
  shots: {
    shotId: string;
    index: number;
    title?: string;
    /** FSE-208 —— 首帧合成已退场,这一格永久可选(老写路径兼容,见上方 storyboardShot)。 */
    firstFramePrompt?: string;
    videoPrompt: string;
    entityIds?: string[];
    /**
     * creation §5 :178 —— 这一镜挂上的 **Library 图**(`Generation.id`,商家 @ 选的现成图)。
     *
     * **服务端写字段**,与 `firstFrameCardId` 同一条纪律:不进 `storyboardShot` 输入 schema,
     * 所以模型永远不会自己编一个 id 出来 —— 它看得见图(input_image 部件),看不见 id。
     * 写它的只有两个执行器:人工卡面的 `setShotReferences`(商家 @ 选,服务端按 typed refs
     * 解析成 Generation id)与 Otto 的 `editStoryboard op:"setShotReferences"`(取这一轮
     * 服务端已校验的挂图)。两处都按 ownerId 解析,别家店的图根本变不成这里的一个 id。
     *
     * 存的是 `Generation.id` 而不是 wire 形状(`upload:<Asset.id>`):上传件的规范身份是
     * Asset,而真会上路的是摄取它的那一行 Generation —— 那一步映射只有读过行才做得到
     * (`resolveOwnedReferenceRefs`),所以在**写入那一刻**做完,下游一路不必再猜。
     * 名额与计价沿「直接出片」口径(`videoAttachedCap` / `referenceBudget`),铸卡时经
     * `ctx.sourceGenerationIds` 进 `cardPayload.referenceGenerationIds`,付费时落
     * `GenJob.videoOptions.referenceGenerationIds`。
     */
    referenceGenerationIds?: string[];
    /** 该镜头视频时长(用户在卡上选/Otto 建议)——入库仅存数字,校验交给下游模型吸附(G 闸②)。 */
    durationSeconds?: number;
    /** 该镜头"当前子 GEN_CARD"的 id(闸① 铸卡时写)——显式追踪;改文字/重出时替换或清空。 */
    firstFrameCardId?: string;
    firstFrameGenerationId?: string;
    /** 该镜头"当前视频子 GEN_CARD"的 id(闸② 铸卡时写,服务端字段)——同 firstFrameCardId 语义。 */
    videoCardId?: string;
    /** 视频生成完写回(闸②,服务端字段)——同 firstFrameGenerationId 语义。 */
    videoGenerationId?: string;
    /**
     * #782 r3 —— 闸③ 的判词(服务端字段,只有 sync 会写)。
     *
     * 值 = **上一镜的那一张视频子卡 id**,含义是「那条片子已经走完一生,交不出可用的末帧,
     * 这一镜再等下去也等不到免费的帧」。只有闸③ 看得见视频作业的真实状态,所以这条判断
     * 只能在那里做一次、记下来,而不是让卡面和动作层各自从指针形状去猜(r2b 猜错了两次:
     * 有 firstFrameCardId 不等于在生成,有旧 videoGenerationId 不等于交棒已经结束)。
     *
     * 点名子卡 id 是这条判词的自清机制:上一镜一旦重出(videoCardId 换成新的一张),旧判词
     * 自动不再匹配 —— 新片还在跑的窗口里,没有人会被请去为一张本该继承的帧多花钱。
     */
    inheritBlockedByVideoCardId?: string;
  }[];
};

/** 纯：输入 → 有序 payload（补 0-based index + 稳定 shotId）。无 DB、无 SDK。
 *  mintId = 可注入的 id 工厂（默认 newId，otto 已依赖 @fikirtive/core）——测试可传计数器求确定性。 */
export function buildStoryboardPayload(
  input: StoryboardCardInput,
  mintId: () => string = newId,
): StoryboardCardPayload {
  return {
    storyboardTitle: input.storyboardTitle,
    ...(input.goal ? { goal: input.goal } : {}),
    // 只有 true 才落键 —— false 与「没说」在读取端是同一件事(默认独立),多存一个
    // false 只会让老卡与新卡看起来不同,却没有任何行为差别。
    ...(input.continuity ? { continuity: true } : {}),
    shots: input.shots.map((s, index) => ({
      shotId: mintId(),
      index,
      ...(s.title ? { title: s.title } : {}),
      // creation §5 :172⑤ —— 没写就不落这一格(与 continuity 同一条「只在有内容时出现」的纪律)。
      ...(s.firstFramePrompt ? { firstFramePrompt: s.firstFramePrompt } : {}),
      videoPrompt: s.videoPrompt,
      ...(s.entityIds ? { entityIds: s.entityIds } : {}),
      ...(s.durationSeconds !== undefined ? { durationSeconds: s.durationSeconds } : {}),
    })),
  };
}
