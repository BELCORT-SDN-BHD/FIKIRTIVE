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
import { EXECUTED_SPEC, imageAspectHonoured } from "./executed-spec.js";
import { imageOutputSize, VIDEO_ASPECT_ADAPTIVE } from "./gen.js";

/** 卡面规格取值的来源 —— 一张付费卡冻下来的那份 params。 */
export type SpecChipParams = {
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
  audio?: boolean;
  count: number;
};

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
  } else {
    // 图片：判据是**这一趟真正会跑的那个适配器**会不会兑现画幅(imageAspectHonoured),
    // 不是那个「现役适配器能不能」的静态标志 —— 选中不发规格的备用路时,卡面必须闭嘴
    // (判官 r1 P2)。兑现不了就按执行层实际会产出的默认(方图)报尺寸。
    const honoured = imageAspectHonoured();
    const { width, height } = imageOutputSize(honoured ? params.aspectRatio : undefined);
    chips.push(`${width} × ${height}`);
    if (honoured && params.aspectRatio) chips.push(params.aspectRatio);
    chips.push(params.count === 1 ? "1 image" : `${params.count} images`);
    // #619：商家挂的那张图现在真的随卡进引擎（付费请求带 sourceGenerationId），
    // 所以卡面必须在批准前说出来。这一条只在卡真的带着图时出现 —— 界面上出现的
    // 每一句都得是执行层真会做的事（#608）。
    if (usesAttachedImage) chips.push("Uses your attached image");
  }
  return chips;
}
