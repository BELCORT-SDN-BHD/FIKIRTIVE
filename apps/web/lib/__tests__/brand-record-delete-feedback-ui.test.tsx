// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfferList } from "@/components/otto/memory/OfferList";
import { SegmentCards } from "@/components/otto/memory/SegmentCards";
import type { BrandRecordRow } from "@/lib/brand-record-actions";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const BASE = {
  status: "active" as const,
  startsAt: null,
  endsAt: null,
  source: "user" as const,
  pinned: false,
  updatedAt: new Date("2026-08-27T00:00:00.000Z"),
};

const GROUP: BrandRecordRow = {
  ...BASE,
  id: "group-1",
  kind: "segment",
  data: { name: "Busy parents", who: "Parents balancing work and school runs" },
};

const OFFER: BrandRecordRow = {
  ...BASE,
  id: "offer-1",
  kind: "offer",
  data: { title: "Weekend breakfast bundle", details: "Two drinks and two pastries" },
};

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

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match;
}

async function chooseRemoval(triggerLabel: string, itemLabel: string): Promise<void> {
  const trigger = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${triggerLabel}"]`);
  if (!trigger) throw new Error(`No actions trigger labelled "${triggerLabel}"`);

  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });

  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (candidate) => candidate.textContent?.trim() === itemLabel,
  );
  if (!item) throw new Error(`No menu item labelled "${itemLabel}"`);
  await click(item);
}

function GroupHarness({ remove }: { remove: (id: string) => Promise<string | null> }) {
  const [records, setRecords] = useState([GROUP]);
  return (
    <SegmentCards
      records={records}
      looseNotes={[]}
      freshIds={new Set()}
      onSave={async () => null}
      onDelete={async (id) => {
        const failure = await remove(id);
        if (failure) return failure;
        setRecords((current) => current.filter((record) => record.id !== id));
        return null;
      }}
      onArchive={async () => null}
      onNoteSave={async () => null}
      onNoteDelete={async () => null}
    />
  );
}

function OfferHarness({ remove }: { remove: (id: string) => Promise<string | null> }) {
  const [records, setRecords] = useState([OFFER]);
  return (
    <OfferList
      records={records}
      freshIds={new Set()}
      onSave={async () => null}
      onDelete={async (id) => {
        const failure = await remove(id);
        if (failure) return failure;
        setRecords((current) => current.filter((record) => record.id !== id));
        return null;
      }}
    />
  );
}

describe("Brand record removal", () => {
  it("opens from the real customer-group menu, explains impact, and cancels safely", async () => {
    const remove = vi.fn(async () => null);
    await render(<GroupHarness remove={remove} />);
    await chooseRemoval("Actions for Busy parents", "Remove group");

    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("This removes the group from Brand memory.");
    expect(dialog?.textContent).toContain("Otto will stop using this audience profile in future Canvases.");
    expect(dialog?.textContent).toContain("Existing Canvases and generated assets stay unchanged.");

    await click(button("Keep group"));
    expect(remove).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.textContent).toContain("Busy parents");
  });

  it("blocks an offer double submit, leaves a refusal visible, and retries in place", async () => {
    let settleFirst: ((value: string | null) => void) | undefined;
    const firstAttempt = new Promise<string | null>((resolve) => { settleFirst = resolve; });
    const remove = vi
      .fn<(id: string) => Promise<string | null>>()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(null);

    await render(<OfferHarness remove={remove} />);
    await chooseRemoval("Actions for Weekend breakfast bundle", "Remove offer");

    const confirm = button("Remove offer");
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(button("Removing…").disabled).toBe(true);
    expect(button("Keep offer").disabled).toBe(true);

    await act(async () => settleFirst?.("Record not found."));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Offer wasn't removed");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Record not found.");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(button("Remove offer").disabled).toBe(false);
    expect(document.body.textContent).toContain("Weekend breakfast bundle");

    await click(button("Remove offer"));
    expect(remove).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Weekend breakfast bundle");
  });

  it("keeps an unexpected group connection failure visible and retryable", async () => {
    const remove = vi.fn(async () => { throw new Error("offline"); });
    await render(<GroupHarness remove={remove} />);
    await chooseRemoval("Actions for Busy parents", "Remove group");
    await click(button("Remove group"));

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "The customer group couldn't be removed. Check your connection and try again.",
    );
    expect(button("Remove group").disabled).toBe(false);
  });

  it("routes both lists through one shared dialog and updates local state only after success", () => {
    const webRoot = path.resolve(__dirname, "../..");
    const segment = fs.readFileSync(path.join(webRoot, "components/otto/memory/SegmentCards.tsx"), "utf8");
    const offer = fs.readFileSync(path.join(webRoot, "components/otto/memory/OfferList.tsx"), "utf8");
    const memory = fs.readFileSync(path.join(webRoot, "components/otto/OttoMemory.tsx"), "utf8");

    expect(segment).toContain("<BrandRecordRemovalDialog");
    expect(offer).toContain("<BrandRecordRemovalDialog");
    expect(memory).toContain("const removeBrandRecord = async (id: string) => {");
    expect(memory).toContain('if ("error" in result) return result.error;');
    expect(memory).toContain("setRecords((current) => current.filter((record) => record.id !== id));");
    expect(memory.match(/onDelete=\{removeBrandRecord\}/g)).toHaveLength(2);
  });
});
