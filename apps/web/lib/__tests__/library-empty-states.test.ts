// @vitest-environment jsdom
/**
 * library-empty-states — #701:Library 两处「话说了一半」。
 *
 * 病灶(走查 W2-A 实测,1280 与 375 两个宽度都复现):
 *   ① 库里有东西、只是搜不到时,复用了真空仓的那句「Nothing here yet.」——
 *      商家读成「素材丢了」。同一句话被两种状态复用,第二种情况下它是错的。
 *   ② 「Set as product image」弹窗说「No products yet — add one in Brand memory first.」,
 *      纯文字,整个弹窗只有一个 Cancel。路是真的通的(Brand memory → Your products →
 *      + Add product),只是没给链接,商家得自己摸四层。
 *
 * 钉板按状态分开断言:搜不到时必须说搜不到并点名搜的是什么词;真空仓才说真空仓。
 * 指路一律断言 DOM 里有一个指向 Brand memory 的可点链接 —— 换句更好听的死文字照样红。
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
  refresh: vi.fn(),
}));

vi.mock("@/lib/actions", () => ({
  updateEntity: mocks.updateEntity,
  softDeleteEntity: mocks.softDeleteEntity,
}));
vi.mock("@/lib/brand-record-actions", () => ({ saveBrandRecord: mocks.saveBrandRecord }));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: mocks.getGenerationHistory }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));
// Neither panel is what this test is about, and both drag the whole spend path into the
// bundle — stub them so the Library's own copy is the only thing under test.
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/otto/stuff/AddAssetDialog", () => ({ AddAssetDialog: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { StuffLibrary } = await import("@/components/otto/stuff/StuffLibrary");
const { OttoStuff } = await import("@/components/otto/OttoStuff");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  // OttoStuff always refetches history on mount and REPLACES the injected prop with what
  // comes back — so the fixture has to live here, not only in the prop.
  mocks.getGenerationHistory.mockResolvedValue({
    items: [
      { id: "g1", projectId: "p1", assetId: "a1", url: "https://cdn.test/g1.png", kind: "image", prompt: "laksa" },
    ],
    nextCursor: null,
    hasMore: false,
  });
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

/** Type into a real input the way the merchant does (React's onChange sees it). */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

// ---------------------------------------------------------------------------
// ① a search that finds nothing is not an empty library
// ---------------------------------------------------------------------------
describe("#701 a search miss says it missed, not that the library is empty", () => {
  it("library grid: names the query instead of claiming nothing is here", async () => {
    const dom = await mount(createElement(StuffLibrary, { items: ONE_IMAGE, mode: "library" as const }));

    const search = dom.querySelector<HTMLInputElement>('input[aria-label="Search library"]');
    expect(search, "the library search box is gone").toBeTruthy();
    await typeInto(search!, "zzzznotfound");

    const text = dom.textContent ?? "";
    expect(text, "a full library told the merchant it was empty").not.toContain("Nothing here yet.");
    expect(text, "the miss does not name what was searched for").toContain("zzzznotfound");
  });

  it("picker: same rule — a miss is a miss, not 'no images to pick from'", async () => {
    const dom = await mount(createElement(StuffLibrary, { items: ONE_IMAGE, mode: "picker" as const }));

    const search = dom.querySelector<HTMLInputElement>('input[aria-label="Search images"]');
    expect(search, "the picker search box is gone").toBeTruthy();
    await typeInto(search!, "zzzznotfound");

    const text = dom.textContent ?? "";
    expect(text, "a picker with an image told the merchant there were none").not.toContain(
      "No images to pick from.",
    );
    expect(text).toContain("zzzznotfound");
  });

  it("a genuinely empty library still says so", async () => {
    const dom = await mount(createElement(StuffLibrary, { items: [], mode: "library" as const }));
    expect(dom.textContent).toContain("Nothing here yet.");
  });
});

// ---------------------------------------------------------------------------
// ② every "go to Brand memory" is a link the merchant can click
// ---------------------------------------------------------------------------
describe("#701 Brand memory is pointed at with a link, not with directions", () => {
  it("the empty product-picker dialog links straight to Brand memory", async () => {
    const dom = await mount(
      createElement(OttoStuff, {
        entities: [],
        ads: [],
        adJobs: [],
        records: [],
        history: [
          { id: "g1", projectId: "p1", assetId: "a1", src: "https://cdn.test/g1.png", kind: "image" as const, prompt: "laksa" },
        ],
      }),
    );

    // Open the item's action menu, then choose the product-image action.
    const actionMenu = dom.querySelector<HTMLButtonElement>('button[aria-label^="Actions for "]');
    expect(actionMenu, "the item action menu is gone").toBeTruthy();
    await act(async () => {
      actionMenu!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const setAsProduct = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent?.trim() === "Set as product image",
    );
    expect(setAsProduct, "the Set as product image action is gone").toBeTruthy();
    await act(async () => { setAsProduct!.click(); });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, "the product picker dialog did not open").toBeTruthy();
    expect(dialog!.textContent, "the dialog no longer mentions Brand memory").toContain("Brand memory");

    // W2-11:落地地址从旧壳的 /otto?view=memory 换成真路由 SHELL_ROUTES.brand(/brand)。
    const link = dialog!.querySelector<HTMLAnchorElement>('a[href="/brand"]');
    expect(link, "the merchant is told where to go and left to find it themselves").toBeTruthy();
    expect(link!.textContent?.trim()).not.toBe("");
  });

  it("the empty product-assets filter links there too", async () => {
    const dom = await mount(createElement(StuffLibrary, { items: [], mode: "library" as const }));

    const productsPill = Array.from(dom.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Product assets"),
    );
    expect(productsPill, "the Product assets filter is gone").toBeTruthy();
    await act(async () => {
      productsPill!.click();
    });

    expect(dom.textContent).toContain("Brand memory");
    // W2-11:落地地址从旧壳的 /otto?view=memory 换成真路由 SHELL_ROUTES.brand(/brand)。
    expect(
      dom.querySelector<HTMLAnchorElement>('a[href="/brand"]'),
      "the same dead pointer, one filter over",
    ).toBeTruthy();
  });
});
