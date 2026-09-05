// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const NOTE: MemoryRow = {
  id: "note-1",
  category: "customers",
  content: "They compare delivery times before ordering.",
  source: "otto",
  pinned: true,
  updatedAt: new Date("2026-08-27T00:00:00.000Z"),
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

async function openRemoveDialog(): Promise<void> {
  const trigger = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="Actions for They compare delivery times before ordering."]',
  );
  if (!trigger) throw new Error("Note actions trigger was not rendered");

  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });

  const removeItem = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (candidate) => candidate.textContent?.trim() === "Remove note",
  );
  if (!removeItem) throw new Error("Remove note menu item was not rendered");
  await click(removeItem);
}

function NoteHarness({ remove }: { remove: (id: string) => Promise<string | null> }) {
  const [notes, setNotes] = useState([NOTE]);

  return notes.map((note) => (
    <MemoryNoteCard
      key={note.id}
      note={note}
      fresh
      onSave={async () => null}
      onDelete={async (id) => {
        const failure = await remove(id);
        if (failure) return failure;
        setNotes((current) => current.filter((candidate) => candidate.id !== id));
        return null;
      }}
    />
  ));
}

describe("Brand memory loose-note removal", () => {
  it("explains the impact and keeps the note when the merchant cancels", async () => {
    const remove = vi.fn(async () => null);
    await render(<NoteHarness remove={remove} />);
    await openRemoveDialog();

    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("This removes the note from Brand memory.");
    expect(dialog?.textContent).toContain("Otto will stop using this note in future Canvases.");
    expect(dialog?.textContent).toContain("Existing Canvases and generated assets stay unchanged.");

    await click(button("Keep note"));
    expect(remove).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.textContent).toContain(NOTE.content);
  });

  it("blocks a same-tick double submit, shows a refusal, and retries from the same dialog", async () => {
    let settleFirst: ((value: string | null) => void) | undefined;
    const firstAttempt = new Promise<string | null>((resolve) => { settleFirst = resolve; });
    const remove = vi
      .fn<(id: string) => Promise<string | null>>()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(null);

    await render(<NoteHarness remove={remove} />);
    await openRemoveDialog();

    const confirm = button("Remove note");
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(button("Removing…").disabled).toBe(true);
    expect(button("Keep note").disabled).toBe(true);

    await act(async () => settleFirst?.("Memory not found."));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Note wasn't removed");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Memory not found.");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(button("Remove note").disabled).toBe(false);
    expect(document.body.textContent).toContain(NOTE.content);

    await click(button("Remove note"));
    expect(remove).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain(NOTE.content);
  });

  it("keeps a connection failure visible and leaves the retry enabled", async () => {
    const remove = vi.fn(async () => { throw new Error("offline"); });
    await render(<NoteHarness remove={remove} />);
    await openRemoveDialog();
    await click(button("Remove note"));

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "The note couldn't be removed. Check your connection and try again.",
    );
    expect(button("Remove note").disabled).toBe(false);
  });

  it("uses one shared note card in both sections and forwards the server result", () => {
    const webRoot = path.resolve(__dirname, "../..");
    const segment = fs.readFileSync(path.join(webRoot, "components/otto/memory/SegmentCards.tsx"), "utf8");
    const product = fs.readFileSync(path.join(webRoot, "components/otto/memory/ProductShowcase.tsx"), "utf8");
    const memory = fs.readFileSync(path.join(webRoot, "components/otto/OttoMemory.tsx"), "utf8");

    expect(segment).toContain("<MemoryNoteCard");
    expect(product).toContain("<MemoryNoteCard");
    expect(memory).toContain("const noteDelete = async (id: string) => {");
    expect(memory).toContain('if ("error" in result) return result.error;');
    expect(memory).toContain("setMemory((current) => current.filter((row) => row.id !== id));");
  });
});
