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
 *
 * #786 追加第三条钉板:**「拿不到货架」不是「没有货」**。价格目录调用抛错时,产品并不知道
 * 货架是空是满 —— 所以不许说「没有」,也不许因此把商家引去写邮件(#771 自己立的围栏:
 * 可重试的错误不挂人工出口)。下面这一组的货架状态由**真的 `listCreditPacks`** 对着一次
 * 真的 Stripe 抛错产出,不是手写的常量 —— 页面读的就是那一层真实给出的判词。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/owner-settings";
import type { AccountInfo } from "@/lib/account-actions";
import type { CreditPackShelf } from "@/lib/billing-actions";

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

const mocks = vi.hoisted(() => ({
  getMyAccount: vi.fn(),
  listCreditPacks: vi.fn(),
  getSpendOverview: vi.fn(),
  setOwnerSetting: vi.fn(),
  // 前端基线合并(FRONT-A1):花费上限搬到了 /billing,所以这一页多读一个数据源。
  // 这一票测的是充值货架的措辞,上限读成什么都不影响它 —— 但不 mock 就会打真 auth 假红。
  getOwnerSettings: vi.fn(async () => ({ spendCapCredits: 0 })),
  setAdsAutonomy: vi.fn(),
  requireOwner: vi.fn(),
  isImpersonating: vi.fn(),
  pricesList: vi.fn(),
}));

vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/billing-actions", () => ({ listCreditPacks: mocks.listCreditPacks }));
vi.mock("@/lib/spend-history-data", () => ({ getSpendOverview: mocks.getSpendOverview }));
vi.mock("@/lib/owner-settings-actions", () => ({
  setOwnerSetting: mocks.setOwnerSetting,
  getOwnerSettings: mocks.getOwnerSettings,
}));
vi.mock("@/lib/otto-client-actions", () => ({ setAdsAutonomy: mocks.setAdsAutonomy }));
// The REAL listCreditPacks runs against these two below (importActual), so the shelf
// verdict the pages read is the one the action really produces (#786).
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mocks.isImpersonating }));
vi.mock("@/lib/stripe", () => ({ stripe: { prices: { list: mocks.pricesList } } }));

const { default: BillingPage } = await import("@/app/billing/page");
const { buildSettingsSections } = await import("@/components/otto/settings/sections");
const { SettingsPage } = await import("@/components/otto/settings/SettingsPage");
const realBilling = await vi.importActual<typeof import("@/lib/billing-actions")>("@/lib/billing-actions");

/** The shelf verdict the REAL action reports when the price catalogue cannot be read —
 *  a transient Stripe failure, which is a different fact from "nothing is on sale". */
async function unreadableShelf(): Promise<CreditPackShelf> {
  mocks.requireOwner.mockResolvedValue({ ownerId: "org_1", email: "owner@acme.test" });
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  mocks.pricesList.mockRejectedValue(new Error("connection reset"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    return await realBilling.listCreditPacks();
  } finally {
    warn.mockRestore();
  }
}

/** The /billing page rendered against a given shelf verdict (default: nothing on sale). */
async function renderBillingPage(shelf: CreditPackShelf = { packs: [] }): Promise<HTMLDivElement> {
  mocks.getMyAccount.mockResolvedValue(account);
  mocks.listCreditPacks.mockResolvedValue(shelf);
  mocks.getSpendOverview.mockResolvedValue({
    entries: [],
    window: { taskLimit: 20, returned: 0, hasMore: false },
  });
  const element = await BillingPage({ searchParams: Promise.resolve({}) });
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

/** The Billing and credits block inside Settings, against a given shelf verdict. */
function renderSettingsBilling(shelf: CreditPackShelf = { packs: [] }): HTMLDivElement {
  const sections = buildSettingsSections({
    account,
    settings: DEFAULT_SETTINGS,
    channels: [],
    shelf,
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
    expect(
      Array.from(host.querySelectorAll('a[href="/billing"]')).find((link) => link.textContent?.includes("Top up")),
    ).toBeUndefined();

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

describe("#786 a shelf we could not read is not an empty shelf", () => {
  it("says neither page could read the catalogue, in the same words", async () => {
    const shelf = await unreadableShelf();
    const hosts = [await renderBillingPage(shelf), renderSettingsBilling(shelf)];

    const sentences = hosts.map((host) => {
      const match = (host.textContent ?? "").match(/Could not load[^.]*\.[^.]*\./);
      expect(match, "the page says nothing about failing to read the catalogue").toBeTruthy();
      return match![0];
    });
    expect(sentences[1], "the two money pages describe one state with two different sentences").toBe(
      sentences[0],
    );
  });

  it.each([
    ["/billing", async (shelf: CreditPackShelf) => renderBillingPage(shelf)],
    ["Settings", async (shelf: CreditPackShelf) => renderSettingsBilling(shelf)],
  ])("%s hangs no human exit on an error the merchant can simply retry", async (where, render) => {
    const host = await render(await unreadableShelf());

    expect(
      host.querySelector('a[href^="mailto:"]'),
      `${where}: a retryable catalogue error must not send the merchant to a human (#771's own fence)`,
    ).toBeNull();
  });

  it.each([
    ["/billing", async (shelf: CreditPackShelf) => renderBillingPage(shelf)],
    ["Settings", async (shelf: CreditPackShelf) => renderSettingsBilling(shelf)],
  ])("%s never claims the shelf is empty when it never saw the shelf", async (where, render) => {
    const host = await render(await unreadableShelf());

    expect(
      host.textContent,
      `${where}: asserts there is nothing on sale on the strength of a failed read`,
    ).not.toMatch(/No credit packs/);
  });
});
