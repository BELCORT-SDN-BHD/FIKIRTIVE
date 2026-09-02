// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  updateDisplayName: vi.fn(),
  updateWorkspaceName: vi.fn(),
}));

vi.mock("@/lib/profile-actions", () => actions);

const { ProfileNames } = await import("@/app/profile/ProfileNames");

const WEB_ROOT = path.resolve(__dirname, "../..");
const source = (relativePath: string) => fs.readFileSync(path.join(WEB_ROOT, relativePath), "utf8");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function renderProfileNames(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(ProfileNames, {
      displayName: "Alya",
      workspaceName: "Kopi Corner",
    }));
  });
  return container;
}

function inputNamed(dom: HTMLDivElement, label: string): HTMLInputElement {
  const fieldLabel = [...dom.querySelectorAll("label")].find((node) => node.textContent === label);
  const input = fieldLabel?.htmlFor ? dom.querySelector<HTMLInputElement>(`#${fieldLabel.htmlFor}`) : null;
  if (!input) throw new Error(`No input labelled ${label}`);
  return input;
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("Profile uses the shared product design system", () => {
  it("composes the route from Card, Field and semantic tokens without inline styling", () => {
    const page = source("app/profile/page.tsx");
    const form = source("app/profile/ProfileNames.tsx");

    expect(page).toContain("<Card");
    expect(page).toContain("<CardHeader>");
    expect(page).toContain("<CardContent");
    expect(page).toContain("<SettingsShell");
    expect(page).toContain("<DisplayNameField");
    expect(form).toContain("<FieldGroup>");
    expect(form).toContain("<FieldLabel");
    expect(form).toContain("<FieldError");
    expect(form).toContain("<Spinner");
    expect(`${page}\n${form}`).not.toContain("style={{");
    expect(`${page}\n${form}`).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(form).not.toContain("<label");
  });

  it("keeps Save explicit, shows progress, and replaces the draft with the server-confirmed name", async () => {
    let finish: ((value: { ok: true; name: string }) => void) | undefined;
    actions.updateDisplayName.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

    const dom = await renderProfileNames();
    const input = inputNamed(dom, "Your name");
    const button = input.closest("form")!.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    expect(button.disabled).toBe(true);
    await typeInto(input, "  Alya Tan  ");
    expect(button.disabled).toBe(false);

    await submit(input);
    expect(actions.updateDisplayName).toHaveBeenCalledWith("  Alya Tan  ");
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Saving");
    expect(button.querySelector('[role="status"]')).toBeTruthy();

    await act(async () => { finish?.({ ok: true, name: "Alya Tan" }); });
    expect(input.value).toBe("Alya Tan");
    expect(input.closest("form")!.textContent).toContain("Saved");
  });

  it("associates a failed save with the field and keeps the server message visible", async () => {
    actions.updateWorkspaceName.mockResolvedValue({ error: "That workspace name is not available." });

    const dom = await renderProfileNames();
    const input = inputNamed(dom, "Workspace");
    await typeInto(input, "Another shop");
    await submit(input);

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.closest('[data-slot="field"]')?.getAttribute("data-invalid")).toBe("true");
    expect(input.closest("form")!.querySelector('[role="alert"]')?.textContent)
      .toBe("That workspace name is not available.");
  });
});
