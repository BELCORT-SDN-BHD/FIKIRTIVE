import { z } from "zod";
import { newId, MAX_GEN_ENTITIES } from "@fikirtive/core";

/** 一条分镜最多几个镜头（对齐遗留 CoworkPlan 每场 8 shot 的上限，防跑飞）。 */
export const MAX_STORYBOARD_SHOTS = 8;

/** 一个镜头：首帧 prompt（Seedream）+ 视频 prompt（Seedance），都由 D/E 的 skill 预先拼好（英文）。
 *  entityIds = 该镜头的 @引用实体 id（可选）——纯数据管道,F4 铸子卡时才透传到模型,此前无人消费。 */
export const storyboardShot = z.object({
  title: z.string().trim().max(120).optional(),
  firstFramePrompt: z.string().trim().min(1).max(2000),
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
    firstFramePrompt: string;
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
      firstFramePrompt: s.firstFramePrompt,
      videoPrompt: s.videoPrompt,
      ...(s.entityIds ? { entityIds: s.entityIds } : {}),
      ...(s.durationSeconds !== undefined ? { durationSeconds: s.durationSeconds } : {}),
    })),
  };
}
