/**
 * storyboard-edit — PURE 编辑变换:一个 StoryboardCardPayload → 新 payload。
 * 不 mutate 入参;重排镜头后一律重编 0-based index(同 buildStoryboardPayload)。
 * editShotPrompt 的陈旧级联(G 闸②):视频以首帧为源,故
 *   - 改 firstFramePrompt → 帧过期 ⇒ 视频过期:清帧两键 + 视频两键;
 *   - 只改 videoPrompt / durationSeconds → 只清视频两键,已付费的首帧图两键保留。
 * 无 React / 无 DB / 无 I/O —— 边界策略(镜头数上限/下限)在动作层,不在这里。
 *
 * [W-B3-C] 原址 apps/web/lib/storyboard-edit.ts;迁入 otto 包作**双执行器共同权威**:
 * 人工 server action(storyboard-actions)与 Otto skill(editStoryboard)共用同一套
 * 编辑语义(含 G 闸②级联),web 侧原路径保留 re-export 垫片,导入方零改动。
 */
import type { StoryboardCardPayload } from "./skills/propose-storyboard.helpers.js";

type Shot = StoryboardCardPayload["shots"][number];

export interface ShotPromptPatch {
  firstFramePrompt?: string;
  videoPrompt?: string;
  durationSeconds?: number;
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

/** 改某镜头文字/时长 + 陈旧级联(视频以首帧为源)。越界 index → 原样返回。
 *  G 闸② 对 F3 无条件删帧行为的语义修正:改帧文字才作废首帧图;改视频文字/时长只作废视频。
 *  一律解构剔除键(不设 undefined),不 mutate 入参。 */
export function applyEditShotPrompt(
  payload: StoryboardCardPayload,
  index: number,
  patch: ShotPromptPatch,
): StoryboardCardPayload {
  if (index < 0 || index >= payload.shots.length) return payload;
  const frameStale = patch.firstFramePrompt !== undefined; // 帧过期 ⇒ 视频过期
  const shots = payload.shots.map((s, i) => {
    if (i !== index) return s;
    // 视频两键始终作废(改帧/改视频文字/改时长都令旧视频过期)。
    // 帧两键仅在 frameStale 时作废——editing video text/duration must not invalidate the paid frame.
    const noVideo = { ...s };
    delete noVideo.videoCardId;
    delete noVideo.videoGenerationId;
    const noFrame = { ...noVideo };
    delete noFrame.firstFrameCardId;
    delete noFrame.firstFrameGenerationId;
    const rest = frameStale ? noFrame : noVideo;
    return {
      ...rest,
      ...(patch.firstFramePrompt !== undefined ? { firstFramePrompt: patch.firstFramePrompt } : {}),
      ...(patch.videoPrompt !== undefined ? { videoPrompt: patch.videoPrompt } : {}),
      ...(patch.durationSeconds !== undefined ? { durationSeconds: patch.durationSeconds } : {}),
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
  // 合法排列已验(上方 valid),index 必命中 —— otto 包 noUncheckedIndexedAccess 下需显式断言。
  return { ...payload, shots: restamp(order.map((i) => payload.shots[i]!)) };
}
