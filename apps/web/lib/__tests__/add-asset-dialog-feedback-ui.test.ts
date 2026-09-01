// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEntity: vi.fn(),
  startRefGen: vi.fn(),
  notifyBalanceRefresh: vi.fn(),
}));

vi.mock("@/lib/actions", () => ({ createEntity: mocks.createEntity }));
vi.mock("@/lib/refgen-actions", () => ({ startRefGen: mocks.startRefGen }));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: mocks.notifyBalanceRefresh }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AddAssetDialog } = await import("@/components/otto/stuff/AddAssetDialog");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

async function openDialog(props: { onClose?: () => void; onDone?: () => void } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(AddAssetDialog, {
      open: true,
      onClose: props.onClose ?? vi.fn(),
      onDone: props.onDone ?? vi.fn(),
    }));
  });
  await settle();
}

function dialog(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]');
  expect(found).not.toBeNull();
  return found!;
}

function button(label: string): HTMLButtonElement {
  const found = [...dialog().querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`No button reading "${label}" — screen says: ${dialog().textContent}`);
  return found;
}

function formatButton(label: string): HTMLButtonElement {
  const found = dialog().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`No format reading "${label}" — screen says: ${dialog().textContent}`);
  return found;
}

async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function prepareUpload() {
  await typeInto(dialog().querySelector<HTMLInputElement>("#add-asset-name")!, "Rosa");
  const fileInput = dialog().querySelector<HTMLInputElement>("#add-asset-images")!;
  const file = new File(["image"], "rosa.png", { type: "image/png" });
  Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
  await act(async () => { fileInput.dispatchEvent(new Event("change", { bubbles: true })); });
}

async function prepareGeneration() {
  await act(async () => { button("Generate reference").click(); });
  await act(async () => { formatButton("Avatar / Cast").click(); });
  await typeInto(dialog().querySelector<HTMLInputElement>("#add-asset-subject")!, "Mira, our founder");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  root = null;
  container = null;
});

describe("AddAssetDialog feedback and input locking", () => {
  it("locks the upload material, blocks a same-tick double submit, and shows a retryable refusal", async () => {
    let finish!: (value: { error: string }) => void;
    mocks.createEntity.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await openDialog();
    await prepareUpload();

    expect(dialog().textContent).toContain("1 image selected");
    const add = button("Add");
    await act(async () => {
      add.click();
      add.click();
      await Promise.resolve();
    });

    expect(mocks.createEntity).toHaveBeenCalledTimes(1);
    expect(button("Adding…").disabled).toBe(true);
    expect(dialog().querySelector('[aria-label="Adding asset"]')).not.toBeNull();
    expect(dialog().querySelector<HTMLInputElement>("#add-asset-name")?.disabled).toBe(true);
    expect(dialog().querySelector<HTMLInputElement>("#add-asset-images")?.disabled).toBe(true);
    expect(dialog().querySelector<HTMLElement>('[data-slot="select-trigger"]')?.getAttribute("data-disabled")).not.toBeNull();
    expect(button("Upload").disabled).toBe(true);
    expect(button("Generate reference").disabled).toBe(true);
    expect(button("Close").disabled).toBe(true);

    await act(async () => { finish({ error: "Those images could not be uploaded." }); });
    await settle();

    const alert = dialog().querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn’t add asset");
    expect(alert?.textContent).toContain("Those images could not be uploaded.");
    expect(alert?.className).toContain("bg-error-soft");
    expect(button("Add").disabled).toBe(false);
    expect(dialog().querySelector<HTMLInputElement>("#add-asset-name")?.disabled).toBe(false);
  });

  it("treats a lost upload response as unknown and removes the duplicate-submit door", async () => {
    const onDone = vi.fn();
    mocks.createEntity.mockRejectedValue(new Error("response lost"));
    await openDialog({ onDone });
    await prepareUpload();

    await act(async () => { button("Add").click(); });
    await settle();

    const alert = dialog().querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Status not confirmed");
    expect(alert?.textContent).toContain("Check Library before trying again.");
    expect(alert?.className).toContain("bg-warning-soft");
    expect(dialog().querySelector<HTMLInputElement>("#add-asset-name")?.disabled).toBe(true);
    expect([...dialog().querySelectorAll("button")].some((item) => item.textContent?.trim() === "Add")).toBe(false);
    expect(button("Close").disabled).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("uses one ToggleGroup choice and keeps a paid generation immutable while it starts", async () => {
    let finish!: (value: { id: string }) => void;
    mocks.createEntity.mockResolvedValue({ id: "entity-1" });
    mocks.startRefGen.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await openDialog();
    await prepareGeneration();

    expect(formatButton("Avatar / Cast").getAttribute("data-state")).toBe("on");
    expect(button("Generate · 1 credit").disabled).toBe(false);
    const generate = button("Generate · 1 credit");
    await act(async () => {
      generate.click();
      generate.click();
      await Promise.resolve();
    });
    await settle();

    expect(mocks.createEntity).toHaveBeenCalledTimes(1);
    expect(mocks.startRefGen).toHaveBeenCalledTimes(1);
    expect(button("Generating…").disabled).toBe(true);
    expect(dialog().querySelector('[aria-label="Generating reference"]')).not.toBeNull();
    expect(formatButton("Avatar / Cast").disabled).toBe(true);
    expect(dialog().querySelector<HTMLInputElement>("#add-asset-subject")?.disabled).toBe(true);
    expect(button("Close").disabled).toBe(true);

    await act(async () => { finish({ id: "job-1" }); });
    await settle();

    const status = dialog().querySelector<HTMLElement>('[role="status"]');
    expect(status?.textContent).toContain("Reference queued");
    expect(status?.textContent).toContain("it will appear in Library shortly");
    expect(button("Done").disabled).toBe(false);
    expect(mocks.notifyBalanceRefresh).toHaveBeenCalled();
  });

  it("keeps a lost paid start in a warning state with no second Generate button", async () => {
    mocks.createEntity.mockResolvedValue({ id: "entity-1" });
    mocks.startRefGen.mockRejectedValue(new Error("response lost"));
    await openDialog();
    await prepareGeneration();

    await act(async () => { button("Generate · 1 credit").click(); });
    await settle();

    const alert = dialog().querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Status not confirmed");
    expect(alert?.textContent).toContain("couldn't confirm whether generation started");
    expect(alert?.className).toContain("bg-warning-soft");
    expect(dialog().querySelector<HTMLInputElement>("#add-asset-subject")?.disabled).toBe(true);
    expect([...dialog().querySelectorAll("button")].some((item) => item.textContent?.includes("Generate ·"))).toBe(false);
    expect(button("Close").disabled).toBe(false);
    expect(mocks.notifyBalanceRefresh).toHaveBeenCalled();
  });
});
