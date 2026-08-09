// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_BLOCKER_COPY } from "@fikirtive/core/schedule-draft";

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
      shelf: { packs: [] },
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
      shelf: { packs: [] },
      adsAutonomy: "ASK",
      canPublish: true,
      meta: {
        connected: true,
        status: "active",
        // account_status is Meta's numeric code — 1 = the account is running (#693).
        accounts: [{ id: "act_1", name: "Acme Ads", currency: "MYR", status: "1" }],
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
      shelf: { packs: [] },
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
    expect(alert!.textContent).toContain("aren’t switched on for this server yet");
    // A Try again button here would just fail the same way — the merchant isn't the blocker.
    expect(alert!.querySelector('a[href="/api/meta/authorize"], button')).toBeNull();
    // #686 — but "the merchant isn't the blocker" is only honest if the product hands over
    // the one exit that IS open: a live way to reach us, not the words "contact support".
    expect(alert!.querySelector('a[href^="mailto:"]')).toBeTruthy();
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

// #693 — the ad-account rows printed Meta's raw account_status code at the merchant
// ("MYR · 1"), and a suspended account looked like "MYR · 2" — the one fact that actually
// matters ("my ad account is stopped") never reached the screen. Same family as #683:
// an internal code shown to the merchant. The page must read the single status mapping
// (lib/meta-ad-account-status.ts) and never render a bare code.
describe("Connections page speaks plain English about ad-account status (#693)", () => {
  function mockAccounts(accounts: { id: string; name: string; currency: string; status: string }[]) {
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: CONNECTED_CHANNELS,
      shelf: { packs: [] },
      adsAutonomy: "ASK",
      canPublish: true,
      meta: { connected: true, status: "active", accounts, canWrite: true, adsAutonomy: "ASK", adsWritesPaused: false },
    });
    mocks.getMetaInsights.mockResolvedValue({ accounts: [] });
  }

  /** The one row for this ad account — innermost matching div, ancestors excluded. */
  function accountRow(dom: HTMLElement, name: string): HTMLElement {
    const candidates = Array.from(dom.querySelectorAll<HTMLElement>("div")).filter((el) =>
      el.textContent?.includes(name),
    );
    const row = candidates.at(-1);
    if (!row) throw new Error(`no ad-account row for "${name}"`);
    return row;
  }

  it("a running account reads as words, never as the code the screenshot showed", async () => {
    mockAccounts([{ id: "act_qa_1", name: "Kaia Cafe QA Ads", currency: "MYR", status: "1" }]);

    const dom = await renderConnections();
    const text = dom.textContent ?? "";

    // The exact string from the ticket's screenshot.
    expect(text).not.toContain("MYR · 1");
    expect(text).toContain("MYR · Active");
  });

  it("a suspended account says so, and says what it means for the merchant's ads", async () => {
    mockAccounts([{ id: "act_qa_1", name: "Night Market QA Ads", currency: "SGD", status: "2" }]);

    const dom = await renderConnections();
    const text = dom.textContent ?? "";

    expect(text).not.toContain("SGD · 2");
    expect(text).toContain("Disabled");
    // "Disabled" alone is still a word the merchant has to interpret — the consequence is spelled out.
    expect(text.toLowerCase()).toContain("ads");
  });

  it("a code we don't recognise is admitted, not printed and not guessed at", async () => {
    mockAccounts([{ id: "act_qa_1", name: "Future State Ads", currency: "MYR", status: "202" }]);

    const dom = await renderConnections();
    const row = accountRow(dom, "Future State Ads");

    expect(row.textContent).toContain("Unknown status");
    expect(row.textContent).not.toContain("202");
  });

  it("no ad-account row anywhere ends in a bare status code", async () => {
    mockAccounts([
      { id: "act_1", name: "Kaia Cafe QA Ads", currency: "MYR", status: "1" },
      { id: "act_2", name: "Night Market QA Ads", currency: "SGD", status: "3" },
      { id: "act_3", name: "Grace Period Ads", currency: "MYR", status: "9" },
      { id: "act_4", name: "Closed Ads", currency: "MYR", status: "101" },
    ]);

    const dom = await renderConnections();
    const text = dom.textContent ?? "";

    // The shape the bug produced: "<CURRENCY> · <digits>".
    expect(text).not.toMatch(/[A-Z]{3}\s·\s\d/);
  });

  it("shows nothing rather than an invented status when Meta reported none", async () => {
    mockAccounts([{ id: "act_1", name: "Silent Ads", currency: "MYR", status: "" }]);

    const dom = await renderConnections();
    const row = accountRow(dom, "Silent Ads");

    expect(row.textContent).toContain("MYR");
    expect(row.textContent).not.toContain("·");
    expect(row.textContent).not.toContain("Unknown status");
  });
});

// ── #741 判官 r5 [P1] 同一个事实,两块屏幕一套话 ────────────────────────────────
//
// 连接页曾经对一个「缺页面权限」的连接只写「Connected」,排程页那边却说「Connect an
// account first」。这一组钉的是:这类状态在两处用的是同一份 CONNECTION_BLOCKER_COPY,
// 逐字比对,而不是各写各的。

describe("#741 r5 连着但用不了:连接页与排程页用同一套说法", () => {
  for (const blocker of ["needs_reconnect", "needs_page_permission"] as const) {
    it(`${blocker}:行上写的就是共享权威那个标签`, async () => {
      mocks.getAccountViewData.mockResolvedValue({
        settings: {},
        channels: [
          { id: "instagram", label: "Instagram", status: "connected" as const, targets: [], blocker, connectUrl: "/api/meta/authorize" },
          { id: "facebook", label: "Facebook", status: "connected" as const, targets: [], blocker, connectUrl: "/api/meta/authorize" },
        ],
        shelf: { packs: [] },
        adsAutonomy: "ASK",
        canPublish: false,
        meta: { connected: true },
      });

      const dom = await renderConnections();
      const text = dom.textContent ?? "";
      expect(text).toContain(CONNECTION_BLOCKER_COPY[blocker].status);
      // 而且不能只剩一个空洞的「Connected」把问题盖过去。
      expect(text).not.toMatch(/Connected(?!\w)/);
    });

    // 判官 r5 [P2]:按钮只看 status 不看 blocker —— needs_page_permission 通常伴随
    // status:"connected",于是同一行写着「Page access needed」按钮却写「Manage」,
    // 与 Schedule 那边的「Reconnect」对不上。
    it(`${blocker}:按钮跟着事实走,写的是 Reconnect 而不是 Manage`, async () => {
      mocks.getAccountViewData.mockResolvedValue({
        settings: {},
        channels: [
          { id: "instagram", label: "Instagram", status: "connected" as const, targets: [], blocker, connectUrl: "/api/meta/authorize" },
        ],
        shelf: { packs: [] },
        adsAutonomy: "ASK",
        canPublish: false,
        meta: { connected: true },
      });

      const dom = await renderConnections();
      const cta = Array.from(dom.querySelectorAll("a")).find((a) => a.getAttribute("href") === "/api/meta/authorize");
      expect(cta?.textContent).toBe("Reconnect");
      expect(cta?.textContent).not.toBe("Manage");
    });
  }

  // 判官 r5 [P2]:status 为 needs_reconnect 而 blocker 缺席的分支**真实可达**,而它当时用的是
  // 一份手写的「Reconnect needed」—— 「唯一措辞源」在这条路径上并不成立。
  it("status=needs_reconnect 且没有 blocker 时,措辞仍然来自共享表", async () => {
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: [
        { id: "instagram", label: "Instagram", status: "needs_reconnect" as const, targets: [], connectUrl: "/api/meta/authorize" },
      ],
      shelf: { packs: [] },
      adsAutonomy: "ASK",
      canPublish: false,
      meta: { connected: true },
    });

    const dom = await renderConnections();
    expect(dom.textContent).toContain(CONNECTION_BLOCKER_COPY.needs_reconnect.status);
  });
});
