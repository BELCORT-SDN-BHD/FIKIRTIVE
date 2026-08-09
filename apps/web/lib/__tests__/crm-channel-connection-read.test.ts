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
  createMessageTemplate: vi.fn(),
  createMessageTemplateVersion: vi.fn(),
  listConversations: vi.fn(),
  listTemplates: vi.fn(),
  searchConversations: vi.fn(),
}));

import BroadcastDetailPage from "@/components/crm/broadcasts/broadcast-detail-page";
import BroadcastListPage from "@/components/crm/broadcasts/broadcast-list-page";
import InboxListPage from "@/components/crm/inbox/inbox-list-page";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

const SCOPE = { id: "scope-1", channel: "whatsapp", scopeKey: "60123456789" };

const CONNECTED = { ok: true, resource: [SCOPE] };
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

function broadcastDetailMarkup(channelScopes: { id: string; channel: string; scopeKey: string }[]): string {
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
    const markup = broadcastDetailMarkup([SCOPE]);
    expect(markup).not.toContain("No channel is connected");
    expect(markup).not.toContain(NO_CHANNEL_CLAIM);
    expect(markup).toContain("WhatsApp · 60123456789");
    // The fact that has nothing to do with channel accounts stays exactly as true as it was.
    expect(markup).toContain("simulated sends only");
  });

  it("broadcast detail still says the truth for a workspace with no channel", () => {
    expect(broadcastDetailMarkup([])).toContain(NO_CHANNEL_CLAIM);
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
});

describe("one connection authority, read once per route (#727)", () => {
  it("no CRM page keeps its own copy of the connection sentence", () => {
    for (const file of [
      "../../components/crm/inbox/inbox-list-page.tsx",
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

  it("both list routes actually read the workspace's channel accounts", () => {
    expect(source("../../app/crm/inbox/page.tsx")).toContain("listChannelScopes");
    expect(source("../../app/crm/broadcasts/page.tsx")).toContain("listChannelScopes");
  });

  it("the broadcast service reads channel accounts in one place, gated like every other read", () => {
    const service = source("../customer-broadcast-service.ts");
    // One query definition, used by the composer options and the new tenant-gated read alike.
    expect(service.match(/db\.channelScope\.findMany/g)).toHaveLength(1);
    expect(service).toContain("async function listChannelScopes");
    const gated = service.match(/async function listChannelScopes[\s\S]{0,240}/)?.[0] ?? "";
    expect(gated).toContain("requireReadMembership");
  });
});
