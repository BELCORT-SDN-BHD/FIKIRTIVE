/**
 * storyboard-card — PURE 渲染侧解析:把 DB 存的 STORYBOARD_CARD payload(unknown)
 * 防御式映射成视图模型。无 React / 无 I/O,可在 node 测试跑(对齐 pack-credit-math)。
 * 编辑(F3)/ 首帧图(F4)按 index 定位镜头,故这里稳定按 index 排序。
 */
import type { StoryboardCardPayload } from "@fikirtive/otto";

export interface StoryboardShotView {
  index: number;
  title?: string;
  firstFramePrompt: string;
  videoPrompt: string;
  firstFrameGenerationId?: string;
}

export interface StoryboardCardView {
  storyboardTitle: string;
  shots: StoryboardShotView[];
}

type RawShot = Partial<StoryboardCardPayload["shots"][number]>;

export function parseStoryboardCardPayload(payload: unknown): StoryboardCardView {
  const p = (payload ?? {}) as Partial<StoryboardCardPayload>;
  const storyboardTitle = typeof p.storyboardTitle === "string" ? p.storyboardTitle : "";
  const rawShots = Array.isArray(p.shots) ? p.shots : [];
  const shots = rawShots
    .map((s, i): StoryboardShotView => {
      const shot = (s ?? {}) as RawShot;
      return {
        index: typeof shot.index === "number" ? shot.index : i,
        ...(typeof shot.title === "string" && shot.title ? { title: shot.title } : {}),
        firstFramePrompt: typeof shot.firstFramePrompt === "string" ? shot.firstFramePrompt : "",
        videoPrompt: typeof shot.videoPrompt === "string" ? shot.videoPrompt : "",
        ...(typeof shot.firstFrameGenerationId === "string"
          ? { firstFrameGenerationId: shot.firstFrameGenerationId }
          : {}),
      };
    })
    .sort((a, b) => a.index - b.index);
  return { storyboardTitle, shots };
}
