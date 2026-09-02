// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { OttoConfirmDialog } = await import("@/components/otto/OttoPromptDialog");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function Harness({
  onConfirm,
}: {
  onConfirm: () => void | string | null | Promise<void | string | null>;
}) {
  const [open, setOpen] = useState(true);
  return createElement(OttoConfirmDialog, {
    open,
    onOpenChange: setOpen,
    title: "Permanently delete project?",
    description: 'Otto will delete "Raya campaign" and its project-scoped work.',
    impacts: [
      "The project record is permanently deleted.",
      "Global library assets stay available.",
    ],
    confirmText: "Raya campaign",
    confirmLabel: "Delete project",
    confirmingLabel: "Deleting…",
    tone: "danger" as const,
    onConfirm,
  });
}

async function mount(onConfirm: () => void | string | null | Promise<void | string | null>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(Harness, { onConfirm }));
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

async function typeConfirmation(value: string) {
  const input = document.body.querySelector<HTMLInputElement>(
    '[aria-label="Type Raya campaign to confirm"]',
  )!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
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

describe("OttoConfirmDialog feedback and locking", () => {
  it("uses AlertDialog, names the impact, and requires an exact confirmation", async () => {
    const onConfirm = vi.fn();
    await mount(onConfirm);

    const dialog = document.body.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("What happens");
    expect(dialog?.textContent).toContain("The project record is permanently deleted.");
    expect(dialog?.querySelector('[data-slot="alert"]')?.className).toContain("bg-warning-soft");
    expect(button("Delete project").disabled).toBe(true);

    await typeConfirmation("raya campaign");
    expect(button("Delete project").disabled).toBe(true);
    await typeConfirmation("Raya campaign");
    expect(button("Delete project").disabled).toBe(false);
  });

  it("locks the confirmation and blocks a same-tick double action", async () => {
    let finish!: (value: string | null) => void;
    const onConfirm = vi.fn(
      () => new Promise<string | null>((resolve) => { finish = resolve; }),
    );
    await mount(onConfirm);
    const input = await typeConfirmation("Raya campaign");

    const confirm = button("Delete project");
    await act(async () => {
      confirm.click();
      confirm.click();
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(button("Deleting…").disabled).toBe(true);
    expect(document.body.querySelector('[aria-label="Deleting…"]')).not.toBeNull();
    expect(input.disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);

    await act(async () => { finish(null); });
    await settle();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("keeps an explicit refusal in the confirmation with a retry path", async () => {
    const onConfirm = vi.fn(async () => "This project is still in use.");
    await mount(onConfirm);
    await typeConfirmation("Raya campaign");
    await act(async () => { button("Delete project").click(); });
    await settle();

    const alert = document.body.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Action wasn't completed");
    expect(alert?.textContent).toContain("This project is still in use.");
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(button("Delete project").disabled).toBe(false);
  });

  it("turns a thrown result into readable feedback", async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error("response lost");
    });
    await mount(onConfirm);
    await typeConfirmation("Raya campaign");
    await act(async () => { button("Delete project").click(); });
    await settle();

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "We couldn't complete this action. Check your connection and try again.",
    );
    expect(button("Delete project").disabled).toBe(false);
  });

  it("Cancel closes without running the action", async () => {
    const onConfirm = vi.fn();
    await mount(onConfirm);
    await act(async () => { button("Cancel").click(); });
    await settle();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
