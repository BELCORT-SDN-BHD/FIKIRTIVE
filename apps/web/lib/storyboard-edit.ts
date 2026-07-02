/**
 * storyboard-edit — PURE 编辑变换:一个 StoryboardCardPayload → 新 payload。
 * 不 mutate 入参;重排镜头后一律重编 0-based index(同 buildStoryboardPayload)。
 * editShotPrompt 额外清掉被改镜头的 firstFrameGenerationId(旧首帧图作废,F4 重出)。
 * 无 React / 无 DB / 无 I/O —— 边界策略(镜头数上限/下限)在动作层,不在这里。
 */
import type { StoryboardCardPayload } from "@fikirtive/otto";

type Shot = StoryboardCardPayload["shots"][number];

export interface ShotPromptPatch {
  firstFramePrompt?: string;
  videoPrompt?: string;
}

export interface NewShotInput {
  /** 稳定镜头 id —— ACTION 层铸造(纯层保持确定性,不自己 mint)。 */
  shotId: string;
  title?: string;
  firstFramePrompt: string;
  videoPrompt: string;
}

/** 重编 0-based index(不 mutate 入参数组元素)。 */
function restamp(shots: Shot[]): Shot[] {
  return shots.map((s, index) => ({ ...s, index }));
}

/** 改某镜头文字 + 清其 firstFrameGenerationId。越界 index → 原样返回。 */
export function applyEditShotPrompt(
  payload: StoryboardCardPayload,
  index: number,
  patch: ShotPromptPatch,
): StoryboardCardPayload {
  if (index < 0 || index >= payload.shots.length) return payload;
  const shots = payload.shots.map((s, i) => {
    if (i !== index) return s;
    // 丢弃 firstFrameGenerationId + firstFrameCardId:解构剔除该键,不是设成 undefined。
    const { firstFrameGenerationId: _drop, firstFrameCardId: _drop2, ...rest } = s;
    return {
      ...rest,
      ...(patch.firstFramePrompt !== undefined ? { firstFramePrompt: patch.firstFramePrompt } : {}),
      ...(patch.videoPrompt !== undefined ? { videoPrompt: patch.videoPrompt } : {}),
    };
  });
  return { ...payload, shots: restamp(shots) };
}

/** 末尾追加一个镜头(无首帧图)+ 重编 index。 */
export function applyAddShot(
  payload: StoryboardCardPayload,
  shot: NewShotInput,
): StoryboardCardPayload {
  const added: Shot = {
    shotId: shot.shotId,
    index: payload.shots.length,
    ...(shot.title ? { title: shot.title } : {}),
    firstFramePrompt: shot.firstFramePrompt,
    videoPrompt: shot.videoPrompt,
  };
  return { ...payload, shots: restamp([...payload.shots, added]) };
}

/** 删某镜头 + 重编 index。越界 index → 原样返回。 */
export function applyDeleteShot(
  payload: StoryboardCardPayload,
  index: number,
): StoryboardCardPayload {
  if (index < 0 || index >= payload.shots.length) return payload;
  return { ...payload, shots: restamp(payload.shots.filter((_, i) => i !== index)) };
}

/** 按 order(当前 index 的一个排列)重排 + 重编 index。
 *  order 不是 [0..n-1] 的合法排列(缺项/越界/重复)→ 原样返回。 */
export function applyReorderShots(
  payload: StoryboardCardPayload,
  order: number[],
): StoryboardCardPayload {
  const n = payload.shots.length;
  const valid =
    order.length === n &&
    new Set(order).size === n &&
    order.every((i) => Number.isInteger(i) && i >= 0 && i < n);
  if (!valid) return payload;
  return { ...payload, shots: restamp(order.map((i) => payload.shots[i])) };
}
