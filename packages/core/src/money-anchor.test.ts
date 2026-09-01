/**
 * 钱引擎 S2 §7.2 定价推构的**回归锚**(验收 MONEY-A11)。
 *
 * 本段(§7.8 第①段)要把定价从「手抄价目字面量」改成「成本钉点 → 公式推导」。
 * 重构会动 spend.ts 的内部结构;商家看到的价一格都不许动。这个文件就是那道闸:
 * 它锚死**今天**在售菜单的每一个价(内部 credits,1 显示 = 10 内部 = $0.10),
 * 重构前后必须逐字相等 —— 有任何一格变了,这里当场变红。
 *
 * 为什么这里可以手抄期望值(生产代码不许,见 MONEY-A1「全仓不存在第二份手抄价目」):
 * 测试就是**第二证人**。锚的价值恰恰来自它与被测代码互相独立 —— 期望值若也从推导
 * 公式算出来,公式错了两边一起错,锚就成了自己给自己签字。
 * 下面 24 格视频价不是从裁决评论抄的,也不是我心算的:是先跑现役 `pricedGenCredits`
 * 打印出真值、核对无误后写进来的(与 video-tiers.test.ts 的 FOUNDER_PRICE_TABLE
 * 显示价 ×10 一致,两份手抄互为交叉核对)。
 *
 * **刻意不锚**的两格:1080p / 未知分辨率的 16cr 兜底,以及不在档位表上的秒数兜底。
 * 那是 MONEY-A3 本段就要改掉的行为(「护栏价按每一个可售时长档重造,单一定额挡不住
 * 15 秒档」),锚了会挡自己的路 —— 那两格的判定由本段新写的 A3 测试接管。
 */
import { describe, it, expect } from "vitest";
import { pricedGenCredits, pricedRefgenCredits } from "./spend.js";

const MODEL = "seedance-2-mini";

const videoJob = (seconds: number, resolution: string) => ({
  kind: "VIDEO" as const,
  model: MODEL,
  count: 1,
  videoOptions: { seconds, resolution, audio: true },
});

/** 今天在售的 24 格,单位 = **内部** credits(显示价 ×10)。 */
const ANCHOR_INTERNAL: readonly { seconds: number; "480p": number; "720p": number }[] = [
  { seconds: 4, "480p": 50, "720p": 90 },
  { seconds: 5, "480p": 60, "720p": 110 },
  { seconds: 6, "480p": 70, "720p": 140 },
  { seconds: 7, "480p": 80, "720p": 160 },
  { seconds: 8, "480p": 90, "720p": 180 },
  { seconds: 9, "480p": 100, "720p": 200 },
  { seconds: 10, "480p": 110, "720p": 220 },
  { seconds: 11, "480p": 130, "720p": 250 },
  { seconds: 12, "480p": 140, "720p": 270 },
  { seconds: 13, "480p": 150, "720p": 290 },
  { seconds: 14, "480p": 160, "720p": 310 },
  { seconds: 15, "480p": 170, "720p": 330 },
];

describe("MONEY-A11 定价回归锚:S2 推构前后,菜单价逐字不变", () => {
  it.each(ANCHOR_INTERNAL)("480p / $seconds 秒 = $480p 内部 credits", (row) => {
    expect(pricedGenCredits(videoJob(row.seconds, "480p"))).toBe(row["480p"]);
  });

  it.each(ANCHOR_INTERNAL)("720p / $seconds 秒 = $720p 内部 credits", (row) => {
    expect(pricedGenCredits(videoJob(row.seconds, "720p"))).toBe(row["720p"]);
  });

  it("菜单只有这 24 格 —— 锚表本身不许缺档、不许多档", () => {
    expect(ANCHOR_INTERNAL.map((r) => r.seconds)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("图片 = 每张 1 显示 credit(10 内部),按张数线性", () => {
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null })).toBe(10);
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 3, videoOptions: null })).toBe(30);
  });

  it("refgen(参考图)= 每张 1 显示 credit,与生成图同价", () => {
    expect(pricedRefgenCredits({ model: "seedream", count: 2 })).toBe(20);
  });

  it("整段参考视频 = 定额 16 显示 credits,不随时长/分辨率浮动", () => {
    expect(
      pricedGenCredits({
        ...videoJob(5, "720p"),
        referenceVideoGenerationId: "x",
      }),
    ).toBe(160);
  });
});
