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

  it("still lights up Inbox on its own Templates sub-route (no CRM_ITEMS entry there yet)", () => {
    // Templates is deliberately absent from CRM_ITEMS until work-order-group E merges
    // its formal /crm/templates entry (#513 A组返工 item 4). Until then, /crm/inbox is
    // the only CRM_ITEMS candidate for the legacy /crm/inbox/templates sub-route.
    const markup = renderShell("/crm/inbox/templates");

    expect(markup).toMatch(/aria-current="page"[^>]*href="\/crm\/inbox"/);
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

  it("nests Connections, Preferences, and Billing & credits under Workspace settings", () => {
    const markup = renderShell("/billing");

    expect(markup).toContain(">Workspace settings<");
    // Points at Otto's already-shipped connections view, not the not-yet-built
    // /connections page (#513 A组返工 item 4 — swap once group B merges its page).
    expect(markup).toContain('href="/otto?view=connections"');
    // Preferences (spend cap, notifications, schedule defaults, delete account)
    // was an island with no clickable entry point anywhere (#513 A组返工·三轮 item 1).
    expect(markup).toContain('href="/otto?view=account"');
    expect(markup).toContain(">Preferences<");
    expect(markup).toContain(">Billing &amp; credits<");
  });

  it("marks Connections active on /otto?view=connections, not on bare /otto (#513 三轮 item 2)", () => {
    const bare = renderShell("/otto");
    expect(bare).not.toMatch(/aria-current="page"[^>]*href="\/otto\?view=connections"/);

    const withQuery = renderShell("/otto?view=connections");
    expect(withQuery).toMatch(/aria-current="page"[^>]*href="\/otto\?view=connections"/);
    // The disclosure auto-expands (open="") once the group's own item is active.
    expect(withQuery).toContain('<details class="group" open="">');
  });

  it("marks Preferences active on /otto?view=account without also lighting up Connections", () => {
    const markup = renderShell("/otto?view=account");

    expect(markup).toMatch(/aria-current="page"[^>]*href="\/otto\?view=account"/);
    expect(markup).not.toMatch(/aria-current="page"[^>]*href="\/otto\?view=connections"/);
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

    expect(markup).toContain('href="/otto?view=connections"');
    expect(markup).toContain('href="/otto?view=account"');
    expect(markup).toMatch(/aria-selected="true"[^>]*href="\/billing"/);
  });

  it("renders (not empty) and selects Connections on /otto?view=connections — the 1024–1279 tabs bar used to not render at all here (#513 三轮 item 2)", () => {
    const markup = renderTabs("/otto?view=connections");

    expect(markup).toContain('role="tablist"');
    expect(markup).toMatch(/aria-selected="true"[^>]*href="\/otto\?view=connections"/);
    expect(markup).not.toMatch(/aria-selected="true"[^>]*href="\/otto\?view=account"/);
  });
});
