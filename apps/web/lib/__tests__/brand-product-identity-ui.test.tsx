// @vitest-environment jsdom

/**
 * Brand 页产品**卡片**这一面交出来的身份意图(规格 `docs/specs/brand-product-identity.md`
 * §5 PRODID-R6 / PRODID-R9;票 #1323)。
 *
 * R6 定的判据是「这一格有没有被**提交上来**」,R9 更正了它的一句前提:那张产品表单有 Name 栏、
 * **没有主图栏**(`ProdForm`:Name / Price / Description / Selling angle / Link / Tags / Category),
 * 换封面与清封面是卡片菜单上那两颗独立的键。修法住在 PR #1343:表单交什么由一处说了算
 * (`lib/brand-product-form-identity.ts` 的 `productFormIdentityIntent`)。
 *
 * 接线那一段(表单 → `OttoMemory.prodSave` → `saveBrandRecord`)由 #1343 那条 PRODID-R9 钉住,
 * 走的是 **Add product** 那条路(`brand-route.test.ts` 的「真表单按 Save」);两条路共用同一个
 * `onSave`,所以接线只需要钉一次。这份文件补的是票 #1323 自己那半边 —— **编辑**已有产品那条路
 * 上,表单自己交出来的东西:
 * ① 卡片菜单 Edit → 改名 → Save:这张表单上一个主图控件都没有,而它交上去的那份 `data` 里仍然
 *   带着读路补进来的封面快照;把这份 `data` 喂给生产代码那一处,算出来的身份意图里只有名字,
 *   `imageAssetId` 这个键根本不出现(`undefined` = 不碰,`null` = 清空,两个意思);
 * ②（原「Remove from product」那一条已随该菜单项一起撤掉 —— Founder 2026-09-15 裁决让封面不变量
 *   变成全量的,那颗键按了不会有任何反应;见文件末尾那段说明与规格 §5 变更登记 2026-09-15 行。）
 *
 * 意图一律**调用生产代码**算,不在测试里另抄一份形状 —— 否则实现怎么变测试都绿。
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductShowcase } from "@/components/otto/memory/ProductShowcase";
import { productFormIdentityIntent } from "@/lib/brand-product-form-identity";
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
 * 因为那正是「顺手递下去就出事」的那一格。
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

type SaveFn = (id: string | undefined, data: Record<string, unknown>) => Promise<string | null>;

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

describe("PRODID-R9 Brand 页产品卡片交出来的身份意图(编辑那条路)", () => {
  it("PRODID-R9 编辑已有产品改名按 Save:身份意图只有名字,主图那一格根本不出现", async () => {
    const save = vi.fn<SaveFn>().mockResolvedValue(null);
    await render(harness(save, async () => null));
    await chooseMenuItem("Morning blend", "Edit");

    // 表单里一个主图控件都不该有 —— 下面那句断言的前提就是这一句。
    const controls = Array.from(document.body.querySelectorAll("input, textarea, select"));
    const labels = controls.map((el) => el.getAttribute("placeholder") ?? el.getAttribute("aria-label") ?? "");
    expect(labels.join("|").toLowerCase()).not.toContain("image");

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
    const [id, data] = save.mock.calls[0];
    expect(id).toBe("product-1");
    // 表单手里那份 `data` 仍然带着读路补进来的封面快照 —— 它是画缩略图用的,不是意图。
    expect(data).toMatchObject({ name: "Morning blend v2", imageAssetId: "as_stale_snapshot" });

    // 把这份 `data` 喂给生产代码那一处(`prodSave` 递给写路时走的就是它):只有名字这一格。
    const identity = productFormIdentityIntent(data);
    expect(identity).toEqual({ name: "Morning blend v2" });
    expect("imageAssetId" in identity).toBe(false);
  });

  // 原来这里还有一条「PRODID-R9 清封面走的是它自己那颗键」——它按的是卡片菜单上的
  // 「Remove from product」。Founder 2026-09-15 裁决把封面不变量变成**全量**的(一件还挂着基础层
  // 参考图的产品永远有一张封面),那颗键于是永远会被同一个事务里的 `reconcileEntityCover` 立刻
  // 钉回同一张图 —— 按了没有任何反应,本票把它撤掉(规格 §5 变更登记 2026-09-15 行)。
  // 它原本要证的「封面不经过表单那条路」由上面第①条继续钉着(表单意图里根本没有 `imageAssetId`
  // 这个键);清空封面落回第一张的语义由
  // `packages/db/src/__tests__/entity-cover-autopin.test.ts` 的
  // 「显式「清空封面」在还有图时落回第一张」钉住。
});
