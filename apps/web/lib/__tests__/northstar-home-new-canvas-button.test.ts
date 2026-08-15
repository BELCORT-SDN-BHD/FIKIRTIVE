// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// #933 — pressing Enter created a canvas named after whatever the merchant typed; the
// "New canvas" button hardcoded `startCanvas("")` and silently dropped it, opening an
// "Untitled Project" instead. Both controls must drive the exact same creation path
// (`startCanvas` → `createProject`), not a second one that forgets the draft.
const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));
vi.mock("@/lib/actions", () => ({ createProject: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));

import { NorthstarHome } from "@/components/canvas/NorthstarHome";
import { createProject } from "@/lib/actions";

// React refuses act() outside a configured act environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- interactive harness (jsdom + react-dom/client; the real client event path,
// mirrored from apps/web/lib/__tests__/crm-zero-channel-entry.test.ts) ---

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

// React tracks the last value it set on a controlled element and drops events whose value
// "didn't change" — write through the NATIVE prototype setter so the event is respected.
function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    setNativeValue(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function findNewCanvasButton(dom: HTMLDivElement): HTMLButtonElement {
  // The submit (ArrowUp) control is type="submit"; "New canvas" is the only type="button".
  const button = dom.querySelector<HTMLButtonElement>('button[type="button"]');
  if (!button || !button.textContent?.includes("New canvas")) {
    throw new Error("New canvas button not found");
  }
  return button;
}

describe('home "New canvas" button carries the merchant\'s typed idea (#933)', () => {
  it("non-empty input: clicking the button creates a canvas named after the idea — same as pressing Enter", async () => {
    vi.mocked(createProject).mockResolvedValue({ id: "proj-1" });

    const dom = await render(createElement(NorthstarHome, { projects: [] }));
    const input = dom.querySelector<HTMLInputElement>('input[aria-label="What are we making?"]');
    expect(input).toBeTruthy();
    await typeInto(input!, "Raya promo for the croffle set");

    await clickButton(findNewCanvasButton(dom));

    // The exact typed text reaches createProject — nothing hardcoded, nothing dropped.
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith("Raya promo for the croffle set");
    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining("proj-1"));
  });

  it("empty input: clicking the button still opens a blank canvas, unchanged", async () => {
    vi.mocked(createProject).mockResolvedValue({ id: "proj-2" });

    const dom = await render(createElement(NorthstarHome, { projects: [] }));
    await clickButton(findNewCanvasButton(dom));

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith("");
    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining("proj-2"));
  });
});
