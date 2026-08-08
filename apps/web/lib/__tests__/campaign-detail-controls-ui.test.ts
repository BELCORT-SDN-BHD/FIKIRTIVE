// @vitest-environment jsdom
/**
 * #744 判官 r1 — the two page-level findings, driven through the REAL campaign detail component.
 *
 *  - P1-1 (UI half): an entry that has already been generated has been paid for, and the server
 *    refuses to take it out of the plan. The page must not offer Undo approval or Remove for it,
 *    and must say why — a button whose only possible outcome is a refusal is a trap.
 *  - P2 (delete error): a refused delete leaves the page exactly as it was, so it must leave the
 *    controls usable. Freezing every button after a recoverable error strands the merchant on a
 *    page they are still allowed to use.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  deleteCampaign: vi.fn(),
  getCampaign: vi.fn(),
  unapproveCampaignEntry: vi.fn(),
  removeCampaignEntry: vi.fn(),
}));

vi.mock("@/lib/campaign-actions", () => ({
  approveCampaignEntry: vi.fn(),
  deleteCampaign: m.deleteCampaign,
  proposeCampaignEntry: vi.fn(),
  removeCampaignEntry: m.removeCampaignEntry,
  setCampaignGrouping: vi.fn(),
  setCampaignStatus: vi.fn(),
  unapproveCampaignEntry: m.unapproveCampaignEntry,
  updateCampaign: vi.fn(),
  updateCampaignEntry: vi.fn(),
}));
vi.mock("@/lib/campaign-view-data", () => ({ getCampaign: m.getCampaign }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: CampaignDetailPage } = await import("@/components/campaign/campaign-detail-page");

const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const PAID_ENTRY = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const FREE_ENTRY = "01ARZ3NDEKTSV4RRFFQ69G5FAX";

function entry(id: string) {
  return {
    id,
    date: "2026-08-25",
    platform: "instagram",
    format: "image",
    hook: `Hook ${id.slice(-4)}`,
    brief: "Show the gift box opening on a bakery counter in warm morning light.",
    estCredits: 12,
    status: "approved" as const,
  };
}

function initialState(dispatchedEntryIds: string[]) {
  return {
    ok: true as const,
    campaign: {
      id: CAMPAIGN_ID,
      name: "Merdeka gift-box launch",
      status: "ACTIVE",
      goal: "Drive Merdeka gift-box pre-orders",
      startAt: "2026-08-23T16:00:00.000Z",
      endAt: "2026-08-31T15:59:59.999Z",
      plan: {
        theme: "Local pride, freshly baked",
        rationale: null,
        entries: [entry(PAID_ENTRY), entry(FREE_ENTRY)],
        ideas: [],
      },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      dispatchedEntryIds,
      grouped: { projects: [], scheduledPosts: [], generations: [], broadcasts: [] },
      available: { projects: [], scheduledPosts: [], generations: [] },
      trendSnapshots: [],
    },
    nextEntryId: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
    nextEntryProof: "proof",
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(dispatchedEntryIds: string[] = []) {
  act(() => {
    root!.render(createElement(CampaignDetailPage, { initialState: initialState(dispatchedEntryIds) } as never));
  });
}

/** Every rendered button, including anything Radix portalled onto document.body. */
function buttons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")] as HTMLButtonElement[];
}

function button(label: string): HTMLButtonElement {
  const found = buttons().filter((node) => node.textContent?.trim() === label);
  if (found.length === 0) throw new Error(`no button labelled "${label}"`);
  return found[0];
}

function buttonsLabelled(label: string): HTMLButtonElement[] {
  return buttons().filter((node) => node.textContent?.trim() === label);
}

async function click(node: HTMLElement) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// ────────────────────────────────────────────────────────────────────────────
describe("#744 P1-1 an already-generated entry offers no way out of the plan", () => {
  it("disables Undo approval and Remove only for the entry that was dispatched", async () => {
    render([PAID_ENTRY]);

    const undo = buttonsLabelled("Undo approval");
    const remove = buttonsLabelled("Remove");
    expect(undo).toHaveLength(2);
    expect(remove).toHaveLength(2);
    // Entry order matches the plan: the paid one first.
    expect(undo[0].disabled).toBe(true);
    expect(remove[0].disabled).toBe(true);
    expect(undo[1].disabled).toBe(false);
    expect(remove[1].disabled).toBe(false);
  });

  it("says why, in the merchant's terms, instead of leaving a dead button unexplained", () => {
    render([PAID_ENTRY]);
    expect(document.body.textContent).toContain(
      "Already generated, so it stays in this plan — its generation and the credits it used are part of your history.",
    );
  });

  it("leaves both buttons live when nothing has been generated yet", () => {
    render([]);
    expect(buttonsLabelled("Undo approval").every((node) => node.disabled)).toBe(false);
    expect(buttonsLabelled("Remove").every((node) => node.disabled)).toBe(false);
    expect(document.body.textContent).not.toContain("Already generated, so it stays in this plan");
  });
});

describe("#744 P2 a refused delete leaves the page usable", () => {
  it("shows the refusal and lets the merchant press Delete again", async () => {
    m.deleteCampaign.mockResolvedValue({ error: "Campaign not found." });
    render();

    await click(button("Delete"));
    await click(button("Delete campaign"));

    expect(m.deleteCampaign).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Campaign not found.");
    // The whole point: `busy` was cleared, so nothing on the page is frozen.
    expect(button("Delete").disabled).toBe(false);
    expect(buttonsLabelled("Undo approval").every((node) => node.disabled)).toBe(false);

    // And a retry really goes through to the server again.
    await click(button("Delete"));
    await click(button("Delete campaign"));
    expect(m.deleteCampaign).toHaveBeenCalledTimes(2);
  });
});
