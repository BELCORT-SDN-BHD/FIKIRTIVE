// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  buildSegment: vi.fn(),
  deleteSegment: vi.fn(),
  listSegments: vi.fn(),
  previewSegment: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@/lib/segment-actions", () => actions);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: SegmentsPage } = await import("@/components/crm/segments-page");

const SEGMENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const initialState = {
  ok: true as const,
  evaluatedAt: "2026-08-27T00:00:00.000Z",
  nextSegmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  nextSegmentProof: "fixture-proof",
  totalContactCount: 6,
  unavailableFacts: { lastOrderAt: true as const, tags: true as const },
  segments: [
    {
      id: SEGMENT_ID,
      name: "Repeat WhatsApp buyers",
      phrase: "All of: Contact is not a known opt-out",
      rules: {
        match: "all" as const,
        rules: [{ kind: "contactability" as const, value: "contactable" as const }],
      },
      status: "ready" as const,
      matchedCount: 4,
      contactableCount: 4,
      knownOptOutCount: 0,
      excludedByConsentCount: 2,
      unresolvedLegacyOptOutCount: 0,
      reportedOptOutCount: 0,
      excludedByReportedOptOutCount: 0,
      createdAt: "2026-08-27T00:00:00.000Z",
    },
  ],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  actions.previewSegment.mockImplementation(() => new Promise(() => {}));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(SegmentsPage, { initialState }));
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function button(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`No button labelled "${label}"`);
  return match;
}

async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("segment deletion feedback", () => {
  it("uses AlertDialog and explains the downstream automation impact", async () => {
    await click(button("Delete"));

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Delete “Repeat WhatsApp buyers”?");
    expect(dialog?.textContent).toContain("Contacts are never deleted");
    expect(dialog?.textContent).toContain("Automations stop using this segment");
  });

  it("blocks same-tick double submits, keeps refusals inline, and retries in place", async () => {
    let release!: (result: { error: string }) => void;
    actions.deleteSegment.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    await click(button("Delete"));

    const confirm = button("Delete segment");
    await act(async () => {
      confirm.click();
      confirm.click();
    });

    expect(actions.deleteSegment).toHaveBeenCalledTimes(1);
    expect(button("Deleting…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);

    await act(async () => {
      release({ error: "This segment is still required by a workflow." });
    });

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "This segment is still required by a workflow.",
    );
    expect(button("Delete segment").disabled).toBe(false);

    actions.deleteSegment.mockResolvedValueOnce({ ok: true, idempotent: false });
    await click(button("Delete segment"));

    expect(actions.deleteSegment).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.textContent).toContain("No saved segments yet");
    expect(document.body.textContent).toContain("“Repeat WhatsApp buyers” is deleted.");
  });
});
