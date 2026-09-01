// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsField } from "@/components/otto/settings/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { SettingsPage } = await import("@/components/otto/settings/SettingsPage");

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let onSave: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onSave = vi.fn();
  const field: SettingsField = {
    id: "cap",
    kind: "number",
    label: "Per-action spend cap",
    hint: "Otto stops any single action above this cap.",
    value: 500,
    unit: "credits",
    onSave,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(SettingsPage, {
        sections: [{ id: "otto", title: "Otto behavior", fields: [field] }],
      }),
    );
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

function button(label: string, scope: ParentNode = document.body): HTMLButtonElement {
  const match = [...scope.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`No button labelled "${label}"`);
  return match;
}

function dialogButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("No alert dialog");
  return button(label, dialog);
}

async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function enterZeroAndOpen() {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Per-action spend cap"]');
  if (!input) throw new Error("No spend cap input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button("Remove cap"));
}

describe("Otto spend-cap removal confirmation", () => {
  it("uses AlertDialog and distinguishes removing the guard from removing balance", async () => {
    await enterZeroAndOpen();

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Remove Otto's spend cap?");
    expect(dialog?.textContent).toContain("Actions above 500 credits are currently refused");
    expect(dialog?.textContent).toContain("Your credit balance and each action's price still apply");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the cap when cancelled", async () => {
    await enterZeroAndOpen();
    await click(dialogButton("Keep cap"));

    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Per-action spend cap"]')?.value).toBe("0");
  });

  it("shows refusal inline, blocks double submits, and retries successfully", async () => {
    let release!: (result: { error: string }) => void;
    onSave.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    await enterZeroAndOpen();

    const confirm = dialogButton("Remove cap");
    await act(async () => {
      confirm.click();
      confirm.click();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(0);
    expect(dialogButton("Removing…").disabled).toBe(true);
    expect(dialogButton("Keep cap").disabled).toBe(true);

    await act(async () => {
      release({ error: "Spend cap is locked by workspace policy." });
    });

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Spend cap is locked by workspace policy.",
    );
    expect(dialogButton("Remove cap").disabled).toBe(false);

    onSave.mockResolvedValueOnce({ ok: true });
    await click(dialogButton("Remove cap"));

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.textContent).toContain("No cap set");
  });
});
