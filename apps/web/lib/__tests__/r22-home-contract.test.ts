import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeView, homeConnectionFromMeta, type HomeConnection } from "@/components/home/HomeView";
import { readOk, UNREADABLE, type HomeData } from "@/components/home/home-data";

const data: HomeData = {
  greeting: "Good morning, Nadia",
  credits: readOk("1,240 credits"),
  billingHref: "/settings?section=billing",
  billingLabel: "Billing & credits",
  canvases: readOk([]), thumbs: readOk([]), upcoming: readOk([]), campaigns: readOk([]), equipment: readOk([]),
};

function render(connection: HomeConnection, fixture = false) {
  return renderToStaticMarkup(createElement(HomeView, { data, connection, fixture }));
}

describe("R22 Data-first Home contract", () => {
  it("keeps sample-data language behind the explicit fixture prop", () => {
    expect(render({ kind: "not_connected" })).not.toContain("Prototype");
    expect(render({ kind: "not_connected" }, true)).toContain("Prototype · sample data · Soft Prism v4");
  });

  it("does not turn an unreadable connection into disconnected or a connect CTA", () => {
    const markup = render({ kind: "unknown", message: "Read failed." });
    expect(markup).toContain("Connection status unavailable");
    expect(markup).not.toContain("Not connected");
    expect(markup).not.toContain('href="/api/meta/authorize"');
  });

  it("shows the provider-flow trigger only for a confirmed disconnected state", () => {
    const markup = render({ kind: "not_connected" });
    expect(markup).toContain("Connect your first channel");
    expect(markup).toContain("Connect</button>");
    expect(markup).not.toContain('href="/api/meta/authorize"');
  });

  it("shows performance numbers only in a verified visual fixture", () => {
    expect(render({ kind: "connected", accountLabel: "Meta account", transient: false })).not.toContain("48.2K");
    expect(render({ kind: "verified_fixture", accountLabel: "@batikhouse" }, true)).toContain("48.2K");
  });

  it("preserves Meta's unknown, disconnected, reconnect, and transient distinctions", () => {
    expect(homeConnectionFromMeta(UNREADABLE).kind).toBe("unknown");
    expect(homeConnectionFromMeta(readOk({ error: "load-failed" }))).toEqual({ kind: "unknown", message: "Connection status could not be read just now." });
    expect(homeConnectionFromMeta(readOk({ connected: false }))).toEqual({ kind: "not_connected" });
    expect(homeConnectionFromMeta(readOk({ connected: true, needsReconnect: true }))).toEqual({ kind: "needs_reconnect" });
    expect(homeConnectionFromMeta(readOk({ connected: true, transientError: true }))).toEqual({ kind: "connected", accountLabel: "Meta account", transient: true });
  });
});
