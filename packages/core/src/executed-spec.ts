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
 *   - `packages/core/src/gen-from-card.ts` —— 卡 → genRequest 的组装。
 *     `durationSeconds` / `resolution` / `aspectRatio` **只在 video 分支**传出;
 *     图片分支一个都不传,所以图片的画幅根本到不了执行层。
 *   - 现役图像/视频适配器的请求体 —— 图片固定输出方图(与商家要的画幅无关);
 *     视频把 resolution / duration / ratio 编成 prompt flags 发出去,声音开关没有接出去。
 */
export const EXECUTED_SPEC: {
  image: { outputSize: { width: number; height: number }; aspectHonoured: boolean };
  video: {
    aspectHonoured: boolean;
    durationHonoured: boolean;
    resolutionHonoured: boolean;
    audioHonoured: boolean;
  };
} = {
  image: {
    /** 执行层固定输出的像素尺寸(方图)。 */
    outputSize: { width: 2048, height: 2048 },
    /** 画幅请求会不会被执行层采纳。false ⇒ 卡面不得承诺画幅;商家提了就是一次降级。 */
    aspectHonoured: false,
  },
  video: {
    aspectHonoured: true,
    durationHonoured: true,
    resolutionHonoured: true,
    /** 声音控制未接通执行层 ⇒ 卡面既不得说 “With sound”,也不得说 “No sound”。 */
    audioHonoured: false,
  },
};
