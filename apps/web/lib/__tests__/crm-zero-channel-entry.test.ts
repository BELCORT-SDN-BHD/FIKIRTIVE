// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// #495 — a brand-new workspace has zero channel scopes. Both CRM outbound entry pages
// (broadcast composer, message templates) must show a guided "Connect a channel" next
// step instead of a dead end. With channels present, the round-3 review (#500) requires
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
function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
}

async function chooseOption(select: HTMLSelectElement, value: string) {
  await act(async () => {
    setNativeValue(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
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

describe("zero-channel workspace gets a guided next step (#495)", () => {
  it("templates page replaces the create form with connect-a-channel guidance", () => {
    const markup = renderToStaticMarkup(createElement(InboxTemplatesPage, templatesProps([])));
    expect(markup).toContain("No messaging channel is connected in this workspace yet");
    expect(markup).toContain("Connect a channel");
    expect(markup).toContain('href="/otto?view=connections"');
    // The create form is gone entirely — no scope select, no submit affordance.
    expect(markup).not.toContain("Create template");
    expect(markup).not.toContain("Select a channel account");
  });

  it("broadcast composer replaces the channel dropdown with connect-a-channel guidance and keeps create disabled", () => {
    const markup = renderToStaticMarkup(createElement(BroadcastComposerPage, composerProps([])));
    expect(markup).toContain("No messaging channel is connected in this workspace yet");
    expect(markup).toContain("Connect a channel");
    expect(markup).toContain('href="/otto?view=connections"');
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

    const scopeSelect = dom.querySelector<HTMLSelectElement>('select[aria-label="Channel account"]');
    expect(scopeSelect).toBeTruthy();
    // The option the merchant sees is the workspace row itself: value = exact scope id.
    expect(Array.from(scopeSelect!.options).map((o) => o.value)).toContain(SCOPE.id);
    await chooseOption(scopeSelect!, SCOPE.id);

    const nameInput = dom.querySelector<HTMLInputElement>('input[aria-label="Template name"]');
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

    // Form select order: 0 = channel account, 1 = template version, 2 = campaign, 3 = segment.
    const selects = dom.querySelectorAll<HTMLSelectElement>("form select");
    expect(selects.length).toBe(4);
    await chooseOption(selects[0], SCOPE.id);
    await chooseOption(selects[1], "tv-1");
    await chooseOption(selects[3], "seg-1");

    await submitForm(selects[0].closest("form")!);

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
