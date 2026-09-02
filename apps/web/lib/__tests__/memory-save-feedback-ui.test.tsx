// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FactSection } from "@/components/otto/memory/FactSection";
import { MemoryNoteCard } from "@/components/otto/memory/MemoryNoteCard";
import type { MemoryRow } from "@/lib/memory-actions";

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

const ROW: MemoryRow = {
  id: "memory-1",
  category: "about",
  content: "We use recyclable packaging.",
  source: "user",
  pinned: true,
  updatedAt: new Date("2026-08-27T00:00:00.000Z"),
};

const NOTE: MemoryRow = {
  ...ROW,
  id: "note-1",
  category: "customers",
  content: "They compare delivery times before ordering.",
  source: "otto",
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

async function openEdit(actionsLabel: string): Promise<void> {
  const trigger = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${actionsLabel}"]`);
  if (!trigger) throw new Error(`No actions trigger labelled "${actionsLabel}"`);

  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });

  const editItem = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (candidate) => candidate.textContent?.trim() === "Edit",
  );
  if (!editItem) throw new Error("Edit menu item was not rendered");
  await click(editItem);
}

async function enterText(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Brand memory save feedback", () => {
  it("locks fact edits, keeps server refusals visible, and closes only after retry succeeds", async () => {
    let settleFirst: ((value: string | null) => void) | undefined;
    const firstAttempt = new Promise<string | null>((resolve) => { settleFirst = resolve; });
    const save = vi
      .fn<(id: string, content: string) => Promise<string | null>>()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(null);

    await render(
      <FactSection
        label=""
        rows={[ROW]}
        freshIds={new Set()}
        onSave={save}
        onAdd={async () => null}
        onDelete={async () => null}
      />,
    );
    await openEdit(`Actions for ${ROW.content}`);

    const confirm = button("Save");
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(button("Saving…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);

    await act(async () => settleFirst?.("Memory not found."));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Brand detail wasn't saved");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Memory not found.");
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Edit this fact"]')?.value).toBe(ROW.content);

    await click(button("Save"));
    expect(save).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[aria-label="Edit this fact"]')).toBeNull();
    expect(document.querySelector(`button[aria-label="Actions for ${ROW.content}"]`)).not.toBeNull();
  });

  it("keeps a rejected new detail and retries without making the merchant retype it", async () => {
    const add = vi
      .fn<(content: string) => Promise<string | null>>()
      .mockResolvedValueOnce("A memory needs a category and some text.")
      .mockResolvedValueOnce(null);

    await render(
      <FactSection
        label=""
        rows={[]}
        freshIds={new Set()}
        onSave={async () => null}
        onAdd={add}
        onDelete={async () => null}
      />,
    );
    await click(button("Add detail"));

    const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="Add a fact about your brand"]');
    if (!textarea) throw new Error("Add-detail textarea was not rendered");
    await enterText(textarea, "Only use certified recyclable boxes.");
    await click(button("Add detail"));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Brand detail wasn't saved");
    expect(textarea.value).toBe("Only use certified recyclable boxes.");
    expect(add).toHaveBeenCalledWith("Only use certified recyclable boxes.");

    await click(button("Add detail"));
    expect(add).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[aria-label="Add a fact about your brand"]')).toBeNull();
    expect(document.body.textContent).toContain("No saved details yet");
  });

  it("keeps a note edit open after a connection failure and retries in place", async () => {
    const save = vi
      .fn<(id: string, content: string) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);

    await render(
      <MemoryNoteCard note={NOTE} fresh onSave={save} onDelete={async () => null} />,
    );
    await openEdit(`Actions for ${NOTE.content}`);
    await click(button("Save"));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Note wasn't saved");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "The note couldn't be saved. Check your connection and try again.",
    );
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Edit this saved note"]')?.value).toBe(NOTE.content);

    await click(button("Save"));
    expect(save).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[aria-label="Edit this saved note"]')).toBeNull();
    expect(document.querySelector(`button[aria-label="Actions for ${NOTE.content}"]`)).not.toBeNull();
  });

  it("forwards action refusals before refreshing facts, additions, and loose notes", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../components/otto/OttoMemory.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /const updateAndRefreshMemory = async[\s\S]+?const result = await updateMemory[\s\S]+?if \(\"error\" in result\) return result\.error;[\s\S]+?await refreshMemory\(\);[\s\S]+?return null;/,
    );
    expect(source).toMatch(
      /const addAndRefreshMemory = async[\s\S]+?const result = await addMemory[\s\S]+?if \(\"error\" in result\) return result\.error;[\s\S]+?await refreshMemory\(\);[\s\S]+?return null;/,
    );
    expect(source).toContain("onSave: updateAndRefreshMemory");
    expect(source).toContain("onAdd: (content: string) => addAndRefreshMemory(sectionKey, content)");
    expect(source).toContain("const noteSave = updateAndRefreshMemory;");
  });
});
