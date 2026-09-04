// @vitest-environment jsdom
// 本面自 PR #1152 起无路由挂载(/library 改画 components/library/LibraryView.tsx),围栏仅护组件本身；tidy 待登记。
/**
 * library-empty-guidance — #942:「Add a character or product」通向空 Library 死胡同。
 *
 * 病灶(2026-08-14 生产 S0 真实商家旅程实测,#850 摩擦清单第 4 条):新店铺点开场引导卡的
 * 「Add a character or product」磁贴,落地在 Library,库是空的,页面只说「Nothing here
 * yet.」——右上角虽然一直有个「Add」按钮,但空态本身不指向它,商家在这里卡住。
 *
 * 修法:library 模式的空态,在库真的一件没有(不是搜索落空、不是筛选到零)时,给一句
 * 引导 + 一个直达同一个「Add to Library」上传弹窗的 CTA——不建第二条上传路。
 *
 * 钉板:
 *   ① 真空库 + 有 onAdd → 引导文案 + CTA 出现,点击调用 onAdd(单元)。
 *   ② 真空库 + 没有 onAdd(旧调用点)→ 退回原来的「Nothing here yet.」,不留孤儿 CTA。
 *   ③ 库不空 → 永远不渲染引导文案 / CTA,即便传了 onAdd(现状不变)。
 *   ④ 端到端:全新店铺的 OttoStuff 页面上,点 CTA 真的打开「Add to Library」弹窗
 *      (复用同一个 AddAssetDialog,不是另起一套)。
 */
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StuffItem } from "@/lib/stuff-items";

const mocks = vi.hoisted(() => ({
  updateEntity: vi.fn(),
  softDeleteEntity: vi.fn(),
  saveBrandRecord: vi.fn(),
  getGenerationHistory: vi.fn(),
  createEntity: vi.fn(),
  startRefGen: vi.fn(),
  notifyBalanceRefresh: vi.fn(),
}));

vi.mock("@/lib/actions", () => ({
  updateEntity: mocks.updateEntity,
  softDeleteEntity: mocks.softDeleteEntity,
  createEntity: mocks.createEntity,
}));
vi.mock("@/lib/brand-record-actions", () => ({ saveBrandRecord: mocks.saveBrandRecord }));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: mocks.getGenerationHistory }));
vi.mock("@/lib/refgen-actions", () => ({ startRefGen: mocks.startRefGen }));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: mocks.notifyBalanceRefresh }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
// Not what this test is about, and it drags the whole spend/detail path into the bundle.
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { StuffLibrary } = await import("@/components/otto/stuff/StuffLibrary");
const { OttoStuff } = await import("@/components/otto/OttoStuff");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.updateEntity.mockReset();
  mocks.softDeleteEntity.mockReset();
  mocks.saveBrandRecord.mockReset();
  mocks.getGenerationHistory.mockReset();
  mocks.createEntity.mockReset();
  mocks.startRefGen.mockReset();
  mocks.notifyBalanceRefresh.mockReset();
  mocks.getGenerationHistory.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function findButton(dom: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(dom.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
}

const ONE_IMAGE: StuffItem[] = [
  {
    id: "gen:g1",
    source: "gen",
    label: "laksa bowl on rattan",
    url: "https://cdn.test/g1.png",
    mediaKind: "image",
    generationId: "g1",
    projectId: "p1",
    assetId: "a1",
  },
];

describe("#942 an empty Library guides the merchant instead of dead-ending", () => {
  it("StuffLibrary (library mode): a genuinely empty library with onAdd shows guidance and a working CTA", async () => {
    const onAdd = vi.fn();
    const dom = await mount(createElement(StuffLibrary, { items: [], mode: "library" as const, onAdd }));

    const text = dom.textContent ?? "";
    expect(text, "no explanation for a first-time empty library").toContain(
      "Add your first character or product photo",
    );

    const cta = findButton(dom, "Add to Library");
    expect(cta, "the upload CTA is gone").toBeTruthy();
    await act(async () => {
      cta!.click();
    });
    expect(onAdd, "the CTA did not call through to the upload dialog opener").toHaveBeenCalledTimes(1);
  });

  it("StuffLibrary (library mode): without onAdd, the old plain message still holds — no orphan CTA", async () => {
    const dom = await mount(createElement(StuffLibrary, { items: [], mode: "library" as const }));
    expect(dom.textContent).toContain("Nothing here yet.");
    expect(findButton(dom, "Add to Library"), "a CTA appeared with nothing to call").toBeUndefined();
  });

  it("StuffLibrary (library mode): a non-empty library never shows the guidance, even if onAdd is passed", async () => {
    const onAdd = vi.fn();
    const dom = await mount(createElement(StuffLibrary, { items: ONE_IMAGE, mode: "library" as const, onAdd }));
    const text = dom.textContent ?? "";
    expect(text).not.toContain("Add your first character or product photo");
    expect(findButton(dom, "Add to Library"), "the CTA leaked into a non-empty library").toBeUndefined();
  });

  it("StuffLibrary (picker mode): unaffected — still just its own empty-picker line, no character/product guidance", async () => {
    const dom = await mount(createElement(StuffLibrary, { items: [], mode: "picker" as const }));
    const text = dom.textContent ?? "";
    expect(text).toContain("No images to pick from.");
    expect(text).not.toContain("Add your first character or product photo");
  });

  it("OttoStuff end-to-end: a brand-new shop's Library shows the CTA, and it opens the real Add to Library dialog", async () => {
    const dom = await mount(
      createElement(OttoStuff, { entities: [], ads: [], adJobs: [], records: [], history: [] }),
    );

    const text = dom.textContent ?? "";
    expect(text).toContain("Add your first character or product photo");

    const cta = findButton(dom, "Add to Library");
    expect(cta, "the guided CTA is missing from a brand-new shop's Library").toBeTruthy();
    await act(async () => {
      cta!.click();
    });

    // Same dialog the header's own "Add" button opens — not a second upload path.
    // W2-1: it is `components/ui/dialog` now, so its accessible name comes from the
    // DialogTitle it is labelled by rather than a hand-written aria-label. Assert on
    // role + the name the merchant hears, which is what the aria-label stood for.
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, "clicking the CTA did not open the real upload dialog").toBeTruthy();
    const titleId = dialog!.getAttribute("aria-labelledby");
    expect(document.getElementById(titleId ?? "")?.textContent).toBe("Add to Library");
    expect(dialog!.textContent).toContain("Add to Library");
  });

  it("OttoStuff end-to-end: once the shop has something saved, the guidance does not show", async () => {
    mocks.getGenerationHistory.mockResolvedValue({
      items: [{ id: "g1", projectId: "p1", assetId: "a1", url: "https://cdn.test/g1.png", kind: "image", prompt: "laksa" }],
      nextCursor: null,
      hasMore: false,
    });
    const dom = await mount(
      createElement(OttoStuff, { entities: [], ads: [], adJobs: [], records: [], history: [] }),
    );
    const text = dom.textContent ?? "";
    expect(text).not.toContain("Add your first character or product photo");
  });
});
