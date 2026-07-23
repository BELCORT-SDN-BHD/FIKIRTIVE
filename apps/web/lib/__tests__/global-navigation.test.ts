import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import {
  MerchantShellContent,
  nextCrmDisclosureOpen,
} from "@/components/global-navigation";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/otto"),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("@/lib/tenant-actions", () => ({
  stopImpersonatingTenant: vi.fn(),
}));

function renderShell(pathname: string) {
  return renderToStaticMarkup(
    createElement(
      MerchantShellContent,
      {
        pathname,
        signOutAction: vi.fn(async () => undefined),
      },
      createElement("div", null, "Page content"),
    ),
  );
}

describe("MerchantShellContent", () => {
  it("renders the global sidebar on an authenticated pillar route", () => {
    const markup = renderShell("/campaign/workbench");

    expect(markup).toContain('aria-label="Global navigation"');
    expect(markup).toContain('href="/otto"');
    expect(markup).toContain('href="/campaign"');
    expect(markup).toContain('href="/crm/inbox"');
    expect(markup).toContain('href="/billing"');
    expect(markup).toContain("overflow-y-auto");
  });

  it.each(["/login", "/admin", "/admin/tenants"])(
    "does not render the merchant sidebar on %s",
    (pathname) => {
      const markup = renderShell(pathname);

      expect(markup).not.toContain('aria-label="Global navigation"');
      expect(markup).toContain("Page content");
    },
  );

  it("marks the current CRM page with aria-current", () => {
    const markup = renderShell("/crm/reports/report-1");

    expect(markup).toContain('<details class="group" open="">');
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/crm\/reports"/);
  });

  it("shows a visible Log out action", () => {
    const markup = renderShell("/billing");

    expect(markup).toContain("<span>Log out</span>");
  });

  it("keeps the impersonation banner above the merchant sidebar", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(ImpersonationBanner),
        createElement(MerchantShellContent, {
          pathname: "/otto",
          signOutAction: vi.fn(async () => undefined),
        }),
      ),
    );

    expect(markup).toContain('class="sticky top-0 z-50"');
    expect(markup).toContain("You are impersonating a customer — spend is disabled.");
    expect(markup).toContain("Stop impersonating");
    expect(markup).toContain("fixed inset-y-0 left-0 z-40");
  });
});

describe("nextCrmDisclosureOpen", () => {
  it("opens when navigating into CRM", () => {
    expect(
      nextCrmDisclosureOpen({ type: "navigation", pathname: "/crm/inbox" }),
    ).toBe(true);
  });

  it("reopens after a manual collapse and a navigation within CRM", () => {
    let open = nextCrmDisclosureOpen({ type: "toggle", open: false });
    expect(open).toBe(false);

    open = nextCrmDisclosureOpen({ type: "navigation", pathname: "/crm/contacts" });
    expect(open).toBe(true);
  });

  it("closes when navigating away from CRM", () => {
    expect(
      nextCrmDisclosureOpen({ type: "navigation", pathname: "/campaign" }),
    ).toBe(false);
  });

  it("preserves a manual open outside CRM until the next navigation", () => {
    let open = nextCrmDisclosureOpen({ type: "toggle", open: true });
    expect(open).toBe(true);

    open = nextCrmDisclosureOpen({ type: "navigation", pathname: "/billing" });
    expect(open).toBe(false);
  });
});
