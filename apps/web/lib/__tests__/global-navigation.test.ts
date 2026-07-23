import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MerchantShellContent } from "@/components/global-navigation";

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
});
