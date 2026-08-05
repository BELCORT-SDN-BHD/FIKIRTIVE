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
 *   - 现役视频适配器的请求体 —— 把 resolution / duration / ratio 编成 prompt flags
 *     发出去,声音开关没有接出去。
 */
import { GEN_IMAGE_DEFAULT_ASPECT, GEN_IMAGE_SIZES, type GenImageAspect } from "./gen.js";

export const EXECUTED_SPEC: {
  image: {
    outputSize: { width: number; height: number };
    outputSizes: Record<GenImageAspect, { width: number; height: number }>;
    defaultAspect: GenImageAspect;
    aspectHonoured: boolean;
    sourceAspectInheritedFromSnapshot: boolean;
    fallbackAdapterAspectHonoured: boolean;
  };
  video: {
    aspectHonoured: boolean;
    durationHonoured: boolean;
    resolutionHonoured: boolean;
    audioHonoured: boolean;
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
    /** 备用(legacy fallback)图像适配器**不**携带画幅:它的尺寸参数未经官方文档确认,
     *  本仓库的规矩是「没确认就不发明参数」(见视频侧 audio flag 同样处置)。
     *  false ⇒ 这条路上画幅不成立,不得假装它成立。现役生产路径不走这条。 */
    fallbackAdapterAspectHonoured: false,
  },
  video: {
    aspectHonoured: true,
    durationHonoured: true,
    resolutionHonoured: true,
    /** 声音控制未接通执行层 ⇒ 卡面既不得说 “With sound”,也不得说 “No sound”。 */
    audioHonoured: false,
  },
};
