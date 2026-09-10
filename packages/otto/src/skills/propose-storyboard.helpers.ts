import { z } from "zod";
import { newId, MAX_GEN_ENTITIES } from "@fikirtive/core";

/** 一条分镜最多几个镜头（对齐遗留 CoworkPlan 每场 8 shot 的上限，防跑飞）。 */
export const MAX_STORYBOARD_SHOTS = 8;

/** 一个镜头：首帧 prompt（Seedream）+ 视频 prompt（Seedance），都由 D/E 的 skill 预先拼好（英文）。
 *  entityIds = 该镜头的 @引用实体 id（可选）——纯数据管道,F4 铸子卡时才透传到模型,此前无人消费。 */
export const storyboardShot = z.object({
  title: z.string().trim().max(120).optional(),
  /**
   * creation §5 :172⑤ —— **按镜头类型条件可选**。
   *
   * 免写这一段的只有**@ 到演员(CHARACTER)的镜头**:它走「演员参考照 + 商品照直接出片」
   * 那一条,首帧那一步整个不存在,所以从前那段必填文字既不出现在任何请求里也没有人读 ——
   * 一段谁都不用的必填文字只会让模型多编一次。
   *
   * 其余全部镜头**逐字不变**(不带 @元素的,以及**只 @ 了商品**的):两步(首帧 → 视频)
   * 还是那两步,所以这一段仍然必填。判据必须与「直接出片」那一条同一句话(`shotsDirectToVideo`
   * 判的是有没有演员)—— 分了家,就会有一种既不直接出片、又没有首帧文字的镜头合法落库,
   * 而它在闸① 会把**整张卡**的首帧一起拒掉。演员这件事要读 `Entity.type`,schema 看不见,
   * 所以这道闸住在 `executeProposeStoryboard`($0、落库之前),判词由下面那个纯函数给。
   */
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

/**
 * creation §5 :172⑤ —— 这一份输入里,哪几镜**必须**带首帧文字却没带(0 基序号)。
 *
 * 判据只有一句,与卡面/铸卡侧的 `shotsDirectToVideo`(apps/web/lib/storyboard-card.ts)
 * **逐字同一条**:@ 到至少一个演员(CHARACTER)⇒ 直接出片 ⇒ 首帧那一步不存在 ⇒ 不必写。
 * 其余全部镜头(不带 @元素的、以及只 @ 了商品的特写镜)都是两步,第一步要有稿子。
 *
 * 为什么不能像先前那样按「有没有 @元素」判:那放行的类别严格大于登记的类别 —— 只 @ 了
 * 商品的镜头会被判**不**直接出片,却又没有首帧文字,于是闸① 走到 `firstFramePromptOf`
 * 抛拒绝,**整张卡**(含其余全部镜头)的首帧一并铸不出来。
 *
 * 纯函数、无 DB:演员那一份集合由调用方按 ownerId 读出来(跨租户 id 根本进不了集合,
 * 因此在这里数出 0 —— 那一镜照旧要首帧文字)。
 */
export function shotsMissingFirstFramePrompt<
  T extends { firstFramePrompt?: string; entityIds?: string[] },
>(shots: readonly T[], castEntityIds: ReadonlySet<string>): number[] {
  return shots.flatMap((shot, i) =>
    !shot.firstFramePrompt?.trim() && !(shot.entityIds ?? []).some((id) => castEntityIds.has(id))
      ? [i]
      : [],
  );
}

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
    /** creation §5 :172⑤ —— @ 到演员的镜头可以没有这一格(它不出首帧);其余镜头一定有。 */
    firstFramePrompt?: string;
    videoPrompt: string;
    entityIds?: string[];
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
