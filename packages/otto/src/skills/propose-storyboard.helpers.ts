import { z } from "zod";
import { newId } from "@fikirtive/core";

/** 一条分镜最多几个镜头（对齐遗留 CoworkPlan 每场 8 shot 的上限，防跑飞）。 */
export const MAX_STORYBOARD_SHOTS = 8;

/** 一个镜头：首帧 prompt（Seedream）+ 视频 prompt（Seedance），都由 D/E 的 skill 预先拼好（英文）。
 *  entityIds = 该镜头的 @引用实体 id（可选）——纯数据管道,F4 铸子卡时才透传到模型,此前无人消费。 */
export const storyboardShot = z.object({
  title: z.string().trim().max(120).optional(),
  firstFramePrompt: z.string().trim().min(1).max(2000),
  videoPrompt: z.string().trim().min(1).max(2000),
  entityIds: z.array(z.string()).max(MAX_STORYBOARD_SHOTS).optional(),
});

/** Otto 调 proposeStoryboard 的输入。goal 是刨根问底资讯门（同 propose）。 */
export const storyboardCardInput = z.object({
  storyboardTitle: z.string().trim().min(1).max(120),
  goal: z.string().optional(),
  shots: z.array(storyboardShot).min(1).max(MAX_STORYBOARD_SHOTS),
});
export type StoryboardCardInput = z.infer<typeof storyboardCardInput>;

/** 持久化进 STORYBOARD_CARD 的 payload —— 有序（每镜头带 index），首帧图 id 由 F4 写回。
 *  shotId = 服务端铸造的稳定镜头 id（index 每次编辑都重编，付费重出/异步写回按 shotId 定位）。
 *  entityIds = 该镜头的 @引用实体 id（可选，透传；F4 铸子卡时才送到模型）。 */
export type StoryboardCardPayload = {
  storyboardTitle: string;
  goal?: string;
  shots: {
    shotId: string;
    index: number;
    title?: string;
    firstFramePrompt: string;
    videoPrompt: string;
    entityIds?: string[];
    firstFrameGenerationId?: string;
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
    shots: input.shots.map((s, index) => ({
      shotId: mintId(),
      index,
      ...(s.title ? { title: s.title } : {}),
      firstFramePrompt: s.firstFramePrompt,
      videoPrompt: s.videoPrompt,
      ...(s.entityIds ? { entityIds: s.entityIds } : {}),
    })),
  };
}
