/**
 * #733 — every admin route actually opens.
 *
 * `admin-v2-tenant-guard.test.ts` was named for this job but only text-matched `findMany`
 * blocks in the SOURCE, so it stayed green through the whole outage: from `6b6c537c` (#626)
 * — which put `count` / `aggregate` / `groupBy` into the guard's SCOPED_WHERE_OPS — until
 * today, all 17 `/admin` routes answered HTTP 500 because `getAdminV2Data()` runs three
 * platform-wide `groupBy` calls and two `aggregate` calls with no principal frame.
 *
 * So this file does the thing no test did: it OPENS each route. Eight render through
 * `renderAdminV2Page` (which calls `getAdminV2Data()` for real, against a real database);
 * nine are redirects into those eight, and are pinned to their destination so a future
 * "it redirects, so it can't 500" reading stays honest.
 *
 * Only the role gate is mocked. The Prisma client, the tenant guard and the read model all run.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("@/lib/auth-guard", () => ({
  requireRole: vi.fn(async () => ({
    email: "founder@fikirtive.test",
    roles: ["super-admin"],
    role: "super-admin",
  })),
  requireOwner: vi.fn(async () => ({ email: "founder@fikirtive.test", ownerId: "founder" })),
}));

const { prisma } = await import("@fikirtive/db");
const { getAdminV2Data } = await import("@/lib/admin-v2");

/** The eight routes that render the v2 dashboard — each one calls `getAdminV2Data()`. */
const RENDERED: Array<[route: string, loader: () => Promise<{ default: () => Promise<unknown> }>]> = [
  ["/admin", () => import("../page")],
  ["/admin/money", () => import("../money/page")],
  ["/admin/tenants", () => import("../tenants/page")],
  ["/admin/staff", () => import("../staff/page")],
  ["/admin/cases", () => import("../cases/page")],
  ["/admin/otto", () => import("../otto/page")],
  ["/admin/audit", () => import("../audit/page")],
  ["/admin/system", () => import("../system/page")],
];

/** The nine legacy routes, and the rendered route each one lands on. */
const REDIRECTED: Array<[route: string, destination: string, loader: () => Promise<{ default: () => unknown }>]> = [
  ["/admin/models", "/admin/otto", () => import("../models/page")],
  ["/admin/cost", "/admin/money", () => import("../cost/page")],
  ["/admin/content", "/admin/cases", () => import("../content/page")],
  ["/admin/credits", "/admin/money", () => import("../credits/page")],
  ["/admin/directives", "/admin/otto", () => import("../directives/page")],
  ["/admin/knowledge", "/admin/otto", () => import("../knowledge/page")],
  ["/admin/settings", "/admin/otto", () => import("../settings/page")],
  ["/admin/conversations", "/admin/cases", () => import("../conversations/page")],
  ["/admin/team", "/admin/staff", () => import("../team/page")],
];

beforeAll(async () => {
  // The founder org must exist for the read model's founder-account lookups.
  await prisma.organization.upsert({
    where: { id: "founder" },
    update: {},
    create: { id: "founder", name: "Fikirtive" },
  });
});

describe("#733 — the admin read model answers at all", () => {
  it("getAdminV2Data() resolves instead of throwing at its platform-wide aggregates", async () => {
    const data = await getAdminV2Data();
    expect(data).toBeTruthy();
    expect(Array.isArray(data.tenants)).toBe(true);
  });
});

describe("#733 — all 17 admin routes open", () => {
  it.each(RENDERED)("%s renders", async (_route, load) => {
    const page = (await load()).default;
    const tree = await page();
    expect(tree, "the route produced nothing to render").toBeTruthy();
  });

  it.each(REDIRECTED)("%s redirects to %s", async (_route, destination, load) => {
    const page = (await load()).default;
    let landed: string | null = null;
    try {
      await page();
    } catch (error) {
      // next/navigation signals a redirect by throwing; the destination rides in the digest.
      const digest = (error as { digest?: string }).digest ?? "";
      const parts = digest.split(";");
      landed = parts.length > 2 ? parts[2] : null;
    }
    expect(landed).toBe(destination);
  });
});
