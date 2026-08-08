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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminV2Data } from "@/lib/admin-v2";

// `saveUserRole` IS driven by this file (#755 judge r1, P1-1) — the rest are imported at module
// load and never called here.
const mocks = vi.hoisted(() => ({ saveUserRole: vi.fn() }));
vi.mock("@/lib/admin-actions", () => ({
  saveModelDirective: vi.fn(),
  saveModelEnabled: vi.fn(),
  saveRuntimeConfig: vi.fn(),
  saveUserRole: mocks.saveUserRole,
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
    { id: "evt_deny", type: "rbac.deny", actor: MERCHANT, ownerId: "founder", projectId: null, createdAt: "2026-08-07T18:04:00.000Z" },
    { id: "evt_role", type: "rbac.role.set", actor: FOUNDER, ownerId: "founder", projectId: null, createdAt: "2026-08-07T18:05:00.000Z" },
    { id: "evt_blank", type: "impersonate.stop", actor: null, ownerId: "founder", projectId: null, createdAt: "2026-08-07T18:06:00.000Z" },
  ],
  money: { totalUsd: 0, jobCount: 0, balance: 0, reserved: 0, days: [], jobs: [], ledger: [] },
  staff: {
    rows: [
      { id: "usr_ops", email: "ops@fikirtive.test", name: "Ops", roles: ["ops"], role: "ops" },
      // Roles are permission bundles, so one person can hold several — the editor must treat an
      // assignment as a SET, not as one value chosen from a list.
      { id: "usr_both", email: "both@fikirtive.test", name: "Both", roles: ["ops", "finance"], role: "ops" },
      // The acting operator, for the self-edit guard.
      { id: "usr_self", email: FOUNDER, name: "Founder", roles: ["super-admin"], role: "super-admin" },
    ],
    roles: ["super-admin", "ops", "finance", "moderator", "viewer"],
    matrix: [],
  },
} as unknown as AdminV2Data;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.saveUserRole.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** The role toggle for `role` inside a staff row, found by its accessible name. */
function roleToggle(row: HTMLElement, role: string): HTMLButtonElement {
  const button = row.querySelector<HTMLButtonElement>(`button[data-role="${role}"]`);
  expect(button, `no toggle for role "${role}"`).toBeTruthy();
  return button!;
}

/** The staff row for `email`. */
function staffRow(dom: HTMLElement, email: string): HTMLElement {
  const row = [...dom.querySelectorAll("div")].find((d) => d.dataset.staffRow === email);
  expect(row, `no staff row for ${email}`).toBeTruthy();
  return row as HTMLElement;
}

function saveButton(row: HTMLElement): HTMLButtonElement {
  const button = row.querySelector<HTMLButtonElement>('button[data-staff-save="true"]');
  expect(button, "the staff row must expose a Save control").toBeTruthy();
  return button!;
}

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
  it("shows every role a person holds as its own pressed toggle", async () => {
    const dom = await render("staff");
    const row = staffRow(dom, "both@fikirtive.test");
    expect(roleToggle(row, "ops").getAttribute("aria-pressed")).toBe("true");
    expect(roleToggle(row, "finance").getAttribute("aria-pressed")).toBe("true");
    expect(roleToggle(row, "moderator").getAttribute("aria-pressed")).toBe("false");
    // …and nobody the gate refuses is described as staff.
    expect(dom.textContent).not.toContain(MERCHANT);
  });

  // ── #755 judge r1, P1-1 — the security one ────────────────────────────────────────────────
  //
  // `saveUserRole` REPLACES the whole assignment set: it deletes what is no longer in the set
  // and writes what is new. That is correct only if the caller sends the COMPLETE set. The old
  // row submitted one value from a single-choice picker, so editing a person who held ops AND
  // finance silently revoked the one you did not pick — no warning, no trace on screen. Project
  // law is explicit that a person may hold several roles and that a role is a permission bundle.
  //
  // These tests DRIVE SAVE. The previous round asserted badges only, which is exactly why it
  // stayed green through the defect.
  describe("editing one role never silently drops another", () => {
    it("submits the complete set when a role is added", async () => {
      const dom = await render("staff");
      const row = staffRow(dom, "both@fikirtive.test");
      await click(roleToggle(row, "moderator"));
      await click(saveButton(row));

      expect(mocks.saveUserRole).toHaveBeenCalledTimes(1);
      const payload = mocks.saveUserRole.mock.calls[0][0] as {
        userId: string;
        roles: string[];
        expectedRoles: string[];
      };
      expect(payload.userId).toBe("usr_both");
      expect([...payload.roles].sort()).toEqual(["finance", "moderator", "ops"]);
      // #755 judge r2, P1 — and the draft the edit was made against: what this row was rendered
      // with, NOT what is now selected. Sending the selection would prove nothing.
      expect([...payload.expectedRoles].sort()).toEqual(["finance", "ops"]);
    });

    it("submits the complete set when a role is removed — the untouched one survives", async () => {
      const dom = await render("staff");
      const row = staffRow(dom, "both@fikirtive.test");
      await click(roleToggle(row, "ops"));
      await click(saveButton(row));

      const payload = mocks.saveUserRole.mock.calls[0][0] as { roles: string[] };
      expect(payload.roles).toEqual(["finance"]);
      // The whole point: finance was never touched, and it is still in the submitted set.
      expect(payload.roles).toContain("finance");
    });

    it("never submits a bare single-value role field", async () => {
      const dom = await render("staff");
      const row = staffRow(dom, "both@fikirtive.test");
      await click(roleToggle(row, "moderator"));
      await click(saveButton(row));

      const payload = mocks.saveUserRole.mock.calls[0][0] as Record<string, unknown>;
      // Still an exact key set, so a `role` field cannot creep back in — now with the draft that
      // makes "the complete set" mean something (#755 judge r2, P1).
      expect(Object.keys(payload).sort()).toEqual(["expectedRoles", "roles", "userId"]);
    });

    it("refuses to submit an empty set instead of quietly stripping every role", async () => {
      const dom = await render("staff");
      const row = staffRow(dom, "ops@fikirtive.test");
      await click(roleToggle(row, "ops"));
      const save = saveButton(row);
      expect(save.disabled, "Save must be unavailable with nothing selected").toBe(true);
      await click(save);
      expect(mocks.saveUserRole).not.toHaveBeenCalled();
      expect(row.textContent).toContain("Select at least one role");
    });

    it("still refuses self-edits", async () => {
      const dom = await render("staff");
      const row = staffRow(dom, FOUNDER);
      expect(roleToggle(row, "ops").disabled).toBe(true);
      expect(saveButton(row).disabled).toBe(true);
    });
  });

  // ── #755 judge r2, P1 — what the operator is told when someone else got there first ────────
  describe("a refused save is shown, not swallowed", () => {
    const STALE = "Roles changed since you loaded this page. Reload and try again.";

    it("puts the refusal on the row and does not retry it behind the operator's back", async () => {
      mocks.saveUserRole.mockResolvedValue({ error: STALE });
      const dom = await render("staff");
      const row = staffRow(dom, "both@fikirtive.test");
      await click(roleToggle(row, "moderator"));
      await click(saveButton(row));

      expect(row.textContent).toContain(STALE);
      expect(mocks.saveUserRole).toHaveBeenCalledTimes(1);
      expect(row.textContent).not.toContain("Saved.");
    });

    it("does not advance the draft, so pressing Save again cannot turn a refusal into a write", async () => {
      mocks.saveUserRole.mockResolvedValue({ error: STALE });
      const dom = await render("staff");
      const row = staffRow(dom, "both@fikirtive.test");
      await click(roleToggle(row, "moderator"));
      await click(saveButton(row));
      await click(saveButton(row));

      expect(mocks.saveUserRole).toHaveBeenCalledTimes(2);
      // Both attempts prove against the set the PAGE rendered. If the refusal had quietly moved
      // the draft forward, the second press would sail through the server's comparison and
      // overwrite whatever the other founder just did — which is the defect, not the fix.
      for (const call of mocks.saveUserRole.mock.calls) {
        const payload = call[0] as { expectedRoles: string[] };
        expect([...payload.expectedRoles].sort()).toEqual(["finance", "ops"]);
      }
    });
  });

  it("counts each role card by the assignments the gate reads", async () => {
    const dom = await render("staff");
    // Two people hold ops, one holds finance, nobody holds viewer. The schema default must not
    // manufacture a viewer — that phantom count was the visible face of #734.
    expect(roleCardValue(dom, "Operations")).toBe("2");
    expect(roleCardValue(dom, "Finance")).toBe("1");
    expect(roleCardValue(dom, "Viewer")).toBe("0");
  });

  // #755 judge r1, P2-3 — role codes are internal vocabulary, not something to print at a founder.
  it("names roles in plain words rather than internal codes", async () => {
    const dom = await render("staff");
    const staff = panel(dom, "Staff");
    expect(staff.textContent).toContain("Super admin");
    expect(staff.textContent).toContain("Operations");
    expect(staff.textContent).not.toContain("super-admin");
  });

  // #755 judge r1, P1-3 — the roster page must not claim these assignments open the admin door.
  // `app/admin/layout.tsx` refuses every non-founder address before any role is consulted, so an
  // ops holder cannot get in at all. Saying otherwise is the same "说的≠做的" defect as #734.
  it("does not claim role assignments alone open the admin area", async () => {
    const dom = await render("staff");
    const subtitle = panel(dom, "Staff").querySelector("p")?.textContent ?? "";
    expect(subtitle.toLowerCase()).toContain("founder");
    // It must still say what the assignments DO control.
    expect(subtitle.toLowerCase()).toContain("capabilit");
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

  // #755 judge r1, P2-3 — an event class is a plain statement of what happened, not a dotted code.
  it("names the event in plain words rather than its internal type code", async () => {
    const dom = await render("audit");
    const stream = panel(dom, "Audit stream");
    expect(stream.textContent).toContain("Access refused");
    expect(stream.textContent).toContain("Role assignment changed");
    expect(stream.textContent).toContain("Impersonation ended");
    expect(stream.textContent).not.toContain("rbac.deny");
    expect(stream.textContent).not.toContain("rbac.role.set");
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

  // #755 judge r1, P1-2 — fixing the card was not enough. The page header still called itself
  // "approval control" and the grant form still told the operator that anything larger "requires
  // founder approval", which reads as "submit it and someone will approve it". `credit-actions.ts`
  // simply REFUSES it; there is no queue and nothing to wait for.
  it("nowhere on the money page implies an approval process exists", async () => {
    const dom = await render("money");
    const text = (dom.textContent ?? "").toLowerCase();
    expect(text).not.toContain("approval");
    expect(text).not.toContain("approve");
    expect(text).not.toContain("review candidate");
  });

  it("says plainly what happens above the limit: refusal, not a queue", async () => {
    const dom = await render("money");
    expect(dom.textContent?.toLowerCase()).toContain("refused");
  });
});
