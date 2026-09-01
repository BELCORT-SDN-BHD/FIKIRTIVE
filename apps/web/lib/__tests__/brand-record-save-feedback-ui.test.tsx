// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfferList } from "@/components/otto/memory/OfferList";
import { ProductShowcase } from "@/components/otto/memory/ProductShowcase";
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

const PRODUCT: BrandRecordRow = {
  ...BASE,
  id: "product-1",
  kind: "product",
  data: { name: "Morning blend", description: "A smooth everyday coffee" },
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

function actionTrigger(label: string): HTMLButtonElement {
  const trigger = document.body.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${label}"]`);
  if (!trigger) throw new Error(`No actions trigger for "${label}"`);
  return trigger;
}

async function chooseMenuItem(recordLabel: string, itemLabel: string): Promise<void> {
  const trigger = actionTrigger(recordLabel);
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

function GroupHarness({
  save = async () => null,
  archive = async () => null,
}: {
  save?: (id: string | undefined, data: unknown) => Promise<string | null>;
  archive?: (id: string, data: Record<string, unknown>, status: "active" | "archived") => Promise<string | null>;
}) {
  const [records, setRecords] = useState([GROUP]);
  return (
    <SegmentCards
      records={records}
      looseNotes={[]}
      freshIds={new Set()}
      onSave={save}
      onDelete={async () => null}
      onArchive={async (id, data, status) => {
        const failure = await archive(id, data, status);
        if (failure) return failure;
        setRecords((current) => current.map((record) => record.id === id ? { ...record, status } : record));
        return null;
      }}
      onNoteSave={async () => null}
      onNoteDelete={async () => null}
    />
  );
}

function ProductHarness({
  save = async () => null,
  archive = async () => null,
}: {
  save?: (id: string | undefined, data: unknown) => Promise<string | null>;
  archive?: (id: string, data: Record<string, unknown>, status: "active" | "archived") => Promise<string | null>;
}) {
  const [records, setRecords] = useState([PRODUCT]);
  return (
    <ProductShowcase
      records={records}
      looseNotes={[]}
      freshIds={new Set()}
      stuffItems={[]}
      onSave={save}
      onArchive={async (id, data, status) => {
        const failure = await archive(id, data, status);
        if (failure) return failure;
        setRecords((current) => current.map((record) => record.id === id ? { ...record, status } : record));
        return null;
      }}
      onNoteSave={async () => null}
      onNoteDelete={async () => null}
      onSetImage={async () => null}
      onOpenPicker={() => {}}
    />
  );
}

function OfferHarness({ save }: {
  save: (id: string | undefined, data: unknown, dates: unknown) => Promise<string | null>;
}) {
  return (
    <OfferList
      records={[OFFER]}
      freshIds={new Set()}
      onSave={save}
      onDelete={async () => null}
    />
  );
}

describe("Brand record save feedback", () => {
  it("keeps the customer-group form open, locks a double submit, and retries after refusal", async () => {
    let settleFirst: ((value: string | null) => void) | undefined;
    const firstAttempt = new Promise<string | null>((resolve) => { settleFirst = resolve; });
    const save = vi
      .fn<(id: string | undefined, data: unknown) => Promise<string | null>>()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(null);

    await render(<GroupHarness save={save} />);
    await chooseMenuItem("Busy parents", "Edit");

    const submit = button("Save");
    await act(async () => {
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(button("Saving…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);

    await act(async () => settleFirst?.("Record not found."));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Customer group wasn't saved");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Record not found.");
    expect(button("Save").disabled).toBe(false);

    await click(button("Save"));
    expect(save).toHaveBeenCalledTimes(2);
    expect(actionTrigger("Busy parents")).toBeTruthy();
  });

  it("keeps the product edit form open on refusal and closes only after retry success", async () => {
    const save = vi
      .fn<(id: string | undefined, data: unknown) => Promise<string | null>>()
      .mockResolvedValueOnce("That record is missing something.")
      .mockResolvedValueOnce(null);

    await render(<ProductHarness save={save} />);
    await chooseMenuItem("Morning blend", "Edit");
    await click(button("Save"));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Product wasn't saved");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("That record is missing something.");
    expect(button("Save")).toBeTruthy();

    await click(button("Save"));
    expect(save).toHaveBeenCalledTimes(2);
    expect(actionTrigger("Morning blend")).toBeTruthy();
  });

  it("keeps the offer edit form and its values after a connection failure", async () => {
    const save = vi
      .fn<(id: string | undefined, data: unknown, dates: unknown) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);

    await render(<OfferHarness save={save} />);
    await chooseMenuItem("Weekend breakfast bundle", "Edit");
    await click(button("Save"));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Offer wasn't saved");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "The offer couldn't be saved. Check your connection and try again.",
    );
    expect(document.body.querySelector<HTMLInputElement>('input[value="Weekend breakfast bundle"]')).not.toBeNull();

    await click(button("Save"));
    expect(save).toHaveBeenCalledTimes(2);
    expect(actionTrigger("Weekend breakfast bundle")).toBeTruthy();
  });
});

describe("Brand record archive feedback", () => {
  it("shows customer-group archive progress, preserves state on refusal, and retries", async () => {
    let settleFirst: ((value: string | null) => void) | undefined;
    const firstAttempt = new Promise<string | null>((resolve) => { settleFirst = resolve; });
    const archive = vi
      .fn<(id: string, data: Record<string, unknown>, status: "active" | "archived") => Promise<string | null>>()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(null);

    await render(<GroupHarness archive={archive} />);
    await chooseMenuItem("Busy parents", "Archive");

    expect(document.body.textContent).toContain("Archiving…");
    expect(actionTrigger("Busy parents").disabled).toBe(true);

    await act(async () => settleFirst?.("Record not found."));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Customer group wasn't updated");
    expect(document.body.textContent).not.toContain("Archived");
    expect(actionTrigger("Busy parents").disabled).toBe(false);

    await chooseMenuItem("Busy parents", "Archive");
    expect(archive).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Archived");
  });

  it("keeps a product active after archive connection failure and succeeds on retry", async () => {
    const archive = vi
      .fn<(id: string, data: Record<string, unknown>, status: "active" | "archived") => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);

    await render(<ProductHarness archive={archive} />);
    await chooseMenuItem("Morning blend", "Archive");

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Product wasn't updated");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "The product couldn't be updated. Check your connection and try again.",
    );
    expect(document.body.textContent).not.toContain("Archived");

    await chooseMenuItem("Morning blend", "Archive");
    expect(archive).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Archived");
  });

  it("forwards saveBrandRecord errors before refreshing or closing any editor", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../components/otto/OttoMemory.tsx"),
      "utf8",
    );

    expect(source).toContain("const saveAndRefreshBrandRecord = async (input: unknown) => {");
    expect(source).toContain("const result = await saveBrandRecord(input);");
    expect(source).toContain('if ("error" in result) return result.error;');
    expect(source).toContain("await refreshRecords();");
    expect(source).toContain("return null;");
  });
});
