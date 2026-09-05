// @vitest-environment jsdom
/**
 * FRONT-A11 第⑦段(Settings / Billing 换皮)的验收围栏。
 *
 * 规格:`docs/specs/frontend-baseline.md` §2 FRONT-A11 ——「商家在新壳的 Settings 改个人显示名
 * 与工作区名,在 Billing 看余额并进充值 ⇒ 改名刷新仍在;余额、冻结额、充值包与结账走现有真
 * 能力;plan / payment method / invoice 这类无契约的控件不出现」。
 *
 * 这一段只换外观。所以这份围栏钉的是「换皮之后**没丢东西、也没长出东西**」两件:
 *
 *  ① Founder 2026-09-03 裁决:账单页按设计排版,但主干的三条花钱披露原样保留 ——
 *     花费上限(MONEY-A5/A2 一族)、自动理解(MONEY-A9)、网页搜索(MONEY-A10)。
 *     它们各自的口径围栏在 `lib/__tests__/` 里(money-a5-credits-never-expire、
 *     understanding-disclosure、money-a10-search-disclosure、credit-packs-empty-exit),
 *     那些是「这句话对不对」;这里钉的是「换皮之后这三节还在同一页上」——一次重排把某一节
 *     漏掉,那几份围栏里有的会红、有的不会,这条一定会红。
 *  ② 设计夹具里的 Plan & payment(套餐、付款方式、发票)在后端有对象之前**不显示、
 *     不放占位**。夹具是评审件,它自己写着 "Preview only";把它照抄进生产就是拿假控件
 *     骗商家。所以生产这一页上不许出现那一族的任何字。
 *
 * 渲染的是**真的 `/billing` 页**(server component 直接 await),不是一个抄了一遍文案的副本。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMyAccount: vi.fn(),
  listCreditPacks: vi.fn(),
  getSpendOverview: vi.fn(),
  getOwnerSettings: vi.fn(),
  setOwnerSetting: vi.fn(),
}));

vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/billing-actions", () => ({
  listCreditPacks: mocks.listCreditPacks,
  createTopupCheckout: vi.fn(),
}));
vi.mock("@/lib/spend-history-data", () => ({ getSpendOverview: mocks.getSpendOverview }));
vi.mock("@/lib/owner-settings-actions", () => ({
  getOwnerSettings: mocks.getOwnerSettings,
  setOwnerSetting: mocks.setOwnerSetting,
}));

const { default: BillingPage } = await import("@/app/billing/page");

/** `&#x27;` 之类的实体在屏幕上就是一个撇号 —— 断言看的是商家读到的那句话。 */
function asReadText(html: string): string {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.textContent ?? "";
}

async function renderBilling(): Promise<string> {
  mocks.getMyAccount.mockResolvedValue({
    email: "owner@acme.test",
    displayName: "Alya",
    organizationName: "Kedai Kopi",
    isFounder: false,
    balance: 1890,
    reserved: 220,
    balanceUsd: 189,
  });
  mocks.listCreditPacks.mockResolvedValue({
    packs: [{ priceId: "price_1", label: "Starter", credits: 500, amountCents: 4900, currency: "myr" }],
  });
  mocks.getSpendOverview.mockResolvedValue({
    entries: [],
    window: { taskLimit: 20, returned: 0, hasMore: false },
  });
  mocks.getOwnerSettings.mockResolvedValue({ spendCapCredits: 25 });
  return asReadText(renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) })));
}

describe("FRONT-A11 Billing & credits 换皮", () => {
  it("FRONT-A11:三条花钱披露在换皮之后仍然同页可读(上限 / 自动理解 / 网页搜索)", async () => {
    const text = await renderBilling();

    // MONEY-A5 —— credits 永不过期,紧挨着余额。
    expect(text, "余额不见了").toContain("Available balance");
    expect(text, "冻结额不见了").toContain("credits held");
    expect(text, "MONEY-A5 那句话被换皮弄丢了").toContain("Credits don't expire");

    // MONEY-A2 一族 —— 花费上限,商家自己能看能改的那个数。
    expect(text, "花费上限那一节被换皮弄丢了").toContain("Spend cap");
    expect(text, "上限说明被改口成「会花钱」").toContain("It never spends anything — it only refuses");

    // MONEY-A9 —— 上传即自动理解的价目区。
    expect(text, "自动理解那一节被换皮弄丢了").toContain("Auto-understanding");
    expect(text, "自动理解漏了级联那一句").toContain("menu or a price list");
    expect(text.toLowerCase(), "自动理解漏了免费祖父条款").toContain(
      "before automatic understanding was priced stay free",
    );

    // MONEY-A10 —— 聊天里的网页搜索,含被接受的上限豁免。
    expect(text, "网页搜索那一节被换皮弄丢了").toContain("Web search in chat");
    expect(text, "网页搜索漏了「只按成功次数收」").toContain("only for searches that complete");
    expect(text, "网页搜索漏了单动作上限豁免").toContain("per-action spend cap does not stop them");
  });

  it("FRONT-A11:充值走的仍是真货架与真结账,不是夹具里的固定金额", async () => {
    const text = await renderBilling();
    expect(text).toContain("Top up credits");
    // 真货架给出的包:credits 数与价钱都来自 listCreditPacks,不是页面里写死的 100/250/500。
    expect(text).toContain("500 credits");
    expect(text).toContain("Buy for");
    expect(mocks.listCreditPacks, "页面没有去读真的货架").toHaveBeenCalled();
    // 夹具的固定档位一个都不许出现在生产页上。
    for (const fixtureAmount of ["100 credits", "250 credits"]) {
      expect(text, `夹具的固定金额 ${fixtureAmount} 被照抄进了生产页`).not.toContain(fixtureAmount);
    }
  });

  it("FRONT-A11:后端没有对象的套餐 / 付款方式 / 发票一个占位都不放", async () => {
    const text = await renderBilling();
    for (const noContract of [
      "Plan & payment",
      "Payment method",
      "Invoices",
      "View invoices",
      "Founder plan",
      "billed monthly",
      "Monthly credits",
      "Purchased credits",
      "Change payment method",
      "Visa ending",
    ]) {
      expect(
        text,
        `「${noContract}」在生产页上出现了 —— 它没有后端契约,按 §3「不做 subscription plan / payment method / invoice」不显示、不放占位`,
      ).not.toContain(noContract);
    }
    // 评审夹具自己的免责话更不许跟着搬过来。
    expect(text).not.toContain("Preview only");
    expect(text).not.toContain("review session");
  });
});
