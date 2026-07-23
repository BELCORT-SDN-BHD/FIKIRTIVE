import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/owner-settings";
import type { AccountInfo } from "@/lib/account-actions";
import type { SettingsField, SettingsSection } from "@/components/otto/settings/types";

const mocks = vi.hoisted(() => ({
  setOwnerSetting: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));

vi.mock("@/lib/account-actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/lib/owner-settings-actions", () => ({ setOwnerSetting: mocks.setOwnerSetting }));
vi.mock("@/lib/otto-client-actions", () => ({ setAdsAutonomy: mocks.setAdsAutonomy }));
vi.mock("@/components/billing/BuyPackButton", () => ({ BuyPackButton: () => null }));

const { buildSettingsSections } = await import("@/components/otto/settings/sections");
const { SettingsPage } = await import("@/components/otto/settings/SettingsPage");

const account: AccountInfo = {
  email: "owner@acme.test",
  organizationName: "Acme Studio",
  isFounder: false,
  balance: 100,
  reserved: 0,
  balanceUsd: 10,
  recent: [],
};

function sections(connected: boolean, autoPublish = false) {
  return buildSettingsSections({
    account,
    settings: { ...DEFAULT_SETTINGS, autoPublish },
    channels: [{
      id: "instagram",
      label: "Instagram",
      status: connected ? "connected" : "not_connected",
      targets: connected ? ["Acme"] : [],
      connectUrl: "/api/meta/authorize",
    }],
    packs: [],
    adsAutonomy: "ASK",
    onDeleteAccountRequest: vi.fn(),
  });
}

function fieldById(items: SettingsSection[], sectionId: string, fieldId: string): SettingsField {
  const field = items.find((section) => section.id === sectionId)?.fields.find((item) => item.id === fieldId);
  if (!field) throw new Error(`Missing ${sectionId}.${fieldId}`);
  return field;
}

beforeEach(() => {
  mocks.setOwnerSetting.mockReset();
  mocks.setOwnerSetting.mockResolvedValue({ ok: true });
  mocks.setAdsAutonomy.mockReset();
});

describe("account settings honesty", () => {
  it("disables auto-publish and explains the Meta approval gate without a connection", () => {
    const autoPublish = fieldById(sections(false), "otto", "autopub");
    expect(autoPublish).toMatchObject({
      kind: "toggle",
      value: false,
      disabled: true,
      hint: "Connect Meta first; auto-publish turns on once Meta approves publishing.",
    });
  });

  it("keeps connected auto-publish behavior unchanged", async () => {
    const autoPublish = fieldById(sections(true, true), "otto", "autopub");
    expect(autoPublish).toMatchObject({
      kind: "toggle",
      value: true,
      disabled: false,
      hint: "Publish approved posts automatically at their time",
    });
    if (autoPublish.kind !== "toggle") throw new Error("Expected auto-publish toggle");
    await autoPublish.onToggle(false);
    expect(mocks.setOwnerSetting).toHaveBeenCalledWith("autoPublish", false);
  });

  it("renders the authenticated organization name in the Workspace field", () => {
    const workspace = fieldById(sections(true), "profile", "workspace");
    expect(workspace).toMatchObject({ kind: "text", value: "Acme Studio", readOnly: true });
    const markup = renderToStaticMarkup(
      createElement(SettingsPage, {
        sections: [{ id: "profile", title: "Profile", fields: [workspace] }],
      }),
    );
    expect(markup).toContain("Workspace");
    expect(markup).toContain('value="Acme Studio"');
  });
});
