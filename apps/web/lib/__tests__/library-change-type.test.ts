// @vitest-environment jsdom
/**
 * beta bug 4 —— Library 卡片上的「Change type」。
 *
 * 病灶:元素的类型建好就再也改不了。录屏里那只瓶子被存成了人,每一次生成都被描述成人,
 * 而商家的唯一出路是删掉元素、连参考照一起丢。
 *
 * 钉板(界面这一面):
 *   ① 元素卡上真有这个入口 —— 只在元素卡上有,点开的弹窗要说清改的是哪一件东西;
 *   ② 没改之前不能保存 —— 一个「保存了什么都没变」的按钮只会制造假动作;
 *   ③ **换成 Cast 要把附带的规矩说出来**:角色没有参考照会在生成开始前被拒。反方向
 *      (从 Cast 换走)不说,免得把一句无关的警告贴在每一次切换上;
 *   ④ 过去的作品不重做 —— 这句话必须在按下保存之前就在屏幕上;
 *   ⑤ 动作那边的在飞拒绝要**原样**显示,而且弹窗不许关:商家必须读到为什么没生效。
 */
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StuffItem } from "@/lib/stuff-items";

// Radix Select 在 jsdom 里要这三样才活得起来(popper 量尺寸、指针捕获、滚动到选中项)。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { StuffLibrary } = await import("@/components/otto/stuff/StuffLibrary");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => { vi.clearAllMocks(); });

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
}

/** Open the Select and pick the option whose label starts with `label`. */
async function pickType(label: string): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]');
  expect(trigger, "the type Select is gone").toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    .find((o) => o.textContent?.trim().startsWith(label));
  expect(option, `no "${label}" option in the type Select`).toBeTruthy();
  await act(async () => {
    option!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

const BOTTLE_AS_PERSON: StuffItem[] = [
  {
    id: "entity:e1",
    source: "entity",
    label: "Sambal bottle",
    url: "https://cdn.test/bottle.png",
    mediaKind: "image",
    entityId: "e1",
    entityType: "CHARACTER",
  },
];

const A_PRODUCT: StuffItem[] = [
  {
    id: "entity:e2",
    source: "entity",
    label: "Signature latte",
    url: "https://cdn.test/latte.png",
    mediaKind: "image",
    entityId: "e2",
    entityType: "PRODUCT",
  },
];

const A_GENERATION: StuffItem[] = [
  {
    id: "gen:g1",
    source: "gen",
    label: "a poster",
    url: "https://cdn.test/poster.png",
    mediaKind: "image",
    generationId: "g1",
    projectId: "p1",
  },
];

describe("Library — the Change type entry exists on an element card (beta bug 4)", () => {
  it("an element tile offers Change type and names the item in the dialog", async () => {
    const onChangeType = vi.fn(async () => null);
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType }),
    );

    const trigger = buttonWithText(dom, "Change type");
    expect(trigger, "the element card has no Change type control").toBeTruthy();
    await act(async () => { trigger!.click(); });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, "Change type opened nothing").toBeTruthy();
    expect(dialog!.textContent, "the dialog doesn't say which item is being changed").toContain("Sambal bottle");
    expect(onChangeType, "the type changed before the merchant chose anything").not.toHaveBeenCalled();
  });

  it("a generation tile has no Change type control — only saved elements have a kind", async () => {
    const dom = await mount(
      createElement(StuffLibrary, { items: A_GENERATION, mode: "library" as const, onChangeType: vi.fn(async () => null) }),
    );
    expect(buttonWithText(dom, "Change type")).toBeFalsy();
  });
});

describe("Library — Change type says what the change costs before it is saved", () => {
  it("Save is refused until the kind actually changes", async () => {
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType: vi.fn(async () => null) }),
    );
    await act(async () => { buttonWithText(dom, "Change type")!.click(); });
    expect(buttonWithText(document.body, "Save")!.disabled, "Save is live before anything changed").toBe(true);
  });

  it("past work is named as untouched, in the dialog, before saving", async () => {
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType: vi.fn(async () => null) }),
    );
    await act(async () => { buttonWithText(dom, "Change type")!.click(); });
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("keeps the wording it was made with");
  });

  it("switching TO Cast surfaces the reference-photo rule", async () => {
    const dom = await mount(
      createElement(StuffLibrary, { items: A_PRODUCT, mode: "library" as const, onChangeType: vi.fn(async () => null) }),
    );
    await act(async () => { buttonWithText(dom, "Change type")!.click(); });
    expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Cast needs a reference photo");

    await pickType("Cast");
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Cast needs a reference photo");
  });

  it("switching AWAY from Cast does not paste that rule onto an unrelated change", async () => {
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType: vi.fn(async () => null) }),
    );
    await act(async () => { buttonWithText(dom, "Change type")!.click(); });
    await pickType("Product");
    expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Cast needs a reference photo");
  });
});

describe("Library — Change type saves, and a refusal is readable", () => {
  it("saving routes the element id and the chosen kind exactly once", async () => {
    const onChangeType = vi.fn(async () => null);
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType }),
    );
    await act(async () => { buttonWithText(dom, "Change type")!.click(); });
    await pickType("Product");
    await act(async () => { buttonWithText(document.body, "Save")!.click(); });

    expect(onChangeType).toHaveBeenCalledTimes(1);
    expect(onChangeType).toHaveBeenCalledWith("e1", "PRODUCT");
    expect(document.querySelector('[role="dialog"]'), "the dialog stayed open after a successful save").toBeFalsy();
  });

  it("the in-flight refusal is shown verbatim and the dialog stays open", async () => {
    const busy = "A generation using this is still running — wait for it to finish, then change the type.";
    const onChangeType = vi.fn(async () => busy);
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType }),
    );
    await act(async () => { buttonWithText(dom, "Change type")!.click(); });
    await pickType("Product");
    await act(async () => { buttonWithText(document.body, "Save")!.click(); });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, "the dialog closed on a refusal — the merchant never learns why").toBeTruthy();
    expect(dialog!.querySelector('[role="alert"]')?.textContent).toBe(busy);
  });

  it("Cancel closes without changing anything", async () => {
    const onChangeType = vi.fn(async () => null);
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType }),
    );
    await act(async () => { buttonWithText(dom, "Change type")!.click(); });
    await pickType("Product");
    await act(async () => { buttonWithText(document.body, "Cancel")!.click(); });

    expect(onChangeType).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeFalsy();
  });
});
