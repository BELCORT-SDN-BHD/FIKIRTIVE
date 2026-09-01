import { describe, expect, it } from "vitest";

import {
  MERCHANT_NAV,
  SHELL_ROUTES,
  everyNavDestination,
  merchantNavLinks,
  type MerchantNavGroup,
  type MerchantNavLink,
} from "@fikirtive/core/navigation";
import {
  activeNavHref,
  activeNavKey,
  isGroupActive,
  railBillingLink,
  railNodes,
  splitLocation,
} from "@/components/navigation/rail/rail-tree";

function link(key: string, href: string): MerchantNavLink {
  return { key, label: key, href, does: "" };
}

function litHrefs(pathname: string, links: readonly MerchantNavLink[]): string[] {
  const winner = activeNavHref(pathname, links);
  return links.filter((item) => item.href === winner).map((item) => item.href);
}

describe("active navigation chooses one deepest owner", () => {
  it("is independent from registry order", () => {
    const links = [link("parent", "/example"), link("child", "/example/detail")];

    expect(activeNavKey("/example/detail", links)).toBe("child");
    expect(activeNavKey("/example/detail", [...links].reverse())).toBe("child");
  });

  it("keeps Home from swallowing every absolute path", () => {
    expect(activeNavKey(SHELL_ROUTES.home)).toBe("home");
    expect(activeNavKey(SHELL_ROUTES.library)).toBe("library");
    expect(activeNavKey("/login")).toBeNull();
  });

  it("supports a generic group without changing the product tree", () => {
    const children = [link("overview", "/example"), link("detail", "/example/detail")];
    const group: MerchantNavGroup = { key: "example", label: "Example", items: children };

    expect(isGroupActive(group, "/example/detail", children)).toBe(true);
    expect(isGroupActive(group, "/outside", children)).toBe(false);
  });
});

describe("current navigation authority", () => {
  const links = merchantNavLinks();

  it("renders the registry itself, in its own order", () => {
    expect(railNodes()).toEqual(MERCHANT_NAV);
    expect(links.map((item) => item.key)).toEqual(["home", "create", "library", "brand", "settings"]);
  });

  it("lights exactly one cell for every main destination and deep link", () => {
    for (const item of links) {
      expect(litHrefs(item.href, links), item.href).toEqual([item.href]);
      const path = splitLocation(item.href).path;
      if (path !== "/") expect(litHrefs(`${path}/deep/child`, links)).toHaveLength(1);
    }
  });

  it("approved child surfaces light their single owner", () => {
    expect(activeNavKey(SHELL_ROUTES.homeAnalysis)).toBe("home");
    expect(activeNavKey(SHELL_ROUTES.canvas)).toBe("create");
    expect(activeNavKey(SHELL_ROUTES.profile)).toBe("settings");
    expect(activeNavKey(SHELL_ROUTES.connections)).toBe("settings");
    expect(activeNavKey(SHELL_ROUTES.billing)).toBe("settings");
  });

  it("does not make parked routes active destinations", () => {
    expect(activeNavKey(SHELL_ROUTES.campaign)).toBeNull();
    expect(activeNavKey(SHELL_ROUTES.schedule)).toBeNull();
  });

  it("keeps every destination path query-free", () => {
    for (const item of everyNavDestination()) {
      expect(splitLocation(item.href).query.toString(), item.href).toBe("");
    }
  });

  it("reads the credits shortcut from Settings destinations", () => {
    const billing = railBillingLink();

    expect(billing).toBe(everyNavDestination().find((item) => item.key === "billing"));
    expect(billing.href).toBe(SHELL_ROUTES.billing);
  });
});
