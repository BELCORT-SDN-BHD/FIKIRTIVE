import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import {
  IdentityMenu,
  MerchantShellContent,
  SectionTabs,
  nextDisclosureOpenForGroup,
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

  // W2-13(#993)— CRM 整段收起来了,所以 /crm 底下不再有任何一扇门,壳也不该在那里画导轨:
  // `MERCHANT_SURFACE_PATHS` 是从 `merchantNavLinks()` 推出来的,那一格删了,这些路径就不再
  // 是商家表面。那些路由文件仍在(各自 `redirect("/")`),所以旧书签落地在 Home 上,不是 404。
  // 半扇门 = 导轨上亮着一格、点进去却被弹走,正是这条要挡的东西。
  it.each(["/crm", "/crm/reports/report-1", "/crm/inbox/templates"])(
    "draws no rail at all on %s — the section is hidden, not half-open",
    (pathname) => {
      const markup = renderShell(pathname);

      expect(markup).not.toContain('aria-label="Global navigation"');
      expect(markup).not.toContain('href="/crm"');
      expect(markup).toContain("Page content");
    },
  );

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
      // W2-13(#993):三条 /crm/* 从这份名单里去掉了 —— 它们不再是商家表面(壳在那里
      // 一根导轨都不画),而不是「壳忘了给它们留位置」。
    ])("reserves the trigger's height above %s content on the mobile tier", (pathname) => {
      const wrapper = renderShell(pathname).match(contentWrapper)?.[1];

      expect(wrapper).toBeDefined();
      // 56px clears the trigger, which is `left-3 top-3` at `size-10` (ends at 52px).
      expect(wrapper).toContain("pt-14");
      expect(wrapper).toContain("lg:pt-0");
    });

    it.each(["/otto", "/create", "/create/canvas"])(
      "reserves nothing on %s, which draws its own in-flow bar over a full-height workspace",
      (pathname) => {
        const wrapper = renderShell(pathname).match(contentWrapper)?.[1];

        expect(wrapper).toBeDefined();
        expect(wrapper).not.toContain("pt-14");
      },
    );

    it("keeps the reserved height and the trigger's own geometry in step", () => {
      const markup = renderShell("/billing");

      // #840 — the trigger is now the shared Button primitive, whose own props
      // (data-slot, class) are always written before the caller's ...props, so
      // aria-label no longer precedes class in the rendered tag. Extract the whole
      // opening tag and assert on its class list directly instead of relying on
      // attribute order, which was never a claim this test meant to make.
      const trigger = markup.match(/<button[^>]*aria-label="Open navigation"[^>]*>/)?.[0];
      expect(trigger).toBeDefined();
      expect(trigger).toContain("fixed left-3 top-3");
      expect(trigger).toContain("size-10");
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
      expect(renderShell("/create")).not.toContain('aria-label="Open navigation"');
      expect(renderShell("/create/canvas")).not.toContain(
        'aria-label="Open navigation"',
      );
    });

    it.each([
      "/otto",
      "/create",
      "/create/canvas",
      "/billing",
      "/profile",
      "/campaign",
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

// #792 — this used to drive the CRM group, which no longer exists (seven doors folded into
// one Customers link). The disclosure logic is unchanged and still live for the two groups
// that remain, so the fence moved to Settings rather than being deleted.
describe("nextDisclosureOpenForGroup", () => {
  const settings = (update: Parameters<typeof nextDisclosureOpenForGroup>[1]) =>
    nextDisclosureOpenForGroup("settings", update);

  it("opens when navigating into the group", () => {
    expect(settings({ type: "navigation", pathname: "/billing" })).toBe(true);
  });

  it("reopens after a manual collapse and a navigation within the group", () => {
    let open = settings({ type: "toggle", open: false });
    expect(open).toBe(false);

    open = settings({ type: "navigation", pathname: "/otto?view=connections" });
    expect(open).toBe(true);
  });

  it("closes when navigating away from the group", () => {
    expect(settings({ type: "navigation", pathname: "/campaign" })).toBe(false);
  });

  it("preserves a manual open outside the group until the next navigation", () => {
    let open = settings({ type: "toggle", open: true });
    expect(open).toBe(true);

    open = settings({ type: "navigation", pathname: "/campaign" });
    expect(open).toBe(false);
  });

  it("an unknown group key keeps a manual toggle and never claims to be on a page", () => {
    expect(nextDisclosureOpenForGroup("nope", { type: "toggle", open: true })).toBe(true);
    expect(nextDisclosureOpenForGroup("nope", { type: "navigation", pathname: "/billing" })).toBe(false);
  });
});

// #592 — the sidebar identity area used to always show the merchant's email, even after
// they set a display name on /profile (#574's own fix). It must now draw the label from
// the same source #574 introduced (getMyProfileNames/readDisplayName), falling back to
// the email only when no display name is set — the pre-#592 behavior. Rendered directly
// (not through MerchantShellContent's internal useEffect fetch, which never runs under
// renderToStaticMarkup) so this pins the real markup the merchant sees, not just a pure
// resolver's return value.
describe("IdentityMenu (#592)", () => {
  function renderIdentity(account: { email: string; displayName: string; balance: number } | null) {
    return renderToStaticMarkup(
      createElement(IdentityMenu, { account, signOutAction: vi.fn(async () => undefined) }),
    );
  }

  it("renders the display name, not the email, when a display name is set", () => {
    const markup = renderIdentity({ email: "nicksgan+e2e02@bel.example.com", displayName: "Nick QA", balance: 10 });

    expect(markup).toContain("Nick QA");
    expect(markup).not.toContain("nicksgan+e2e02@bel.example.com");
  });

  it("falls back to the email when no display name is set (current behavior)", () => {
    const markup = renderIdentity({ email: "nicksgan+e2e02@bel.example.com", displayName: "", balance: 10 });

    expect(markup).toContain("nicksgan+e2e02@bel.example.com");
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
    expect(renderTabs("/create")).toBe("");
    // W2-13(#993)— CRM 整段收起来了,导轨上一格都没有,所以它也长不出一条页签栏。
    expect(renderTabs("/crm")).toBe("");
    expect(renderTabs("/crm/segments")).toBe("");
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
