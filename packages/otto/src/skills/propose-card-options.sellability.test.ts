/**
 * propose-card-options.sellability.test —— 精修那一格的**派生**证据（复审 r1 P2-1）。
 *
 * 规格 docs/specs/otto-engine.md，验收 ENGINE-A3。
 *
 * 为什么另起一份：`propose-card-options.test.ts` 里那条断言两边都是今天的真值
 * （`fineDetailAvailable` 等于 `isSellableImageSku(PRO_IMAGE_MODEL)`），于是把派生写死成
 * `true` 它照样全绿 —— 那是同义反复，不是证据。这一份把「pro 今天卖不卖得动」这个判据
 * 打桩成 false，钉两件事：菜单那一格真的跟着变，改档也真的被拒（$0，卡一个字节不动）。
 * 打桩只在这个文件里生效，所以别的那 15 条判词一个字都没被动过。
 */
import { describe, expect, it, vi } from "vitest";
import type { OttoContext } from "../context.js";

/** 打桩开关。默认跟着真值走 —— 只有点名那一条测试才把它扳成 false。 */
const proSellable = vi.hoisted(() => ({ value: true as boolean | null }));

vi.mock("@fikirtive/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fikirtive/core")>();
  return {
    ...actual,
    isSellableImageSku: (sku: string) =>
      sku === actual.PRO_IMAGE_MODEL && proSellable.value !== null
        ? proSellable.value
        : actual.isSellableImageSku(sku),
  };
});

const { DEFAULT_IMAGE_MODEL, PRO_IMAGE_MODEL } = await import("@fikirtive/core");
const { applyCardOptions, cardOptionMenu } = await import("./propose-card-options.js");
const { buildProposeCard } = await import("./propose.helpers.js");

function makeCtx(): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
  } as OttoContext;
}

function imageCard() {
  return buildProposeCard(
    {
      kind: "image" as const,
      structuredPrompt: "a pandan kaya jar on a marble counter",
      entityIds: [],
      variantSel: {},
    },
    makeCtx(),
    [],
  ).cardPayload;
}

describe("ENGINE-A3 精修那一格跟着「今天卖不卖得动」走", () => {
  it("ENGINE-A3 pro 卖得动 ⇒ 菜单上有精修那一格", () => {
    proSellable.value = true;
    expect(cardOptionMenu(DEFAULT_IMAGE_MODEL)!.fineDetailAvailable).toBe(true);
    expect(cardOptionMenu(PRO_IMAGE_MODEL)!.fineDetailAvailable).toBe(true);
  });

  it("ENGINE-A3 pro 今天卖不动 ⇒ 菜单那一格是 false(不摆一个点了必然被拒的选项)", () => {
    proSellable.value = false;
    try {
      expect(cardOptionMenu(DEFAULT_IMAGE_MODEL)!.fineDetailAvailable).toBe(false);
      // 别的两格照旧 —— 一格卖不动不该把整份菜单收掉。
      expect(cardOptionMenu(DEFAULT_IMAGE_MODEL)!.maxCount).toBeGreaterThan(0);
    } finally {
      proSellable.value = true;
    }
  });

  it("ENGINE-A3 pro 今天卖不动 ⇒ 打开精修被拒,卡一个字节不动($0)", () => {
    proSellable.value = true;
    const card = imageCard();
    proSellable.value = false;
    try {
      const result = applyCardOptions(card, { fineDetail: true });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toContain("Fine detail isn't available right now");
      // 拒绝那一次不产出新卡 —— 旧卡原样留在库里,没有任何一格被静默换掉。
      expect(card.model).toBe(DEFAULT_IMAGE_MODEL);
      expect(card.fineDetail).toBeUndefined();
    } finally {
      proSellable.value = true;
    }
  });
});
