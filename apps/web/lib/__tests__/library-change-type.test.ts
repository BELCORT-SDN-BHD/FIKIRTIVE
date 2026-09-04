// @vitest-environment jsdom
// 本面自 PR #1152 起无路由挂载(/library 改画 components/library/LibraryView.tsx),围栏仅护组件本身；tidy 待登记。
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

// Radix overlays 在 jsdom 里要这三样才活得起来(popper 量尺寸、指针捕获、滚动)。
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

async function openAction(scope: ParentNode, label: string): Promise<void> {
  const trigger = scope.querySelector<HTMLButtonElement>('button[aria-label^="Actions for "]');
  expect(trigger, "the item action menu is gone").toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  const action = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((item) => item.textContent?.trim() === label);
  expect(action, `the item menu has no ${label} action`).toBeTruthy();
  await act(async () => { action!.click(); });
}

/** Pick the visible ToggleGroup option whose label starts with `label`. */
async function pickType(label: string): Promise<void> {
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog, "the Change type dialog is gone").toBeTruthy();
  const option = Array.from(
    dialog!.querySelectorAll<HTMLButtonElement>('[data-slot="toggle-group-item"]'),
  ).find((item) => item.textContent?.trim().startsWith(label));
  expect(option, `no "${label}" option in the type choices`).toBeTruthy();
  await act(async () => { option!.click(); });
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

    await openAction(dom, "Change type");

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, "Change type opened nothing").toBeTruthy();
    expect(dialog!.textContent, "the dialog doesn't say which item is being changed").toContain("Sambal bottle");
    expect(onChangeType, "the type changed before the merchant chose anything").not.toHaveBeenCalled();
  });

  it("a generation tile has no Change type control — only saved elements have a kind", async () => {
    const dom = await mount(
      createElement(StuffLibrary, { items: A_GENERATION, mode: "library" as const, onChangeType: vi.fn(async () => null) }),
    );
    expect(dom.querySelector('button[aria-label^="Actions for "]')).toBeFalsy();
  });
});

describe("Library — Change type says what the change costs before it is saved", () => {
  it("Save is refused until the kind actually changes", async () => {
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType: vi.fn(async () => null) }),
    );
    await openAction(dom, "Change type");
    expect(buttonWithText(document.body, "Save")!.disabled, "Save is live before anything changed").toBe(true);
  });

  it("past work is named as untouched, in the dialog, before saving", async () => {
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType: vi.fn(async () => null) }),
    );
    await openAction(dom, "Change type");
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("keeps the wording it was made with");
  });

  it("switching TO Cast surfaces the reference-photo rule", async () => {
    const dom = await mount(
      createElement(StuffLibrary, { items: A_PRODUCT, mode: "library" as const, onChangeType: vi.fn(async () => null) }),
    );
    await openAction(dom, "Change type");
    expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Cast needs a reference photo");

    await pickType("Cast");
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Cast needs a reference photo");
  });

  it("switching AWAY from Cast does not paste that rule onto an unrelated change", async () => {
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType: vi.fn(async () => null) }),
    );
    await openAction(dom, "Change type");
    await pickType("Product");
    expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Cast needs a reference photo");
  });
});

describe("Library — Change type saves, and a refusal is readable", () => {
  it("locks every exit and blocks a same-tick double save while the type changes", async () => {
    let finish!: (value: string | null) => void;
    const onChangeType = vi.fn(
      () => new Promise<string | null>((resolve) => { finish = resolve; }),
    );
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType }),
    );
    await openAction(dom, "Change type");
    await pickType("Product");

    const save = buttonWithText(document.body, "Save")!;
    await act(async () => {
      save.click();
      save.click();
      await Promise.resolve();
    });

    expect(onChangeType).toHaveBeenCalledTimes(1);
    expect(buttonWithText(document.body, "Saving…")?.disabled).toBe(true);
    expect(document.querySelector('[aria-label="Saving type"]')).toBeTruthy();
    expect(buttonWithText(document.body, "Cancel")?.disabled).toBe(true);
    expect(buttonWithText(document.body, "Close")?.disabled).toBe(true);
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] [data-slot="toggle-group-item"]',
        ),
      )
        .every((item) => item.disabled),
    ).toBe(true);

    await act(async () => { finish(null); });
    expect(document.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it("saving routes the element id and the chosen kind exactly once", async () => {
    const onChangeType = vi.fn(async () => null);
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType }),
    );
    await openAction(dom, "Change type");
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
    await openAction(dom, "Change type");
    await pickType("Product");
    await act(async () => { buttonWithText(document.body, "Save")!.click(); });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, "the dialog closed on a refusal — the merchant never learns why").toBeTruthy();
    expect(dialog!.querySelector('[role="alert"]')?.textContent).toContain(busy);
  });

  it("turns a thrown response into readable feedback and leaves a retry path", async () => {
    const onChangeType = vi.fn(async () => {
      throw new Error("response lost");
    });
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType }),
    );
    await openAction(dom, "Change type");
    await pickType("Product");
    await act(async () => { buttonWithText(document.body, "Save")!.click(); });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.querySelector('[role="alert"]')?.textContent).toContain(
      "The type couldn't be changed. Check your connection and try again.",
    );
    expect(buttonWithText(document.body, "Save")?.disabled).toBe(false);
    expect(buttonWithText(document.body, "Cancel")?.disabled).toBe(false);
  });

  it("Cancel closes without changing anything", async () => {
    const onChangeType = vi.fn(async () => null);
    const dom = await mount(
      createElement(StuffLibrary, { items: BOTTLE_AS_PERSON, mode: "library" as const, onChangeType }),
    );
    await openAction(dom, "Change type");
    await pickType("Product");
    await act(async () => { buttonWithText(document.body, "Cancel")!.click(); });

    expect(onChangeType).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeFalsy();
  });
});
