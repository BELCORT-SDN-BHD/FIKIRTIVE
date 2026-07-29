// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// #518 — the Connections page (/otto?view=connections) is now the single real page every
// "Connect a channel" entry point lands on. It must group channels by merchant task
// (Publishing vs Messaging), give each channel exactly one status source and one button,
// and be honest about capabilities that don't exist yet (WhatsApp: no fake Connect button).
// It must also keep the pre-existing Meta ads kill-switch working — privacy/terms cite its
// exact lines as legal evidence, so behavior (not just markup) must not regress.

const mocks = vi.hoisted(() => ({
  getMetaConnection: vi.fn(),
  disconnectMeta: vi.fn(),
  getMetaInsights: vi.fn(),
  setAdsAutonomy: vi.fn(),
  setAdsWritesPaused: vi.fn(),
  getAccountViewData: vi.fn(),
}));

vi.mock("@/lib/meta-actions", () => ({
  getMetaConnection: mocks.getMetaConnection,
  disconnectMeta: mocks.disconnectMeta,
  getMetaInsights: mocks.getMetaInsights,
}));
vi.mock("@/lib/otto-client-actions", () => ({
  setAdsAutonomy: mocks.setAdsAutonomy,
  setAdsWritesPaused: mocks.setAdsWritesPaused,
}));
vi.mock("@/lib/account-view-data", () => ({
  getAccountViewData: mocks.getAccountViewData,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: OttoConnections } = await import("@/components/otto/OttoConnections");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function renderConnections() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(OttoConnections)));
  // Flush the queueMicrotask() that kicks off the two loads on mount.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

const CHANNELS = [
  { id: "instagram", label: "Instagram", status: "not_connected" as const, targets: [], connectUrl: "/api/meta/authorize" },
  { id: "facebook", label: "Facebook", status: "connected" as const, targets: ["Acme Page"], connectUrl: "/api/meta/authorize" },
  { id: "x", label: "X", status: "needs_reconnect" as const, targets: [], connectUrl: "/api/x/authorize" },
];

describe("Connections page groups by merchant task (#518)", () => {
  it("shows Publishing and Messaging as separate groups, each channel with one status and one button", async () => {
    mocks.getMetaConnection.mockResolvedValue({ connected: false });
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: CHANNELS,
      packs: [],
      adsAutonomy: "ASK",
      canPublish: false,
    });

    const dom = await renderConnections();
    const text = dom.textContent ?? "";

    expect(text).toContain("Publishing");
    expect(text).toContain("Messaging");

    // Instagram: not connected → one Connect action to the one OAuth start URL.
    const instagramLink = dom.querySelector<HTMLAnchorElement>('a[href="/api/meta/authorize"]');
    expect(instagramLink?.textContent).toBe("Connect");

    // Facebook: connected → shows its one connection record (target) and a Manage action.
    expect(text).toContain("Acme Page");
    const manageLinks = Array.from(dom.querySelectorAll("a")).filter((a) => a.textContent === "Manage");
    expect(manageLinks.length).toBe(1);

    // X: needs reconnect → its own status + its own connect URL (a different real record).
    const xLink = dom.querySelector<HTMLAnchorElement>('a[href="/api/x/authorize"]');
    expect(xLink?.textContent).toBe("Reconnect");

    // WhatsApp: capability doesn't exist yet — honest label, and definitely NOT a fake
    // Connect button (no anchor/button anywhere carries the WhatsApp row's action).
    expect(text).toContain("WhatsApp");
    expect(text).toContain("Not available yet");
    // querySelectorAll returns document order (ancestors before descendants), so the
    // LAST matching div is the innermost, most specific row — not the whole-page wrapper.
    const whatsappCandidates = Array.from(dom.querySelectorAll("div")).filter(
      (el) => el.textContent?.includes("WhatsApp") && el.textContent.includes("Not available yet"),
    );
    const whatsappRow = whatsappCandidates.at(-1);
    expect(whatsappRow).toBeTruthy();
    expect(whatsappRow!.querySelector("a, button")).toBeNull();
  });

  it("keeps the Meta ad kill-switch working, nested under Publishing once the connection is live", async () => {
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: CHANNELS,
      packs: [],
      adsAutonomy: "ASK",
      canPublish: true,
    });
    mocks.getMetaConnection.mockResolvedValue({
      connected: true,
      status: "active",
      accounts: [{ id: "act_1", name: "Acme Ads", currency: "MYR", status: "ACTIVE" }],
      canWrite: true,
      adsAutonomy: "ASK",
      adsWritesPaused: false,
    });
    mocks.getMetaInsights.mockResolvedValue({ accounts: [] });
    mocks.setAdsWritesPaused.mockResolvedValue({ ok: true });

    const dom = await renderConnections();
    expect(dom.textContent).toContain("Meta ad accounts");
    expect(dom.textContent).toContain("Pause all ad changes");

    const pauseButton = Array.from(dom.querySelectorAll("button")).find((b) => b.textContent === "Pause");
    expect(pauseButton).toBeTruthy();

    await act(async () => {
      pauseButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.setAdsWritesPaused).toHaveBeenCalledWith(true);
  });
});
