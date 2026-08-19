import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// #727 — three CRM screens wrote "no messaging channel is connected" as fixed text while three
// others read the workspace's channel accounts and said whatever was true. Today nothing writes
// a ChannelScope row in production, so the fixed text happens to be right — by accident, not by
// reading. The moment a channel exists, those three screens lie to the merchant with nothing to
// catch it. The same blind spot made the Broadcasts empty state invite a merchant into a form
// whose Create button can never enable.
//
// Every assertion below feeds the pages a channel state and reads what the merchant would read.

vi.mock("@/lib/customer-broadcast-ui-actions", () => ({
  cancelBroadcastRun: vi.fn(),
  confirmBroadcastRun: vi.fn(),
  executeBroadcastRun: vi.fn(),
  freezeAudience: vi.fn(),
  getBroadcastRunLivePreflight: vi.fn(),
  listBroadcastRuns: vi.fn(),
}));
vi.mock("@/lib/customer-broadcast-report-ui-actions", () => ({
  getCustomerBroadcastReport: vi.fn(),
}));
vi.mock("@/lib/customer-inbox-ui-actions", () => ({
  assignConversation: vi.fn(),
  createMessageTemplate: vi.fn(),
  createMessageTemplateVersion: vi.fn(),
  getConversation: vi.fn(),
  getConversationPreflight: vi.fn(),
  getHistory: vi.fn(),
  handOffConversation: vi.fn(),
  listConversations: vi.fn(),
  listTemplates: vi.fn(),
  requestAutomationResume: vi.fn(),
  saveConversationDraft: vi.fn(),
  searchConversations: vi.fn(),
  setConversationStatus: vi.fn(),
}));

import BroadcastDetailPage from "@/components/crm/broadcasts/broadcast-detail-page";
import BroadcastListPage from "@/components/crm/broadcasts/broadcast-list-page";
import InboxConversationPage from "@/components/crm/inbox/inbox-conversation-page";
import InboxListPage from "@/components/crm/inbox/inbox-list-page";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

// 判官 r2 P1-1 — three distinct shapes the product can actually be in. A ChannelScope row is a
// stable IDENTITY (the schema keeps it lifecycle-free on purpose); whether it is connected lives
// on ChannelConnection.status, which the server reads into `connectionState`.
const LIVE_SCOPE = { id: "scope-1", channel: "whatsapp", scopeKey: "60123456789", connectionState: "active" as const };
const LAPSED_SCOPE = { id: "scope-1", channel: "whatsapp", scopeKey: "60123456789", connectionState: "inactive" as const };
const NEVER_CONNECTED_SCOPE = { id: "scope-1", channel: "whatsapp", scopeKey: "60123456789", connectionState: "none" as const };

const CONNECTED = { ok: true, resource: [LIVE_SCOPE] };
const EXPIRED = { ok: true, resource: [LAPSED_SCOPE] };
const IDENTITY_ONLY = { ok: true, resource: [NEVER_CONNECTED_SCOPE] };
const NONE = { ok: true, resource: [] };
const UNREADABLE = { ok: false, error: "ACTION_DENIED" };

const NO_CHANNEL_CLAIM = "No messaging channel is connected in this workspace";
const CONNECT_UNAVAILABLE_NOTE = "Messaging channels are not available to connect yet";

const RUN = {
  id: "run-1",
  status: "draft",
  purpose: "marketing",
  channel: "whatsapp",
  createdByMembershipId: "membership-1",
  createdAt: new Date("2026-07-24T00:00:00.000Z"),
  revision: 0,
};

const DIRECTORY = {
  ok: true,
  resource: {
    self: { role: "owner", roles: ["owner"], membershipId: "membership-1" },
    members: [{ membershipId: "membership-1", displayName: "Owner", roles: ["owner"] }],
  },
};

function inboxMarkup(channelScopes: unknown): string {
  const props = {
    initialState: { ok: true, resource: [] },
    initialChannelScopes: channelScopes,
  } as unknown as ComponentProps<typeof InboxListPage>;
  return renderToStaticMarkup(createElement(InboxListPage, props));
}

function broadcastListMarkup(channelScopes: unknown): string {
  const props = {
    initialRuns: { ok: true, resource: [] },
    initialDirectory: DIRECTORY,
    initialReportRunIds: [],
    initialChannelScopes: channelScopes,
  } as unknown as ComponentProps<typeof BroadcastListPage>;
  return renderToStaticMarkup(createElement(BroadcastListPage, props));
}

function broadcastDetailMarkup(channelScopes: { id: string; channel: string; scopeKey: string; connectionState?: string }[]): string {
  const props = {
    broadcastRunId: RUN.id,
    initialRun: { ok: true, resource: { run: RUN, members: [], campaign: null } },
    initialPreflight: { ok: true, resource: { run: RUN, members: [] } },
    initialDirectory: DIRECTORY,
    initialOptions: { ok: true, resource: { segments: [], channelScopes } },
    initialReportAvailable: false,
    preselectedSegmentId: null,
  } as unknown as ComponentProps<typeof BroadcastDetailPage>;
  return renderToStaticMarkup(createElement(BroadcastDetailPage, props));
}

// 判官 r2 P1-2 — the conversation page. The service hard-codes `connection.status: "unknown"`
// (customer-inbox-service `stored_evidence_unavailable`), and the page turned that unknown into
// the assertion "Not connected yet". Its own axis may only speak about THIS conversation's link.
function conversationMarkup(channelScopes: unknown): string {
  const props = {
    conversationId: "conv-1",
    initialState: {
      conversation: {
        ok: true,
        resource: {
          id: "conv-1",
          revision: 3,
          status: "open",
          automationState: "disabled",
          lastMessageAt: null,
          assigneeMembership: null,
          draft: null,
          contactIdentity: {
            channel: "whatsapp",
            externalId: "60111111111",
            handle: "60111111111",
            label: null,
            contact: { id: "contact-1", name: "Aisyah", lifecycleStage: "Active" },
          },
        },
      },
      history: { ok: true, resource: { messages: [], events: [] } },
      preflight: {
        ok: true,
        resource: {
          checkedAt: new Date("2026-07-24T00:00:00.000Z"),
          internalCapability: { status: "pass" },
          connection: { status: "unknown" },
          d8Carrier: { status: "unavailable" },
          consentStop: { status: "pass" },
          doNotDisturb: { status: "pass" },
          providerRefusal: { status: "pass" },
          frequency: { status: "pass" },
          exactApproval: { status: "unavailable" },
          sendEligibility: { status: "unavailable" },
          freshness: {
            lastProviderEventAt: null,
            lastHealthCheckedAt: null,
            lastDataLoadedAt: new Date("2026-07-24T00:00:00.000Z"),
          },
        },
      },
    },
    initialDirectory: DIRECTORY,
    initialChannelScopes: channelScopes,
  } as unknown as ComponentProps<typeof InboxConversationPage>;
  return renderToStaticMarkup(createElement(InboxConversationPage, props));
}

describe("the conversation page stops turning an unknown into a claim (#727 判官 r2 P1-2)", () => {
  it("no longer asserts 'Not connected yet' off an axis the server hard-codes to unknown", () => {
    for (const state of [CONNECTED, EXPIRED, IDENTITY_ONLY, NONE, UNREADABLE]) {
      expect(conversationMarkup(state)).not.toContain("Not connected yet");
    }
  });

  it("says what is true of the workspace, and separately that this conversation's link is unconfirmed", () => {
    const connected = conversationMarkup(CONNECTED);
    expect(connected).toContain("Connected messaging channel: WhatsApp · 60123456789.");
    expect(connected).not.toContain(NO_CHANNEL_CLAIM);
    expect(connected).toContain("provider link is not confirmed");

    expect(conversationMarkup(NONE)).toContain(NO_CHANNEL_CLAIM);
    expect(conversationMarkup(EXPIRED)).toContain("is no longer active");
    expect(conversationMarkup(UNREADABLE)).toContain("could not be read");
    expect(conversationMarkup(UNREADABLE)).not.toContain(NO_CHANNEL_CLAIM);
  });
});

describe("the three screens that wrote it down now read it (#727)", () => {
  it("Inbox list says a channel is connected when one is, and names it", () => {
    const markup = inboxMarkup(CONNECTED);
    expect(markup).not.toContain(NO_CHANNEL_CLAIM);
    expect(markup).not.toContain(CONNECT_UNAVAILABLE_NOTE);
    expect(markup).toContain("WhatsApp · 60123456789");
  });

  it("Inbox list still says the truth for a workspace with no channel", () => {
    const markup = inboxMarkup(NONE);
    expect(markup).toContain(NO_CHANNEL_CLAIM);
    expect(markup).toContain(CONNECT_UNAVAILABLE_NOTE);
  });

  it("Broadcasts list says a channel is connected when one is, and names it", () => {
    const markup = broadcastListMarkup(CONNECTED);
    expect(markup).not.toContain(NO_CHANNEL_CLAIM);
    expect(markup).toContain("WhatsApp · 60123456789");
  });

  it("Broadcasts list still says the truth for a workspace with no channel", () => {
    expect(broadcastListMarkup(NONE)).toContain(NO_CHANNEL_CLAIM);
  });

  it("broadcast detail stops asserting no channel is connected when one is", () => {
    const markup = broadcastDetailMarkup([LIVE_SCOPE]);
    expect(markup).not.toContain("No channel is connected");
    expect(markup).not.toContain(NO_CHANNEL_CLAIM);
    expect(markup).toContain("WhatsApp · 60123456789");
    // The fact that has nothing to do with channel accounts stays exactly as true as it was.
    expect(markup).toContain("simulated sends only");
  });

  it("broadcast detail still says the truth for a workspace with no channel", () => {
    expect(broadcastDetailMarkup([])).toContain(NO_CHANNEL_CLAIM);
  });

  // 判官 r2 P1-1: the two shapes the scope-presence reading got wrong.
  it("a channel account that was NEVER connected is not a connection", () => {
    for (const markup of [inboxMarkup(IDENTITY_ONLY), broadcastListMarkup(IDENTITY_ONLY), broadcastDetailMarkup([NEVER_CONNECTED_SCOPE])]) {
      expect(markup).toContain(NO_CHANNEL_CLAIM);
      expect(markup).not.toContain("Connected messaging channel");
    }
  });

  it("an EXPIRED connection is not a connection, and says which account lapsed", () => {
    for (const markup of [inboxMarkup(EXPIRED), broadcastListMarkup(EXPIRED), broadcastDetailMarkup([LAPSED_SCOPE])]) {
      expect(markup).toContain(NO_CHANNEL_CLAIM);
      expect(markup).not.toContain("Connected messaging channel");
      expect(markup).toContain("is no longer active");
      expect(markup).toContain("WhatsApp · 60123456789");
    }
  });

  it("never turns a failed read into a claim about connection either way", () => {
    for (const markup of [inboxMarkup(UNREADABLE), broadcastListMarkup(UNREADABLE)]) {
      expect(markup).not.toContain(NO_CHANNEL_CLAIM);
      expect(markup).toContain("could not be read");
    }
  });
});

describe("the Broadcasts empty state is no longer a dead end (#727)", () => {
  it("with no channel, does not invite a merchant into a form that can never submit", () => {
    const markup = broadcastListMarkup(NONE);
    // The composer's Create button requires a channelScopeId; with zero channel accounts there
    // is no dropdown to pick one from, so every route into it ends on a disabled button.
    expect(markup).not.toContain('href="/crm/broadcasts/new"');
    expect(markup).not.toContain("Create your first broadcast");
    expect(markup).toContain(CONNECT_UNAVAILABLE_NOTE);
  });

  it("with a channel connected, the invitation and the CTA come back", () => {
    const markup = broadcastListMarkup(CONNECTED);
    expect(markup).toContain('href="/crm/broadcasts/new"');
    expect(markup).toContain("Create your first broadcast");
  });

  // 判官 r2 P1-1: identity, not lifecycle, is what the composer needs — it submits a
  // channelScopeId. A lapsed connection must not invent a refusal the server does not make.
  it("keeps the CTA for an account whose connection lapsed — the form can still be filled in", () => {
    for (const state of [EXPIRED, IDENTITY_ONLY]) {
      const markup = broadcastListMarkup(state);
      expect(markup).toContain('href="/crm/broadcasts/new"');
    }
  });
});

describe("one connection authority, read once per route (#727)", () => {
  it("no CRM page keeps its own copy of the connection sentence", () => {
    for (const file of [
      "../../components/crm/inbox/inbox-list-page.tsx",
      // 判官 r2 P1-2: the conversation page is inside the fence now.
      "../../components/crm/inbox/inbox-conversation-page.tsx",
      "../../components/crm/inbox/inbox-templates-page.tsx",
      "../../components/crm/broadcasts/broadcast-list-page.tsx",
      "../../components/crm/broadcasts/broadcast-detail-page.tsx",
      "../../components/crm/broadcasts/broadcast-composer-page.tsx",
    ]) {
      const src = source(file);
      expect(src).toContain('from "@/lib/crm-channel-connection"');
      expect(src).not.toContain(NO_CHANNEL_CLAIM);
      expect(src).not.toContain(CONNECT_UNAVAILABLE_NOTE);
    }
  });

  // W2-13 (#993) — these three routes used to preload the workspace's channel accounts for
  // the page below them. The whole CRM section is hidden until Meta verification passes
  // (Founder ruling 2026-08-18; restore trigger recorded on issue #359), so every /crm route
  // is now a bare `redirect("/")` and loads nothing at all.
  //
  // The claim this test made — "a route that states connection reads the real connection
  // state" — is kept by pinning the new fact instead: a route that loads NOTHING cannot
  // state anything. Rebuilding these loaders is part of restoring CRM; the components below
  // them are untouched and still covered by the sweep above.
  it("no CRM route states connection any more — they redirect and load nothing", () => {
    for (const route of [
      "../../app/crm/inbox/page.tsx",
      "../../app/crm/inbox/[id]/page.tsx",
      "../../app/crm/broadcasts/page.tsx",
    ]) {
      const src = source(route);
      expect(src, `${route} 还在取数`).toContain('redirect("/")');
      expect(src, `${route} 还在读渠道账号`).not.toContain("listChannelScopes");
    }
  });

  it("both CRM services read channel accounts through the one lifecycle-aware source", () => {
    // 判官 r2 P1-1: neither service may query ChannelScope for this question on its own — that is
    // how "a scope row exists" got mistaken for "a channel is connected".
    for (const file of ["../customer-broadcast-service.ts", "../customer-inbox-service.ts"]) {
      expect(source(file)).toContain("listChannelScopesWithConnectionState");
    }
    const service = source("../customer-broadcast-service.ts");
    expect(service).toContain("async function listChannelScopes");
    const gated = service.match(/async function listChannelScopes[\s\S]{0,240}/)?.[0] ?? "";
    expect(gated).toContain("requireReadMembership");
  });

  it("the connection state comes from ChannelConnection.status, not from the identity table", () => {
    const resolver = source("../channel-connection-resolve.ts");
    expect(resolver).toContain("listChannelScopesWithConnectionState");
    // Same liveness condition the send path already gates on.
    expect(resolver).toContain('status === "active"');
    expect(resolver).toContain("channelConnection.findMany");
  });
});
