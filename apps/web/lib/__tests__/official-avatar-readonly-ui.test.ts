// @vitest-environment jsdom
/**
 * **官方演员只读 —— UI 层,真挂载(CREATE-A10 只读半,Codex QA-CRE-003)**
 *
 * Codex 2026-09-04 只读 E2E(`docs/audits/creation-e2e-2026-09-04.md` §4.7)在主干上打开
 * Library → Cast → Aisyah,看到的是 `Use as base`、`Add a variant`、`Variant name`、
 * `What changes`,两项填完 `Make variant · 1 credit` 就 enabled 了。这一份把那句报告翻成
 * 一条会红的断言:官方 DTO 挂上去,那些字一个都不许出现;商家自己的 DTO 挂上去,它们必须在。
 *
 * 两件事这里**不**做,因为它们不在这一层:
 *   · 不断言拒绝文案 —— 官方演员根本走不到动作,商家看不到那句话(那句在 server action
 *     的真库测试里断言:`official-avatar-readonly-actions.test.ts`);
 *   · 不重新判断「是不是官方」—— 组件读的是 DTO 上域层算好的 `capabilities`,这份测试
 *     喂的也是同一个函数的产物(`capabilitiesForOrigin`),所以判据只有一份。
 *
 * 「不画」而不是「画成禁用」是刻意的:一个能按、按完道歉的假控件,正是这次要拆掉的东西。
 * 所以断言的是文本**不存在**,不是 `disabled` 为真。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilitiesForOrigin } from "@fikirtive/core/entity-policy";
import type { EntityDTO } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  createVariant: vi.fn(),
  deleteVariant: vi.fn(),
  getRefGenJobs: vi.fn(async () => []),
  regenerateVariant: vi.fn(),
  renameVariant: vi.fn(),
  setBaseAsset: vi.fn(),
  notifyBalanceRefresh: vi.fn(),
}));

vi.mock("@/lib/refgen-actions", () => ({
  createVariant: mocks.createVariant,
  deleteVariant: mocks.deleteVariant,
  getRefGenJobs: mocks.getRefGenJobs,
  regenerateVariant: mocks.regenerateVariant,
  renameVariant: mocks.renameVariant,
  setBaseAsset: mocks.setBaseAsset,
}));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: mocks.notifyBalanceRefresh }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ElementVariantsDialog } = await import("@/components/otto/stuff/ElementVariantsDialog");

/** 两张定妆照(第二张的存在正是 `Use as base` 会出现的前提)+ 一个变体。 */
function entityOf(origin: "OFFICIAL_CATALOG" | "USER"): EntityDTO {
  return {
    id: "entity-aisyah",
    type: "CHARACTER",
    name: "Aisyah",
    aliases: [],
    notes: "",
    negativeConstraints: "",
    refs: [
      { id: "ref-closeup", assetId: "asset-closeup", url: "/aisyah-closeup.jpg", kind: "image" },
      { id: "ref-fullbody", assetId: "asset-fullbody", url: "/aisyah-fullbody.jpg", kind: "image" },
    ],
    baseAssetId: "asset-closeup",
    variants: [
      {
        id: "variant-chef",
        name: "Chef whites",
        handle: "chef-whites",
        prompt: "in a chef jacket",
        refs: [{ id: "vref-1", assetId: "vasset-1", url: "/aisyah-chef.jpg", kind: "image" }],
      },
    ],
    usageCount: 0,
    origin,
    capabilities: capabilitiesForOrigin(origin),
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function settle() {
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
}

async function open(entity: EntityDTO) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(ElementVariantsDialog, {
      entity, open: true, onOpenChange: vi.fn(), onChanged: vi.fn(),
    }));
  });
  await settle();
}

function dialog(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]');
  expect(found).not.toBeNull();
  return found!;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

/** Codex 报告里逐字点名的那四段文字。 */
const MUTATION_COPY = ["Use as base", "Add a variant", "Variant name", "What changes", "Make variant"];

describe("CREATE-A10 官方演员只读 —— 元素详情不出 mutation 控件", () => {
  it("CREATE-A10: 官方 DTO —— Codex 点名的那几段文字一个都不出现", async () => {
    await open(entityOf("OFFICIAL_CATALOG"));
    const text = dialog().textContent ?? "";
    for (const copy of MUTATION_COPY) expect(text, copy).not.toContain(copy);
    // 输入框本身也不该在 DOM 里 —— 「不画」不是「画了再隐藏」。
    expect(dialog().querySelector("#variant-name")).toBeNull();
    expect(dialog().querySelector("#variant-change")).toBeNull();
  });

  it("CREATE-A10: 官方 DTO —— 变体卡上的「⋯」动作菜单整个不出现", async () => {
    await open(entityOf("OFFICIAL_CATALOG"));
    expect(dialog().querySelector('[aria-label="Actions for Chef whites"]')).toBeNull();
    // 每一个按钮都必须是只读动作:官方那一面一个 mutation 按钮都不该剩下。
    const labels = [...dialog().querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
    for (const label of labels) {
      for (const copy of MUTATION_COPY) expect(label, `button "${label}"`).not.toContain(copy);
    }
  });

  it("CREATE-A10: 官方 DTO —— 说明文字告诉商家出路是「用」,不是「改」", async () => {
    await open(entityOf("OFFICIAL_CATALOG"));
    const text = dialog().textContent ?? "";
    expect(text).toContain("provided by Fikirtive");
    expect(text.toLowerCase()).toContain("canvas");
  });

  it("CREATE-A10: 官方 DTO —— 标题旁挂「Official avatar · Read only」标签,商家自己的不挂", async () => {
    // 只读要看得见,而不是靠「按钮怎么少了」去猜(Codex QA-CRE-FE9-008)。
    await open(entityOf("OFFICIAL_CATALOG"));
    expect(dialog().textContent ?? "").toContain("Official avatar · Read only");
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = null;
    container = null;

    await open(entityOf("USER"));
    expect(dialog().textContent ?? "").not.toContain("Official avatar · Read only");
  });

  it("CREATE-A10: 商家自己的 DTO —— 那几段文字全都在(围栏没误伤自己的元素)", async () => {
    await open(entityOf("USER"));
    const text = dialog().textContent ?? "";
    for (const copy of MUTATION_COPY) expect(text, copy).toContain(copy);
    expect(dialog().querySelector("#variant-name")).not.toBeNull();
    expect(dialog().querySelector("#variant-change")).not.toBeNull();
    expect(dialog().querySelector('[aria-label="Actions for Chef whites"]')).not.toBeNull();
  });
});
