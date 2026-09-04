// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilitiesForOrigin } from "@fikirtive/core/entity-policy";
import type { EntityDTO } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  createVariant: vi.fn(),
  deleteVariant: vi.fn(),
  getRefGenJobs: vi.fn(),
  regenerateVariant: vi.fn(),
  renameVariant: vi.fn(),
  setBaseAsset: vi.fn(),
  notifyBalanceRefresh: vi.fn(),
}));

vi.mock("@/lib/refgen-actions", () => ({
  createVariant: mocks.createVariant,
  deleteVariant: mocks.deleteVariant,
  getRefGenJobs: mocks.getRefGenJobs,
  regenerateVariant: mocks.regenerateVariant,
  renameVariant: mocks.renameVariant,
  setBaseAsset: mocks.setBaseAsset,
}));
vi.mock("@/lib/balance-refresh", () => ({
  notifyBalanceRefresh: mocks.notifyBalanceRefresh,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ElementVariantsDialog } = await import(
  "@/components/otto/stuff/ElementVariantsDialog"
);

const entity: EntityDTO = {
  id: "entity-1",
  type: "CHARACTER",
  name: "Mira",
  aliases: [],
  notes: "",
  negativeConstraints: "",
  refs: [
    {
      id: "ref-1",
      assetId: "asset-1",
      url: "/mira.png",
      kind: "image",
    },
  ],
  baseAssetId: "asset-1",
  variants: [],
  usageCount: 0,
  // 商家自己的元素 —— 能力表全开(官方目录只读的对照见 element-official-readonly-ui.test.tsx)。
  origin: "USER",
  capabilities: capabilitiesForOrigin("USER"),
};

const entityWithVariant: EntityDTO = {
  ...entity,
  variants: [
    {
      id: "variant-1",
      name: "Red dress",
      handle: "red-dress",
      prompt: "Wearing an elegant red evening gown",
      refs: [
        {
          id: "variant-ref-1",
          assetId: "variant-asset-1",
          url: "/mira-red-dress.png",
          kind: "image",
        },
      ],
    },
  ],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function openDialog(onChanged = vi.fn(), selectedEntity = entity) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(ElementVariantsDialog, {
        entity: selectedEntity,
        open: true,
        onOpenChange: vi.fn(),
        onChanged,
      }),
    );
  });
  await settle();
}

function dialog(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]');
  expect(found).not.toBeNull();
  return found!;
}

function button(label: string): HTMLButtonElement {
  const found = [...dialog().querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) {
    throw new Error(`No button reading "${label}" — screen says: ${dialog().textContent}`);
  }
  return found;
}

async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function prepareVariant() {
  await typeInto(dialog().querySelector<HTMLInputElement>("#variant-name")!, "Red dress");
  await typeInto(
    dialog().querySelector<HTMLTextAreaElement>("#variant-change")!,
    "Wearing an elegant red evening gown",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRefGenJobs.mockResolvedValue([]);
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  container?.remove();
  document.body.innerHTML = "";
  root = null;
  container = null;
});

describe("ElementVariantsDialog feedback and input locking", () => {
  it("uses the shared shadcn empty and card language for a new element", async () => {
    await openDialog();

    expect(dialog().querySelector('[data-slot="empty"]')?.textContent).toContain(
      "No styling variants",
    );
    expect(dialog().querySelector('[data-slot="card"]')?.textContent).toContain(
      "Add a variant",
    );
    expect(button("Make variant · 1 credit").disabled).toBe(true);
  });

  it("keeps the existing image visible and names an in-flight paid rerun", async () => {
    mocks.getRefGenJobs.mockResolvedValue([
      {
        status: "GENERATING",
        error: "",
        outputAssetIds: [],
      },
    ]);
    await openDialog(vi.fn(), entityWithVariant);
    await settle();

    const variantCard = [...dialog().querySelectorAll<HTMLElement>('[data-slot="card"]')].find(
      (card) => card.textContent?.includes("Red dress"),
    );
    expect(variantCard).not.toBeUndefined();
    expect(variantCard?.querySelector('img[src="/mira-red-dress.png"]')).not.toBeNull();
    expect(variantCard?.querySelector('[data-slot="badge"]')?.textContent).toContain(
      "Making it again",
    );
    expect(variantCard?.querySelector('[aria-label="Making variant again"]')).not.toBeNull();
  });

  it("locks the paid material and blocks a same-tick double submit", async () => {
    let finish!: (value: { variantId: string }) => void;
    mocks.createVariant.mockImplementation(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onChanged = vi.fn();
    await openDialog(onChanged);
    await prepareVariant();

    const make = button("Make variant · 1 credit");
    await act(async () => {
      make.click();
      make.click();
      await Promise.resolve();
    });

    expect(mocks.createVariant).toHaveBeenCalledTimes(1);
    expect(button("Making variant…").disabled).toBe(true);
    expect(dialog().querySelector('[aria-label="Making variant"]')).not.toBeNull();
    expect(dialog().querySelector<HTMLInputElement>("#variant-name")?.disabled).toBe(true);
    expect(dialog().querySelector<HTMLTextAreaElement>("#variant-change")?.disabled).toBe(true);
    expect(button("Close").disabled).toBe(true);

    await act(async () => {
      finish({ variantId: "variant-1" });
    });
    await settle();

    expect(onChanged).toHaveBeenCalled();
    expect(mocks.notifyBalanceRefresh).toHaveBeenCalled();
  });

  it("turns a lost paid response into a warning with no duplicate-submit door", async () => {
    const onChanged = vi.fn();
    mocks.createVariant.mockRejectedValue(new Error("response lost"));
    await openDialog(onChanged);
    await prepareVariant();

    await act(async () => {
      button("Make variant · 1 credit").click();
    });
    await settle();

    const alert = dialog().querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Status not confirmed");
    expect(alert?.textContent).toContain("couldn't confirm whether generation started");
    expect(alert?.className).toContain("bg-warning-soft");
    expect(dialog().querySelector<HTMLInputElement>("#variant-name")?.disabled).toBe(true);
    expect(
      [...dialog().querySelectorAll("button")].some((item) =>
        item.textContent?.includes("Make variant ·"),
      ),
    ).toBe(false);
    expect(button("Close").disabled).toBe(false);
    expect(onChanged).toHaveBeenCalled();
    expect(mocks.notifyBalanceRefresh).toHaveBeenCalled();
  });
});
