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
    // /crm/inbox/templates is a legacy sub-route with no registry entry of its own, so
    // /crm/inbox — its longest matching ancestor — is the item that lights up.
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

  it("nests Connections, Preferences, and Billing & credits under Settings", () => {
    const markup = renderShell("/billing");

    expect(markup).toContain(">Settings<");
    expect(markup).toContain('href="/otto?view=connections"');
    expect(markup).toContain('href="/otto?view=account"');
    expect(markup).toContain(">Preferences<");
    expect(markup).toContain(">Billing &amp; credits<");
  });

  // #801 — at 1024–1279 a group is one icon and its children live in SectionTabs, which is
  // withheld on a surface that owns its own full-height workspace. So the icon must land
  // where those tabs actually render: Settings still opens on Billing, as it always did.
  it("collapses Settings to an icon that opens Billing, where its tabs render", () => {
    const markup = renderShell("/campaign");

    expect(markup).toMatch(/aria-label="Settings"[^>]*href="\/billing"|href="\/billing"[^>]*aria-label="Settings"/);
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

  it("does not also highlight the assistant row when a ?view= destination is active (#520)", () => {
    const connections = renderShell("/otto?view=connections");
    expect(connections).toMatch(/aria-current="page" title="Connections"/);
    expect(connections).not.toMatch(/aria-current="page" title="Ask Otto"/);

    const preferences = renderShell("/otto?view=account");
    expect(preferences).toMatch(/aria-current="page" title="Preferences"/);
    expect(preferences).not.toMatch(/aria-current="page" title="Ask Otto"/);

    // #801 — Library and Schedule are ?view= destinations too now. Before the whole
    // registry was scanned, only the settings group was, so these two would have lit the
    // assistant row up alongside themselves.
    const library = renderShell("/otto?view=library");
    expect(library).toMatch(/aria-current="page" title="Library"/);
    expect(library).not.toMatch(/aria-current="page" title="Ask Otto"/);

    const schedule = renderShell("/otto?view=schedule");
    expect(schedule).toMatch(/aria-current="page" title="Schedule"/);
    expect(schedule).not.toMatch(/aria-current="page" title="Ask Otto"/);
  });

  it("keeps the assistant row active on bare /otto and on an unrelated query (#520)", () => {
    expect(renderShell("/otto")).toMatch(/aria-current="page" title="Ask Otto"/);
    expect(renderShell("/otto?foo=bar")).toMatch(/aria-current="page" title="Ask Otto"/);
  });

  // #685 — the mobile trigger is `fixed`, so it occupies no layout space of its own.
  // The shell reserves that space once for every merchant surface, exactly as it already
  // reserves the rail's width with lg:pl-16 / xl:pl-60. Before this, each page had to
  // dodge the button by hand: /billing and /profile ate their own H1 ("illing",
  // "rofile"), and eight campaign/CRM surfaces had "Return to Otto" — a LINK — covered,
  // so the merchant's way back was unclickable at its left edge.
  describe("mobile nav trigger footprint", () => {
    const contentWrapper = /<div class="((?:[^"]*\b)?min-h-dvh min-w-0[^"]*)"/;

    it.each([
      "/billing",
      "/profile",
      "/campaign",
      "/campaign/workbench",
      "/crm/inbox",
      "/crm/broadcasts",
      "/crm/workflows",
    ])("reserves the trigger's height above %s content on the mobile tier", (pathname) => {
      const wrapper = renderShell(pathname).match(contentWrapper)?.[1];

      expect(wrapper).toBeDefined();
      // 56px clears the trigger, which is `left-3 top-3` at `size-10` (ends at 52px).
      expect(wrapper).toContain("pt-14");
      expect(wrapper).toContain("lg:pt-0");
    });

    it.each(["/otto", "/northstar-immersive", "/northstar-immersive/create/canvas"])(
      "reserves nothing on %s, which draws its own in-flow bar over a full-height workspace",
      (pathname) => {
        const wrapper = renderShell(pathname).match(contentWrapper)?.[1];

        expect(wrapper).toBeDefined();
        expect(wrapper).not.toContain("pt-14");
      },
    );

    it("keeps the reserved height and the trigger's own geometry in step", () => {
      const markup = renderShell("/billing");

      expect(markup).toContain('aria-label="Open navigation"');
      expect(markup).toMatch(/aria-label="Open navigation"[^>]*class="fixed left-3 top-3 [^"]*size-10/);
    });

    // #747 — reserving nothing was only half of Otto's exemption, and the missing half is
    // what caused the defect: the trigger is `fixed`, so "reserve no space for it" left it
    // sitting ON TOP of Otto's own hamburger. A surface that owns the mobile top bar now
    // gets no trigger either; its own menu carries the entry (see
    // otto-mobile-nav-handoff.test.ts for the handoff itself).
    it("draws no floating trigger on a surface that owns its own bar", () => {
      expect(renderShell("/otto")).not.toContain('aria-label="Open navigation"');
      expect(renderShell("/otto?view=connections")).not.toContain('aria-label="Open navigation"');
      // #801 — Create joined on the same terms: its own 52px bar opens THIS drawer.
      expect(renderShell("/northstar-immersive")).not.toContain('aria-label="Open navigation"');
      expect(renderShell("/northstar-immersive/create/canvas")).not.toContain(
        'aria-label="Open navigation"',
      );
    });

    it.each([
      "/otto",
      "/northstar-immersive",
      "/northstar-immersive/create/canvas",
      "/billing",
      "/profile",
      "/campaign",
      "/crm/inbox",
    ])("decides the reservation and the trigger from one predicate on %s", (pathname) => {
      const markup = renderShell(pathname);
      const reserved = (markup.match(contentWrapper)?.[1] ?? "").includes("pt-14");
      const triggered = markup.includes('aria-label="Open navigation"');

      // Either the shell owns the mobile entry (space AND button) or it owns neither.
      // One without the other is exactly the shape of #747.
      expect(reserved).toBe(triggered);
    });
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

// #513 三.4 — at the 1024–1279px rail, a group's children move here instead of nesting
// under a 64px icon. MerchantShellContent renders this above {children}, so it never
// touches a business page's own content.
describe("SectionTabs", () => {
  function renderTabs(pathname: string) {
    return renderToStaticMarkup(createElement(SectionTabs, { pathname }));
  }

  it("renders nothing outside a grouped section", () => {
    expect(renderTabs("/campaign")).toBe("");
    expect(renderTabs("/northstar-immersive")).toBe("");
  });

  it("renders the CRM group's tabs on a CRM page", () => {
    const markup = renderTabs("/crm/segments");

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('href="/crm/contacts"');
    expect(markup).toContain('href="/crm/workflows"');
    expect(markup).toMatch(/aria-selected="true"[^>]*href="\/crm\/segments"/);
  });

  it("renders the Settings group's tabs on Billing", () => {
    const markup = renderTabs("/billing");

    expect(markup).toContain('href="/otto?view=connections"');
    expect(markup).toContain('href="/otto?view=account"');
    expect(markup).toMatch(/aria-selected="true"[^>]*href="\/billing"/);
  });

  // #801 — this bar used to render on Otto's own `?view=` surfaces. It repeated the very
  // rows Otto's rail already lists, and as an in-flow bar above a 100dvh workspace it put
  // a scrollbar on a pane that must not scroll — the #685 shape, one layer up.
  it.each([
    "/otto?view=connections",
    "/otto?view=account",
    "/otto?view=library",
    "/otto?view=schedule",
  ])("renders nothing on %s, a surface that owns its own full-height workspace", (pathname) => {
    expect(renderTabs(pathname)).toBe("");
  });
});
