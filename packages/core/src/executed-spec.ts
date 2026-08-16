/**
 * EXECUTED_SPEC —— 执行层**真正会做的事**,写成数据。
 *
 * 根因(#580 复审 r1 P1-2):卡面「说的」不是从执行「做的」同一数据源来的,于是商家会按
 * 一份执行层根本不会采纳的规格确认并付费。这里把执行层的实际行为逐条写成数据;卡面文案
 * (`buildSpecChips` / `buildDowngradeNote`)只读这份数据,谁都不再自己猜。
 *
 * 它住在 `@fikirtive/core` 而不是 otto 里,是因为它有**两个**读者,而两边都必须钉在同一
 * 份声明上(#580 复审 r2 P2):
 *   - `@fikirtive/otto` 的 propose 卡面文案 —— 「说的」;
 *   - `@fikirtive/generation` 的现役图像适配器测试 —— 「做的」。那条测试 stub 掉 fetch、
 *     调真适配器、把它真正发出去的 JSON 整体断言一遍,并逐字比对这里的数字。
 *     适配器哪天改了尺寸或接上了声音,那条测试立刻红,逼着这里一起改 —— 卡面于是自动开始
 *     说新话,而不是继续说旧话。
 *
 * 纯声明:不参与选型、报价、预扣或任何 provider 调用。
 *
 * 真相位置:
 *   - 现役图像适配器的请求体 —— 按请求画幅拼出确切的 WxH(#642);
 *   - 现役视频适配器的请求体 —— resolution / duration / ratio / generate_audio 四项都作为
 *     **严格顶层字段**发出去(#646 T5)。严格通道下写错的值当场报错,不会像旧的 prompt
 *     flag 通道那样被悄悄换成默认值、把一支商家没批准的片子做出来并计费。
 */
import { GEN_IMAGE_DEFAULT_ASPECT, GEN_IMAGE_SIZES, type GenImageAspect } from "./gen.js";

export const EXECUTED_SPEC: {
  image: {
    outputSize: { width: number; height: number };
    outputSizes: Record<GenImageAspect, { width: number; height: number }>;
    defaultAspect: GenImageAspect;
    aspectHonoured: boolean;
    sourceAspectInheritedFromSnapshot: boolean;
    coherentSetHonoured: boolean;
  };
  video: {
    aspectHonoured: boolean;
    durationHonoured: boolean;
    resolutionHonoured: boolean;
    audioHonoured: boolean;
    elementReferencesHonoured: boolean;
  };
} = {
  image: {
    /** 没指定画幅时执行层真会产出的像素尺寸(默认画幅 = 方图,与 #642 之前逐字节一致)。 */
    outputSize: GEN_IMAGE_SIZES[GEN_IMAGE_DEFAULT_ASPECT],
    /** 每个画幅执行层真会产出的像素尺寸 —— 与适配器读的是**同一个对象**,
     *  所以卡面报的尺寸不可能和发出去的 `size` 分家。 */
    outputSizes: GEN_IMAGE_SIZES,
    /** 商家没提画幅时执行层采用的画幅。 */
    defaultAspect: GEN_IMAGE_DEFAULT_ASPECT,
    /** 画幅请求会不会被执行层采纳。#642 起为 true:契约带画幅、快照落盘、
     *  worker 透传、适配器发出确切 WxH,`byteplus.test.ts` 逐档整体断言。 */
    aspectHonoured: true,
    /** 改图 / 再来一张(带底图)继承源图画幅的**唯一**依据是源图那一单的画幅快照
     *  (`GenJob.imageOptions`)。快照读不到(迁移前的老图)就诚实回落默认方图 ——
     *  执行层不去猜像素、不去反推比例。 */
    sourceAspectInheritedFromSnapshot: true,
    /** #777:现役适配器把「一组连贯图」作为**一次请求**发出去(整组一次出齐),
     *  `byteplus.test.ts` 对请求体整体断言。true ⇒ 卡面可以照实说「一组连贯的图」。 */
    coherentSetHonoured: true,
  },
  video: {
    aspectHonoured: true,
    durationHonoured: true,
    resolutionHonoured: true,
    /** #646 T5:声音开关已接通执行层 —— 适配器把它作为顶层 `generate_audio` 发出去
     *  (`byteplus.test.ts` 整体断言逐字比对),所以卡面可以照实说 “With sound” /
     *  “No sound”。缺省 true = 引擎默认,也 = `videoDefaults()` 给这个模型的 audio。 */
    audioHonoured: true,
    /** #785:@元素(产品图 / 代言人)的参考照现在真的进视频引擎 —— 现役适配器把它们发成
     *  role:"reference_image" 部件(`byteplus.test.ts` 整体断言逐字比对),张数由
     *  `referenceBudget` 一处算出、worker 侧等价测试对表。**只在纯文生视频那一档**成立
     *  (`videoReferencesRide`):带首帧/末帧/整段参考视频的三个场景引擎当互斥处理,那些
     *  档上元素照一张也不发,卡面也照实说 0。false ⇒ 卡面不得承诺元素照会上车。 */
    elementReferencesHonoured: true,
  },
};

/**
 * 这一趟**真正会跑**的那个适配器,会不会兑现图片画幅。
 *
 * ADR 0003(docs/adr/0003-single-provider-byteplus.md,2026-08-16):byteplus 是唯一的
 * 付费适配器,不再有第二条「备用路」需要按 `GENERATION_PROVIDER` 分支判断能不能兑现 ——
 * 判官轮 r1 P2 当初把这条判据从静态标志改成函数,是因为那时选中的适配器会影响答案;
 * 现在只剩一个会花钱的适配器,答案回到 `EXECUTED_SPEC.image.aspectHonoured` 本身。
 * 保留成函数(而不是让调用方直接读那个标志)是因为 `packages/generation` 的测试仍然拿
 * **真适配器实际发出去的请求体**逐个对表 —— 判据与行为分居两处,任一侧漂移才有得测。
 *
 * 纯函数:不选型、不报价、不发请求。
 */
export function imageAspectHonoured(): boolean {
  return EXECUTED_SPEC.image.aspectHonoured;
}

/**
 * 这一趟**真正会跑**的那个适配器,会不会把 @元素参考照送进视频引擎(#785 判官 r1 P1)。
 *
 * ADR 0003:同上——只剩 byteplus 一个会花钱的适配器,不再有「备用路收不了元素照」这个
 * 特例要分支。这个函数不只喂卡面:选片名额 `conditioningCap`(worker 与卡面共用的那一个)
 * 也读它,所以「说几张」与「送几张」结构上不可能分家。
 *
 * 纯函数:不选型、不报价、不发请求。
 */
export function videoElementReferencesHonoured(): boolean {
  return EXECUTED_SPEC.video.elementReferencesHonoured;
}

/**
 * 这一趟**真正会跑**的那个适配器,会不会兑现「一组连贯图」(#777)。
 *
 * ADR 0003:与 `imageAspectHonoured` 同一条判据、同一个理由——只剩 byteplus 一个会花钱的
 * 适配器,答案就是 `EXECUTED_SPEC.image.coherentSetHonoured` 本身。
 *
 * 纯函数:不选型、不报价、不发请求。
 */
export function imageCoherentSetHonoured(): boolean {
  return EXECUTED_SPEC.image.coherentSetHonoured;
}
