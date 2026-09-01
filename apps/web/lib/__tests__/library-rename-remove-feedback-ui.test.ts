// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StuffItem } from "@/lib/stuff-items";

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

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(element);
  });
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No button reading "${label}" — screen says: ${document.body.textContent}`);
  return found;
}

async function openAction(label: string) {
  const trigger = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label^="Actions for "]',
  );
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(item).not.toBeUndefined();
  await act(async () => {
    item!.click();
  });
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  container?.remove();
  document.body.innerHTML = "";
  root = null;
  container = null;
});

describe("Library rename feedback", () => {
  it("locks every exit and blocks a same-tick double rename", async () => {
    let finish!: (value: string | null) => void;
    const onRename = vi.fn(
      () => new Promise<string | null>((resolve) => { finish = resolve; }),
    );
    await mount(
      createElement(StuffLibrary, {
        items: ENTITY_ITEM,
        mode: "library" as const,
        onRename,
      }),
    );
    await openAction("Rename");
    const input = document.body.querySelector<HTMLInputElement>('[aria-label="Item name"]')!;
    await typeInto(input, "Mira");

    const save = button("Save");
    await act(async () => {
      save.click();
      save.click();
      await Promise.resolve();
    });

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("e1", "Mira");
    expect(button("Saving…").disabled).toBe(true);
    expect(document.body.querySelector('[aria-label="Saving name"]')).not.toBeNull();
    expect(input.disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    expect(button("Close").disabled).toBe(true);

    await act(async () => { finish(null); });
    await settle();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps a server refusal beside the field and leaves a retry path", async () => {
    const onRename = vi.fn(async () => "That name is already used.");
    await mount(
      createElement(StuffLibrary, {
        items: ENTITY_ITEM,
        mode: "library" as const,
        onRename,
      }),
    );
    await openAction("Rename");
    await typeInto(
      document.body.querySelector<HTMLInputElement>('[aria-label="Item name"]')!,
      "Mira",
    );
    await act(async () => { button("Save").click(); });
    await settle();

    const alert = document.body.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Name wasn't changed");
    expect(alert?.textContent).toContain("That name is already used.");
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(button("Save").disabled).toBe(false);
  });

  it("turns a thrown rename into readable feedback", async () => {
    const onRename = vi.fn(async () => {
      throw new Error("response lost");
    });
    await mount(
      createElement(StuffLibrary, {
        items: ENTITY_ITEM,
        mode: "library" as const,
        onRename,
      }),
    );
    await openAction("Rename");
    await typeInto(
      document.body.querySelector<HTMLInputElement>('[aria-label="Item name"]')!,
      "Mira",
    );
    await act(async () => { button("Save").click(); });
    await settle();

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "The name couldn't be saved. Check your connection and try again.",
    );
    expect(button("Save").disabled).toBe(false);
  });
});

describe("Library remove feedback", () => {
  it("keeps the confirmation open, locks Cancel, and blocks a same-tick double remove", async () => {
    let finish!: (value: string | null) => void;
    const onDelete = vi.fn(
      () => new Promise<string | null>((resolve) => { finish = resolve; }),
    );
    await mount(
      createElement(StuffLibrary, {
        items: ENTITY_ITEM,
        mode: "library" as const,
        onDelete,
      }),
    );
    await openAction("Remove from Library");

    const remove = button("Remove");
    await act(async () => {
      remove.click();
      remove.click();
      await Promise.resolve();
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("e1");
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(button("Removing…").disabled).toBe(true);
    expect(document.body.querySelector('[aria-label="Removing item"]')).not.toBeNull();
    expect(button("Cancel").disabled).toBe(true);

    await act(async () => { finish(null); });
    await settle();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("keeps an explicit removal refusal in the confirmation", async () => {
    const onDelete = vi.fn(async () => "This item is still in use.");
    await mount(
      createElement(StuffLibrary, {
        items: ENTITY_ITEM,
        mode: "library" as const,
        onDelete,
      }),
    );
    await openAction("Remove from Library");
    await act(async () => { button("Remove").click(); });
    await settle();

    const alert = document.body.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Item wasn't removed");
    expect(alert?.textContent).toContain("This item is still in use.");
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(button("Remove").disabled).toBe(false);
  });

  it("turns a thrown removal into readable feedback", async () => {
    const onDelete = vi.fn(async () => {
      throw new Error("response lost");
    });
    await mount(
      createElement(StuffLibrary, {
        items: ENTITY_ITEM,
        mode: "library" as const,
        onDelete,
      }),
    );
    await openAction("Remove from Library");
    await act(async () => { button("Remove").click(); });
    await settle();

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "The item couldn't be removed. Check your connection and try again.",
    );
    expect(button("Remove").disabled).toBe(false);
  });
});
