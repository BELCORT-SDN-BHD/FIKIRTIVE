/**
 * MONEY-A5(规格 docs/specs/money-engine.md §2 验收表)—— 「credits 永不过期」这句话本身。
 *
 * 这一票钉的不是行为,是**一句文案存不存在**,而且验收行把这一点写死了:
 *
 *   > billing 面存在明示「Credits don't expire」的商家可见文案(今天没有这句文案,S2 补上——
 *   > 没有文案则本行不算过,**不许以「没有相反文案」空转通过**)
 *
 * 所以这份测试刻意**不去证明**「仓库里没有过期代码路径」。那是同一条验收的另一半,由钱路那边
 * 的行为测试与账本守恒负责;而「代码里没有清零逻辑」这件事,对一个正在犹豫要不要充 250 块的
 * 商家来说,是他永远读不到的东西。九问 1 把这条列在**商家看不到、但同样重要**的那一栏里 ——
 * 让它被看见,就是这一行验收的全部内容。
 *
 * 两种余额状态都测:读不到余额的商家比读得到的更有理由担心「我的 credits 还在不在」,
 * 所以这句话不能只挂在成功分支上。
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/** React 把文本里的 `'` 转义成 `&#x27;`,所以直接对 markup 做 `toContain("don't")` 永远假红。
 *  只还原引号这一类,别的转义原样留着 —— 这里要读的是**商家看到的那句话**。 */
function asReadText(html: string): string {
  return html
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** 用给定的账户状态渲染一次 billing 页。三个数据源全 mock —— 这一票不测数据,只测文案。 */
async function renderBilling(account: { balance: number; reserved: number } | { error: string }) {
  vi.resetModules();
  vi.doMock("@/lib/account-actions", () => ({ getMyAccount: async () => account }));
  vi.doMock("@/lib/billing-actions", () => ({ listCreditPacks: async () => ({ packs: [] }) }));
  vi.doMock("@/lib/spend-history-data", () => ({
    getSpendOverview: async () => ({ error: "unavailable" }),
  }));
  // 前端基线合并(FRONT-A1):花费上限搬到了这一页,所以页面多读一个数据源。这一票不测上限,
  // 只测文案 —— 但不 mock 它,页面会去打真的 auth,整条断言就变成一次假红。
  vi.doMock("@/lib/owner-settings-actions", () => ({
    getOwnerSettings: async () => ({ spendCapCredits: 0 }),
    setOwnerSetting: async () => ({ ok: true as const }),
  }));
  const { default: BillingPage } = await import("@/app/billing/page");
  const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));
  vi.doUnmock("@/lib/account-actions");
  vi.doUnmock("@/lib/billing-actions");
  vi.doUnmock("@/lib/spend-history-data");
  vi.doUnmock("@/lib/owner-settings-actions");
  return asReadText(html);
}

/** 验收行逐字要求的那句话。测试与页面共用这一份字面量,是**故意**的:文案没了就红。 */
const A5_SENTENCE = "Credits don't expire";

describe("MONEY-A5:credits 永不过期 —— billing 面读得到的那句话", () => {
  it("MONEY-A5:余额读得到时,余额卡上明示「Credits don't expire」", async () => {
    const text = await renderBilling({ balance: 1890, reserved: 0 });
    expect(text, "billing 面没有这句话 = 本行不算过(验收行明写,不许空转通过)").toContain(
      A5_SENTENCE,
    );
  });

  it("MONEY-A5:余额读不到时这句话照样在(此时商家更有理由担心 credits 还在不在)", async () => {
    const text = await renderBilling({ error: "not signed in" });
    expect(text, "余额加载失败的分支漏了这句话 —— 恰恰是最需要它的那一屏").toContain(A5_SENTENCE);
  });

  it("MONEY-A5:这句话紧挨着余额,不是埋在页尾", async () => {
    // 「永不过期」讲的是屏幕上那个数字。离开那个数字,它就只是一句条款。
    const text = await renderBilling({ balance: 1890, reserved: 220 });
    // 前端基线合并(FRONT-A1):余额卡的 hold 行由 main 的一行小字改成分支的 Badge —— 长相以分支
    // 为准,所以定位锚点跟着改成 Badge 的文案。钉的东西一个字没松:这句话仍然必须紧挨着余额卡的
    // hold 行,离得远了照样红。
    const balanceIndex = text.indexOf("credits held");
    const sentenceIndex = text.indexOf(A5_SENTENCE);
    expect(balanceIndex, "余额卡的 hold 行不见了 —— 定位锚点变了,这条断言要重写").toBeGreaterThan(-1);
    expect(sentenceIndex, A5_SENTENCE + " 不在页面上").toBeGreaterThan(-1);
    expect(
      sentenceIndex - balanceIndex,
      "这句话离余额太远了(它讲的是余额那个数字,不是页脚条款)",
    ).toBeLessThan(600);
  });
});
