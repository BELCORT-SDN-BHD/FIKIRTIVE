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

const m = vi.hoisted(() => ({ resolveCanvasNode: vi.fn(), createCanvasNode: vi.fn() }));
vi.mock("../canvas-actions", () => ({
  resolveCanvasNode: m.resolveCanvasNode,
  createCanvasNode: m.createCanvasNode,
}));
vi.mock("../gen-actions", () => ({ getGenJob: vi.fn(), startCanvasGen: vi.fn() }));

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
const { TERMINAL_CARD_STATUSES } = await import("@/lib/canvas-card-status");
const { applyCanvasResolve, isInFlightPaidGen } = await import("@/components/canvas/useCanvasGen");

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
    // `unknown` joined the list in #602 T3: a card with no account of itself has come to rest
    // too, and the one thing it must not do is keep spinning.
    expect([...TERMINAL_CARD_STATUSES]).toEqual(["failed", "cancelled", "timeout", "missing", "unknown"]);
  });
});

/**
 * #612 r3 — ONE licence to paint: the server said it took the report.
 *
 * Two review rounds went at this a branch at a time (refusal in r2, then {error} and lost
 * responses), which is the signature of a wrong shape rather than missing cases. So the rule is
 * now a three-state machine with a single positive licence: `accepted` — and only `accepted` —
 * lets this tab draw its own report as truth. `refused` means the server has a settled answer and
 * hands it over. Everything else is `unknown`: an {error} the server returned, a response that
 * never came back, a lost connection. Unknown paints NOTHING; the card keeps what a merchant is
 * already looking at, and the answer arrives from the server through the board read that stays
 * running while the card is unresolved.
 */
const fast = { attempts: 3, wait: async () => {} };

describe("the one licence to paint a local report as truth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("paints the local status only when the server says it took it", async () => {
    m.resolveCanvasNode.mockResolvedValue({ ok: true, applied: true });

    expect(await applyCanvasResolve("p1", "card-1", { status: "timeout" }, fast))
      .toEqual({ kind: "accepted", paint: "timeout" });
  });

  it("paints the server's own ending when the report is refused", async () => {
    m.resolveCanvasNode.mockResolvedValue({ ok: true, applied: false, status: "failed" });

    const outcome = await applyCanvasResolve("p1", "card-1", { status: "timeout" }, fast);

    expect(outcome).toEqual({ kind: "refused", paint: "failed" });
    // …and that is what a merchant then reads on the card.
    const text = await renderCard(ImageNode, "failed");
    expect(text).toContain("That didn't finish");
    expect(text).not.toContain("Still working…");
  });

  it("paints nothing over a settled card whose picture this poll does not have", async () => {
    m.resolveCanvasNode.mockResolvedValue({ ok: true, applied: false, status: "done" });

    expect(await applyCanvasResolve("p1", "card-1", { status: "timeout" }, fast))
      .toEqual({ kind: "refused", paint: null });
  });

  it("removes a card another tab deleted, rather than drawing anything on it", async () => {
    // Removal is the one thing this tab CAN do unaided: it needs no media and no further answer.
    // Leaving the card alone was the r3 hole — nothing visible could ever converge a tombstone,
    // so the merchant kept watching a card being made that no longer existed (judge r3 P1).
    m.resolveCanvasNode.mockResolvedValue({ ok: true, applied: false, status: "deleted" });

    expect(await applyCanvasResolve("p1", "card-1", { status: "timeout" }, fast))
      .toEqual({ kind: "removed" });
  });

  it("treats an {error} answer as unknown, never as acceptance", async () => {
    // A generation that moved, a card that never existed: the server did NOT take this report
    // and never told us what the card says. Painting the report here was the r2 hole (judge P1②①).
    m.resolveCanvasNode.mockResolvedValue({ error: "Node not found." });

    expect(await applyCanvasResolve("p1", "card-1", { status: "timeout" }, fast))
      .toEqual({ kind: "unknown" });
    // Deterministic refusals are not worth asking again.
    expect(m.resolveCanvasNode).toHaveBeenCalledTimes(1);
  });

  it("asks again when the answer is lost, and ends on the truth that landed meanwhile", async () => {
    // The write may well have been applied — or a settlement may have overtaken it. Either way the
    // tab does not know, so it asks again rather than drawing its own guess (judge P1②②).
    m.resolveCanvasNode
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ ok: true, applied: false, status: "failed" });

    expect(await applyCanvasResolve("p1", "card-1", { status: "timeout" }, fast))
      .toEqual({ kind: "refused", paint: "failed" });
    expect(m.resolveCanvasNode).toHaveBeenCalledTimes(2);
  });

  it("ends unknown — never on its own guess — when every attempt is lost", async () => {
    m.resolveCanvasNode.mockRejectedValue(new Error("network down"));

    expect(await applyCanvasResolve("p1", "card-1", { status: "timeout" }, fast))
      .toEqual({ kind: "unknown" });
    expect(m.resolveCanvasNode).toHaveBeenCalledTimes(3);
  });
});

/**
 * The other half of `unknown`: nothing is painted, so SOMETHING has to keep looking.
 *
 * A card left unresolved by an unknown outcome is exactly the shape the board's own re-read loop
 * runs for (FlowCanvas keys that 5-second loop on `isInFlightPaidGen`). This pins the join, so the
 * "convergence keeps running" claim is a test rather than a sentence in a comment.
 */
describe("a card an unknown answer left behind keeps the board looking", () => {
  it.each([
    // Card FACES, not the stored row word (#602 T3).
    ["queued"],
    ["generating"],
    ["timeout"],
  ])("keeps the board's re-read loop alive for a %s card", (status) => {
    expect(isInFlightPaidGen({ type: "image", status, url: null })).toBe(true);
  });

  it("lets the loop stop once the server has actually answered", () => {
    expect(isInFlightPaidGen({ type: "image", status: "failed", url: null })).toBe(false);
    expect(isInFlightPaidGen({ type: "image", status: "done", url: "https://cdn.example/a.png" })).toBe(false);
  });
});
