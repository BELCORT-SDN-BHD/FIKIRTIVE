// @vitest-environment jsdom
/**
 * 尾巴组九 · 判官 #1159 P2-6 —— 「新建合集」弹层连按两次会建出同名的第二个合集。
 *
 * 验收编号:**FRONT-A6**(冻结表:「商家新建 collection,加入一个生成结果与一个上传,
 * 移除一项,删除 collection」)。这里钉的是那一步的**收口**:合集一旦真的建出来,
 * 这个弹层就不能再建第二个。
 *
 * 修前现象(main d7072345 的 `components/library/CollectionDialogs.tsx`):`create()` 在
 * 两条路上**留着弹层不关** —— ① 素材一件都没进去(`addToCollection` 回 `{error}`),
 * ② 有几件已经不在了(`unavailable > 0`)。留着是对的(那句话得说完),但名字还在框里、
 * 「Create collection」原样可按,商家再按一次就是同名的第二个合集,而屏幕上没有任何东西
 * 说过第一个已经建好了。
 *
 * 真组件 + 真 React;只有服务端动作是假件。断言的是屏幕上的字与键的可按性,不是源码标识符。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  addToCollection: vi.fn(),
}));

vi.mock("@/lib/library-collections", () => ({
  listCollections: mocks.listCollections,
  createCollection: mocks.createCollection,
  addToCollection: mocks.addToCollection,
}));

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

const { CollectionDialogs } = await import("@/components/library/CollectionDialogs");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountDialog() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(CollectionDialogs, {
        subjects: [{ subjectType: "generation" as const, subjectId: "g1" }],
        open: true,
        onOpenChange: () => {},
        startOnCreate: true,
        onChanged: () => {},
      }),
    );
  });
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No button reading "${label}" — screen says: ${document.body.textContent}`);
  return found as HTMLButtonElement;
}

function nameField(): HTMLInputElement {
  const found = document.body.querySelector<HTMLInputElement>('input[aria-label="Collection name"]');
  if (!found) throw new Error(`No name field — screen says: ${document.body.textContent}`);
  return found;
}

async function typeName(value: string) {
  const field = nameField();
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function press(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await settle();
}

beforeEach(() => {
  mocks.listCollections.mockReset();
  mocks.createCollection.mockReset();
  mocks.addToCollection.mockReset();
  mocks.listCollections.mockResolvedValue({ collections: [] });
  mocks.createCollection.mockResolvedValue({ id: "c1", name: "Ramadan launch" });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

describe("FRONT-A6 — the New collection dialog creates one collection, not two", () => {
  it("FRONT-A6: pressing Create collection again after some items were unavailable does not create a second collection", async () => {
    mocks.addToCollection.mockResolvedValue({ added: 2, skipped: 0, unavailable: 1 });
    await mountDialog();
    await typeName("Ramadan launch");

    await press(button("Create collection"));
    expect(mocks.createCollection).toHaveBeenCalledTimes(1);
    // 弹层留着,那句「有几件已经不在了」说完 —— 这一半是修前就对的,不能被这次收口弄丢。
    expect(document.body.textContent).toContain(
      "Ramadan launch was created. 1 item is no longer available, so it wasn't added.",
    );

    const again = button("Create collection");
    expect(again.disabled, "the create key must be spent once the collection exists").toBe(true);
    await press(again);
    expect(mocks.createCollection).toHaveBeenCalledTimes(1);
  });

  it("FRONT-A6: pressing Create collection again after the items could not be added does not create a second collection", async () => {
    mocks.addToCollection.mockResolvedValue({ error: "Not found." });
    await mountDialog();
    await typeName("Ramadan launch");

    await press(button("Create collection"));
    expect(mocks.createCollection).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "Ramadan launch was created, but nothing was added. Not found.",
    );

    const again = button("Create collection");
    expect(again.disabled).toBe(true);
    await press(again);
    expect(mocks.createCollection).toHaveBeenCalledTimes(1);
  });

  it("FRONT-A6: pressing Enter in the name field again does not create a second collection either", async () => {
    mocks.addToCollection.mockResolvedValue({ added: 0, skipped: 0, unavailable: 1 });
    await mountDialog();
    await typeName("Ramadan launch");

    const field = nameField();
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(mocks.createCollection).toHaveBeenCalledTimes(1);

    expect(nameField().disabled, "the name field is spent too").toBe(true);
    await act(async () => {
      nameField().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(mocks.createCollection).toHaveBeenCalledTimes(1);
  });

  it("FRONT-A6: the way out of the dialog reads Done once the collection exists, not Cancel", async () => {
    mocks.addToCollection.mockResolvedValue({ added: 2, skipped: 0, unavailable: 1 });
    await mountDialog();
    expect(button("Cancel")).toBeTruthy();

    await typeName("Ramadan launch");
    await press(button("Create collection"));

    expect(button("Done")).toBeTruthy();
    expect(
      [...document.body.querySelectorAll("button")].some(
        (item) => item.textContent?.trim() === "Cancel",
      ),
      "Cancel would say the collection was not created — it was",
    ).toBe(false);
  });
});
