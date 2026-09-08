/**
 * generation-reference.test.ts —— FSE-001 的付费前尺寸闸。
 *
 * 探针实测(2026-09-08,USD 0.18):视频端在**建任务之前**就要求参考图宽度 ≥300px,
 * 275×183 的原件零花费被弹回,放大到 550×366 就过。判据必须在预扣之前跑,而且
 * 「不知道」不能被读成「太小」—— 本站生成的资产根本没有那一格。
 */
import { describe, it, expect } from "vitest";
import { MIN_REFERENCE_IMAGE_WIDTH, referenceImageTooSmall } from "./generation-reference.js";

describe("FSE-001 —— 参考图宽度闸", () => {
  it("FSE-001 / CREATE-A2: 供应商实测的那个门槛是 300px", () => {
    expect(MIN_REFERENCE_IMAGE_WIDTH).toBe(300);
  });

  it("FSE-001 / CREATE-A2: 探针那张 275px 的原件判为太小(付费前就该拒)", () => {
    expect(referenceImageTooSmall(275)).toBe(true);
  });

  it("FSE-001 / CREATE-A2: 放大到 550px 的那一张判为可用(与探针的成功那一趟一致)", () => {
    expect(referenceImageTooSmall(550)).toBe(false);
  });

  it("FSE-001 / CREATE-A2: 刚好压线的 300px 可用 —— 门槛是「至少」,不是「大于」", () => {
    expect(referenceImageTooSmall(MIN_REFERENCE_IMAGE_WIDTH)).toBe(false);
    expect(referenceImageTooSmall(MIN_REFERENCE_IMAGE_WIDTH - 1)).toBe(true);
  });

  // 宽度只有 UPLOAD 资产才由 ingest 的 ffprobe 填得上;本站生成的商品图那一格恒为空,
  // 而那正是这条正路最主要的输入。把「不知道」读成「太小」会拒掉每一张本站生成的图。
  it("FSE-001 / CREATE-A9: 不知道宽度就放行(本站生成的资产没有那一格)", () => {
    expect(referenceImageTooSmall(null)).toBe(false);
    expect(referenceImageTooSmall(undefined)).toBe(false);
    expect(referenceImageTooSmall(Number.NaN)).toBe(false);
  });
});
