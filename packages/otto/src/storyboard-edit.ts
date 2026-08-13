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

/** 这次编辑**真的作废了什么**。 */
export interface EditStaleness {
  /** 首帧文字真的变了 → 已生成的首帧图过期。 */
  frame: boolean;
  /** 帧过期,或视频文字/时长真的变了 → 已生成的片子过期。 */
  video: boolean;
}

/**
 * #782 r17(判官 r16 P1-1)—— 判的是「**变了没有**」,不是「传了没有」。
 *
 * 判官钉出的形状:真实 UI(StoryboardCard.saveEdit)保存时把两句 prompt **无条件同发**,
 * 而 startEdit 把当前首帧文字原样装进草稿。所以「商家只改了视频文字」这件事,到服务端长成
 * 「firstFramePrompt 也在 patch 里」——旧写法 `patch.firstFramePrompt !== undefined` 于是把
 * 它读成「帧文字改了」,把一张**已付费已消费**的首帧两键一起删掉。那张图从此对这一镜不可达,
 * prepare 见「这一镜没有首帧」就铸一张新的可扣费子卡 = 新的 `cowork:` 幂等域 = 可以再收一次钱。
 *
 * 客户端爱发什么发什么;「改没改」只能由服务端拿**父卡当前值**自己比。这个函数就是那个比较,
 * 而且是**唯一**的那个:陈旧级联(下面的 applyEditShotPrompt)与在途闸
 * (storyboard-child-job.ts 的 inFlightPointerBlock)读的是同一份答案,不可能各判各的。
 *
 * 同一条规矩顺带治了视频那一格的同族问题:视频两键过去是「任何一次编辑都删」,于是一次原样
 * 保存也会作废一条已付费的片子。现在它同样只在**真的**有东西变了时才过期。
 */
export function editStaleness(
  shot: Pick<Shot, "firstFramePrompt" | "videoPrompt" | "durationSeconds">,
  patch: ShotPromptPatch,
): EditStaleness {
  const frame = patch.firstFramePrompt !== undefined && patch.firstFramePrompt !== shot.firstFramePrompt;
  const videoText = patch.videoPrompt !== undefined && patch.videoPrompt !== shot.videoPrompt;
  const duration = patch.durationSeconds !== undefined && patch.durationSeconds !== shot.durationSeconds;
  return { frame, video: frame || videoText || duration }; // 帧过期 ⇒ 视频过期(视频以首帧为源)
}

/** 改某镜头文字/时长 + 陈旧级联(视频以首帧为源)。越界 index → 原样返回。
 *  G 闸② 对 F3 无条件删帧行为的语义修正:改帧文字才作废首帧图;改视频文字/时长只作废视频。
 *  #782 r17:「改」= 与父卡现值真的不同(见 editStaleness),不是「patch 里有这个键」。
 *  一律解构剔除键(不设 undefined),不 mutate 入参。 */
export function applyEditShotPrompt(
  payload: StoryboardCardPayload,
  index: number,
  patch: ShotPromptPatch,
): StoryboardCardPayload {
  if (index < 0 || index >= payload.shots.length) return payload;
  const stale = editStaleness(payload.shots[index]!, patch);
  const shots = payload.shots.map((s, i) => {
    if (i !== index) return s;
    const rest = { ...s };
    if (stale.video) {
      delete rest.videoCardId;
      delete rest.videoGenerationId;
    }
    if (stale.frame) {
      delete rest.firstFrameCardId;
      delete rest.firstFrameGenerationId;
    }
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

/**
 * #782 接续开关(整条分镜一个)。开 = 每个镜头从上一个镜头真实停住的那一帧起步。
 *
 * **只改这一个键,一件已生成的东西都不动**。这一条是刻意的:接续影响的是「下一个镜头的
 * 首帧从哪来」,而关掉它并不会让任何**已经存在**的帧或片子变得不对 —— 那些帧本来就是这条
 * 片子真实走过的样子。所以这里没有陈旧级联;商家想换掉某一帧,走的是那一帧自己的重出路径
 * (闸① 的 per-shot regen),而不是被一个开关连坐清掉付过钱的东西。
 */
export function applySetContinuity(
  payload: StoryboardCardPayload,
  on: boolean,
): StoryboardCardPayload {
  if (on) return { ...payload, continuity: true };
  const rest = { ...payload };
  delete rest.continuity; // 关 = 不落键(与「从没开过」逐字节同形)
  return rest;
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
