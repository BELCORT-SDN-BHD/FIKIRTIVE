// @vitest-environment jsdom
/**
 * support-exit — #686:产品里每一句「联系我们 / 联系支持」都必须是一条能点的路。
 *
 * 病灶(走查 W1-B / W2-B / W4-A 实测):三处告诉商家去联系我们,三处都是死文字。
 *   ① Settings → Danger zone:「Hides your workspace. Contact us to fully erase.」——
 *      `<span>`,`closest("a")` 为 null,整个区块 `<a>` 数量 0。
 *   ② Connections 页 `not_configured`:「…Contact support and we'll enable it.」——
 *      这一支 `retry: false`,代码自己判定商家重试没用,唯一出路就是联系我们,
 *      而这条路在产品里不存在,商家彻底卡死。
 *   ③ Checkout 起不来时:「Checkout is unavailable — please contact support.」——
 *      纯字符串,渲染出来一样点不动。
 *
 * 答案产品自己早就有:OttoAccount 的删号确认框跳的是 mailto:tao@belcort.com。
 * 这不是「还没想好联系方式」,是同一个已知答案在三处漏接。
 *
 * 这些钉板封的是「出口」而不是「措辞」:断言的是 DOM 里真有一个可点的 mailto,
 * 不是断言某句话长什么样 —— 换一句更好听的死文字照样红。
 */
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/owner-settings";
import type { AccountInfo } from "@/lib/account-actions";

const mocks = vi.hoisted(() => ({
  setOwnerSetting: vi.fn(),
  setAdsAutonomy: vi.fn(),
  setAdsWritesPaused: vi.fn(),
  getMetaConnection: vi.fn(),
  disconnectMeta: vi.fn(),
  getMetaInsights: vi.fn(),
  getAccountViewData: vi.fn(),
  createTopupCheckout: vi.fn(),
}));

vi.mock("@/lib/owner-settings-actions", () => ({ setOwnerSetting: mocks.setOwnerSetting }));
vi.mock("@/lib/otto-client-actions", () => ({
  setAdsAutonomy: mocks.setAdsAutonomy,
  setAdsWritesPaused: mocks.setAdsWritesPaused,
}));
vi.mock("@/lib/meta-actions", () => ({
  getMetaConnection: mocks.getMetaConnection,
  disconnectMeta: mocks.disconnectMeta,
  getMetaInsights: mocks.getMetaInsights,
}));
vi.mock("@/lib/account-view-data", () => ({ getAccountViewData: mocks.getAccountViewData }));
vi.mock("@/lib/billing-actions", () => ({ createTopupCheckout: mocks.createTopupCheckout }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { buildSettingsSections } = await import("@/components/otto/settings/sections");
const { SettingsPage } = await import("@/components/otto/settings/SettingsPage");
const { default: OttoConnections } = await import("@/components/otto/OttoConnections");
const { BuyPackButton } = await import("@/components/billing/BuyPackButton");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

const WEB_ROOT = path.resolve(__dirname, "../..");

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/** Every mailto exit must actually address a person — no empty `mailto:` placeholders. */
function expectReachableMailto(anchor: HTMLAnchorElement | null, where: string): void {
  expect(anchor, `${where}: nothing to click — the merchant is told to contact us with no way to`).toBeTruthy();
  const href = anchor!.getAttribute("href") ?? "";
  expect(href, `${where}: mailto has no address`).toMatch(/^mailto:[^@\s]+@[^@\s]+/);
  expect(anchor!.textContent?.trim(), `${where}: the link has no label`).not.toBe("");
}

const account: AccountInfo = {
  email: "owner@acme.test",
  displayName: "",
  organizationName: "Acme Studio",
  isFounder: false,
  balance: 100,
  reserved: 0,
  balanceUsd: 10,
  recent: [],
};

// ---------------------------------------------------------------------------
// ① Settings → Danger zone
// ---------------------------------------------------------------------------
describe("#686 Danger zone hands over a way to reach us", () => {
  it("renders 'Contact us' as a live mailto, not a dead span", () => {
    const sections = buildSettingsSections({
      account,
      settings: DEFAULT_SETTINGS,
      channels: [],
      shelf: { packs: [] },
      adsAutonomy: "ASK",
      canPublish: false,
      onDeleteAccountRequest: vi.fn(),
    });
    const danger = sections.find((s) => s.id === "danger");
    expect(danger, "the Danger zone section disappeared").toBeTruthy();

    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(SettingsPage, { sections: [danger!] }));

    expect(host.textContent, "the erase sentence is gone — this test is pointed at nothing").toContain(
      "to fully erase",
    );
    expectReachableMailto(host.querySelector<HTMLAnchorElement>('a[href^="mailto:"]'), "Danger zone");
  });
});

// ---------------------------------------------------------------------------
// ② Connections — the server has no Meta keys
// ---------------------------------------------------------------------------
describe("#686 the not_configured dead end has an exit", () => {
  it("offers a live support mailto — and still no pointless retry", async () => {
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: [],
      shelf: { packs: [] },
      adsAutonomy: "ASK",
      canPublish: false,
      meta: { connected: false },
    });
    window.history.pushState(null, "", "/otto?view=connections&error=not_configured");

    const dom = await mount(createElement(OttoConnections));
    const alert = dom.querySelector('[role="alert"]');
    expect(alert, "the failed-connect banner is gone").toBeTruthy();

    expectReachableMailto(
      alert!.querySelector<HTMLAnchorElement>('a[href^="mailto:"]'),
      "Connections not_configured",
    );
    // The merchant is not the blocker here — a "Try again" would fail the same way.
    expect(
      alert!.querySelector('a[href="/api/meta/authorize"]'),
      "retrying cannot clear a missing server key",
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ③ Checkout is unavailable
// ---------------------------------------------------------------------------
describe("#686 a checkout that cannot start hands over a way to reach us", () => {
  it("turns the server's contact-support verdict into a live mailto", async () => {
    mocks.createTopupCheckout.mockResolvedValue({
      error: "Checkout is unavailable — please contact support.",
      contactSupport: true,
    });

    const dom = await mount(createElement(BuyPackButton, { priceId: "price_a", label: "Buy · $5" }));
    const button = dom.querySelector("button");
    expect(button, "the Buy button is gone").toBeTruthy();

    await act(async () => {
      button!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const alert = dom.querySelector('[role="alert"]');
    expect(alert, "the checkout error is not shown at all").toBeTruthy();
    expectReachableMailto(alert!.querySelector<HTMLAnchorElement>('a[href^="mailto:"]'), "BuyPackButton");
  });

  it("adds no support link to an error the merchant can simply retry", async () => {
    mocks.createTopupCheckout.mockResolvedValue({ error: "Could not start checkout — please retry." });

    const dom = await mount(createElement(BuyPackButton, { priceId: "price_a", label: "Buy · $5" }));
    await act(async () => {
      dom.querySelector("button")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(dom.textContent).toContain("Could not start checkout");
    expect(
      dom.querySelector('a[href^="mailto:"]'),
      "a retryable error must not send the merchant to a human",
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ④ one address, one source
// ---------------------------------------------------------------------------
describe("#686 the three exits all reach the same inbox", () => {
  it("keeps the delete-account address in one place, not four", () => {
    // OttoAccount's mailto is the address the product has always used. The shared exit
    // layer must BE that address — read from one place, never re-typed beside it.
    const exits = readFileSync(path.join(WEB_ROOT, "lib/exits.ts"), "utf8");
    const address = exits.match(/SUPPORT_EMAIL\s*=\s*"([^"]+)"/)?.[1];
    expect(address, "the shared exit layer names no support address").toMatch(/^[^@\s]+@[^@\s]+$/);

    const accountSource = readFileSync(path.join(WEB_ROOT, "components/otto/OttoAccount.tsx"), "utf8");
    expect(accountSource, "OttoAccount does not read the shared exit").toMatch(/supportMailto|SUPPORT_EMAIL/);
    expect(accountSource, "OttoAccount still keeps its own copy of the address").not.toContain(address!);
  });
});

// ---------------------------------------------------------------------------
// ⑤ #786 — the fence, not just the three exits #686 happened to touch
//
// #771 收编了 OttoAccount 一处,并按「只改当前目标所需」放过了法务页的 10 个字面量。
// 一个只覆盖三处的规矩不是规矩:第 11 个字面量随时会长回来,而换地址那天没人找得齐。
// 所以这里枚举**整个渲染树**:页面和组件不许自己手写地址,也不许自己手写 mailto。
// ---------------------------------------------------------------------------
describe("#786 no page or component writes the support address itself", () => {
  /**
   * Every source file under app/ + components/ — `.ts` as well as `.tsx` (#825).
   *
   * The first version walked `.tsx` only, on the reasoning that this fence is about what
   * reaches a merchant's screen. That reasoning does not survive contact with the tree: those
   * two directories also hold 23 `.ts` files — route handlers, formatters, per-component model
   * helpers — and a formatter that returns an href or a sentence puts it on the screen just as
   * surely as the component that renders it. A hand-written mailto in one of them was invisible
   * to the fence, which is the whole shape #786 exists to stop: an address the product knows in
   * a place nobody can find on the day it changes.
   *
   * Test files are the one exclusion, by structure rather than by name list: `__tests__`
   * directories are skipped whole, and any stray `*.test.ts(x)` beside the source it covers is
   * skipped too. A test that writes the address is describing the product, not shipping it.
   */
  function renderedFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(WEB_ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") continue;
          walk(rel);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          found.push(rel);
        }
      }
    };
    walk("app");
    walk("components");
    return found;
  }

  const address = readFileSync(path.join(WEB_ROOT, "lib/exits.ts"), "utf8").match(
    /SUPPORT_EMAIL\s*=\s*"([^"]+)"/,
  )?.[1];

  it("finds files to check (a fence pointed at nothing proves nothing)", () => {
    expect(renderedFiles().length).toBeGreaterThan(50);
    expect(address).toMatch(/^[^@\s]+@[^@\s]+$/);
    // #825 — the `.ts` half is the half that was missing. Narrowing the walk back to `.tsx`
    // leaves every other assertion here green; this one goes red.
    expect(renderedFiles().filter((rel) => rel.endsWith(".ts")).length).toBeGreaterThanOrEqual(20);
    // And no test file rode in with them.
    expect(renderedFiles().filter((rel) => /\.test\.tsx?$/.test(rel))).toEqual([]);
  });

  it("nobody hand-writes the address", () => {
    const offenders = renderedFiles().filter((rel) =>
      readFileSync(path.join(WEB_ROOT, rel), "utf8").includes(address!),
    );
    expect(
      offenders,
      "these render the support address from their own copy — it belongs to lib/exits.ts alone",
    ).toEqual([]);
  });

  it("nobody hand-writes a mailto href", () => {
    const offenders = renderedFiles().filter((rel) =>
      readFileSync(path.join(WEB_ROOT, rel), "utf8").includes("mailto:"),
    );
    expect(
      offenders,
      "these build a mailto by hand instead of asking supportMailto() for one",
    ).toEqual([]);
  });
});
