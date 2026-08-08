// @vitest-environment jsdom
/**
 * credit-packs-empty-exit — #687:没有可售积分包时,两个账务页必须说同一句话,而且不是死胡同。
 *
 * 病灶(走查 W1-B 实测,Stripe 未配置 / 密钥失效 / 包全下架都会走到这里):
 *   /billing        → "No credit packs are available right now."
 *   /otto?view=account → "No credit packs available right now."
 * 同一个状态两句话,而且都到此为止 —— 商家已经想花钱了,页面只说「没有」,不给任何下一步。
 *
 * 两条钉板:
 *   ① 一个事实一个来源:两处渲染出的句子必须逐字相同(措辞本身由共享常量决定,
 *      这里不锁死具体字面量 —— 锁的是「不许各写各的」)。
 *   ② 空态必须有出口:两处都要有一条能点的 mailto。空态不承诺「什么时候恢复」——
 *      产品不知道,所以不说;能给的只有「找得到人」。
 *
 * 不在本票范围(走查已判合格,勿回退):失效密钥不会把 Stripe 的内部报错抛到界面上。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/owner-settings";
import type { AccountInfo } from "@/lib/account-actions";

const account: AccountInfo = {
  email: "owner@acme.test",
  organizationName: "Acme Studio",
  isFounder: false,
  balance: 100,
  reserved: 0,
  balanceUsd: 10,
  recent: [],
};

const mocks = vi.hoisted(() => ({
  getMyAccount: vi.fn(),
  listCreditPacks: vi.fn(),
  getSpendOverview: vi.fn(),
  setOwnerSetting: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));

vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/billing-actions", () => ({ listCreditPacks: mocks.listCreditPacks }));
vi.mock("@/lib/spend-history-data", () => ({ getSpendOverview: mocks.getSpendOverview }));
vi.mock("@/lib/owner-settings-actions", () => ({ setOwnerSetting: mocks.setOwnerSetting }));
vi.mock("@/lib/otto-client-actions", () => ({ setAdsAutonomy: mocks.setAdsAutonomy }));

const { default: BillingPage } = await import("@/app/billing/page");
const { buildSettingsSections } = await import("@/components/otto/settings/sections");
const { SettingsPage } = await import("@/components/otto/settings/SettingsPage");

/** The /billing page with nothing on sale. */
async function renderBillingPage(): Promise<HTMLDivElement> {
  mocks.getMyAccount.mockResolvedValue(account);
  mocks.listCreditPacks.mockResolvedValue([]);
  mocks.getSpendOverview.mockResolvedValue({
    entries: [],
    window: { taskLimit: 20, returned: 0, hasMore: false },
  });
  const element = await BillingPage({ searchParams: Promise.resolve({}) });
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

/** The Billing and credits block inside Settings, with nothing on sale. */
function renderSettingsBilling(): HTMLDivElement {
  const sections = buildSettingsSections({
    account,
    settings: DEFAULT_SETTINGS,
    channels: [],
    packs: [],
    adsAutonomy: "ASK",
    canPublish: false,
    onDeleteAccountRequest: vi.fn(),
  });
  const billing = sections.find((s) => s.id === "billing");
  if (!billing) throw new Error("the Billing and credits section disappeared");
  const balance = billing.fields.find((f) => f.id === "balance");
  if (!balance) throw new Error("the balance field disappeared");
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(SettingsPage, { sections: [{ id: "billing", title: "Billing", fields: [balance] }] }),
  );
  return host;
}

/** The one sentence about an empty shelf, wherever it is rendered. */
function emptyShelfSentence(host: HTMLElement): string {
  const match = (host.textContent ?? "").match(/No credit packs[^.]*\./);
  expect(match, "neither page says anything about the empty shelf").toBeTruthy();
  return match![0];
}

describe("#687 an empty credit shelf reads the same on both money pages", () => {
  it("says it in exactly the same words on /billing and in Settings", async () => {
    const billingSentence = emptyShelfSentence(await renderBillingPage());
    const settingsSentence = emptyShelfSentence(renderSettingsBilling());

    expect(
      settingsSentence,
      "the two money pages describe one state with two different sentences",
    ).toBe(billingSentence);
  });

  it.each([
    ["/billing", async () => renderBillingPage()],
    ["Settings", async () => renderSettingsBilling()],
  ])("%s gives the merchant somewhere to go, not a dead end", async (_where, render) => {
    const host = await render();

    // No "Top up" button can exist — there is nothing to sell.
    expect(host.querySelector('a[href="/billing"]')).toBeNull();

    const exit = host.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
    expect(exit, "a merchant who wants to pay is shown a full stop and nothing else").toBeTruthy();
    expect(exit!.getAttribute("href")).toMatch(/^mailto:[^@\s]+@[^@\s]+/);
    expect(exit!.textContent?.trim()).not.toBe("");
  });

  it("promises nothing about when packs come back", async () => {
    for (const host of [await renderBillingPage(), renderSettingsBilling()]) {
      const sentence = emptyShelfSentence(host);
      expect(sentence, "the product does not know when the shelf refills — it must not say").not.toMatch(
        /soon|shortly|back|later|tomorrow|hours?|days?/i,
      );
    }
  });
});
