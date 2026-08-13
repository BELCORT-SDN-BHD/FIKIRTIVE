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
  /** #782 r3 闸③ 判词:上一镜的哪一张视频子卡已经确定交不出末帧(见 shotsStuckWithoutInheritedFrame)。 */
  inheritBlockedByVideoCardId?: string;
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
 *
 * #782 r2b(判官 r1 P1 之一)—— 接续开着时,「等上一镜交棒」和「上一镜交过棒了、但交不出、
 * 永远不会再交」是两件不同的事,以前混成一句。后者(见 `shotsStuckWithoutInheritedFrame`)
 * 一样算「需要铸首帧」——不然供应商键猜错 / 旧 worker 没存末帧 / 下载失败,这一镜就卡进一个
 * 界面上连按钮都没有的死路:Generate all 数不到它、也没有单镜按钮。诚实的出路是让它和普通
 * 缺帧镜头一样,走「花钱铸一张自己的首帧」那条路——不再接上一镜的画面,但至少能往前走。
 * r3(判官 r2)只改了**怎么认定后者**:改读闸③ 的判词,不再从指针形状去猜。
 */
export function shotsNeedingMintedFirstFrame<
  T extends {
    index: number;
    firstFrameGenerationId?: string;
    videoCardId?: string;
    inheritBlockedByVideoCardId?: string;
  },
>(shots: readonly T[], continuity: boolean): T[] {
  const missing = [...shots].sort((a, b) => a.index - b.index).filter((s) => !s.firstFrameGenerationId);
  if (!continuity) return missing;
  const first = [...shots].sort((a, b) => a.index - b.index)[0];
  const eligible = first && !first.firstFrameGenerationId ? [first] : [];
  for (const shot of shotsStuckWithoutInheritedFrame(shots, continuity)) eligible.push(shot);
  return eligible.sort((a, b) => a.index - b.index);
}

/**
 * #782 r3(判官 r2 的两条 P1)—— 哪些镜头「卡死」了。
 *
 * 这条判据只回答一个问题:**这一镜还有没有免费的帧在路上?** 有 → 什么都别做(等着);
 * 没有 → 商家必须看得见一个自己出一张的入口,否则就是死路。
 *
 * r2b 用两个**指针存不存在**回答它,两处都答错了(判官 r2):
 *   • `firstFrameCardId` 在 ≠ 正在生成。准备卡在商家按 Cancel、启动失败、或刷新崩溃之后
 *     照样留在 payload 里 —— 一分钱没花,什么都没在跑。把它当在途,恢复入口就凭空消失。
 *   • `prev.videoGenerationId` 在 ≠ 交棒已经结束。重出视频换上新的 `videoCardId` 而**故意
 *     保留**旧的 `videoGenerationId`;新片还在跑,免费的末帧正在路上,却已经把这一镜开成
 *     付费首帧 —— 商家为一张本该继承的帧多花钱。
 *
 * 唯一看得见视频作业真实状态的是闸③(sync)。所以这条判断在那里做一次、写进 payload,
 * 这里只**读判词**:`inheritBlockedByVideoCardId` = 上一镜的那一张视频子卡已经走完一生、
 * 交不出可用的末帧。判词点名是哪一张子卡,于是上一镜一重出(`videoCardId` 换新),旧判词
 * 自动不再匹配 —— 新片在跑的窗口里,一分钱都不会被提前请出去。
 *
 * 不猜测、不设超时、不看首帧子卡指针:一张准备卡的存在从来不是「免费的帧在路上」的证据。
 */
export function shotsStuckWithoutInheritedFrame<
  T extends {
    index: number;
    firstFrameGenerationId?: string;
    videoCardId?: string;
    inheritBlockedByVideoCardId?: string;
  },
>(shots: readonly T[], continuity: boolean): T[] {
  if (!continuity) return [];
  const ordered = [...shots].sort((a, b) => a.index - b.index);
  const stuck: T[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const cur = ordered[i]!;
    if (cur.firstFrameGenerationId) continue; // 已经有帧(自己出的 / 接上的)→ 不是卡死
    const prev = ordered[i - 1]!;
    const verdict = cur.inheritBlockedByVideoCardId;
    // 判词必须点着上一镜**现在**这一张视频子卡才算数:点着别的(上一镜重出了)或无从匹配
    // (上一镜还没做视频)一律当「还在等」——宁可多等,不可多花。
    if (verdict && prev.videoCardId && verdict === prev.videoCardId) stuck.push(cur);
  }
  return stuck;
}

/**
 * #782 r4(判官 r3 P3)—— 这一镜的首帧到底有没有东西在跑。
 *
 * r3 的卡面把「有 firstFrameCardId、还没有图」当成「正在生成」。指针在 ≠ 有东西在跑:一张
 * 准备卡在商家按 Cancel、启动失败、或崩溃刷新之后照样留在 payload 里,一分钱没花、什么都
 * 没在跑。卡面于是转着 "Generating first frame…"、轮询白转到上限(约两分钟)才自己消失,
 * 而那一镜其实需要商家按一下 —— 一个转两分钟的假进度,比什么都不显示更伤。
 *
 * 真相只有服务端看得见,所以判据来自 sync 报回来的那份「真有活作业的镜头」
 * (`liveFrameShotIds`,与闸③ 判词同源)。
 *
 * `live === null` = 还没问过服务端(首屏那一瞬)。这时只能按指针答,和 r3 一样 —— 但那个
 * 误报最多活到第一次 sync 回来为止(挂载即发一次),不再是两分钟。反过来在这一瞬就藏起
 * spinner 更糟:刚按下确认、钱已经花出去的那一秒,卡面会显得什么都没发生。
 */
export function isFrameInProgress<
  T extends { shotId: string; firstFrameCardId?: string; firstFrameGenerationId?: string },
>(shot: T, liveFrameShotIds: ReadonlySet<string> | null): boolean {
  if (!shot.firstFrameCardId || shot.firstFrameGenerationId) return false;
  return liveFrameShotIds === null || liveFrameShotIds.has(shot.shotId);
}

/**
 * #782 r5(判官 r4 P1-②)—— 这一镜的片子到底还在不在路上。
 *
 * 视频那一侧一直停在「有 videoCardId、还没有 videoGenerationId = 生成中」。那答的是有没有
 * 指针,不是有没有东西在跑。片子第一次就失败时,商家看到的是一个永远转下去的
 * "Generating video…" —— 他因此永远不会去按那个真正能救他的按钮,而下一镜在接续链上会一直
 * 等着这一镜。「有入口」于是在实际使用里等于没有入口。
 *
 * 判据与首帧同源:sync 报回来的那份「哪些镜头的片子已经死了」(`deadVideoShotIds`)。
 * 这里取的是**否定**式(没被点名 = 还在路上),因为「死」是一件服务端能确证的事,而
 * 「活」在首屏那一瞬本来就无从确证 —— `dead === null`(还没问过服务端)因此照旧按指针答,
 * 与 `isFrameInProgress` 同一条规矩:刚花完钱的那一秒,卡面不该显得什么都没发生。
 */
export function isVideoInProgress<
  T extends { shotId: string; videoCardId?: string; videoGenerationId?: string },
>(shot: T, deadVideoShotIds: ReadonlySet<string> | null): boolean {
  if (!shot.videoCardId || shot.videoGenerationId) return false;
  return deadVideoShotIds === null || !deadVideoShotIds.has(shot.shotId);
}

/**
 * #782 r7(判官 r6 P1-B)—— 这一镜的片子**这一生结束了、什么都没交出来**。
 *
 * 与 `isVideoInProgress` 在「有子卡、还没有片子」这个域上严格互补:服务端答过话之后,
 * 两者恰有一个成立。分成两条命名规则,是因为卡面要拿它们做**两件不同的事** —— 一条决定
 * 转不转 spinner,另一条决定**给不给这一镜一个自己再来一次的入口**。
 *
 * r5 只做了前者:片子死了就停止转圈、并写一句「你没有被扣钱」。但那一镜的重出按钮当时挂在
 * `videoUrl` 上 —— 而一条死掉的片子从来不会有 url,所以按钮永远不渲染。商家于是只剩「Make
 * all videos」这一条整包的路:两镜一起报价,余额只够救那一镜时,整包确认是灰的。能力在
 * 代码里存在(regenShotVideoCard 只要求这一镜有首帧,死作业照样铸新卡),在界面上不可达。
 */
export function isVideoDead<
  T extends { shotId: string; videoCardId?: string; videoGenerationId?: string },
>(shot: T, deadVideoShotIds: ReadonlySet<string> | null): boolean {
  if (!shot.videoCardId || shot.videoGenerationId) return false;
  return deadVideoShotIds !== null && deadVideoShotIds.has(shot.shotId);
}

/** 卡面 sync 轮询的三个档位。"off" = 不再发问;"fast" = 刚花完钱、盯着结果;
 *  "slow" = 快轮的额度用完了,但服务端说还有活作业 —— 降频接着问。 */
export type SyncPhase = "off" | "fast" | "slow";

/**
 * #782 r7(判官 r6 P1-A)—— **「到顶」不等于「放弃」**。
 *
 * 判官钉出的时序:快轮 40×3s 打满之后卡面直接收工,而那一刻服务端可能还有一条活作业。
 * 挂载时那次 sync 是一次性的,Generate all 复用一张已花钱的子卡会得到空的待发起集合、
 * 同样不重启轮询 —— 于是「引擎晚一步交货」这件小事,变成「商家付了钱、产出躺在库里、
 * 卡面永远不显示」,只有重开页面才解得开。服务端的权威回退(firstGenerationIdOf 读作业行
 * 自己落的 generationIds)已经保证那笔产出**可达**;缺的只是再问一次的路径。
 *
 * 这条规则就是那条路径,三句话说完:
 *   • 服务端说没有活作业了 → 收工("off")。已终局的卡(帧落地 / 判死)一次都不轮询。
 *   • 本档还有额度 → 原速接着问。
 *   • 快轮到顶 → **降频再问**("slow"),不是放弃;慢轮也到顶才真的停。
 *
 * 慢轮同样有上限,所以不存在一个永远跑下去的定时器:整段观察窗是有界的,而窗口关掉之后
 * 商家任何一次交互(Generate all / 单镜重出)都会把它重新打开(见卡面 startPolling 的调用点)。
 */
export function nextSyncPhase(args: {
  phase: "fast" | "slow";
  triesUsed: number;
  maxTries: number;
  stillPending: boolean;
}): SyncPhase {
  if (!args.stillPending) return "off";
  if (args.triesUsed < args.maxTries) return args.phase;
  return args.phase === "fast" ? "slow" : "off";
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
        ...(typeof shot.inheritBlockedByVideoCardId === "string"
          ? { inheritBlockedByVideoCardId: shot.inheritBlockedByVideoCardId }
          : {}),
      };
    })
    .sort((a, b) => a.index - b.index);
  // 只有明写 true 才算开(老卡没有这个键 = 关 = 老行为,逐字节同形)。
  return { storyboardTitle, continuity: p.continuity === true, shots };
}
