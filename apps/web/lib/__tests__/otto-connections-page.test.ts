// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// #518 — the Connections page (/otto?view=connections) is now the single real page every
// "Connect a channel" entry point lands on. It must group channels by merchant task
// (Publishing vs Messaging), give each channel exactly one status source and one button,
// and be honest about capabilities that don't exist yet (WhatsApp AND X: no fake
// Connect/Reconnect/Manage button — X has no OAuth route, lib/channels/x.ts).
//
// #518 round 3 rework finding 2 — one Meta read, not up to four: the page must make
// exactly ONE data call, getAccountViewData(). It must NEVER call getMetaConnection()
// itself; account-view-data.ts is the single place that reads the Meta connection, and it
// hands the page both the already-correct Instagram/Facebook row status (`channels`) and
// the ad-accounts panel data (`meta`) from that one read.
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
  // Flush the queueMicrotask() that kicks off the single load() on mount.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

// Meta disconnected: getAccountViewData() (the single Meta read, server-side) already
// resolved instagram/facebook status to "not_connected" — the page just renders what it's
// given, it does not compute this itself.
const DISCONNECTED_CHANNELS = [
  { id: "instagram", label: "Instagram", status: "not_connected" as const, targets: [], connectUrl: "/api/meta/authorize" },
  { id: "facebook", label: "Facebook", status: "not_connected" as const, targets: [], connectUrl: "/api/meta/authorize" },
  { id: "x", label: "X", status: "needs_reconnect" as const, targets: [], connectUrl: "/api/x/authorize" },
];

// Meta connected: instagram/facebook targets AND status both come from the one
// getAccountViewData() read.
const CONNECTED_CHANNELS = [
  { id: "instagram", label: "Instagram", status: "connected" as const, targets: ["Acme IG Page"], connectUrl: "/api/meta/authorize" },
  { id: "facebook", label: "Facebook", status: "connected" as const, targets: ["Acme Page"], connectUrl: "/api/meta/authorize" },
  { id: "x", label: "X", status: "needs_reconnect" as const, targets: [], connectUrl: "/api/x/authorize" },
];

describe("Connections page groups by merchant task (#518)", () => {
  it("shows Publishing and Messaging as separate groups; makes exactly one data call", async () => {
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: DISCONNECTED_CHANNELS,
      packs: [],
      adsAutonomy: "ASK",
      canPublish: false,
      meta: { connected: false },
    });

    const dom = await renderConnections();
    const text = dom.textContent ?? "";

    // Round 3 rework finding 2: the page reads Meta status ONLY through
    // getAccountViewData() — it must never call getMetaConnection() itself.
    expect(mocks.getMetaConnection).not.toHaveBeenCalled();

    expect(text).toContain("Publishing");
    expect(text).toContain("Messaging");

    // Meta disconnected ⇒ Instagram and Facebook both show Connect, never Manage.
    const connectLinks = Array.from(dom.querySelectorAll<HTMLAnchorElement>('a[href="/api/meta/authorize"]'));
    expect(connectLinks).toHaveLength(2);
    connectLinks.forEach((a) => expect(a.textContent).toBe("Connect"));
    expect(Array.from(dom.querySelectorAll("a")).some((a) => a.textContent === "Manage")).toBe(false);

    // X: no OAuth route exists yet — honest "Not available yet", no button, regardless
    // of the (irrelevant) needs_reconnect/connectUrl the channels-load fixture carries.
    expect(dom.querySelector('a[href="/api/x/authorize"]')).toBeNull();

    // WhatsApp and X: capabilities that don't exist yet — honest label, and definitely
    // NOT a fake Connect/Reconnect button (no anchor/button anywhere in their row).
    expect(text).toContain("WhatsApp");
    for (const label of ["WhatsApp", "X"]) {
      // querySelectorAll returns document order (ancestors before descendants), so the
      // LAST matching div is the innermost, most specific row — not the whole-page wrapper.
      const candidates = Array.from(dom.querySelectorAll("div")).filter(
        (el) => el.textContent?.includes(label) && el.textContent.includes("Not available yet"),
      );
      const row = candidates.at(-1);
      expect(row, `${label} row should say "Not available yet"`).toBeTruthy();
      expect(row!.querySelector("a, button")).toBeNull();
    }
  });

  it("keeps the Meta ad kill-switch working, nested under Publishing once the connection is live", async () => {
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: CONNECTED_CHANNELS,
      packs: [],
      adsAutonomy: "ASK",
      canPublish: true,
      meta: {
        connected: true,
        status: "active",
        accounts: [{ id: "act_1", name: "Acme Ads", currency: "MYR", status: "ACTIVE" }],
        canWrite: true,
        adsAutonomy: "ASK",
        adsWritesPaused: false,
      },
    });
    mocks.getMetaInsights.mockResolvedValue({ accounts: [] });
    mocks.setAdsWritesPaused.mockResolvedValue({ ok: true });

    const dom = await renderConnections();
    expect(mocks.getMetaConnection).not.toHaveBeenCalled();
    expect(dom.textContent).toContain("Meta ad accounts");
    expect(dom.textContent).toContain("Pause all ad changes");

    // Instagram AND Facebook both show "Manage", matching their real targets — one status
    // source (getAccountViewData()'s single Meta read), one button each.
    expect(dom.textContent).toContain("Acme IG Page");
    expect(dom.textContent).toContain("Acme Page");
    const manageLinks = Array.from(dom.querySelectorAll("a")).filter((a) => a.textContent === "Manage");
    expect(manageLinks.length).toBe(2);

    // X still has no real connect flow even once Meta is connected — it isn't Meta-backed.
    expect(dom.querySelector('a[href="/api/x/authorize"]')).toBeNull();

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
