// @vitest-environment jsdom
/**
 * creation-reference-receipt-card —— 确认卡上的引用回执(Codex 只读 E2E QA-CRE-FE9-013)。
 *
 * 规格 `docs/specs/creation-engine.md`,验收 **CREATE-A1**(花钱前看得见:画布路径的判定
 * 落在 Otto 确认卡片上)与 **CREATE-A2**(素材指派:图＝产品参考,指派可见)。
 *
 * Codex 那一轮:确认卡只列得出 `Aisyah (person)`,商家从 Library 挑的那只蓝杯子在卡上
 * 一个字都没有 —— 他批准并支付了一张不含指定产品的素材。所以这里钉两件事:
 *   ① 人物与媒体参考**都**逐项列出,媒体那几行带真实名字与来源画布(不是 `Image ref`);
 *   ② 卡上带着一件参考却没有它的回执 ⇒ **不给 Generate**,并说出缺哪一件。
 *
 * 纯展示层:这里不预扣、不结算、不调 provider。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(),
  ottoTurn: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: vi.fn(),
  coworkVaryCard: vi.fn(),
  cancelGenJob: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/create",
  useSearchParams: () => new URLSearchParams(),
}));

const { OttoPlanCard } = await import("@/components/otto/OttoPlanCard");
const { planCardGate, missingReferenceReceipts } = await import("@/components/otto/plan-card-contract");

const CUP_ID = "gen_cup";
const CUP_LABEL = "A blue ceramic cup on a linen cloth";

const cupReceipt = {
  generationId: CUP_ID,
  kind: "image" as const,
  label: CUP_LABEL,
  sourceProjectId: "canvas_a",
  sourceProjectName: "Product shots",
  sameCanvas: false,
  previewUrl: "/files/org/aa/bb/hash.png",
};

/** 一张与服务端 builder 同形的图片卡:@了一个人物,又带着一张产品参考图。 */
function cardWithCup(over: Record<string, unknown> = {}) {
  return {
    kind: "image",
    model: "seedream-lite",
    params: { aspectRatio: "1:1", count: 1 },
    reason: "internal",
    specChips: ["1 image", "1:1"],
    downgraded: false,
    structuredPrompt: "Put my cup on a marble counter",
    entityIds: ["ent_aisyah"],
    approvedEntities: [{ id: "ent_aisyah", type: "CHARACTER", name: "Aisyah" }],
    variantSel: {},
    estimatedPriceUsd: 0.04,
    estimatedCredits: 1,
    sourceGenerationId: CUP_ID,
    mediaReferences: [cupReceipt],
    ...over,
  };
}

function renderCard(payload: unknown): string {
  const markup = renderToStaticMarkup(
    createElement(OttoPlanCard, {
      cardId: "card_1",
      payload,
      entities: [],
      threadId: "thread_1",
      projectId: "canvas_b",
      genJobId: null,
      cardState: "idle" as const,
      pendingApproval: false,
      onApproved: vi.fn(),
      onChangeSomething: vi.fn(),
      onOptionsChanged: vi.fn(),
    }),
  );
  return markup.replaceAll("&#x27;", "'").replaceAll("&#39;", "'").replaceAll("&quot;", '"');
}

describe("CREATE-A1 确认卡逐项列出这一趟会用到的东西", () => {
  it("CREATE-A1 人物与媒体参考都列出来 —— 媒体那一行是真名字,不是 `Image ref`", () => {
    const markup = renderCard(cardWithCup());

    // 人物那一句照旧(措辞的单一权威仍是 core 的 approvedEntitiesNote)。
    expect(markup).toContain("Reference names sent to the engine: Aisyah (person).");
    // 媒体那一行:真名字 + 缩略图 + 来源画布。
    expect(markup).toContain(CUP_LABEL);
    expect(markup).toContain(cupReceipt.previewUrl);
    expect(markup).toContain("From Product shots");
    expect(markup).not.toContain("Image ref");
    // 价格与按钮照旧 —— 回执不动钱路。
    expect(markup).toContain("Generate");
  });

  it("CREATE-A2 同一块画布上的参考不多说一句出处,但照样列出来", () => {
    const markup = renderCard(
      cardWithCup({ mediaReferences: [{ ...cupReceipt, sameCanvas: true, sourceProjectName: "Raya campaign" }] }),
    );

    expect(markup).toContain(CUP_LABEL);
    expect(markup).not.toContain("From Raya campaign");
  });

  it("CREATE-A1 卡上有参考、没有回执:不给 Generate,并说出缺哪一件", () => {
    // 老卡的形状 —— 有 sourceGenerationId,没有 mediaReferences。
    const payload = cardWithCup({ mediaReferences: undefined });
    const gate = planCardGate(payload);

    expect(missingReferenceReceipts(gate.value)).toEqual(["reference image"]);
    expect(gate.approvable).toBe(false);

    const markup = renderCard(payload);
    expect(markup).toContain("reference image");
    expect(markup).not.toContain("Generate ·");
    // 走不下去时给的是「再来一张」,不是一颗按不动的付费按钮。
    expect(markup).toContain("Ask again");
  });

  it("CREATE-A1 参考视频那一格同样要有回执", () => {
    const gate = planCardGate({
      ...cardWithCup({ mediaReferences: undefined, sourceGenerationId: undefined }),
      kind: "video",
      referenceVideoGenerationId: "gen_clip",
    });

    expect(missingReferenceReceipts(gate.value)).toEqual(["reference video"]);
    expect(gate.approvable).toBe(false);
  });

  it("CREATE-A1 一条读不全的回执 = 畸形,不是「就当没有」", () => {
    const gate = planCardGate(
      cardWithCup({ mediaReferences: [{ generationId: CUP_ID, kind: "image", label: CUP_LABEL }] }),
    );

    expect(gate.malformedFields).toContain("mediaReferences");
    expect(gate.approvable).toBe(false);
  });

  it("CREATE-A1 一张不带任何参考的卡照旧可批准 —— 这一条规矩只管带了参考的卡", () => {
    const gate = planCardGate(
      cardWithCup({ sourceGenerationId: undefined, mediaReferences: undefined, entityIds: [], approvedEntities: undefined }),
    );

    expect(gate.missingReferenceReceipts).toEqual([]);
    expect(gate.approvable).toBe(true);
  });
});
