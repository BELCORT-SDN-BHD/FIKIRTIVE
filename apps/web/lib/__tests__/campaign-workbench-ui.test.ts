// @vitest-environment jsdom
/**
 * #714 — a campaign whose end date is before its start date must be refused where the
 * merchant can see it, driven through the REAL workbench component.
 *
 * The date picker already sets min={start}, but a typed or pasted end date never goes
 * through the picker. Before this, "Create campaign" stayed live, the server refused the
 * submission, and the only thing the merchant was told was "That campaign plan isn't valid."
 * The front end greying out is a courtesy; campaign-actions.test.ts holds the server half,
 * which refuses the same input with the same sentence.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ proposeCampaign: vi.fn() }));

vi.mock("@/lib/campaign-actions", () => ({ proposeCampaign: m.proposeCampaign }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: CampaignWorkbenchPage } = await import("@/components/campaign/campaign-workbench-page");

const PERIOD_ERROR = "The campaign end date must be on or after its start date.";

const initialState = {
  ok: true as const,
  campaigns: [],
  nextCampaignId: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
  nextCampaignProof: "proof",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(CampaignWorkbenchPage, { initialState } as never));
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function field(selector: string): HTMLInputElement | HTMLTextAreaElement {
  const node = container!.querySelector(selector);
  if (!node) throw new Error(`no field matching ${selector}`);
  return node as HTMLInputElement | HTMLTextAreaElement;
}

function type(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function createButton(): HTMLButtonElement {
  const found = [...container!.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === "Create campaign",
  );
  if (!found) throw new Error('no button labelled "Create campaign"');
  return found as HTMLButtonElement;
}

function fillCampaign(start: string, end: string) {
  const [nameInput] = [...container!.querySelectorAll("input")] as HTMLInputElement[];
  type(nameInput, "Backwards period probe");
  type(field("textarea"), "Drive Merdeka gift-box pre-orders");
  const dates = [...container!.querySelectorAll('input[type="date"]')] as HTMLInputElement[];
  type(dates[0], start);
  type(dates[1], end);
}

describe("#714 backwards campaign period", () => {
  it("greys out Create campaign and names the problem when the end date is before the start", () => {
    fillCampaign("2026-12-31", "2026-01-01");
    expect(createButton().disabled).toBe(true);
    expect(container!.textContent).toContain(PERIOD_ERROR);
  });

  it("keeps Create campaign live for a period that runs forwards, and for a single-day one", () => {
    fillCampaign("2026-01-01", "2026-12-31");
    expect(createButton().disabled).toBe(false);
    expect(container!.textContent).not.toContain(PERIOD_ERROR);

    fillCampaign("2026-03-05", "2026-03-05");
    expect(createButton().disabled).toBe(false);
    expect(container!.textContent).not.toContain(PERIOD_ERROR);
  });
});
