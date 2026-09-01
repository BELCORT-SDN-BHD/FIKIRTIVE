// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FactSection } from "@/components/otto/memory/FactSection";
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
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
    'button[aria-label="Actions for We use recyclable packaging."]',
  );
  if (!trigger) throw new Error("Fact actions trigger was not rendered");

  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });

  const removeItem = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (candidate) => candidate.textContent?.trim() === "Remove detail",
  );
  if (!removeItem) throw new Error("Remove detail menu item was not rendered");
  await click(removeItem);
}

function FactHarness({ remove }: { remove: (id: string) => Promise<string | null> }) {
  const [rows, setRows] = useState([ROW]);

  return (
    <FactSection
      label=""
      rows={rows}
      freshIds={new Set()}
      onSave={async () => null}
      onAdd={async () => null}
      onDelete={async (id) => {
        const failure = await remove(id);
        if (failure) return failure;
        setRows((current) => current.filter((row) => row.id !== id));
        return null;
      }}
    />
  );
}

describe("Brand memory fact removal", () => {
  it("explains future impact separately from existing work and cancels without deleting", async () => {
    const remove = vi.fn(async () => null);
    await render(<FactHarness remove={remove} />);
    await openRemoveDialog();

    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("This removes the saved detail from Brand memory.");
    expect(dialog?.textContent).toContain("Otto will stop using this detail in future projects.");
    expect(dialog?.textContent).toContain("Existing projects and generated assets stay unchanged.");

    await click(button("Keep detail"));
    expect(remove).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.textContent).toContain(ROW.content);
  });

  it("locks a same-tick double submit, keeps a refusal visible, and retries in place", async () => {
    let settleFirst: ((value: string | null) => void) | undefined;
    const firstAttempt = new Promise<string | null>((resolve) => { settleFirst = resolve; });
    const remove = vi
      .fn<(id: string) => Promise<string | null>>()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(null);

    await render(<FactHarness remove={remove} />);
    await openRemoveDialog();

    const confirm = button("Remove detail");
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(button("Removing…").disabled).toBe(true);
    expect(button("Keep detail").disabled).toBe(true);

    await act(async () => settleFirst?.("Memory not found."));

    const error = document.querySelector<HTMLElement>('[role="alert"]');
    expect(error?.textContent).toContain("Detail wasn't removed");
    expect(error?.textContent).toContain("Memory not found.");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(button("Remove detail").disabled).toBe(false);
    expect(document.body.textContent).toContain(ROW.content);

    await click(button("Remove detail"));
    expect(remove).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain(ROW.content);
  });

  it("keeps an unexpected connection failure in the same decision point", async () => {
    const remove = vi.fn(async () => { throw new Error("offline"); });
    await render(<FactHarness remove={remove} />);
    await openRemoveDialog();
    await click(button("Remove detail"));

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "The detail couldn't be removed. Check your connection and try again.",
    );
    expect(button("Remove detail").disabled).toBe(false);
  });

  it("forwards the server refusal and removes local state only after confirmed success", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../components/otto/OttoMemory.tsx"),
      "utf8",
    );

    expect(source).toContain('const result = await deleteMemory({ id });');
    expect(source).toContain('if ("error" in result) return result.error;');
    expect(source).toContain("setMemory((current) => current.filter((row) => row.id !== id));");
  });
});
