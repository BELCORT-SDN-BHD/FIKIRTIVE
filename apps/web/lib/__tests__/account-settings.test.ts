import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/owner-settings";
import type { AccountInfo } from "@/lib/account-actions";
import type { CreditPack } from "@/lib/billing-actions";
import type { SettingsField, SettingsSection } from "@/components/otto/settings/types";

const mocks = vi.hoisted(() => ({
  setOwnerSetting: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));

vi.mock("@/lib/account-actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/lib/owner-settings-actions", () => ({ setOwnerSetting: mocks.setOwnerSetting }));
vi.mock("@/lib/otto-client-actions", () => ({ setAdsAutonomy: mocks.setAdsAutonomy }));

const { buildSettingsSections } = await import("@/components/otto/settings/sections");
const { SettingsPage } = await import("@/components/otto/settings/SettingsPage");
const { parseWholeCredits } = await import("@/components/otto/settings/SettingsPage");

const account: AccountInfo = {
  email: "owner@acme.test",
  organizationName: "Acme Studio",
  isFounder: false,
  balance: 100,
  reserved: 0,
  balanceUsd: 10,
  recent: [],
};

function sections({
  connected,
  canPublish,
  autoPublish = false,
  spendCapCredits = DEFAULT_SETTINGS.spendCapCredits,
  packs = [],
}: {
  connected: boolean;
  canPublish: boolean;
  autoPublish?: boolean;
  spendCapCredits?: number;
  packs?: CreditPack[];
}) {
  return buildSettingsSections({
    account,
    settings: { ...DEFAULT_SETTINGS, autoPublish, spendCapCredits },
    channels: [{
      id: "instagram",
      label: "Instagram",
      status: connected ? "connected" : "not_connected",
      targets: connected ? ["Acme"] : [],
      connectUrl: "/api/meta/authorize",
    }],
    packs,
    adsAutonomy: "ASK",
    canPublish,
    onDeleteAccountRequest: vi.fn(),
  });
}

function renderField(sectionId: string, field: SettingsField): string {
  return renderToStaticMarkup(
    createElement(SettingsPage, { sections: [{ id: sectionId, title: sectionId, fields: [field] }] }),
  );
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
    const autoPublish = fieldById(
      sections({ connected: false, canPublish: false }),
      "otto",
      "autopub",
    );
    expect(autoPublish).toMatchObject({
      kind: "toggle",
      value: false,
      disabled: true,
      hint: "Connect Meta first — auto-publish unlocks once Meta approves publishing.",
    });
  });

  it("renders a persisted true setting as checked and disabled with zero connections", () => {
    const autoPublish = fieldById(
      sections({ connected: false, canPublish: false, autoPublish: true }),
      "otto",
      "autopub",
    );
    expect(autoPublish).toMatchObject({ kind: "toggle", value: true, disabled: true });
    const markup = renderToStaticMarkup(
      createElement(SettingsPage, {
        sections: [{ id: "otto", title: "Otto behavior", fields: [autoPublish] }],
      }),
    );
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("disabled");
  });

  it("keeps auto-publish disabled until the connected Meta account is approved", () => {
    const autoPublish = fieldById(
      sections({ connected: true, canPublish: false }),
      "otto",
      "autopub",
    );
    expect(autoPublish).toMatchObject({
      kind: "toggle",
      value: false,
      disabled: true,
      hint: "Connect Meta first — auto-publish unlocks once Meta approves publishing.",
    });
  });

  it("keeps approved connected auto-publish behavior unchanged", async () => {
    const autoPublish = fieldById(
      sections({ connected: true, canPublish: true, autoPublish: true }),
      "otto",
      "autopub",
    );
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
    const workspace = fieldById(
      sections({ connected: true, canPublish: true }),
      "profile",
      "workspace",
    );
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

// Decision ① (issue #513 §C1, the P1 fix): a spend cap of 0 must always read as
// "Unlimited" in words, never a bare 0 in an editable box, and reaching it is a
// distinct, confirmed action — never a side effect of clearing the field.
describe("spend cap honesty (decision ①)", () => {
  it("renders a saved cap of 0 as the word Unlimited, not an editable 0", () => {
    const cap = fieldById(sections({ connected: true, canPublish: true, spendCapCredits: 0 }), "otto", "cap");
    expect(cap).toMatchObject({ kind: "number", value: 0 });
    const markup = renderField("otto", cap);
    expect(markup).toContain("Unlimited");
    expect(markup).toContain("Set a cap");
    expect(markup).not.toMatch(/<input[^>]*value="0"/);
  });

  it("renders a saved positive cap as an editable input with Save disabled until it changes", () => {
    const cap = fieldById(sections({ connected: true, canPublish: true, spendCapCredits: 500 }), "otto", "cap");
    const markup = renderField("otto", cap);
    expect(markup).toContain('value="500"');
    expect(markup).toContain("disabled"); // nothing typed yet — Save has nothing to do
  });
});

describe("parseWholeCredits — the P1 fix's validation gate", () => {
  it("rejects empty, negative, and non-integer drafts so nothing silently becomes 0", () => {
    expect(parseWholeCredits("")).toBeNull();
    expect(parseWholeCredits("   ")).toBeNull();
    expect(parseWholeCredits("-1")).toBeNull();
    expect(parseWholeCredits("12.5")).toBeNull();
    expect(parseWholeCredits("abc")).toBeNull();
  });

  it("accepts 0 and any positive whole number", () => {
    expect(parseWholeCredits("0")).toBe(0);
    expect(parseWholeCredits("500")).toBe(500);
    expect(parseWholeCredits("  20  ")).toBe(20);
  });
});

// Decision ③ (issue #513 §C3): Settings shows exactly ONE Top up entry, not one
// price-only Buy button per pack.
describe("billing top-up (decision ③)", () => {
  const packs: CreditPack[] = [
    { priceId: "p1", credits: 100, amountCents: 500, currency: "usd", label: "Starter" },
    { priceId: "p2", credits: 500, amountCents: 2000, currency: "usd", label: "Growth" },
  ];

  it("shows a single Top up entry when packs exist — not one button per pack", () => {
    const balance = fieldById(sections({ connected: true, canPublish: true, packs }), "billing", "balance");
    const markup = renderField("billing", balance);
    expect(markup).toContain(">Top up<");
    expect(markup).not.toContain("Buy ·");
  });

  it("shows a hint instead of a dead Top up link when no packs are configured", () => {
    const balance = fieldById(sections({ connected: true, canPublish: true, packs: [] }), "billing", "balance");
    const markup = renderField("billing", balance);
    expect(markup).toContain("No credit packs available right now.");
    expect(markup).not.toContain(">Top up<");
  });
});
