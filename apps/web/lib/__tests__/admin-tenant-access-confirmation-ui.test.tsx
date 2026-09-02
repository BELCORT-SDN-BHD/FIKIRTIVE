// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cutTenantSessions: vi.fn(),
  grantTenantCredits: vi.fn(),
  impersonateTenant: vi.fn(),
  setMembershipStatus: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/tenant-actions", () => ({
  cutTenantSessions: mocks.cutTenantSessions,
  grantTenantCredits: mocks.grantTenantCredits,
  impersonateTenant: mocks.impersonateTenant,
  setMembershipStatus: mocks.setMembershipStatus,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TenantDetail } = await import("@/components/admin/TenantDetail");

const DETAIL = {
  orgId: "org-merchant",
  name: "Kedai Maju",
  ownerEmail: "owner@kedaimaju.test",
  status: "active",
  balance: 1200,
  reserved: 0,
  spentUsd: 4.25,
  projectCount: 3,
  genCount: 8,
  ledger: [],
  audit: [],
  // 前端基线合并(FRONT-A1):main 的 MONEY-A14 给 TenantDetail 加了四个必填字段,
  // 组件渲染时就会读。这份夹具跟着补齐,断言一条没动 —— 这一票测的仍然是访问控制确认弹层。
  adjustRolling30dDisplay: 0,
  adjustRolling30dLimitDisplay: 2000,
  openManualRefunds: [],
  openManualRefundsHasMore: false,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cutTenantSessions.mockResolvedValue({ ok: true, cut: 2 });
  mocks.setMembershipStatus.mockResolvedValue({ ok: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(TenantDetail, { detail: DETAIL }));
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function button(label: string): HTMLButtonElement {
  const byText = [...document.body.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (byText instanceof HTMLButtonElement) return byText;
  const byAria = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (byAria) return byAria;
  throw new Error(`No button labelled "${label}"`);
}

async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("admin tenant access confirmations", () => {
  it("explains that suspension ends access but preserves tenant data", async () => {
    await click(button("Suspend tenant"));

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Suspend tenant?");
    expect(dialog?.textContent).toContain("Active sessions end and sign-in stays blocked");
    expect(dialog?.textContent).toContain("Projects, assets, credits, and billing history stay unchanged");
    expect(mocks.setMembershipStatus).not.toHaveBeenCalled();
  });

  it("keeps a refused suspension inline and blocks same-tick double submits", async () => {
    let release!: (result: { error: string }) => void;
    mocks.setMembershipStatus.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    await click(button("Suspend tenant"));

    const confirm = button("Suspend tenant");
    await act(async () => {
      confirm.click();
      confirm.click();
    });

    expect(mocks.setMembershipStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setMembershipStatus).toHaveBeenCalledWith("org-merchant", "suspended");
    expect(button("Suspending…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);

    await act(async () => {
      release({ error: "This tenant cannot be suspended right now." });
    });

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "This tenant cannot be suspended right now.",
    );
    expect(button("Suspend tenant").disabled).toBe(false);
  });

  it("distinguishes ending sessions from suspending the tenant", async () => {
    await click(button("End tenant sessions"));

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("End all tenant sessions?");
    expect(dialog?.textContent).toContain("The tenant stays active, so members can sign in again.");

    await click(button("End sessions"));

    expect(mocks.cutTenantSessions).toHaveBeenCalledTimes(1);
    expect(mocks.cutTenantSessions).toHaveBeenCalledWith("org-merchant");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.textContent).toContain("Signed out 2 sessions.");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("cancels without changing access", async () => {
    await click(button("Suspend tenant"));
    await click(button("Cancel"));

    expect(mocks.setMembershipStatus).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
