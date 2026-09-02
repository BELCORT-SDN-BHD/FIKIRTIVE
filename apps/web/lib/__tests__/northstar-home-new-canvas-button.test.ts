// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCanvasConversation: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("@/lib/canvas-entry-actions", () => ({
  createCanvasConversation: mocks.createCanvasConversation,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.routerPush }) }));

import { StartSomething } from "@/components/start-something/StartSomething";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function renderComposer() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(StartSomething)));
  return container;
}

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Create first prompt handoff", () => {
  it("keeps the typed prompt and routes to its exact Canvas and Conversation", async () => {
    mocks.createCanvasConversation.mockResolvedValue({
      projectId: "canvas-1",
      threadId: "thread-1",
      handoffId: "handoff-1",
    });
    const dom = await renderComposer();
    const textarea = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Describe what you want to create"]')!;

    await act(async () => typeInto(textarea, "Raya promo for the croffle set"));
    await act(async () => {
      dom.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await Promise.resolve();
    });

    expect(mocks.createCanvasConversation).toHaveBeenCalledWith({
      prompt: "Raya promo for the croffle set",
      requestId: expect.any(String),
    });
    expect(mocks.routerPush).toHaveBeenCalledWith(
      "/create/canvas?project=canvas-1&thread=thread-1&handoff=handoff-1",
    );
  });

  it("does not create a blank Canvas", async () => {
    const dom = await renderComposer();
    await act(async () => {
      dom.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mocks.createCanvasConversation).not.toHaveBeenCalled();
    expect(dom.textContent).toContain("Describe what you want to create.");
  });
});
