// @vitest-environment jsdom
/**
 * library-guardrails — #934: Library 界面两个缺陷收口。
 *
 * 病灶:
 *   ① 删除单击立即生效,没有确认。软删可恢复,但界面从没说过,商家读成「点错=丢了」。
 *   ② 「Add to Library」的 Upload 半屏不选文件也能提交:createEntity 只要 name 有效就
 *      成功建 Entity,零 ReferenceImage,Library 里多一张没有图的空卡。
 *
 * 钉板:
 *   ① 删除必经确认弹窗 —— 点击 Delete 不能直接调 onDelete;Cancel 不删,Remove 才删。
 *   ② 不选文件时 Add 不可提交,createEntity 从不会在零文件下被调用。
 */
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StuffItem } from "@/lib/stuff-items";

const mocks = vi.hoisted(() => ({
  createEntity: vi.fn(),
  startRefGen: vi.fn(),
  notifyBalanceRefresh: vi.fn(),
}));

vi.mock("@/lib/actions", () => ({ createEntity: mocks.createEntity }));
vi.mock("@/lib/refgen-actions", () => ({ startRefGen: mocks.startRefGen }));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: mocks.notifyBalanceRefresh }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { StuffLibrary } = await import("@/components/otto/stuff/StuffLibrary");
const { AddAssetDialog } = await import("@/components/otto/stuff/AddAssetDialog");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.createEntity.mockReset();
  mocks.startRefGen.mockReset();
  mocks.notifyBalanceRefresh.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

/**
 * 返回的是 `document.body`,不是那个挂载点(W2-1)。
 *
 * 弹窗从手搓的 `fixed inset-0` 换成 `components/ui/dialog` 之后,内容走 Radix 的
 * Portal —— 它渲染到 `document.body` 下面,不在挂载点里。商家看到的东西一样不少,
 * 只是「在 DOM 的哪一支」变了,所以这里把查询范围放到整个文档。
 * (同一份文件里那些 alert-dialog 的断言本来就在查 `document`,与这一条一致。)
 */
async function mount(element: ReactElement): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await act(async () => {
    await Promise.resolve();
  });
  return document.body;
}

/** Type into a real input the way the merchant does (React's onChange sees it). */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function buttonWithText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
}

async function openRemoveAction(root: ParentNode): Promise<void> {
  const trigger = root.querySelector<HTMLButtonElement>('button[aria-label^="Actions for "]');
  expect(trigger, "the item action menu is gone").toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  const action = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((item) => item.textContent?.trim() === "Remove from Library");
  expect(action, "the Remove from Library action is gone").toBeTruthy();
  await act(async () => { action!.click(); });
}

const ENTITY_ITEM: StuffItem[] = [
  {
    id: "entity:e1",
    source: "entity",
    label: "Rosa",
    url: "https://cdn.test/rosa.png",
    mediaKind: "image",
    entityId: "e1",
    entityType: "CHARACTER",
  },
];

// ---------------------------------------------------------------------------
// ① delete requires confirmation
// ---------------------------------------------------------------------------
describe("#934 Library delete goes through a confirmation, not straight to onDelete", () => {
  it("clicking Delete opens a confirm dialog instead of deleting immediately", async () => {
    const onDelete = vi.fn();
    const dom = await mount(
      createElement(StuffLibrary, { items: ENTITY_ITEM, mode: "library" as const, onDelete }),
    );

    await openRemoveAction(dom);

    expect(onDelete, "the item was deleted before any confirmation").not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog, "no confirmation dialog appeared").toBeTruthy();
    expect(dialog!.textContent, "the dialog doesn't say what item is being removed").toContain("Rosa");
    // Honest wording — a soft delete is recoverable; the dialog must not claim otherwise.
    expect(dialog!.textContent?.toLowerCase()).not.toContain("cannot be undone");
    expect(dialog!.textContent?.toLowerCase()).not.toContain("permanently");
  });

  it("Cancel closes the dialog without deleting", async () => {
    const onDelete = vi.fn();
    const dom = await mount(
      createElement(StuffLibrary, { items: ENTITY_ITEM, mode: "library" as const, onDelete }),
    );
    await openRemoveAction(dom);

    const cancel = buttonWithText(document.body, "Cancel");
    expect(cancel, "no Cancel control in the confirm dialog").toBeTruthy();
    await act(async () => { cancel!.click(); });

    expect(onDelete, "Cancel still deleted the item").not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]'), "the dialog stayed open after Cancel").toBeFalsy();
  });

  it("confirming removal calls onDelete exactly once with the item's entityId", async () => {
    const onDelete = vi.fn();
    const dom = await mount(
      createElement(StuffLibrary, { items: ENTITY_ITEM, mode: "library" as const, onDelete }),
    );
    await openRemoveAction(dom);

    const confirm = buttonWithText(document.body, "Remove");
    expect(confirm, "no confirm/Remove control in the dialog").toBeTruthy();
    await act(async () => { confirm!.click(); });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("e1");
    expect(document.querySelector('[role="alertdialog"]'), "the dialog did not close after confirming").toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// ② Add to Library can't submit with zero files
// ---------------------------------------------------------------------------
describe("#934 Add to Library (Upload) can't produce an empty card", () => {
  it("Add stays disabled and createEntity is never called with no file chosen", async () => {
    const dom = await mount(
      createElement(AddAssetDialog, { open: true, onClose: vi.fn(), onDone: vi.fn() }),
    );

    const nameInput = dom.querySelector<HTMLInputElement>('input[placeholder="e.g. Rosa"]');
    expect(nameInput, "the Name field is gone").toBeTruthy();
    await typeInto(nameInput!, "New reference");

    const addButton = buttonWithText(dom, "Add");
    expect(addButton, "the Add submit button is gone").toBeTruthy();
    expect(addButton!.disabled, "Add is clickable with no file chosen").toBe(true);

    // Defense in depth: even a forced click must not reach createEntity.
    await act(async () => { addButton!.click(); });
    expect(mocks.createEntity, "an empty submit reached createEntity").not.toHaveBeenCalled();
  });

  it("choosing a file enables Add and a real submit creates exactly one entity", async () => {
    mocks.createEntity.mockResolvedValue({ id: "e-new" });
    const onDone = vi.fn();
    const onClose = vi.fn();
    const dom = await mount(createElement(AddAssetDialog, { open: true, onClose, onDone }));

    const nameInput = dom.querySelector<HTMLInputElement>('input[placeholder="e.g. Rosa"]');
    await typeInto(nameInput!, "New reference");

    const fileInput = dom.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput, "the file input is gone").toBeTruthy();
    const file = new File(["x"], "rosa.png", { type: "image/png" });
    Object.defineProperty(fileInput!, "files", { value: [file], configurable: true });
    await act(async () => {
      fileInput!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const addButton = buttonWithText(dom, "Add");
    expect(addButton!.disabled, "Add stayed disabled after a file was chosen").toBe(false);

    await act(async () => { addButton!.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(mocks.createEntity).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
