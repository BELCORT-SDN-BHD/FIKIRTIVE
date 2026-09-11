/**
 * generation-reference.test.ts —— FSE-001 的付费前尺寸闸与自动放大计划。
 *
 * 探针实测三场(2026-09-08 ×2、2026-09-09 ×1,USD 0.74):视频端在**建任务之前**就查参考图
 * 尺寸,闸是**宽与高各 ≥300px**(第三场逐字回执 `expected the height to be at least 300px,
 * but received a 300x200px image instead`);短边落在 [100, 300) 时按整数倍 lanczos 放大到刚
 * 好过门,出片商品可辨度高(150×100 → 3×、200×200 → 2× 各一笔实证)。
 *
 * 两条纪律钉在这里:
 *   · 判据是**短边**,不是宽度 —— 400×200 在旧口径下过我们的闸、到供应商才被弹,而那时钱
 *     已经预扣;
 *   · 「读不出尺寸」不是「太小」—— 本站生成的资产根本没有宽高那两格。
 */
import { describe, it, expect } from "vitest";
import {
  MIN_REFERENCE_IMAGE_SIDE,
  MIN_UPSCALABLE_REFERENCE_SIDE,
  lineageCarriesOfficialActor,
  minimumUsableReferenceSide,
  referenceUpscalePlan,
} from "./generation-reference.js";

describe("FSE-001 —— 参考图尺寸闸(宽高双查)与放大计划", () => {
  it("FSE-001 / CREATE-A2: 供应商实测的两条门槛 —— 过门 300px、可放大下限 100px", () => {
    expect(MIN_REFERENCE_IMAGE_SIDE).toBe(300);
    expect(MIN_UPSCALABLE_REFERENCE_SIDE).toBe(100);
  });

  // 表驱动:每一行都是探针里真跑过、或由那两个门槛直接推出的那一格。
  const table: {
    name: string;
    size: { width: number | null; height: number | null };
    want: ReturnType<typeof referenceUpscalePlan>;
  }[] = [
    {
      name: "275×183 的真实鞋照(探针 T2 原件)⇒ 2× → 550×366",
      size: { width: 275, height: 183 },
      want: { action: "upscale", factor: 2, width: 550, height: 366 },
    },
    {
      name: "200×200 的 AI 商品照(探针 T3,2× 后 succeeded)⇒ 2× → 400×400",
      size: { width: 200, height: 200 },
      want: { action: "upscale", factor: 2, width: 400, height: 400 },
    },
    {
      name: "150×100(探针 T4′,3× 后 succeeded)⇒ 3× → 450×300,不是被高度弹回的 2×",
      size: { width: 150, height: 100 },
      want: { action: "upscale", factor: 3, width: 450, height: 300 },
    },
    {
      name: "400×200 —— 宽度够、高度不够,旧口径的漏洞在这一行",
      size: { width: 400, height: 200 },
      want: { action: "upscale", factor: 2, width: 800, height: 400 },
    },
    {
      name: "300×300 刚好压线 ⇒ 原样,一个字节都不动",
      size: { width: 300, height: 300 },
      want: { action: "asIs" },
    },
    {
      name: "99×500 短边低于可放大下限 ⇒ 花钱前拒绝",
      size: { width: 99, height: 500 },
      want: { action: "refuse" },
    },
    {
      name: "宽高读不出来(本站生成的资产)⇒ unknown,不是「太小」",
      size: { width: null, height: null },
      want: { action: "unknown" },
    },
  ];

  for (const row of table) {
    it(`FSE-001 / CREATE-A2: ${row.name}`, () => {
      expect(referenceUpscalePlan(row.size)).toEqual(row.want);
    });
  }

  it("FSE-001 / CREATE-A2: 只读到一边也算读不出来(半个尺寸推不出短边)", () => {
    expect(referenceUpscalePlan({ width: 400, height: null }).action).toBe("unknown");
    expect(referenceUpscalePlan({ width: null, height: 400 }).action).toBe("unknown");
    expect(referenceUpscalePlan({ width: 400, height: Number.NaN }).action).toBe("unknown");
    expect(referenceUpscalePlan({ width: 0, height: 400 }).action).toBe("unknown");
  });

  it("FSE-001 / CREATE-A2: 放大只按整数倍同乘,长宽比一格不动(不裁剪、不改构图)", () => {
    for (const size of [
      { width: 275, height: 183 },
      { width: 150, height: 100 },
      { width: 400, height: 200 },
    ]) {
      const plan = referenceUpscalePlan(size);
      expect(plan.action).toBe("upscale");
      if (plan.action !== "upscale") return;
      expect(plan.width).toBe(size.width * plan.factor);
      expect(plan.height).toBe(size.height * plan.factor);
      // 刚好过门的**最小**整数倍:再少一倍就过不了那道 300 的闸。
      expect(Math.min(plan.width, plan.height)).toBeGreaterThanOrEqual(MIN_REFERENCE_IMAGE_SIDE);
      expect(Math.min(size.width, size.height) * (plan.factor - 1)).toBeLessThan(
        MIN_REFERENCE_IMAGE_SIDE,
      );
    }
  });

  /**
   * 规格 §5 :162① —— 本站生成的资产从此**有真尺寸**(`apps/worker/src/jobs/gen.ts` 出图处按
   * ingest 同一套 ffprobe 量真字节)。所以尺寸闸对它不再读 `unknown`,而是三档各归各位。
   *
   * 这一条钉的是**闸的答案**,不是量法本身:量法由 `apps/worker/src/jobs/gen-output-dimensions.test.ts`
   * 用真字节证明。两条一起,「本站生成的小图付费前就被拦下」才算证完。
   */
  it("creation §5 :162①: 本站生成的资产量到宽高之后,尺寸闸三档各归各位(不再是 unknown 放行)", () => {
    // 短边 <100 —— 付费前拒绝(放大到过门要 4× 以上,我们只在 2×／3× 有实证)。
    expect(referenceUpscalePlan({ width: 99, height: 1344 }).action).toBe("refuse");
    // 100 ≤ 短边 <300 —— 走放大。
    expect(referenceUpscalePlan({ width: 100, height: 1344 }).action).toBe("upscale");
    expect(referenceUpscalePlan({ width: 299, height: 1344 }).action).toBe("upscale");
    // 短边 ≥300 —— 原样。本站出图短边最小 1344px,正常出图永远落在这一档。
    expect(referenceUpscalePlan({ width: 300, height: 1344 }).action).toBe("asIs");
    expect(referenceUpscalePlan({ width: 1344, height: 1344 }).action).toBe("asIs");
    // 「尺寸未知＝放行」从此只剩一档:上传图 ingest 还没量完就被引用(已登记)。
    expect(referenceUpscalePlan({ width: null, height: null }).action).toBe("unknown");
  });

  /**
   * 规格 §5 :176⑥ —— 拒绝文案的门槛不再统一写 300。
   *
   * 门槛按「我们能不能替它放大」分岔,而这条分岔只有 `minimumUsableReferenceSide` 一个产地:
   * 拒绝那一句读它,别处不许再算第二遍。
   */
  it("creation §5 :176⑥ / CREATE-A10: 能放大 ⇒ 门槛 100;不许动像素(演员血统)⇒ 门槛就是供应商那道 300", () => {
    expect(minimumUsableReferenceSide(true)).toBe(MIN_UPSCALABLE_REFERENCE_SIDE);
    expect(minimumUsableReferenceSide(true)).toBe(100);
    // 演员血统那一档我们一格不动像素(像素完整性铁律),所以对商家真正成立的门槛是 300。
    expect(minimumUsableReferenceSide(false)).toBe(MIN_REFERENCE_IMAGE_SIDE);
    expect(minimumUsableReferenceSide(false)).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// 演员血统 —— 「哪些图一格都不许动像素」的判据(Founder 2026-09-09 裁决的机器可查那一半)
// ---------------------------------------------------------------------------

describe("FSE-001 —— 演员血统判据", () => {
  it("FSE-001 / CREATE-A10: 快照里有 CHARACTER ⇒ 认作带演员血统(像素铁律:一格不动)", () => {
    expect(
      lineageCarriesOfficialActor({ entities: [{ id: "e1", type: "CHARACTER", name: "Aisyah" }] }),
    ).toBe(true);
  });

  it("FSE-001 / CREATE-A10: 只有商品元素 ⇒ 不带演员血统(可以自动放大)", () => {
    expect(lineageCarriesOfficialActor({ entities: [{ id: "e2", type: "PRODUCT" }] })).toBe(false);
  });

  it("FSE-001 / CREATE-A10: 形状不对(null / {} / 脏数据)一律当作没有演员", () => {
    expect(lineageCarriesOfficialActor(null)).toBe(false);
    expect(lineageCarriesOfficialActor(undefined)).toBe(false);
    expect(lineageCarriesOfficialActor({})).toBe(false);
    expect(lineageCarriesOfficialActor({ entities: "nope" })).toBe(false);
    expect(lineageCarriesOfficialActor({ entities: [null, 7] })).toBe(false);
  });
});
