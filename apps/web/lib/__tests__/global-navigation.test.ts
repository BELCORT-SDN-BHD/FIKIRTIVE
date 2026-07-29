import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import {
  MerchantShellContent,
  SectionTabs,
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

  it("does not also light up Inbox when the current page is its Templates sub-route", () => {
    // /crm/inbox/templates starts with /crm/inbox, so a naive prefix match would mark
    // both items active. Only the longest (most specific) match should win.
    const markup = renderShell("/crm/inbox/templates");

    expect(markup).toMatch(/aria-current="page"[^>]*href="\/crm\/inbox\/templates"/);
    expect(markup).not.toMatch(/aria-current="page"[^>]*href="\/crm\/inbox"[^/]/);
  });

  it("replaces the old Account box with a real avatar menu offering Profile and Sign out", () => {
    const markup = renderShell("/billing");

    expect(markup).not.toContain("<span>Log out</span>");
    expect(markup).not.toContain('text-xs font-semibold text-muted-foreground">Account<');
    expect(markup).toContain('role="menu"');
    expect(markup).toContain('href="/profile"');
    // Sign out stays a real form submit (signOutAction), not a bare link.
    expect(markup).toMatch(/<form[^>]*>[\s\S]*?Sign out[\s\S]*?<\/form>/);
  });

  it("shows credits above the identity menu, linking through to Billing & credits", () => {
    const markup = renderShell("/otto");

    expect(markup).toMatch(/href="\/billing"[^>]*>[\s\S]{0,600}?Credits/);
  });

  it("nests Connections and Billing & credits under Workspace settings", () => {
    const markup = renderShell("/billing");

    expect(markup).toContain(">Workspace settings<");
    expect(markup).toContain('href="/connections"');
    expect(markup).toContain(">Billing &amp; credits<");
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

// #513 三.4 — at the 1024–1279px rail, a Settings-style group's children move here
// instead of nesting under a 64px icon. MerchantShellContent renders this above
// {children}, so it never touches a business page's own content.
describe("SectionTabs", () => {
  function renderTabs(pathname: string) {
    return renderToStaticMarkup(createElement(SectionTabs, { pathname }));
  }

  it("renders nothing outside a sectioned group", () => {
    expect(renderTabs("/otto")).toBe("");
    expect(renderTabs("/campaign")).toBe("");
  });

  it("renders the CRM group's tabs on a CRM page", () => {
    const markup = renderTabs("/crm/segments");

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('href="/crm/contacts"');
    expect(markup).toContain('href="/crm/workflows"');
    expect(markup).toMatch(/aria-selected="true"[^>]*href="\/crm\/segments"/);
  });

  it("renders the Workspace settings group's tabs on Billing", () => {
    const markup = renderTabs("/billing");

    expect(markup).toContain('href="/connections"');
    expect(markup).toMatch(/aria-selected="true"[^>]*href="\/billing"/);
  });
});
