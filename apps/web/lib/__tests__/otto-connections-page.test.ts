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

// #511 — /api/meta/callback and /api/meta/authorize redirect a failed connect back to
// /otto?view=connections&error=<code>. Nothing in the app read that param, so the merchant
// was bounced to an unchanged Connections page with no explanation. The page must explain
// the failure, offer a retry where retrying can actually help, and strip the code from the
// URL so a later refresh doesn't resurrect a stale error.
describe("Connections page explains a failed Meta connect (#511)", () => {
  // Keep the address bar out of the other tests in this file — several of them count the
  // /api/meta/authorize anchors, and the error card adds one.
  afterEach(() => {
    window.history.pushState(null, "", "/");
  });

  function mockDisconnected() {
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: DISCONNECTED_CHANNELS,
      packs: [],
      adsAutonomy: "ASK",
      canPublish: false,
      meta: { connected: false },
    });
  }

  it("shows a known failure code as a sentence with a retry, and strips it from the URL", async () => {
    mockDisconnected();
    window.history.pushState(null, "", "/otto?view=connections&error=exchange");

    const dom = await renderConnections();

    const alert = dom.querySelector('[role="alert"]');
    expect(alert, "a failed connect must be explained, not silent").toBeTruthy();
    expect(alert!.textContent).toContain("handshake");

    // Retrying an exchange failure can genuinely work, so the card offers it.
    const retry = alert!.querySelector<HTMLAnchorElement>('a[href="/api/meta/authorize"]');
    expect(retry).toBeTruthy();
    expect(retry!.textContent).toBe("Try again");

    // The code is consumed once: a refresh must not re-show an error that already happened.
    expect(window.location.search).toBe("?view=connections");
  });

  it("keeps the other query params when it strips the error code", async () => {
    mockDisconnected();
    window.history.pushState(null, "", "/otto?view=connections&connected=meta&error=state");

    await renderConnections();

    expect(window.location.search).not.toContain("error");
    expect(window.location.search).toContain("view=connections");
    expect(window.location.search).toContain("connected=meta");
  });

  it("leaves the other params' encoding, the hash and the history entry exactly as they were", async () => {
    mockDisconnected();
    const onPopstate = vi.fn();
    window.addEventListener("popstate", onPopstate);
    try {
      window.history.pushState({ marker: "otto" }, "", "/otto?view=connections&other=a%20b&error=state#frag");
      const stateBefore = window.history.state;

      await renderConnections();

      // Byte-for-byte. Round-tripping the query through URLSearchParams would re-encode
      // `a%20b` as `a+b` — a param this page was never asked to touch, quietly rewritten.
      expect(window.location.search).toBe("?view=connections&other=a%20b");
      // Stripping the code must not drop the fragment or the entry's state...
      expect(window.location.hash).toBe("#frag");
      expect(window.history.state).toEqual(stateBefore);
      // ...and it must be a replace, never a navigation: OttoApp's syncFromLocation
      // listens on popstate, and firing one here would make it re-read the view.
      expect(onPopstate).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("popstate", onPopstate);
    }
  });

  it("tells the truth about an unknown code instead of guessing, and shows the code", async () => {
    mockDisconnected();
    window.history.pushState(null, "", "/otto?view=connections&error=some_future_code");

    const dom = await renderConnections();

    const alert = dom.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("be connected");
    // Shown verbatim so the merchant can quote it to support.
    expect(alert!.textContent).toContain("some_future_code");
    expect(alert!.querySelector('a[href="/api/meta/authorize"]')).toBeTruthy();
  });

  it("#573: explains a connect Meta never identified, and never shows the bare code", async () => {
    // lib/meta-actions.ts now refuses to store a connection whose Meta account id is missing
    // or unusable, and sends the merchant back with error=incomplete. Landing on the generic
    // fallback here would tell them "Meta couldn't be connected. Details: incomplete" — a
    // code, not an explanation, for a case we understand exactly: nothing was saved, and
    // trying again normally works.
    mockDisconnected();
    window.history.pushState(null, "", "/otto?view=connections&error=incomplete");

    const dom = await renderConnections();

    const alert = dom.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain(
      "Meta didn’t confirm which account you connected, so nothing was saved.",
    );
    expect(alert!.textContent).not.toContain("Details: incomplete");
    const retry = alert!.querySelector<HTMLAnchorElement>('a[href="/api/meta/authorize"]');
    expect(retry, "a fresh connect normally succeeds, so the retry must be offered").toBeTruthy();
    expect(retry!.textContent).toBe("Try again");
  });

  it("offers no retry when retrying cannot help (server not configured)", async () => {
    mockDisconnected();
    window.history.pushState(null, "", "/otto?view=connections&error=not_configured");

    const dom = await renderConnections();

    const alert = dom.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("Contact support");
    // A Try again button here would just fail the same way — the merchant isn't the blocker.
    expect(alert!.querySelector("a, button")).toBeNull();
  });

  it("does not mistake a code that merely mentions impersonation for the guard's sentence", async () => {
    mockDisconnected();
    window.history.pushState(null, "", "/otto?view=connections&error=impersonation_failed");

    const dom = await renderConnections();

    const alert = dom.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    // An unknown code is an unknown code: no invented cause, the raw code shown for support,
    // and the retry left available — this merchant is not necessarily impersonating anyone.
    expect(alert!.textContent).toContain("Meta couldn’t be connected.");
    expect(alert!.textContent).toContain("Details: impersonation_failed");
    const retry = alert!.querySelector<HTMLAnchorElement>('a[href="/api/meta/authorize"]');
    expect(retry).toBeTruthy();
    expect(retry!.textContent).toBe("Try again");
  });

  it("shows a server-sent sentence verbatim, with no retry (impersonation guard)", async () => {
    mockDisconnected();
    const sentence = "Paused while impersonating a customer — exit impersonation to connect Meta.";
    window.history.pushState(null, "", `/otto?view=connections&error=${encodeURIComponent(sentence)}`);

    const dom = await renderConnections();

    const alert = dom.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain(sentence);
    expect(alert!.querySelector("a, button")).toBeNull();
  });

  it("renders no error card when the connect did not fail", async () => {
    mockDisconnected();

    const dom = await renderConnections();

    expect(dom.querySelector('[role="alert"]')).toBeNull();
  });
});
