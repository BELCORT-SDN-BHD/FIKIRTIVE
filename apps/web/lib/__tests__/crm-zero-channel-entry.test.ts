import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// #495 — a brand-new workspace has zero channel scopes. Both CRM outbound entry pages
// (broadcast composer, message templates) must show a guided "Connect a channel" next
// step instead of a dead end, and with channels present the template scope must be
// picked from real workspace rows — the displayed choice is exactly what is submitted.
vi.mock("@/lib/customer-inbox-ui-actions", () => ({
  createMessageTemplate: vi.fn(),
  createMessageTemplateVersion: vi.fn(),
  listTemplates: vi.fn(),
}));
vi.mock("@/lib/customer-broadcast-ui-actions", () => ({
  createBroadcastRun: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import BroadcastComposerPage from "@/components/crm/broadcasts/broadcast-composer-page";
import InboxTemplatesPage from "@/components/crm/inbox/inbox-templates-page";

const SCOPE = { id: "scope-1", channel: "whatsapp", scopeKey: "waba-a" };

function templatesMarkup(scopes: (typeof SCOPE)[]): string {
  const props = {
    initialState: { ok: true, resource: [] },
    initialScopes: { ok: true, resource: scopes },
  } as unknown as ComponentProps<typeof InboxTemplatesPage>;
  return renderToStaticMarkup(createElement(InboxTemplatesPage, props));
}

function composerMarkup(scopes: (typeof SCOPE)[]): string {
  const props = {
    initialOptions: {
      ok: true,
      resource: { channelScopes: scopes, segments: [], templateVersions: [], campaigns: [] },
    },
    initialDirectory: { ok: true, resource: { self: { role: "owner" }, members: [] } },
  } as unknown as ComponentProps<typeof BroadcastComposerPage>;
  return renderToStaticMarkup(createElement(BroadcastComposerPage, props));
}

describe("zero-channel workspace gets a guided next step (#495)", () => {
  it("templates page replaces the create form with connect-a-channel guidance", () => {
    const markup = templatesMarkup([]);
    expect(markup).toContain("No messaging channel is connected in this workspace yet");
    expect(markup).toContain("Connect a channel");
    expect(markup).toContain('href="/otto?view=connections"');
    // The create form is gone entirely — no scope select, no submit affordance.
    expect(markup).not.toContain("Create template");
    expect(markup).not.toContain("Select a channel account");
  });

  it("broadcast composer replaces the channel dropdown with connect-a-channel guidance and keeps create disabled", () => {
    const markup = composerMarkup([]);
    expect(markup).toContain("No messaging channel is connected in this workspace yet");
    expect(markup).toContain("Connect a channel");
    expect(markup).toContain('href="/otto?view=connections"');
    expect(markup).not.toContain("Select a channel account");
    // Create broadcast stays disabled with no channel to send through.
    expect(markup).toMatch(/<button[^>]*\bdisabled\b[^>]*>(?:(?!<\/button>)[\s\S])*Create broadcast/);
  });
});

describe("with-channel workspace picks the template scope from real rows (#495)", () => {
  it("templates page offers the workspace channel scopes as a dropdown whose option value is the exact scope id", () => {
    const markup = templatesMarkup([SCOPE]);
    // Displayed value and submitted value are the same row: the option the merchant sees
    // carries the exact channelScopeId the create call will send.
    expect(markup).toContain('<option value="scope-1">');
    expect(markup).toContain("whatsapp · waba-a");
    expect(markup).toContain("Create template");
    // The old free-text scope entry is gone from the create form.
    expect(markup).not.toContain('aria-label="Channel scope ID"');
    expect(markup).not.toContain("enter the exact channel scope ID");
  });
});
