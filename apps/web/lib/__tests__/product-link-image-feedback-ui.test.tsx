// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductImagePickerDialog } from "@/components/otto/memory/ProductImagePickerDialog";
import { ProductShowcase } from "@/components/otto/memory/ProductShowcase";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { ProductDraftResult } from "@/lib/product-ingest-actions";
import type { StuffItem } from "@/lib/stuff-items";

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

const PRODUCT: BrandRecordRow = {
  id: "product-1",
  kind: "product",
  data: {
    name: "Morning blend",
    description: "A smooth everyday coffee",
    imageAssetId: "asset-1",
  },
  status: "active",
  startsAt: null,
  endsAt: null,
  source: "user",
  pinned: false,
  updatedAt: new Date("2026-08-27T00:00:00.000Z"),
};

const IMAGE: StuffItem = {
  id: "gen-1",
  source: "gen",
  label: "Morning blend hero",
  url: "https://cdn.example.com/morning-blend.png",
  mediaKind: "image",
  assetId: "asset-1",
  generationId: "gen-1",
  projectId: "project-1",
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

async function enterText(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openProductMenu(): Promise<void> {
  const trigger = document.body.querySelector<HTMLButtonElement>('button[aria-label="Actions for Morning blend"]');
  if (!trigger) throw new Error("Product actions trigger was not rendered");
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

function menuItem(label: string): HTMLElement {
  const match = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No menu item labelled "${label}"`);
  return match;
}

function ShowcaseHarness({ setImage }: {
  setImage: (record: BrandRecordRow, assetId: string | null) => Promise<string | null>;
}) {
  const [records, setRecords] = useState([PRODUCT]);
  return (
    <ProductShowcase
      records={records}
      looseNotes={[]}
      freshIds={new Set()}
      stuffItems={[IMAGE]}
      onSave={async () => null}
      onArchive={async () => null}
      onNoteSave={async () => null}
      onNoteDelete={async () => null}
      onSetImage={async (record, assetId) => {
        const failure = await setImage(record, assetId);
        if (failure) return failure;
        setRecords((current) => current.map((candidate) => {
          if (candidate.id !== record.id) return candidate;
          const data = { ...candidate.data };
          if (assetId) data.imageAssetId = assetId;
          else delete data.imageAssetId;
          return { ...candidate, data };
        }));
        return null;
      }}
      onOpenPicker={() => {}}
    />
  );
}

function PickerHarness({ setImage }: {
  setImage: (record: BrandRecordRow, assetId: string) => Promise<string | null>;
}) {
  const [product, setProduct] = useState<BrandRecordRow | null>(PRODUCT);
  return (
    <ProductImagePickerDialog
      product={product}
      items={[IMAGE]}
      onClose={() => setProduct(null)}
      onSetImage={setImage}
    />
  );
}

describe("Product link and image feedback", () => {
  it("locks duplicate link reads, keeps a connection failure visible, and retries into review", async () => {
    let rejectFirst: ((reason?: unknown) => void) | undefined;
    const firstAttempt = new Promise<ProductDraftResult>((_resolve, reject) => { rejectFirst = reject; });
    const ingest = vi
      .fn<(url: string) => Promise<ProductDraftResult>>()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce({
        ok: true,
        draft: {
          name: "Latte blend",
          price: "MYR 49.00",
          description: "Smooth coffee.",
          sourceUrl: "https://shop.example.com/products/latte",
          filled: ["name", "price", "description"],
        },
      });

    await render(
      <ProductShowcase
        records={[]}
        looseNotes={[]}
        freshIds={new Set()}
        onSave={async () => null}
        onArchive={async () => null}
        onNoteSave={async () => null}
        onNoteDelete={async () => null}
        onSetImage={async () => null}
        onOpenPicker={() => {}}
        onIngest={ingest}
      />,
    );
    await click(button("Paste a link"));
    const input = document.querySelector<HTMLInputElement>('[aria-label="Product page link"]');
    if (!input) throw new Error("Product page link input was not rendered");
    await enterText(input, "https://shop.example.com/products/latte");

    const submit = button("Read product");
    await act(async () => {
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(button("Reading…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);

    await act(async () => rejectFirst?.(new Error("offline")));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Product page wasn't read");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Check your connection and try again.");
    expect(input.value).toBe("https://shop.example.com/products/latte");

    await click(button("Read product"));
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Product details found");
    expect(document.body.textContent).toContain("shop.example.com");
    expect(document.querySelector<HTMLInputElement>('input[value="Latte blend"]')).not.toBeNull();
  });

  it("keeps an image removal refusal visible and removes only after retry succeeds", async () => {
    let settleFirst: ((value: string | null) => void) | undefined;
    const firstAttempt = new Promise<string | null>((resolve) => { settleFirst = resolve; });
    const setImage = vi
      .fn<(record: BrandRecordRow, assetId: string | null) => Promise<string | null>>()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(null);

    await render(<ShowcaseHarness setImage={setImage} />);
    await openProductMenu();
    const remove = menuItem("Remove from product");
    await act(async () => {
      remove.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      remove.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(setImage).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Removing image…");
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Actions for Morning blend"]')?.disabled).toBe(true);

    await act(async () => settleFirst?.("Record not found."));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Product image wasn't removed");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Record not found.");
    expect(document.querySelector('img[alt="Morning blend"]')).not.toBeNull();

    await openProductMenu();
    await click(menuItem("Remove from product"));
    expect(setImage).toHaveBeenCalledTimes(2);
    expect(document.querySelector('img[alt="Morning blend"]')).toBeNull();
    expect(document.body.textContent).toContain("Add image · from Library");
  });

  it("still exposes replace and remove when a saved image is missing from Library results", async () => {
    await render(
      <ProductShowcase
        records={[PRODUCT]}
        looseNotes={[]}
        freshIds={new Set()}
        stuffItems={[]}
        onSave={async () => null}
        onArchive={async () => null}
        onNoteSave={async () => null}
        onNoteDelete={async () => null}
        onSetImage={async () => null}
        onOpenPicker={() => {}}
      />,
    );

    await openProductMenu();
    expect(menuItem("Replace image")).toBeTruthy();
    expect(menuItem("Remove from product")).toBeTruthy();
  });

  it("keeps the image picker open on refusal, locks every tile, and closes after retry success", async () => {
    let settleFirst: ((value: string | null) => void) | undefined;
    const firstAttempt = new Promise<string | null>((resolve) => { settleFirst = resolve; });
    const setImage = vi
      .fn<(record: BrandRecordRow, assetId: string) => Promise<string | null>>()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(null);

    await render(<PickerHarness setImage={setImage} />);
    const choose = document.querySelector<HTMLButtonElement>('button[aria-label="Choose Morning blend hero"]');
    if (!choose) throw new Error("Image choice was not rendered");
    await act(async () => {
      choose.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      choose.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(setImage).toHaveBeenCalledTimes(1);
    expect(choose.disabled).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Updating product image");
    expect(button("Close").disabled).toBe(true);

    await act(async () => settleFirst?.("Record not found."));

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Product image wasn't updated");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Record not found.");
    expect(choose.disabled).toBe(false);

    await click(choose);
    expect(setImage).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("routes both image changes through the result-aware parent helper", () => {
    const webRoot = path.resolve(__dirname, "../..");
    const memory = fs.readFileSync(path.join(webRoot, "components/otto/OttoMemory.tsx"), "utf8");

    expect(memory).toContain("return saveAndRefreshBrandRecord({ id: rec.id, kind: \"product\", data });");
    expect(memory).toContain("<ProductImagePickerDialog");
    expect(memory).toContain("onSetImage={(product, assetId) => prodSetImage(product, assetId)}");
  });
});
