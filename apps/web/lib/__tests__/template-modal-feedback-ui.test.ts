// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startAssetGen: vi.fn(),
  getGenJob: vi.fn(),
  getActiveGenModels: vi.fn(),
  uploadFilesDirect: vi.fn(),
  finalizeCandidateUploads: vi.fn(),
  notifyBalanceRefresh: vi.fn(),
}));

vi.mock("@/lib/gen-actions", () => ({
  startAssetGen: mocks.startAssetGen,
  getGenJob: mocks.getGenJob,
  getActiveGenModels: mocks.getActiveGenModels,
}));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: mocks.uploadFilesDirect }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: mocks.finalizeCandidateUploads }));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: mocks.notifyBalanceRefresh }));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: TemplateModal } = await import("@/components/otto/TemplateModal");
const { TEMPLATES } = await import("@/lib/templates");
const template = TEMPLATES.find((item) => item.id === "remove-object")!;

let container: HTMLDivElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

async function openModal() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(TemplateModal, {
      template,
      projectId: "project-1",
      onClose: vi.fn(),
    }));
  });
  await settle();
}

function modal(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]');
  expect(found).not.toBeNull();
  return found!;
}

function button(label: string): HTMLButtonElement {
  const found = [...modal().querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  if (!found) throw new Error(`No button reading "${label}" — screen says: ${modal().textContent}`);
  return found;
}

async function attachProductAndAnswer() {
  const input = modal().querySelector<HTMLInputElement>('#template-product-image')!;
  const file = new File(["image"], "product.png", { type: "image/png" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();

  const answer = modal().querySelector<HTMLInputElement>('#template-answer')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(answer, "the old logo");
    answer.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:product") });
  mocks.getActiveGenModels.mockResolvedValue({ image: "active-image-model" });
  mocks.uploadFilesDirect.mockResolvedValue({ files: [] });
  mocks.finalizeCandidateUploads.mockResolvedValue({ generationIds: ["source-1"] });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.innerHTML = "";
});

describe("TemplateModal paid feedback", () => {
  it("locks the submitted material and shows an accurate pending button", async () => {
    let finishStart!: (value: { error: string }) => void;
    mocks.startAssetGen.mockImplementation(() => new Promise((resolve) => { finishStart = resolve; }));
    await openModal();
    await attachProductAndAnswer();

    expect(modal().textContent).toContain("Ready");
    expect(button("Generate · 1 credit").disabled).toBe(false);

    await act(async () => { button("Generate · 1 credit").click(); });

    expect(button("Generating…").disabled).toBe(true);
    expect(modal().querySelector('[aria-label="Generating template"]')).not.toBeNull();
    expect(modal().querySelector<HTMLInputElement>('#template-answer')?.disabled).toBe(true);

    await act(async () => { finishStart({ error: "Your balance changed. Review and retry." }); });
    await settle();

    const alert = modal().querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Generation couldn’t start");
    expect(alert?.textContent).toContain("Your balance changed. Review and retry.");
    expect(alert?.className).toContain("bg-error-soft");
    expect(modal().querySelector<HTMLInputElement>('#template-answer')?.disabled).toBe(false);
  });

  it("treats a lost start response as unknown, not as a proven failure", async () => {
    mocks.startAssetGen.mockRejectedValue(new Error("response lost"));
    await openModal();
    await attachProductAndAnswer();

    await act(async () => { button("Generate · 1 credit").click(); });
    await settle();

    const alert = modal().querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Status not confirmed");
    expect(alert?.textContent).toContain("We couldn't confirm whether this finished.");
    expect(alert?.className).toContain("bg-warning-soft");
    expect(modal().querySelector<HTMLInputElement>('#template-answer')?.disabled).toBe(true);
    expect(modal().textContent).not.toContain("This didn't finish");
    expect(modal().textContent).not.toContain("Generate · 1 credit");
  });
});
