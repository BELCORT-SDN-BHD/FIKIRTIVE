/**
 * spec-chips —— 一张付费卡上「这一趟真会做成什么样」的那几个词。
 *
 * 它住在 `@fikirtive/core`,理由与旁边的 `EXECUTED_SPEC` 一模一样:**读者不止一个**。
 *   - Otto 的细节卡(`@fikirtive/otto` 的 propose 卡面,#580/#572);
 *   - 战役确认卡(`apps/web` 的 campaign confirm,#709)。
 *
 * #709 之前这份规矩只长在 Otto 那一侧,于是两条付费路的诚实度分家:Otto 卡上写着
 * 「5s · 720p」,战役卡上一个规格字段都没有 —— 商家看着 11 credits,却没有一个字
 * 解释这 11 买的是哪一档。规格文案抄成两份,就一定会有一份先烂掉。
 *
 * 纯函数:不选型、不报价、不预扣、不发请求。每一条都只可能来自 `EXECUTED_SPEC` 认定
 * 执行层真会采纳的控制项,且结构上不可能带出引擎名(只读 params,从不读 model/reason)。
 */
import {
  EXECUTED_SPEC, imageAspectHonoured, imageCoherentSetHonoured, videoElementReferencesHonoured,
  videoStartFrameHonoured,
} from "./executed-spec.js";
import { imageOutputSize, VIDEO_ASPECT_ADAPTIVE } from "./gen.js";

/** 卡面规格取值的来源 —— 一张付费卡冻下来的那份 params。 */
export type SpecChipParams = {
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
  audio?: boolean;
  count: number;
  /** #777:这几张是**一组要连贯的图**(一次出齐,角色与风格连续)。图片专用。 */
  coherentSet?: boolean;
};

/** #785 视频卡的一条附加事实:这一趟引擎真会收到几张 @元素参考照。
 *  数字只可能来自 `referenceBudget(...).used` —— 卡面不自己数。 */
export type VideoReferenceChipInput = {
  elementReferenceCount: number;
  /** #979:这张卡带着一张**首帧**(商家挂的那张图会成为片子的第一帧)。
   *  只可能来自卡自己的 `sourceGenerationId` —— 卡面不自己推。 */
  hasStartFrame?: boolean;
};

/** #979 —— 「你的图会成为第一帧」那一格。措辞住在这里,因为卡面与测试必须钉同一份。 */
export const VIDEO_START_FRAME_CHIP = "Starts from your image";

/**
 * 片子形状那一格的卡面说法(#645 T4)。
 *
 * `adaptive` **不是一个具体形状** —— 引擎会跟着首帧自己挑。所以卡面绝不能把它印成
 * 「16:9」之类的具体值(那就是卡面承诺了一件引擎没答应的事),也不该印生硬的 "adaptive"。
 * 它的真实含义正好就是「和你给的图同一个形状」,于是就这么说。
 */
export function videoAspectChip(aspectRatio: string | undefined, hasSourceImage: boolean): string {
  if (aspectRatio === VIDEO_ASPECT_ADAPTIVE) {
    return hasSourceImage ? "Same shape as your reference" : "Shape picked to fit";
  }
  return aspectRatio ?? (hasSourceImage ? "Same shape as your reference" : "Default shape");
}

/**
 * 卡面规格条目（脱敏）。与 `reason` 同事实，但只从 `params` 取值，
 * 因此结构上不可能带出引擎名；并且只输出 `EXECUTED_SPEC` 认定执行层真会采纳的控制项，
 * 因此不可能承诺一件执行层做不到的事。这是卡面规格的**唯一一次**派生。
 */
export function buildSpecChips(
  kind: "image" | "video",
  params: SpecChipParams,
  hasSourceImage: boolean,
  usesAttachedImage = false,
  video?: VideoReferenceChipInput,
): string[] {
  const chips: string[] = [];
  if (kind === "video") {
    if (EXECUTED_SPEC.video.aspectHonoured) {
      chips.push(videoAspectChip(params.aspectRatio, hasSourceImage));
    }
    if (EXECUTED_SPEC.video.durationHonoured && typeof params.durationSeconds === "number") {
      chips.push(`${params.durationSeconds}s`);
    }
    if (EXECUTED_SPEC.video.resolutionHonoured && params.resolution) chips.push(params.resolution);
    // 声音：#646 T5 接通后这一条照实出现。判据仍然只有 EXECUTED_SPEC 一处 —— 哪天执行层
    // 又断了，改那一处，卡面立刻停止承诺。
    if (EXECUTED_SPEC.video.audioHonoured) chips.push(params.audio ? "With sound" : "No sound");
    // #979:首帧那一档,卡面必须先说**真会用上的那张图**。少了这一格,卡上关于图片的
    // 唯一一句话就是「你那 N 张一张都不会用上」——字面为真,读起来却是「我们什么图都没用」,
    // 而对话里 Otto 同时(同样为真地)说刚做好的那张会当首帧。同一次生成、两句相反的话
    // (beta 录像 06:32 / 10:24)。判据与别的格子同一个形状:真正会跑的那个适配器收不收首帧。
    if (videoStartFrameHonoured() && video?.hasStartFrame === true) chips.push(VIDEO_START_FRAME_CHIP);
    // #785：@元素的参考照现在真的进视频引擎，所以卡面在批准前就说出来 —— 与图片侧
    // 「Uses your attached image」(#619) 同一条规矩：界面上出现的每一句都得是执行层真会
    // 做的事。数字不在这里算(来自 `referenceBudget(...).used`)，为 0 时一个字都不说。
    // 判据是**这一趟真正会跑的那个适配器**收不收元素照(`videoElementReferencesHonoured`),
    // 不是那个「现役适配器能不能」的静态标志(判官 r1 P1)。与图片画幅那一条
    // (`imageAspectHonoured`)同一个形状,而且与选片名额读的是同一个函数。
    const refCount = video?.elementReferenceCount ?? 0;
    if (videoElementReferencesHonoured() && refCount > 0) {
      chips.push(refCount === 1 ? "Uses 1 of your reference photos" : `Uses ${refCount} of your reference photos`);
    }
  } else {
    // 图片：判据是**这一趟真正会跑的那个适配器**会不会兑现画幅(imageAspectHonoured),
    // 不是那个「现役适配器能不能」的静态标志 —— 选中不发规格的备用路时,卡面必须闭嘴
    // (判官 r1 P2)。兑现不了就按执行层实际会产出的默认(方图)报尺寸。
    const honoured = imageAspectHonoured();
    const { width, height } = imageOutputSize(honoured ? params.aspectRatio : undefined);
    chips.push(`${width} × ${height}`);
    if (honoured && params.aspectRatio) chips.push(params.aspectRatio);
    // #777:一组连贯的图和 N 张散图是**两样东西**,卡面必须分得出来 —— 商家批的是
    // 「同一个模特的四个角度」,交一堆互不相干的图就是没交付。判据同样只有一处:
    // 真正会跑的那个适配器兑现不了组图,卡面立刻停止承诺,退回说「4 images」。
    const setHonoured = params.coherentSet === true && params.count > 1 && imageCoherentSetHonoured();
    chips.push(
      params.count === 1
        ? "1 image"
        : setHonoured
          ? `${params.count} images in one set`
          : `${params.count} images`,
    );
    // #619：商家挂的那张图现在真的随卡进引擎（付费请求带 sourceGenerationId），
    // 所以卡面必须在批准前说出来。这一条只在卡真的带着图时出现 —— 界面上出现的
    // 每一句都得是执行层真会做的事（#608）。
    if (usesAttachedImage) chips.push("Uses your attached image");
  }
  return chips;
}
