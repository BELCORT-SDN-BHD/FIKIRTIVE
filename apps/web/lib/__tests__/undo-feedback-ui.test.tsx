// @vitest-environment jsdom

import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UndoBar } from "@/components/otto/memory/UndoBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match;
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

function UndoHarness({ undo }: { undo: () => Promise<string | null> }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <UndoBar
      summary="2 added, 1 changed"
      onUndo={async () => {
        const failure = await undo();
        if (failure) return failure;
        setVisible(false);
        return null;
      }}
      onDismiss={() => setVisible(false)}
    />
  );
}

describe("Brand memory Undo feedback", () => {
  it("locks a same-tick double click, keeps a refusal visible, and closes only after retry succeeds", async () => {
    let settleFirst: ((value: string | null) => void) | undefined;
    const firstAttempt = new Promise<string | null>((resolve) => { settleFirst = resolve; });
    const undo = vi
      .fn<() => Promise<string | null>>()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(null);

    await render(<UndoHarness undo={undo} />);
    const submit = button("Undo");
    await act(async () => {
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(undo).toHaveBeenCalledTimes(1);
    expect(button("Undoing…").disabled).toBe(true);
    expect(button("Dismiss").disabled).toBe(true);

    await act(async () => settleFirst?.("Memory not found."));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Brand memory wasn't restored");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Memory not found.");
    expect(button("Try again").disabled).toBe(false);
    expect(document.body.textContent).toContain("2 added, 1 changed");

    await click(button("Try again"));
    expect(undo).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("Otto updated your brand memory");
  });

  it("turns an unexpected connection failure into a retryable Alert", async () => {
    const undo = vi.fn(async () => { throw new Error("offline"); });
    await render(<UndoHarness undo={undo} />);
    await click(button("Undo"));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Brand memory couldn't be restored. Check your connection and try again.",
    );
    expect(button("Try again").disabled).toBe(false);
  });

  it("lets the merchant dismiss an idle receipt without running Undo", async () => {
    const undo = vi.fn(async () => null);
    await render(<UndoHarness undo={undo} />);
    await click(button("Dismiss"));
    expect(undo).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Otto updated your brand memory");
  });
});
