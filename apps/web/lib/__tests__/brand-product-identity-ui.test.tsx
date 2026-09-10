// @vitest-environment jsdom

/**
 * Brand 页产品表单交上来的**身份意图**(规格 `docs/specs/brand-product-identity.md`
 * §1.4 与 §5 PRODID-R6;票 #1323)。
 *
 * R6 定的判据是「这一格有没有被提交上来」。答得出这句话的只有那张真的画着输入框的界面 ——
 * 所以这份文件在 jsdom 里把 `ProductShowcase` 渲染出来、按下 Edit、按下 Save,看它究竟把
 * 哪几格交给了上游。
 *
 * 要钉的那一格:这张表单有 Name 栏,**没有主图栏**(换/清封面是卡片菜单上那两颗独立的键)。
 * 上一版由 `OttoMemory.prodSave` 替它猜,把 `data.imageAssetId` 当主图意图无条件递下去 ——
 * 而那一格的值是读路 `withProductIdentity` 补进 `data` 的客户端快照。后果是商家在 Library
 * 换过封面之后,回到 Brand 页改一次价就把旧封面写回权威。
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductShowcase } from "@/components/otto/memory/ProductShowcase";
import type { BrandRecordRow } from "@/lib/brand-record-actions";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

/**
 * 读路交给界面的那一行:`data` 里的 `name` 与 `imageAssetId` 都是身份 join 上来的**缓存**
 * (`withProductIdentity`),不是价签自己存的。这份 fixture 刻意带上 `imageAssetId`,
 * 因为那正是上一版顺手递下去的那一格。
 */
const PRODUCT: BrandRecordRow = {
  id: "product-1",
  kind: "product",
  data: { name: "Morning blend", price: "RM 18", imageAssetId: "as_stale_snapshot" },
  status: "active",
  startsAt: null,
  endsAt: null,
  source: "user",
  pinned: false,
  updatedAt: new Date("2026-09-11T00:00:00.000Z"),
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

async function render(element: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match;
}

async function chooseMenuItem(recordLabel: string, itemLabel: string): Promise<void> {
  const trigger = document.body.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${recordLabel}"]`);
  if (!trigger) throw new Error(`No actions trigger for "${recordLabel}"`);
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (candidate) => candidate.textContent?.trim() === itemLabel,
  );
  if (!item) throw new Error(`No menu item labelled "${itemLabel}"`);
  await click(item);
}

type SaveFn = (
  id: string | undefined,
  data: Record<string, unknown>,
  identity?: { name?: string; imageAssetId?: string | null },
) => Promise<string | null>;

function harness(save: SaveFn, setImage: (rec: BrandRecordRow, assetId: string | null) => Promise<string | null>) {
  return (
    <ProductShowcase
      records={[PRODUCT]}
      looseNotes={[]}
      freshIds={new Set()}
      stuffItems={[]}
      onSave={save}
      onArchive={async () => null}
      onNoteSave={async () => null}
      onNoteDelete={async () => null}
      onSetImage={setImage}
      onOpenPicker={() => {}}
    />
  );
}

describe("PRODID-A4 Brand 页产品表单交上来的身份意图", () => {
  it("PRODID-A4 Brand 页表单没有主图栏:保存只交名字这一格,不交主图", async () => {
    const save = vi.fn<SaveFn>().mockResolvedValue(null);
    await render(harness(save, async () => null));
    await chooseMenuItem("Morning blend", "Edit");

    // 商家改的是名字(表单上真有这一栏)。
    const nameInput = Array.from(document.body.querySelectorAll<HTMLInputElement>("input"))
      .find((input) => input.value === "Morning blend");
    if (!nameInput) throw new Error("No Name input prefilled with the product name");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(nameInput, "Morning blend v2");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await click(button("Save"));

    expect(save).toHaveBeenCalledTimes(1);
    const [id, data, identity] = save.mock.calls[0];
    expect(id).toBe("product-1");
    // 名字这一格交了,而且交的是**这一次提交**里那个值。
    expect(identity).toEqual({ name: "Morning blend v2" });
    // 主图那一格一个字都没交 —— 表单上根本没有它,它在 `data` 里只是一张客户端快照。
    expect(identity && "imageAssetId" in identity).toBe(false);
    expect(data).toMatchObject({ name: "Morning blend v2", imageAssetId: "as_stale_snapshot" });
  });

  it("PRODID-A4 换封面走的是它自己那颗键:只交主图这一格,不经过表单", async () => {
    const save = vi.fn<SaveFn>().mockResolvedValue(null);
    const setImage = vi.fn<(rec: BrandRecordRow, assetId: string | null) => Promise<string | null>>()
      .mockResolvedValue(null);
    await render(harness(save, setImage));

    // 卡片菜单上的「Remove from product」= 清封面。这条路交的是主图,不是名字。
    await chooseMenuItem("Morning blend", "Remove from product");

    expect(setImage).toHaveBeenCalledWith(expect.objectContaining({ id: "product-1" }), null);
    // 清封面不是改名 —— 整张表单那条路一次都没被走过。
    expect(save).not.toHaveBeenCalled();
  });
});
