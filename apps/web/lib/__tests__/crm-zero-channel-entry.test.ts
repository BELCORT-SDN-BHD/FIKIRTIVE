// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// #495 — a brand-new workspace has zero channel scopes. Both CRM outbound entry pages
// (broadcast composer, message templates) must show an honest empty state instead of a
// dead end (#541: no CTA into Connections while Messaging cannot be connected there).
// With channels present, the round-3 review (#500) requires
// driving the REAL submission path — select a scope, fill the form, submit — and
// asserting the exact scope/channel values the server action receives, not just markup.
const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));
vi.mock("@/lib/customer-inbox-ui-actions", () => ({
  createMessageTemplate: vi.fn(),
  createMessageTemplateVersion: vi.fn(),
  listTemplates: vi.fn(),
}));
vi.mock("@/lib/customer-broadcast-ui-actions", () => ({
  createBroadcastRun: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import BroadcastComposerPage from "@/components/crm/broadcasts/broadcast-composer-page";
import InboxTemplatesPage from "@/components/crm/inbox/inbox-templates-page";
import { createMessageTemplate, listTemplates } from "@/lib/customer-inbox-ui-actions";
import { createBroadcastRun } from "@/lib/customer-broadcast-ui-actions";

// The composer mints its idempotency key with crypto.randomUUID(); jsdom's crypto may lack it.
if (typeof globalThis.crypto?.randomUUID !== "function") {
  vi.stubGlobal("crypto", webcrypto);
}
// React refuses act() outside a configured act environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const SCOPE = { id: "scope-1", channel: "whatsapp", scopeKey: "waba-a" };

function templatesProps(scopes: (typeof SCOPE)[]): ComponentProps<typeof InboxTemplatesPage> {
  return {
    initialState: { ok: true, resource: [] },
    initialScopes: { ok: true, resource: scopes },
  } as unknown as ComponentProps<typeof InboxTemplatesPage>;
}

function composerProps(scopes: (typeof SCOPE)[]): ComponentProps<typeof BroadcastComposerPage> {
  return {
    initialOptions: {
      ok: true,
      resource: {
        channelScopes: scopes,
        segments: [{ id: "seg-1", name: "All customers" }],
        templateVersions: [
          {
            id: "tv-1",
            revision: 1,
            broadcastPurpose: "marketing",
            template: { channelScopeId: SCOPE.id, name: "Promo" },
          },
        ],
        campaigns: [],
      },
    },
    initialDirectory: { ok: true, resource: { self: { role: "owner" }, members: [] } },
  } as unknown as ComponentProps<typeof BroadcastComposerPage>;
}

// --- interactive harness (jsdom + react-dom/client; the real client event path) ---

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

// React tracks the last value it set on a controlled element and drops events whose value
// "didn't change" — write through the NATIVE prototype setter so the event is respected.
function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
}

async function openSelect(trigger: HTMLButtonElement): Promise<HTMLElement[]> {
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
}

async function chooseOption(trigger: HTMLButtonElement, label: string) {
  const options = await openSelect(trigger);
  const option = options.find((candidate) => (candidate.textContent ?? "").includes(label));
  expect(option, `expected a Select option containing "${label}"`).toBeTruthy();
  await act(async () => {
    option!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    setNativeValue(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitForm(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

// #541 — the #495 "Connect a channel" CTA pointed at Connections, where Messaging has no
// Connect button (WhatsApp is "Not available yet"): a guided next step into a dead end.
// Until a messaging channel can actually be connected, the zero-channel state must say so
// honestly and must NOT render a CTA to Connections.
describe("zero-channel workspace tells the truth about unavailable channels (#495 → #541)", () => {
  it("templates page replaces the create form with honest not-available-yet copy and no dead-end CTA", () => {
    const markup = renderToStaticMarkup(createElement(InboxTemplatesPage, templatesProps([])));
    expect(markup).toContain("No messaging channel is connected in this workspace yet");
    expect(markup).toContain("Messaging channels are not available to connect yet");
    // The dead-end CTA is gone: no "Connect a channel" button, no link to Connections.
    expect(markup).not.toContain("Connect a channel");
    expect(markup).not.toContain('href="/otto?view=connections"');
    // The create form is gone entirely — no scope select, no submit affordance.
    expect(markup).not.toContain("Create template");
    expect(markup).not.toContain("Select a channel account");
  });

  it("broadcast composer replaces the channel dropdown with honest not-available-yet copy and keeps create disabled", () => {
    const markup = renderToStaticMarkup(createElement(BroadcastComposerPage, composerProps([])));
    expect(markup).toContain("No messaging channel is connected in this workspace yet");
    expect(markup).toContain("Messaging channels are not available to connect yet");
    expect(markup).not.toContain("Connect a channel");
    expect(markup).not.toContain('href="/otto?view=connections"');
    expect(markup).not.toContain("Select a channel account");
    // Create broadcast stays disabled with no channel to send through.
    expect(markup).toMatch(/<button[^>]*\bdisabled\b[^>]*>(?:(?!<\/button>)[\s\S])*Create broadcast/);
  });
});

describe("with-channel workspace submits exactly the picked scope row (#495 / #500 round 3)", () => {
  it("templates page: selecting a scope, filling the form, and submitting sends the exact scope id AND channel of the picked row", async () => {
    vi.mocked(createMessageTemplate).mockResolvedValue({
      ok: true,
      resource: { id: "tpl-1" },
    } as never);
    vi.mocked(listTemplates).mockResolvedValue({ ok: true, resource: [] } as never);

    const dom = await render(createElement(InboxTemplatesPage, templatesProps([SCOPE])));

    const scopeSelect = dom.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Channel account"]');
    expect(scopeSelect).toBeTruthy();
    // The merchant picks the workspace row by its visible channel-account label.
    await chooseOption(scopeSelect!, "WhatsApp");

    const nameInput = dom.querySelector<HTMLInputElement>("#template-name");
    expect(nameInput).toBeTruthy();
    await typeInto(nameInput!, "Order update");

    await submitForm(scopeSelect!.closest("form")!);

    // The REAL submit path (inbox-templates-page.tsx submitTemplate): both channelScopeId and
    // channel come from the ONE picked workspace row — never free text, never a second source.
    expect(createMessageTemplate).toHaveBeenCalledTimes(1);
    expect(createMessageTemplate).toHaveBeenCalledWith({
      channelScopeId: "scope-1",
      channel: "whatsapp",
      name: "Order update",
      locale: "en_MY",
    });
    // Success refreshes the list through the same wrapper.
    expect(listTemplates).toHaveBeenCalled();
  });

  it("broadcast composer happy path: scope + template + segment picked from real rows submit the exact ids and channel", async () => {
    vi.mocked(createBroadcastRun).mockResolvedValue({
      ok: true,
      resource: { id: "run-1" },
    } as never);

    const dom = await render(createElement(BroadcastComposerPage, composerProps([SCOPE])));

    const channel = dom.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Channel account"]')!;
    const template = dom.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Template version"]')!;
    const segment = dom.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Audience segment"]')!;
    await chooseOption(channel, "WhatsApp");
    await chooseOption(template, "Promo");
    await chooseOption(segment, "All customers");

    await submitForm(channel.closest("form")!);

    // The REAL submit path (broadcast-composer-page.tsx onSubmit): channelScopeId and channel
    // both come from the picked scope row; the template version is the picked id; campaign
    // stays null; the idempotency key is the composer-minted bc-* key.
    expect(createBroadcastRun).toHaveBeenCalledTimes(1);
    expect(createBroadcastRun).toHaveBeenCalledWith({
      channelScopeId: "scope-1",
      channel: "whatsapp",
      templateVersionId: "tv-1",
      campaignId: null,
      creationIdempotencyKey: expect.stringMatching(/^bc-/),
    });
    // The chosen segment is carried to the detail page for the freeze step.
    expect(routerPush).toHaveBeenCalledWith("/crm/broadcasts/run-1?segment=seg-1");
  });
});
