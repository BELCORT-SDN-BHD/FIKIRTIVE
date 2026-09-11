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
//   3. Revoke opens an AlertDialog first — one stray click must not lock an address out.
//
// SIGNIN-A7（#1319 第 2 轮）—— 第四条：撤销一个**自助进来**的地址那条路也在这里钉住。它不能
// 挂在下面那份待邀清单的行上，因为清单里只有 `invited` 的行，自助进来的地址（`active`）从来
// 不在上面；操作员唯一能点名它的地方是顶上那个输入框。判官第 1 轮记的正是「新动作全仓零生产
// 调用点」，所以这里断言的是**按钮真的调到它**，不是它自己的实现（那在
// `admin-revoke-access-action.test.ts` 的真库用例里）。

const mocks = vi.hoisted(() => ({
  inviteTenant: vi.fn(),
  revokeTenantInvite: vi.fn(),
  revokeMerchantAccess: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/tenant-actions", () => ({
  inviteTenant: mocks.inviteTenant,
  revokeTenantInvite: mocks.revokeTenantInvite,
  revokeMerchantAccess: mocks.revokeMerchantAccess,
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
  mocks.revokeMerchantAccess.mockResolvedValue({ ok: true, result: "revoked" });
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

/** SIGNIN-A7 —— 顶上那颗「Revoke access」。它按地址走，所以不带 aria-label，靠文案找。 */
function revokeAccessButton(dom: HTMLElement): HTMLButtonElement {
  const button = [...dom.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Revoke access");
  expect(button, "the tenants page must expose a control that revokes an address's access").toBeTruthy();
  return button as HTMLButtonElement;
}

/** 页面上那颗按钮和弹窗里的确认按钮文案相同（这是对的：确认按钮该重复它确认的那个动作），
 *  所以确认必须**在弹窗内**找，否则会点回页面上那一颗。 */
function confirmButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog, "the confirmation dialog must be open").toBeTruthy();
  const button = [...dialog!.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  expect(button, `the confirmation must expose a ${label} button`).toBeTruthy();
  return button as HTMLButtonElement;
}

function dialogButton(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  expect(button, `the confirmation must expose a ${label} button`).toBeTruthy();
  return button as HTMLButtonElement;
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
      error: "That address already belongs to a merchant workspace. Manage their access from that tenant instead.",
    });
    const dom = await renderTenants();

    await click(revokeButton(dom));
    await click(dialogButton("Revoke invite"));

    expect(document.body.textContent).toContain("already belongs to a merchant workspace");
    expect(document.body.textContent).not.toContain(`Revoked ${PENDING_EMAIL}`);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  // #538 round 2 (P2) — the old wording promised the address could not sign in at all, but
  // FOUNDER_ADMIN_EMAILS / AUTH_ALLOWED_EMAILS outrank the DB row (allowlist.ts).
  it("scopes the confirmation wording to what revoking actually blocks", async () => {
    const dom = await renderTenants();

    await click(revokeButton(dom));

    const prompt = document.querySelector('[role="alertdialog"]')?.textContent ?? "";
    expect(prompt).toContain("Future self-signup with this email is blocked.");
    expect(prompt).not.toContain("cannot sign in");
  });

  it("does not revoke when the confirmation is declined", async () => {
    const dom = await renderTenants();

    await click(revokeButton(dom));
    await click(dialogButton("Cancel"));

    expect(mocks.revokeTenantInvite).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("revokes only after the confirmation is accepted", async () => {
    const dom = await renderTenants();

    await click(revokeButton(dom));
    await click(dialogButton("Revoke invite"));

    expect(mocks.revokeTenantInvite).toHaveBeenCalledTimes(1);
    expect(mocks.revokeTenantInvite).toHaveBeenCalledWith(PENDING_EMAIL);
    expect(mocks.refresh).toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("locks a same-tick double confirmation and leaves a failed request in place", async () => {
    let release!: (result: { error: string }) => void;
    mocks.revokeTenantInvite.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    const dom = await renderTenants();
    await click(revokeButton(dom));

    const confirm = dialogButton("Revoke invite");
    await act(async () => {
      confirm.click();
      confirm.click();
    });

    expect(mocks.revokeTenantInvite).toHaveBeenCalledTimes(1);
    expect(dialogButton("Revoking…").disabled).toBe(true);
    expect(dialogButton("Cancel").disabled).toBe(true);

    await act(async () => {
      release({ error: "No pending invite for that address." });
    });

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "No pending invite for that address.",
    );
  });
});

// ── SIGNIN-A7：撤销一个自助进来的地址 ────────────────────────────────────────────────────
describe("admin tenants access revoke UI (SIGNIN-A7, #1319)", () => {
  const SELF_SIGNED_UP = "selfserve@merchant.com";

  it("SIGNIN-A7 —— 后台有一条撤销进门权的路，而且它不在待邀清单的行上（自助进来的地址不在那份清单里）", async () => {
    const dom = await renderTenants();

    // 这份清单里只有 `invited` 的行；A7 要撤的地址是 `active`，它永远不会出现在这里。
    expect(dom.textContent).not.toContain(SELF_SIGNED_UP);
    expect(revokeAccessButton(dom)).toBeTruthy();
  });

  it("SIGNIN-A7 —— 输入一个自助进来的地址、确认之后，后台调的是 revokeMerchantAccess（不是只认 invited 的旧动作）", async () => {
    const dom = await renderTenants();
    const input = emailInput(dom);

    await typeInto(input, `  ${SELF_SIGNED_UP.toUpperCase()}  `);
    await click(revokeAccessButton(dom));
    await click(confirmButton("Revoke access"));

    expect(mocks.revokeMerchantAccess).toHaveBeenCalledTimes(1);
    expect(mocks.revokeMerchantAccess).toHaveBeenCalledWith(SELF_SIGNED_UP);
    // 旧那条路一次都没被走过 —— 它会回「No pending invite for that address.」。
    expect(mocks.revokeTenantInvite).not.toHaveBeenCalled();
    expect(dom.textContent).toContain(`Revoked access for ${SELF_SIGNED_UP}`);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  /** 撤销进门权会把人**当场登出**，后果比收回一张邀请重得多，所以确认弹窗必须说出那一件事。 */
  it("SIGNIN-A7 —— 确认弹窗说清楚会当场登出、两扇门都拒", async () => {
    const dom = await renderTenants();
    await typeInto(emailInput(dom), SELF_SIGNED_UP);
    await click(revokeAccessButton(dom));

    const prompt = document.querySelector('[role="alertdialog"]')?.textContent ?? "";
    expect(prompt).toContain("Every session for this address is deleted");
    expect(prompt).toContain("Both sign-in doors");
    // 邀请那条路的措辞（「只影响将来的自助注册」）在这里是假话，不许出现。
    expect(prompt).not.toContain("This changes future self-signup only");
  });

  it("SIGNIN-A7 —— 没确认就不撤：一次误点不该把人踢出去", async () => {
    const dom = await renderTenants();
    await typeInto(emailInput(dom), SELF_SIGNED_UP);
    await click(revokeAccessButton(dom));
    await click(confirmButton("Cancel"));

    expect(mocks.revokeMerchantAccess).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("SIGNIN-A7 —— 写坏的地址连弹窗都开不出来，更到不了服务端", async () => {
    const dom = await renderTenants();
    await typeInto(emailInput(dom), "not-an-email");
    await click(revokeAccessButton(dom));

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.revokeMerchantAccess).not.toHaveBeenCalled();
    expect(dom.textContent).toContain("Enter a valid email.");
  });

  it("SIGNIN-A7 —— 服务端说没有可撤的东西时，界面照说，不冒充成功", async () => {
    mocks.revokeMerchantAccess.mockResolvedValue({ error: "That address has no access to revoke." });
    const dom = await renderTenants();
    await typeInto(emailInput(dom), "ghost@merchant.com");
    await click(revokeAccessButton(dom));
    await click(confirmButton("Revoke access"));

    expect(document.body.textContent).toContain("That address has no access to revoke.");
    expect(document.body.textContent).not.toContain("Revoked access for ghost@merchant.com");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it("SIGNIN-A7 —— 第二次撤同一个地址报的是 already_revoked，不冒充「刚刚撤掉了」", async () => {
    mocks.revokeMerchantAccess.mockResolvedValue({ ok: true, result: "already_revoked" });
    const dom = await renderTenants();
    await typeInto(emailInput(dom), SELF_SIGNED_UP);
    await click(revokeAccessButton(dom));
    await click(confirmButton("Revoke access"));

    expect(dom.textContent).toContain(`${SELF_SIGNED_UP} was already revoked.`);
    expect(dom.textContent).not.toContain(`Revoked access for ${SELF_SIGNED_UP}.`);
  });
});
