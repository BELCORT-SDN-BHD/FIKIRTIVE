// @vitest-environment jsdom
/**
 * #734 / #735 / #736 — what the admin console actually PUTS ON SCREEN.
 *
 * The read-model half lives in `app/admin/__tests__/admin-identity-truth.test.ts`. This half
 * renders the real dashboard, because all three defects were finally defects of the rendered
 * page: a merchant in the employee table, "founder" under every audit event, and a warning card
 * wired to a `<button>` that does nothing when you press it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminV2Data } from "@/lib/admin-v2";

// Server actions the dashboard imports at module load; this file never drives them.
vi.mock("@/lib/admin-actions", () => ({
  saveModelDirective: vi.fn(),
  saveModelEnabled: vi.fn(),
  saveRuntimeConfig: vi.fn(),
  saveUserRole: vi.fn(),
  seedResearchDirectives: vi.fn(),
}));
vi.mock("@/lib/tenant-actions", () => ({ inviteTenant: vi.fn(), revokeTenantInvite: vi.fn() }));
vi.mock("@/lib/credit-actions", () => ({ grantCreditsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AdminDashboardV2 } = await import("@/components/admin/AdminDashboardV2");

const MERCHANT = "merchant@example.test";
const FOUNDER = "founder@fikirtive.test";

/** Only the slices each section reads; everything else stays empty on purpose. */
const DATA = {
  generatedAt: "2026-08-08T10:00:00.000Z",
  riskSignals: [],
  largeGrants: [
    {
      id: "led_1",
      tenant: "Founder workspace",
      ownerEmail: "founder",
      kind: "GRANT",
      amount: 10_000_000,
      limit: 1000,
      state: "over limit" as const,
      reason: "founder beta seed",
      createdBy: "seed",
      createdAt: "2026-08-07T09:54:00.000Z",
    },
  ],
  tenants: [],
  invitedCount: 0,
  pendingInvites: [],
  cases: [],
  systemIncidents: [],
  audit: [
    {
      id: "evt_deny",
      type: "rbac.deny",
      actor: MERCHANT,
      target: null,
      ownerId: "founder",
      projectId: null,
      createdAt: "2026-08-07T18:04:00.000Z",
    },
    {
      id: "evt_role",
      type: "rbac.role.set",
      actor: FOUNDER,
      target: MERCHANT,
      ownerId: "founder",
      projectId: null,
      createdAt: "2026-08-07T18:05:00.000Z",
    },
    {
      id: "evt_blank",
      type: "impersonate.stop",
      actor: null,
      target: null,
      ownerId: "founder",
      projectId: null,
      createdAt: "2026-08-07T18:06:00.000Z",
    },
  ],
  money: { totalUsd: 0, jobCount: 0, balance: 0, reserved: 0, days: [], jobs: [], ledger: [] },
  staff: {
    rows: [
      { id: "usr_ops", email: "ops@fikirtive.test", name: "Ops", roles: ["ops"], role: "ops" },
      // Roles are permission bundles, so one person can hold several. The picker can show only
      // one; the row must still say what this person actually holds.
      { id: "usr_both", email: "both@fikirtive.test", name: "Both", roles: ["ops", "finance"], role: "ops" },
    ],
    roles: ["super-admin", "ops", "finance", "moderator", "viewer"],
    matrix: [],
  },
} as unknown as AdminV2Data;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function render(section: "overview" | "staff" | "audit" | "money"): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(AdminDashboardV2, {
        section,
        data: DATA,
        selfEmail: FOUNDER,
        currentRole: "super-admin" as const,
      }),
    ),
  );
  return container;
}

/** The `<section>` whose heading is `title` — panels are the page's unit of meaning. */
function panel(dom: HTMLElement, title: string): HTMLElement {
  const heading = [...dom.querySelectorAll("h2")].find((h) => h.textContent?.trim() === title);
  expect(heading, `no panel titled "${title}"`).toBeTruthy();
  const section = heading!.closest("section");
  expect(section, `panel "${title}" has no section wrapper`).toBeTruthy();
  return section as HTMLElement;
}

/** The big number on the metric card labelled `role`. Card shape: [header, value, detail]. */
function roleCardValue(dom: HTMLElement, role: string): string | undefined {
  for (const card of dom.querySelectorAll("div")) {
    const [header, value] = [card.firstElementChild, card.children[1]];
    if (!header || !value || value.tagName !== "SPAN") continue;
    if (header.firstElementChild?.textContent === role) return value.textContent ?? undefined;
  }
  return undefined;
}

describe("#734 — the staff page shows employees, not customers", () => {
  it("shows every role a person holds, not just the one the picker can display", async () => {
    const dom = await render("staff");
    const staff = panel(dom, "Staff");
    const row = [...staff.querySelectorAll("div")].find((d) =>
      d.querySelector("span")?.textContent === "both@fikirtive.test",
    );
    expect(row, "the multi-role staff member must be on the roster").toBeTruthy();
    const badges = [...row!.querySelectorAll("span")].map((s) => s.textContent);
    expect(badges).toContain("ops");
    expect(badges).toContain("finance");
    // …and nobody the gate refuses is described as staff.
    expect(dom.textContent).not.toContain(MERCHANT);
  });

  it("counts each role card by the assignments the gate reads", async () => {
    const dom = await render("staff");
    // Two people hold ops, one holds finance, nobody holds viewer. The schema default must not
    // manufacture a viewer — that phantom count was the visible face of #734.
    expect(roleCardValue(dom, "ops")).toBe("2");
    expect(roleCardValue(dom, "finance")).toBe("1");
    expect(roleCardValue(dom, "viewer")).toBe("0");
  });

  it("says out loud that the roster and the gate are the same list", async () => {
    const dom = await render("staff");
    const staff = panel(dom, "Staff");
    const subtitle = staff.querySelector("p")?.textContent ?? "";
    expect(subtitle.toLowerCase()).toContain("role assignment");
  });
});

describe("#735 — the audit stream shows who, not the owner column", () => {
  it("puts the real actor on the row", async () => {
    const dom = await render("audit");
    const stream = panel(dom, "Audit stream");
    const rows = stream.textContent ?? "";
    expect(rows).toContain(MERCHANT);
    expect(rows).toContain(FOUNDER);
  });

  it("marks an event that recorded nobody as unattributed instead of as the founder", async () => {
    const dom = await render("audit");
    const stream = panel(dom, "Audit stream");
    expect(stream.textContent).toContain("Unattributed");
  });

  it("stops presenting the data-scope column as an identity", async () => {
    const dom = await render("audit");
    const stream = panel(dom, "Audit stream");
    // "founder" as a bare identity string is exactly what the page used to claim for all three
    // rows. The founder's real address may appear (it IS the actor of one row); the bare
    // ownerId constant standing in for a person may not.
    const identityCells = [...stream.querySelectorAll("[data-audit-actor]")].map((n) => n.textContent?.trim());
    expect(identityCells).toEqual([MERCHANT, FOUNDER, "Unattributed"]);
  });
});

describe("#736 — the ledger projection stops pretending to be a queue", () => {
  it("offers no dead pointer: the rows are not pressable", async () => {
    const dom = await render("money");
    const grants = panel(dom, "Large grants and adjustments");
    expect(grants.querySelectorAll("button")).toHaveLength(0);
    expect(grants.querySelectorAll("a")).toHaveLength(0);
  });

  it("never calls a settled ledger row an approval", async () => {
    const dom = await render("money");
    const grants = panel(dom, "Large grants and adjustments");
    expect(grants.textContent?.toLowerCase()).not.toContain("approval");
    expect(dom.textContent).not.toContain("Pending approvals");
    expect(dom.textContent).not.toContain("Money risk queue");
    expect(dom.textContent).not.toContain("Grant reviews");
  });
});
