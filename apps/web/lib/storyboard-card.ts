/**
 * storyboard-card — PURE 渲染侧解析:把 DB 存的 STORYBOARD_CARD payload(unknown)
 * 防御式映射成视图模型。无 React / 无 I/O,可在 node 测试跑(对齐 pack-credit-math)。
 * 编辑(F3)/ 首帧图(F4)按 index 定位镜头,故这里稳定按 index 排序。
 */
import type { StoryboardCardPayload } from "@fikirtive/otto";

/** 镜头数上限（client-safe 常量）。权威值在 @fikirtive/otto 的
 *  MAX_STORYBOARD_SHOTS；此处保留一份纯值副本，好让 "use client" 的
 *  StoryboardCard 引用它而不必把 otto barrel（→ skills → prisma → pg）
 *  拖进浏览器 bundle。node 侧测试(storyboard-card.test.ts)断言二者相等,漂移不可能。 */
export const MAX_STORYBOARD_SHOTS = 8;

export interface StoryboardShotView {
  shotId: string;
  index: number;
  title?: string;
  firstFramePrompt: string;
  videoPrompt: string;
  entityIds?: string[];
  durationSeconds?: number;
  firstFrameCardId?: string;
  firstFrameGenerationId?: string;
  videoCardId?: string;
  videoGenerationId?: string;
}

export interface StoryboardCardView {
  storyboardTitle: string;
  /** #782 接续模式:镜头一镜接一镜(下一镜从上一镜真实停住的那一帧起步)。 */
  continuity: boolean;
  shots: StoryboardShotView[];
}

/**
 * #782 —— 闸① 到底会为**哪些**镜头铸(要花钱的)首帧图子卡。**唯一权威**,服务端动作层与
 * 卡面同读这一条,所以「卡上说要出几张」和「服务端真的会出几张」不可能分家。
 *
 * 接续关(老行为):每个还没有首帧图的镜头各出一张。
 * 接续开:**只有第一个镜头**要出图。其后每个镜头的首帧 = 上一个镜头出片时引擎免费附送的
 * 末帧(闸③ 写回),所以那些镜头一分钱都不该花在首帧上 —— 真替商家省下的钱,不是话术。
 * 商家想给中间某个镜头换一张自己的首帧:走那个镜头自己的重出按钮(per-shot regen),
 * 那是显式动作,不受这条规则影响 —— 能力一格没少。
 *
 * 泛型 + 按 index 排序:服务端拿 payload 的镜头、卡面拿视图镜头,两边形状不同但语义同一条。
 */
export function shotsNeedingMintedFirstFrame<
  T extends { index: number; firstFrameGenerationId?: string },
>(shots: readonly T[], continuity: boolean): T[] {
  const missing = [...shots].sort((a, b) => a.index - b.index).filter((s) => !s.firstFrameGenerationId);
  if (!continuity) return missing;
  const first = [...shots].sort((a, b) => a.index - b.index)[0];
  return first && !first.firstFrameGenerationId ? [first] : [];
}

type RawShot = Partial<StoryboardCardPayload["shots"][number]>;

export function parseStoryboardCardPayload(payload: unknown): StoryboardCardView {
  const p = (payload ?? {}) as Partial<StoryboardCardPayload>;
  const storyboardTitle = typeof p.storyboardTitle === "string" ? p.storyboardTitle : "";
  const rawShots = Array.isArray(p.shots) ? p.shots : [];
  const shots = rawShots
    .map((s, i): StoryboardShotView => {
      const shot = (s ?? {}) as RawShot;
      const index = typeof shot.index === "number" ? shot.index : i;
      return {
        // 遗留 payload 可能没 shotId → 回落到 String(index),渲染/key 仍稳定。
        shotId: typeof shot.shotId === "string" && shot.shotId ? shot.shotId : String(index),
        index,
        ...(typeof shot.title === "string" && shot.title ? { title: shot.title } : {}),
        firstFramePrompt: typeof shot.firstFramePrompt === "string" ? shot.firstFramePrompt : "",
        videoPrompt: typeof shot.videoPrompt === "string" ? shot.videoPrompt : "",
        ...(Array.isArray(shot.entityIds) && shot.entityIds.every((e) => typeof e === "string")
          ? { entityIds: shot.entityIds as string[] }
          : {}),
        ...(typeof shot.durationSeconds === "number"
          ? { durationSeconds: shot.durationSeconds }
          : {}),
        ...(typeof shot.firstFrameCardId === "string"
          ? { firstFrameCardId: shot.firstFrameCardId }
          : {}),
        ...(typeof shot.firstFrameGenerationId === "string"
          ? { firstFrameGenerationId: shot.firstFrameGenerationId }
          : {}),
        ...(typeof shot.videoCardId === "string"
          ? { videoCardId: shot.videoCardId }
          : {}),
        ...(typeof shot.videoGenerationId === "string"
          ? { videoGenerationId: shot.videoGenerationId }
          : {}),
      };
    })
    .sort((a, b) => a.index - b.index);
  // 只有明写 true 才算开(老卡没有这个键 = 关 = 老行为,逐字节同形)。
  return { storyboardTitle, continuity: p.continuity === true, shots };
}
