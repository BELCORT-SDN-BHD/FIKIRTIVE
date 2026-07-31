// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminV2Data } from "@/lib/admin-v2";

// #538 — inviteTenant/revokeTenantInvite existed and were fully gated + audited, but nothing
// in the product called them: /admin/tenants had no Invite control at all, so no merchant
// could be let in from inside the product. These tests pin the wiring, not the backend:
//   1. submitting the form reaches inviteTenant with the typed address;
//   2. a malformed address never reaches the server action;
//   3. Revoke is confirmed first — one stray click must not lock an address out.

const mocks = vi.hoisted(() => ({
  inviteTenant: vi.fn(),
  revokeTenantInvite: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/tenant-actions", () => ({
  inviteTenant: mocks.inviteTenant,
  revokeTenantInvite: mocks.revokeTenantInvite,
}));
// The dashboard imports these at module load; they are server actions this test never drives.
vi.mock("@/lib/admin-actions", () => ({
  saveModelDirective: vi.fn(),
  saveModelEnabled: vi.fn(),
  saveRuntimeConfig: vi.fn(),
  saveUserRole: vi.fn(),
  seedResearchDirectives: vi.fn(),
}));
vi.mock("@/lib/credit-actions", () => ({ grantCreditsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));

// React refuses act() outside a configured act environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AdminDashboardV2 } = await import("@/components/admin/AdminDashboardV2");

const PENDING_EMAIL = "owner@merchant.com";

// Only the fields the tenants section and the page chrome read. `tenants: []` keeps the row
// list (and its next/link anchors) out of this test — the subject is the invite panel.
const DATA = {
  generatedAt: "2026-07-30T10:00:00.000Z",
  tenants: [],
  invitedCount: 1,
  pendingInvites: [
    { email: PENDING_EMAIL, invitedBy: "founder@fikirtive.test", createdAt: "2026-07-29T08:00:00.000Z" },
  ],
} as unknown as AdminV2Data;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.inviteTenant.mockResolvedValue({ ok: true, result: "invited" });
  mocks.revokeTenantInvite.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function renderTenants(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(AdminDashboardV2, {
        section: "tenants" as const,
        data: DATA,
        selfEmail: "founder@fikirtive.test",
        currentRole: "super-admin",
      }),
    ),
  );
  return container;
}

// React tracks the last value it set on a controlled element and drops events whose value
// "didn't change" — write through the NATIVE prototype setter so the event is respected.
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitForm(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function emailInput(dom: HTMLElement): HTMLInputElement {
  const input = dom.querySelector<HTMLInputElement>('input[type="email"]');
  expect(input, "the tenants page must expose an email field for invites").toBeTruthy();
  return input!;
}

function revokeButton(dom: HTMLElement): HTMLButtonElement {
  const button = dom.querySelector<HTMLButtonElement>(`button[aria-label="Revoke invite for ${PENDING_EMAIL}"]`);
  expect(button, "each pending invite must expose a Revoke control").toBeTruthy();
  return button!;
}

describe("admin tenants invite UI (#538)", () => {
  it("shows the invite entry point and the pending invite it can revoke", async () => {
    const dom = await renderTenants();
    const text = dom.textContent ?? "";

    expect(text).toContain("Invite a merchant");
    expect(text).toContain(PENDING_EMAIL);
    expect(revokeButton(dom)).toBeTruthy();
  });

  // inviteTenant only writes the AllowedEmail row — nothing in that path sends mail. The
  // panel must not imply an email went out, or an operator will wait for a merchant who was
  // never told anything.
  it("does not claim an invite email was sent", async () => {
    const dom = await renderTenants();
    expect(dom.textContent).not.toContain("Send invite");
    expect(dom.textContent).toContain("Nothing is emailed from here");

    const input = emailInput(dom);
    await typeInto(input, "new.owner@merchant.com");
    await submitForm(input.closest("form")!);

    expect(dom.textContent).toContain("No email was sent");
  });

  it("submitting the form calls inviteTenant with the typed email and refreshes the list", async () => {
    const dom = await renderTenants();
    const input = emailInput(dom);

    await typeInto(input, "  New.Owner@Merchant.com  ");
    await submitForm(input.closest("form")!);

    expect(mocks.inviteTenant).toHaveBeenCalledTimes(1);
    expect(mocks.inviteTenant).toHaveBeenCalledWith("new.owner@merchant.com");
    expect(mocks.refresh).toHaveBeenCalled();
    expect(dom.textContent).toContain("Admitted new.owner@merchant.com");
    expect(input.value).toBe("");
  });

  it("keeps a malformed email away from the server action", async () => {
    const dom = await renderTenants();
    const input = emailInput(dom);

    await typeInto(input, "not-an-email");
    await submitForm(input.closest("form")!);

    expect(mocks.inviteTenant).not.toHaveBeenCalled();
    expect(dom.textContent).toContain("Enter a valid email.");
  });

  it("surfaces the server action's error instead of claiming success", async () => {
    mocks.inviteTenant.mockResolvedValue({ error: "Forbidden." });
    const dom = await renderTenants();
    const input = emailInput(dom);

    await typeInto(input, "blocked@merchant.com");
    await submitForm(input.closest("form")!);

    expect(mocks.inviteTenant).toHaveBeenCalledWith("blocked@merchant.com");
    expect(dom.textContent).toContain("Forbidden.");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  // #538 round 2 (P2) — re-inviting an address that is already inside used to report
  // "Admitted", which is a lie: the server writes nothing. Each of the three server outcomes
  // gets its own honest sentence.
  it("reports an already-active address as unchanged, not as newly admitted", async () => {
    mocks.inviteTenant.mockResolvedValue({ ok: true, result: "already_member" });
    const dom = await renderTenants();
    const input = emailInput(dom);

    await typeInto(input, "live@merchant.com");
    await submitForm(input.closest("form")!);

    expect(dom.textContent).toContain("live@merchant.com has already signed up. Nothing changed.");
    expect(dom.textContent).not.toContain("Admitted live@merchant.com");
  });

  it("reports an already-pending address as unchanged", async () => {
    mocks.inviteTenant.mockResolvedValue({ ok: true, result: "already_invited" });
    const dom = await renderTenants();
    const input = emailInput(dom);

    await typeInto(input, "pending@merchant.com");
    await submitForm(input.closest("form")!);

    expect(dom.textContent).toContain("pending@merchant.com was already invited. Nothing changed");
    expect(dom.textContent).not.toContain("Admitted pending@merchant.com");
  });

  // #538 round 2 (P1) — when the server refuses because the merchant activated in the
  // meantime, the operator must see that refusal, not a success line.
  it("surfaces the server's refusal when the invite was already activated", async () => {
    mocks.revokeTenantInvite.mockResolvedValue({
      error: "That address already belongs to an active merchant. Suspend their tenant instead.",
    });
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const dom = await renderTenants();

    await click(revokeButton(dom));

    expect(dom.textContent).toContain("already belongs to an active merchant");
    expect(dom.textContent).not.toContain(`Revoked ${PENDING_EMAIL}`);
  });

  // #538 round 2 (P2) — the old wording promised the address could not sign in at all, but
  // FOUNDER_ADMIN_EMAILS / AUTH_ALLOWED_EMAILS outrank the DB row (allowlist.ts).
  it("scopes the confirmation wording to what revoking actually blocks", async () => {
    const confirmSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirmSpy);
    const dom = await renderTenants();

    await click(revokeButton(dom));

    const prompt = confirmSpy.mock.calls[0][0] as string;
    expect(prompt).toContain("blocks future self-signup");
    expect(prompt).not.toContain("sign in");
  });

  it("does not revoke when the confirmation is declined", async () => {
    const confirmSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirmSpy);
    const dom = await renderTenants();

    await click(revokeButton(dom));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain(PENDING_EMAIL);
    expect(mocks.revokeTenantInvite).not.toHaveBeenCalled();
  });

  it("revokes only after the confirmation is accepted", async () => {
    const confirmSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmSpy);
    const dom = await renderTenants();

    await click(revokeButton(dom));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mocks.revokeTenantInvite).toHaveBeenCalledTimes(1);
    expect(mocks.revokeTenantInvite).toHaveBeenCalledWith(PENDING_EMAIL);
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
