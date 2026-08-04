// @vitest-environment jsdom
/**
 * #612 T2c — a card that has come to rest LOOKS like it has come to rest.
 *
 * The settlement writing "cancelled" onto a row is only half of "cancel shows as cancelled": if a
 * renderer does not know the word, that card goes back to the eternal spinner (F21) and the
 * merchant is told their generation is still being made long after it stopped. So each ending is
 * driven through the REAL card components — the same ImageNode / VideoNode the board mounts — and
 * asserted on the words a merchant reads.
 *
 * React Flow owns pan/zoom/portals, none of which jsdom can do; only those primitives are stood
 * in for (same dialect as canvas-flow-lineage-ui.test.ts). The card bodies are the real ones.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    Handle: () => null,
    NodeResizer: () => null,
    NodeToolbar: ({ isVisible, children }: { isVisible?: boolean; children?: unknown }) =>
      isVisible === false ? null : createElement("div", null, children as ReactElement),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ImageNode } = await import("@/components/canvas/nodes/ImageNode");
const { VideoNode } = await import("@/components/canvas/nodes/VideoNode");
const { TERMINAL_CARD_STATUSES } = await import("@/components/canvas/nodes/GeneratingBody");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderCard(
  component: typeof ImageNode | typeof VideoNode,
  status: string,
): Promise<string> {
  await act(async () => {
    root!.render(createElement(component, {
      id: "card-1",
      type: "image",
      selected: false,
      data: { status, prompt: "a cup steaming" },
      // React Flow hands its node components more than these; the card bodies read only `data`.
    } as never));
  });
  return container!.textContent ?? "";
}

describe("what a card says once it has stopped being made", () => {
  it.each([
    ["cancelled", "Cancelled", "This generation was cancelled."],
    ["failed", "That didn't finish", "You weren't charged. Try again."],
    ["timeout", "Still working…", "This is taking longer than usual — check back in a moment."],
    ["missing", "Preview missing", "The job finished, but this card could not load the media."],
  ])("shows an image card in %s as its own ending", async (status, title, detail) => {
    const text = await renderCard(ImageNode, status);

    expect(text).toContain(title);
    expect(text).toContain(detail);
    // The spinner is what every one of these replaces.
    expect(text).not.toContain("Otto is making this");
    expect(text).not.toContain("Generating…");
  });

  it("shows a cancelled video card as cancelled too, not as a render in progress", async () => {
    const text = await renderCard(VideoNode, "cancelled");

    expect(text).toContain("Cancelled");
    expect(text).not.toContain("Rendering…");
    expect(text).not.toContain("Otto is making this");
  });

  it("still spins for a card that really is being made", async () => {
    const text = await renderCard(ImageNode, "pending");

    expect(text).not.toContain("Cancelled");
    expect(text).toContain("Generating…");
  });

  it("keeps one list of endings, so no renderer can miss one", () => {
    expect([...TERMINAL_CARD_STATUSES]).toEqual(["failed", "cancelled", "timeout", "missing"]);
  });
});
