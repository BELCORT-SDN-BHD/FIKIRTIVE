/**
 * #791 公开页面文案与产品事实对齐。
 *
 * 这些页面是没登录的人唯一读得到的东西 —— 一句低估或高估自己的话,在这里的代价
 * 最高。测试读的是页面源码里的文案常量,因为这些页是 server component,渲染需要
 * 会话/DB;文案本身是纯字符串,读得到就钉得住。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { redactProviderNames } from "@fikirtive/core/provider-secrecy";

const webRoot = path.resolve(__dirname, "../..");
/** Page source with comments stripped — a comment recording what a line USED to say is
 *  not something a visitor reads, and must not count as the page still saying it. */
const readCopy = (rel: string) =>
  readFileSync(path.join(webRoot, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

describe("#791-5 登录页不再低估自己的发布器", () => {
  const login = readCopy("app/login/page.tsx");

  it("不再说「direct publish is coming soon」—— 发布器早就写好了", () => {
    expect(login).not.toMatch(/coming soon/i);
  });

  it("改说真正的卡点:Meta 的审核", () => {
    expect(login).toMatch(/Instagram and Facebook/);
    expect(login).toMatch(/Meta approves/);
  });
});

// ── #791-8 对外不称 beta(Founder 裁决 2026-08-08 裁决④)──────────────────
//
// 条款页与私隐页把产品称作「invite-only beta」,注册页把 credits 叫「free」,而这些
// credits 是卖的、产品是收费的。称 beta 有两个代价:对商家是「这东西还没做好」的
// 暗示,对我们是一句随时可以拿来搪塞的免责。裁决:对外不再称 beta;合理的「价格与
// 功能会变」的权利以事实陈述保留,不靠 beta 这个词。
describe("#791-8 对外文案不再称 beta", () => {
  for (const page of ["app/terms/page.tsx", "app/privacy/page.tsx", "app/privacy/bm/page.tsx"]) {
    it(`${page} 的正文里没有 beta`, () => {
      expect(readCopy(page)).not.toMatch(/\bbeta\b/i);
    });
  }

  it("条款仍然保留「功能、价格、限制会变」这项权利 —— 去掉的是词,不是条款", () => {
    const terms = readCopy("app/terms/page.tsx");
    expect(terms).toMatch(/features, prices/i);
    expect(terms).toMatch(/continue to change/i);
  });

  it("管辖法这一句照旧成立(法律实质不动,只去掉 beta 这个词)", () => {
    expect(readCopy("app/terms/page.tsx")).toMatch(/governed\s*\n?\s*by the laws of Malaysia/);
  });
});

// ── #810 P3-2:注册页的承诺与价目表钉在一起 ────────────────────────────────
//
// packages/core 的 spend.test.ts 断言「赠额 ≥ 一场对话 + 一张图 + 一条 5s 视频」,
// 三项全部从活的计价权威读。但那条测试证明不了它算的就是**注册页真正承诺的那句
// 话** —— 页面上多写一件、或者把数字打死成 "25 free credits",价目表那侧一无所知。
// 这里补上另一半:页面的数字必须是算出来的,承诺的必须正好是被算过价的那三件。
describe("#810 P3-2 注册页承诺不许自己长出数字或第四件东西", () => {
  const signup = readCopy("app/signup/page.tsx");

  /** 把「enough for a full run: …」后面那句承诺拆成一件一件东西。
   *
   *  JSX 里这句被折行、夹着 {" "} 与 {starterCredits},所以先还原成一行纯文本:去掉表达式与
   *  标签、压平空白,再按句号截断、按逗号 / and 拆项。拆出来的是**商家眼睛看到的东西**,
   *  不是源码形状 —— 只有这样,「承诺了几件」才是断言得了的。 */
  function promisedItems(): string[] {
    const flat = signup
      .replace(/\{[^{}]*\}/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    const after = flat.split(/enough for a full run:/i)[1];
    if (!after) return [];
    return (after.split(".")[0] ?? "")
      .split(/,|\band\b/i)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  it("数字是从赠额常量算出来的,不是打上去的", () => {
    expect(signup).toContain("displayCredits(SIGNUP_GRANT_CREDITS)");
    expect(signup).toMatch(/\{starterCredits\}\s*free credits/);
    // 正文里不许出现「<数字> free credits」这种写死的说法(改赠额时它会静静变成谎话)。
    expect(signup).not.toMatch(/\d+\s*free credits/);
  });

  // #810 r3 P3:r2 这条只数「, a/an 出现几次」并要求 ≤2 —— 追加 "and analytics" 照样过,
  // 因为那一项不带冠词。改成真正把承诺**枚举出来**,断言这个集合恰好等于被算过价的三件:
  // 多一件、少一件、换一件,都在这里先红。
  it("承诺的正好是被算过价的那三件:一场对话、一张图、一条短视频", () => {
    expect(promisedItems()).toEqual(["a conversation with Otto", "an image", "a short video"]);
  });
});

// ── #805 主话术:「它帮你把活干完了」 ─────────────────────────────────────────
//
// Founder 裁决(2026-08-08 弹窗 产品⑤):主话术改为「它帮你把活干完了 —— 建活动、
// 调分群、看钱、换素材」;「像真人」降为体验描述,不作定价论据。背景是 Meta 已在
// 2026-06-03 把「WhatsApp 里会聊天的 AI」免费化 —— 会聊天不再是卖点,活干完了才是。
//
// 商家看得到的这三面(登录页 = 未登录唯一读得到的落地面、注册页、Otto 进门自我介绍)
// 必须说同一句话。仓内没有独立官网,登录页左半屏就是落地文案本体。
describe("#805 对外主话术:先说把活干完", () => {
  /** 商家看得到、且承载主话术的三面。Otto 提示词那一面由
   *  packages/otto/src/instructions.test.ts 钉(它在另一个包,读不到这里)。 */
  const SURFACES: ReadonlyArray<[string, string]> = [
    ["登录页", "app/login/page.tsx"],
    ["注册页", "app/signup/page.tsx"],
    ["Otto 进门", "components/otto/OttoFrontDoor.tsx"],
  ];

  describe("登录页", () => {
    const login = readCopy("app/login/page.tsx");

    it("主标题说的是活干完了,不是「不用变成 marketer」", () => {
      expect(login).toMatch(/Otto gets the/);
      expect(login).toMatch(/work done/);
      expect(login).not.toMatch(/without becoming a/i);
    });

    it("四件事一件不少:建活动、调分群、看钱、换素材", () => {
      for (const outcome of [/campaign/i, /segment/i, /where the money went/i, /creative/i]) {
        expect(login).toMatch(outcome);
      }
    });

    it("不拿证明不了的社会证明当卖点(没有可指名的公开商家)", () => {
      expect(login).not.toMatch(/\btrusted by\b/i);
    });

    // r2 · 判官 P1(PR #831 评论 5232023830):第一版写的是「brings every paid step back for
    // you to approve first」。**这句话是假的** —— 和 Otto 聊天本身就按消息预扣结算,那条路
    // (OttoFrontDoor 的 ottoTurn 调用)上根本没有审批卡。审批卡真实覆盖的是付费生成与发布。
    // 未登录的人读到的第一句钱路承诺,只能说得比事实小,不许说得比事实大。
    it("不承诺「凡花钱都先经你点头」—— 审批卡覆盖的是做东西与发布,不是每一次计费", () => {
      expect(login).not.toMatch(/every paid step/i);
      expect(login).not.toMatch(/every step that (?:spends|costs)/i);
    });

    it("说的是审批卡真正管得住的那一半", () => {
      expect(login).toMatch(/nothing gets made or published until you approve/i);
    });
  });

  it("注册页把 Otto 派去干活,不只是介绍认识", () => {
    const signup = readCopy("app/signup/page.tsx");
    expect(signup).toMatch(/put Otto to work/);
    expect(signup).not.toMatch(/meet Otto/i);
  });

  it("Otto 进门那句说的是做完的活,不是「我陪你走一遍」", () => {
    const frontDoor = readCopy("components/otto/OttoFrontDoor.tsx");
    expect(frontDoor).toMatch(/I&apos;ll do the work/);
  });

  // 裁决的第二半:「像真人」可以是体验描述,但不许出现在商家可见表面上当卖点。
  // 这里禁的是**把「像真人」写成产品价值**的那一族说法,不禁「warm」「plain language」
  // 这类体验用词 —— 那些本来就允许。
  const HUMAN_AS_VALUE =
    /\blike a (?:real )?(?:person|human)\b|\bhuman-?like\b|\blike talking to a (?:real )?(?:person|human)\b|\bjust like a human\b/i;

  for (const [name, rel] of SURFACES) {
    it(`${name}不拿「像真人」当卖点`, () => {
      expect(readCopy(rel)).not.toMatch(HUMAN_AS_VALUE);
    });
  }

  // 白标铁律:供应商/模型名不得出现在任何商家可见表面。不另抄一份名单 —— 直接用
  // 洗名权威本身:洗过之后一个字节都没变,才叫没提过。
  for (const [name, rel] of SURFACES) {
    it(`${name}不出现供应商或模型名`, () => {
      const copy = readCopy(rel);
      expect(redactProviderNames(copy)).toBe(copy);
    });
  }
});
