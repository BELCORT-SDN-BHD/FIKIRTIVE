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
 * 前端基线①(判官 2026-09-02 P2-f)——**第二臂换成了真东西**。
 * 这份围栏原来的「Settings 那一臂」渲染的是 `buildSettingsSections` + `SettingsPage`,
 * 而新壳把 Settings 拆成四面之后,那一面**没有任何路由渲染**(`OttoAccount` 是死代码,
 * 它自己的文件头就写着这件事)。钉在死代码上的围栏保护不了任何商家:那句话在屏幕上早已
 * 不存在,它却一直是绿的。新壳上「Billing & credits」就是 `/billing`,所以第二臂改成两半,
 * 两半钉的都是活的东西:
 *   上半 · **真渲染**那一面上的两块真钱表面 —— 余额卡与花费上限卡
 *          (`app/billing/SpendCapCard.tsx`),含「读不到上限就如实报错」那条分支;
 *   下半 · **唯一来源**普查 —— 屏幕上那两句话在产品源码里一个字面量都不许有,只能来自
 *          `lib/exits.ts`;全仓只有一处产品代码读得到货架;退役的那一面一旦被重新接上
 *          路由,这里立刻红(那天第二臂要多长一只手,把它也渲染进来)。
 * 「一个状态两句话」是 #687 真正要挡的事,下半挡的就是它。
 *
 * #786 追加第三条钉板:**「拿不到货架」不是「没有货」**。价格目录调用抛错时,产品并不知道
 * 货架是空是满 —— 所以不许说「没有」,也不许因此把商家引去写邮件(#771 自己立的围栏:
 * 可重试的错误不挂人工出口)。下面这一组的货架状态由**真的 `listCreditPacks`** 对着一次
 * 真的 Stripe 抛错产出,不是手写的常量 —— 页面读的就是那一层真实给出的判词。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CREDIT_PACKS_UNREADABLE_MESSAGE, NO_CREDIT_PACKS_MESSAGE } from "@/lib/exits";
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
  // 不 mock 就会打真 auth 假红。它的返回形状与真 action 一样有两种(读到 / 读不到),
  // 第二臂要两种都渲染一遍,所以这里就照真形状标注类型。
  getOwnerSettings: vi.fn<() => Promise<{ spendCapCredits: number } | { error: string }>>(
    async () => ({ spendCapCredits: 0 }),
  ),
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

/** 这一页读到的上限:一个真的数,或者一次读不到。 */
type SettingsVerdict = { spendCapCredits: number } | { error: string };

/** The /billing page rendered against a given shelf verdict (default: nothing on sale). */
async function renderBillingPage(
  shelf: CreditPackShelf = { packs: [] },
  settings: SettingsVerdict = { spendCapCredits: 0 },
  accountVerdict: AccountInfo | { error: string } = account,
): Promise<HTMLDivElement> {
  mocks.getMyAccount.mockResolvedValue(accountVerdict);
  mocks.listCreditPacks.mockResolvedValue(shelf);
  mocks.getSpendOverview.mockResolvedValue({
    entries: [],
    window: { taskLimit: 20, returned: 0, hasMore: false },
  });
  mocks.getOwnerSettings.mockResolvedValue(settings);
  const element = await BillingPage({ searchParams: Promise.resolve({}) });
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

/** The one sentence about an empty shelf, wherever it is rendered. */
function emptyShelfSentence(host: HTMLElement): string {
  const match = (host.textContent ?? "").match(/No credit packs[^.]*\./);
  expect(match, "neither page says anything about the empty shelf").toBeTruthy();
  return match![0];
}

/**
 * 空货架那一块**本身**(不是整页)。
 *
 * 判官 P2-a:原来那条断言是「货架区里没有一颗**文案含 Top up** 的 /billing 链接」——
 * 文案一改(「Add credits」「Buy more」)围栏就失明,而它要挡的从来不是那三个字母,是
 * 「没有东西可卖时还给一颗看起来能买的按钮」。所以查询收紧到区块内、且不认文案:
 * 这一块里**一条指向充值页的链接都不许有**。
 */
function emptyShelfBlock(host: HTMLElement): HTMLElement {
  const carrier = Array.from(host.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && (el.textContent ?? "").includes(NO_CREDIT_PACKS_MESSAGE),
  );
  expect(carrier, "页面上找不到那句空货架的话").toBeTruthy();
  // 空态那一块本身(`<Empty>` 的根),不是它外面那个还装着余额卡的 `<section>` ——
  // 范围放宽就等于替别的区块作答,范围就是断言的一部分。
  const block = carrier!.closest('[data-slot="empty"]');
  expect(block, "空货架那句话不在一个空态块里 —— 无法判定「区块内」").toBeTruthy();
  return block as HTMLElement;
}

describe("#687 an empty credit shelf is one sentence and not a dead end", () => {
  it("念的是共享常量本人,不是自己写的第二句", async () => {
    expect(emptyShelfSentence(await renderBillingPage())).toBe(NO_CREDIT_PACKS_MESSAGE);
  });

  it("/billing gives the merchant somewhere to go, not a dead end", async () => {
    const host = await renderBillingPage();
    const block = emptyShelfBlock(host);

    // 没有东西可卖 ⇒ 这一块里不许出现任何指向充值页的链接(不看文案,只看去处)。
    expect(
      Array.from(block.querySelectorAll('a[href="/billing"]')).map((a) => a.textContent?.trim()),
      "货架空着,却还在这一块里挂了一条通往充值页的链接",
    ).toEqual([]);

    const exit = block.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
    expect(exit, "a merchant who wants to pay is shown a full stop and nothing else").toBeTruthy();
    expect(exit!.getAttribute("href")).toMatch(/^mailto:[^@\s]+@[^@\s]+/);
    expect(exit!.textContent?.trim()).not.toBe("");
  });

  it("promises nothing about when packs come back", async () => {
    const sentence = emptyShelfSentence(await renderBillingPage());
    expect(sentence, "the product does not know when the shelf refills — it must not say").not.toMatch(
      /soon|shortly|back|later|tomorrow|hours?|days?/i,
    );
  });
});

/**
 * #687 的第二臂(判官 P2-f)第一半 —— **换成真渲染**。
 *
 * 原来那一臂渲染 `buildSettingsSections` + `SettingsPage`,而新壳里那一面没有任何路由挂它
 * (`OttoAccount` 的文件头自己写着这件事)。钉在死代码上的围栏保护不了任何商家。
 * 新壳上「Billing & credits」这一面就是 `/billing`,它上面有两块真的钱表面:**余额卡**
 * 与**花费上限卡**(`app/billing/SpendCapCard.tsx`)。第二臂改成钉这两块 —— 它们和上面
 * 那条空货架的臂一样,渲染的是真页面,不是一个没人看得见的组件。
 */
describe("#687 第二臂:Billing & credits 上的两块真钱表面", () => {
  it("余额卡与花费上限卡都真的画在这一页上", async () => {
    const host = await renderBillingPage();
    const text = host.textContent ?? "";
    expect(text, "余额卡不在这一页上").toContain("Available balance");
    expect(text, "余额那个数字不见了").toContain("100");
    // 上限控件本体:0 ⇒ 「No cap set」+ 「Set a cap」,不是一个可编辑的裸 0。
    expect(text, "花费上限卡不在这一页上 —— 服务端照旧按它拒绝,商家却看不见").toContain("Spend cap");
    expect(text, "0 被画成了一个裸 0,而不是「没设上限」").toContain("No cap set");
    expect(text).toContain("Set a cap");
  });

  it("上限是几就说几 —— 不把商家自己设的数字吞掉", async () => {
    const host = await renderBillingPage({ packs: [] }, { spendCapCredits: 25 });
    const cap = host.querySelector<HTMLInputElement>('input[type="number"]');
    expect(cap, "上限有值的时候没有可编辑的输入框").toBeTruthy();
    expect(cap!.getAttribute("value")).toBe("25");
    expect(host.textContent, "有上限却还说「没设上限」").not.toContain("No cap set");
  });

  /**
   * 判官 P2-g —— `app/billing/page.tsx` 里「读不到上限就如实报错」那条分支从来没被渲染过。
   *
   * 这条分支挡的是一句会骗人的话:读取失败时渲染一个 0,屏幕上就会写「No cap set」,
   * 而商家的动作此刻可能正被一个我们读不出来的上限拦着 —— 那是一句我们没有证据的话。
   */
  it("读不到上限就说读不到,绝不改口成「没设上限」", async () => {
    const host = await renderBillingPage({ packs: [] }, { error: "Sign in first." });
    const text = host.textContent ?? "";
    expect(text, "读取失败却什么都没说").toContain("Spend cap unavailable");
    expect(text, "读不到上限,却对商家宣称他没设过上限").not.toContain("No cap set");
    // 报错也要说清楚「上限本身没变,仍然生效」——否则商家会以为自己的保护没了。
    expect(text).toContain("the cap itself is unchanged and still applies");
    // 而且这条分支不许把这一页别的东西一起吞掉:余额与货架照常。
    expect(text).toContain("Available balance");
    expect(text).toContain(NO_CREDIT_PACKS_MESSAGE);
  });
});

/**
 * #687 的第二臂(判官 P2-f)第二半 —— 那句话的**唯一来源**。
 *
 * 真渲染证明得了「这一面在」,证明不了「全仓没有第二份同义的句子」。#687 的病正是后者
 * (一个状态两句话),所以这一半普查产品源码:句子只能从 `lib/exits.ts` 取,货架只有一个
 * 读者,退役的那一面一旦被重新接上路由就当场红。
 */
const WEB = path.resolve(__dirname, "../..");
const PRODUCT_ROOTS = ["app", "components"];
const SKIP_DIRS = new Set(["__tests__", "node_modules", ".next", "dist", "generated"]);

function productFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) productFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** 注释里的名字是历史,不是事实 —— 判定前先剥掉(与 library-real-route-986 同一个做法)。 */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const PRODUCT_SOURCES = PRODUCT_ROOTS.flatMap((root) => productFiles(path.join(WEB, root))).map(
  (file) => {
    const raw = readFileSync(file, "utf8");
    return {
      file: path.relative(WEB, file).split(path.sep).join("/"),
      /** 文案普查看原文(屏幕上的字可能就写在 JSX 里),依赖普查看剥了注释的代码。 */
      text: raw,
      code: stripComments(raw),
    };
  },
);

describe("#687 第二臂(下半):一个状态一句话,那句话只有一个来源", () => {
  it("普查面本身不是空集", () => {
    expect(PRODUCT_SOURCES.length).toBeGreaterThan(100);
  });

  it.each([
    ["空货架", NO_CREDIT_PACKS_MESSAGE],
    ["读不到货架", CREDIT_PACKS_UNREADABLE_MESSAGE],
  ])("%s 那句话在产品源码里一个字面量都没有 —— 只能从 lib/exits.ts 取", (_what, sentence) => {
    const literals = PRODUCT_SOURCES.filter(({ text }) => text.includes(sentence)).map(({ file }) => file);
    expect(
      literals,
      "有人把这句话又抄了一遍 —— #687 的病(一个状态两句话)就是这样开始的",
    ).toEqual([]);
  });

  it("全仓只有一处产品代码读得到货架", () => {
    const readers = PRODUCT_SOURCES.filter(({ code }) => /\blistCreditPacks\b/.test(code)).map(({ file }) => file);
    expect(readers.sort(), "多了一处钱面 —— 第二臂要把它的真渲染加回这份围栏").toEqual([
      "app/billing/page.tsx",
    ]);
  });

  it("退役的那一面仍然没有路由 —— 它一旦复活,这条围栏就要长回第二只手", () => {
    const routed = PRODUCT_SOURCES.filter(
      ({ file, code }) =>
        file.startsWith("app/") && /\b(?:buildSettingsSections|OttoAccount)\b/.test(code),
    ).map(({ file }) => file);
    expect(
      routed,
      "旧 Settings 账务面被重新接上了路由 —— 现在它是真表面,请恢复第二臂的真渲染",
    ).toEqual([]);
  });
});

describe("#786 a shelf we could not read is not an empty shelf", () => {
  it("念的是共享常量本人,不是自己写的第二句", async () => {
    const host = await renderBillingPage(await unreadableShelf());
    expect(host.textContent, "the page says nothing about failing to read the catalogue").toContain(
      CREDIT_PACKS_UNREADABLE_MESSAGE,
    );
  });

  it("/billing hangs no human exit on an error the merchant can simply retry", async () => {
    const host = await renderBillingPage(await unreadableShelf());

    expect(
      host.querySelector('a[href^="mailto:"]'),
      "a retryable catalogue error must not send the merchant to a human (#771's own fence)",
    ).toBeNull();
  });

  it("/billing never claims the shelf is empty when it never saw the shelf", async () => {
    const host = await renderBillingPage(await unreadableShelf());

    expect(
      host.textContent,
      "asserts there is nothing on sale on the strength of a failed read",
    ).not.toMatch(/No credit packs/);
  });
});


/* ── 前端基线①(#1139 钱面判官登记):e2e 旅程 05 负向断言钉的那几个字,产品里真的有 ──── */

/**
 * `e2e/journeys/05-topup-shelf-honesty.spec.ts` 有一条负向断言:充值货架空着的时候,
 * **余额读失败那张卡不许在屏幕上**。判官发现它钉的是旧壳的 "Could not load balance.
 * Please refresh." —— 换壳后那句话在仓里一个字都不剩,于是那条断言永远绿:余额真的读
 * 失败它也不会红。
 *
 * 负向断言天生有这个病:钉的字一旦从产品里消失,它就静静地什么都不管了,而且**永远不会
 * 因此变红**。所以这一条从正面把那张卡钉住 —— 它长什么样、写哪几个字、挂不挂 `role="alert"`。
 * 改文案、去掉 role、把标题并进描述,这里先红,e2e 那条不会再悄悄失效。
 */
describe("余额读不到时那张卡:e2e 05 钉的就是这几个字", () => {
  it("是一张 role=alert 的卡,标题与描述逐字如 e2e 所钉", async () => {
    const host = await renderBillingPage({ packs: [] }, { spendCapCredits: 0 }, { error: "load-failed" });

    const alerts = Array.from(host.querySelectorAll('[role="alert"]')).filter((el) =>
      (el.textContent ?? "").includes("Balance unavailable"),
    );
    expect(alerts.length, "余额读失败时没有一张写着 Balance unavailable 的 role=alert 卡").toBe(1);
    expect(alerts[0]!.textContent).toContain("Refresh to try reading it again.");

    // 而余额真的读得到时,这张卡不许在 —— 否则上面那条只是「页面上总有这张卡」。
    const ok = await renderBillingPage();
    expect(ok.textContent).not.toContain("Balance unavailable");
  });
});
